/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { AuditAction, PaymentComplianceCase } from '../../shared/types.ts';
import { sha256 } from './normalizer.ts';

export interface WalRecord {
  seq: number;
  timestamp: string;
  eventType: 'CASE_UPSERT' | 'DECISION_RECORDED' | 'EVIDENCE_SEALED' | 'WORKFLOW_UPSERT';
  tenantId: string;
  entityId: string;
  payload: any;
  previousWalHash: string;
  walHash: string;
}

export interface StorageBackupManifest {
  backupId: string;
  createdAt: string;
  caseCount: number;
  workflowCount: number;
  walSequence: number;
  lastWalHash: string;
  snapshotSha256: string;
  sha256: string;
  backupFilePath: string;
  filePath: string;
}

export class DurableStorageEngine {
  private readonly stateDir: string;
  private readonly storeFilePath: string;
  private readonly walFilePath: string;
  private readonly backupDir: string;
  private readonly sqliteDbPath: string;
  private walSeq = 0;
  private lastWalHash = 'GENESIS_WAL';
  private sqliteAvailable = false;

  constructor(customDataDir?: string) {
    this.stateDir = path.resolve(
      process.cwd(),
      customDataDir || process.env.STATE_DATA_DIR || process.env.DATA_DIR || process.env.PAYMENTS_DATA_DIR || 'data'
    );
    this.storeFilePath = path.join(this.stateDir, 'payments_store.json');
    this.walFilePath = path.join(this.stateDir, 'compliancegate_wal.jsonl');
    this.backupDir = path.join(this.stateDir, 'backups');
    this.sqliteDbPath = path.join(this.stateDir, 'compliancegate.sqlite');
    this.ensureDirectories();
    this.initSqliteIfAvailable();
  }

  public getStateDir(): string {
    return this.stateDir;
  }

  private ensureDirectories(): void {
    try {
      fs.mkdirSync(this.stateDir, { recursive: true });
      fs.mkdirSync(this.backupDir, { recursive: true });
    } catch {
      // Constrained read-only environment fallback
    }
  }

  private initSqliteIfAvailable(): void {
    try {
      execFileSync('sqlite3', [
        this.sqliteDbPath,
        `PRAGMA journal_mode=WAL;
         PRAGMA synchronous=NORMAL;
         CREATE TABLE IF NOT EXISTS cases (
           case_id TEXT PRIMARY KEY,
           tenant_id TEXT NOT NULL,
           status TEXT NOT NULL,
           priority TEXT NOT NULL,
           evidence_hash TEXT NOT NULL,
           updated_at TEXT NOT NULL,
           payload_json TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS audit_records (
           action_id TEXT PRIMARY KEY,
           case_id TEXT NOT NULL,
           tenant_id TEXT NOT NULL,
           analyst_id TEXT NOT NULL,
           decision TEXT NOT NULL,
           previous_hash TEXT NOT NULL,
           server_checksum TEXT NOT NULL,
           created_at TEXT NOT NULL,
           payload_json TEXT NOT NULL
         );`,
      ], { stdio: 'ignore', timeout: 3000 });
      this.sqliteAvailable = true;
    } catch {
      this.sqliteAvailable = false;
    }
  }

  /**
   * Appends a tamper-evident record to the Write-Ahead Log with explicit fsync before mutating state.
   */
  public appendWal(
    eventType: WalRecord['eventType'],
    tenantId: string,
    entityId: string,
    payload: any
  ): WalRecord {
    this.walSeq += 1;
    const timestamp = new Date().toISOString();
    const previousWalHash = this.lastWalHash;
    const walHash = sha256({
      seq: this.walSeq,
      timestamp,
      eventType,
      tenantId,
      entityId,
      payloadDigest: sha256(payload),
      previousWalHash,
    });
    this.lastWalHash = walHash;

    const record: WalRecord = {
      seq: this.walSeq,
      timestamp,
      eventType,
      tenantId,
      entityId,
      payload,
      previousWalHash,
      walHash,
    };

    try {
      const fd = fs.openSync(this.walFilePath, 'a');
      try {
        fs.writeSync(fd, JSON.stringify(record) + '\n', null, 'utf8');
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      // Ignore if running in read-only sandbox
    }

    if (this.sqliteAvailable && (eventType === 'CASE_UPSERT' || eventType === 'DECISION_RECORDED')) {
      this.syncCaseToSqlite(payload as PaymentComplianceCase, tenantId);
    }

    return record;
  }

  private syncCaseToSqlite(c: PaymentComplianceCase, tenantId: string): void {
    if (!c || !c.caseId) return;
    try {
      const esc = (s: string) => s.replace(/'/g, "''");
      const jsonStr = esc(JSON.stringify(c));
      let sql = `INSERT OR REPLACE INTO cases (case_id, tenant_id, status, priority, evidence_hash, updated_at, payload_json)
                 VALUES ('${esc(c.caseId)}', '${esc(tenantId)}', '${esc(c.status)}', '${esc(c.priority)}', '${esc(c.evidenceHash)}', '${esc(c.updatedAt)}', '${jsonStr}');\n`;

      for (const act of c.auditTrail || []) {
        const actJson = esc(JSON.stringify(act));
        sql += `INSERT OR REPLACE INTO audit_records (action_id, case_id, tenant_id, analyst_id, decision, previous_hash, server_checksum, created_at, payload_json)
                VALUES ('${esc(act.actionId)}', '${esc(c.caseId)}', '${esc(tenantId)}', '${esc(act.analystId)}', '${esc(act.decision)}', '${esc(act.previousHash || 'GENESIS')}', '${esc(act.serverChecksum)}', '${esc(act.timestamp)}', '${actJson}');\n`;
      }
      execFileSync('sqlite3', [this.sqliteDbPath, sql], { stdio: 'ignore', timeout: 2500 });
    } catch {
      // Non-fatal fallback to WAL + atomic JSON checkpoint
    }
  }

  /**
   * Atomically writes the checkpoint snapshot using write-to-temp + fsync + rename.
   */
  public saveCheckpoint(cases: PaymentComplianceCase[], workflows: any[] = []): void {
    try {
      this.ensureDirectories();
      const dump = {
        schemaVersion: '2.0.0-DURABLE-WAL',
        savedAt: new Date().toISOString(),
        walSequence: this.walSeq,
        lastWalHash: this.lastWalHash,
        cases,
        workflows,
      };
      const rawJson = JSON.stringify(dump, null, 2);
      const tmpPath = `${this.storeFilePath}.tmp.${process.pid}.${Date.now()}`;
      const fd = fs.openSync(tmpPath, 'w');
      try {
        fs.writeSync(fd, rawJson, null, 'utf8');
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(tmpPath, this.storeFilePath);
    } catch {
      // Ignore if read-only filesystem
    }
  }

  /**
   * Loads cases and workflows from checkpoint and replays any newer WAL entries for crash recovery.
   */
  public loadAndRecoverState(): { cases: Map<string, PaymentComplianceCase>; workflows: Map<string, any> } {
    const cases = new Map<string, PaymentComplianceCase>();
    const workflows = new Map<string, any>();

    // 1. Load checkpoint snapshot
    try {
      if (fs.existsSync(this.storeFilePath)) {
        const raw = fs.readFileSync(this.storeFilePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (typeof parsed.walSequence === 'number') {
          this.walSeq = parsed.walSequence;
        }
        if (typeof parsed.lastWalHash === 'string') {
          this.lastWalHash = parsed.lastWalHash;
        }
        if (Array.isArray(parsed.cases)) {
          for (const c of parsed.cases) {
            cases.set(c.caseId, c);
          }
        }
        if (Array.isArray(parsed.workflows)) {
          for (const w of parsed.workflows) {
            workflows.set(w.workflowId, w);
          }
        }
      }
    } catch {
      // If checkpoint is missing or corrupted, WAL replay below reconstructs state
    }

    // 2. Replay WAL records to recover any uncommitted post-checkpoint mutations
    try {
      if (fs.existsSync(this.walFilePath)) {
        const lines = fs.readFileSync(this.walFilePath, 'utf8').split(/\r?\n/).filter(Boolean);
        for (const line of lines) {
          try {
            const rec = JSON.parse(line) as WalRecord;
            if (rec.seq > this.walSeq) {
              this.walSeq = rec.seq;
              this.lastWalHash = rec.walHash;
            }
            if ((rec.eventType === 'CASE_UPSERT' || rec.eventType === 'DECISION_RECORDED') && rec.payload?.caseId) {
              cases.set(rec.payload.caseId, rec.payload);
            } else if (rec.eventType === 'WORKFLOW_UPSERT' && rec.payload?.workflowId) {
              workflows.set(rec.payload.workflowId, rec.payload);
            }
          } catch {
            // Skip malformed tail line if interrupted mid-append
          }
        }
      }
    } catch {
      // Ignore if WAL does not exist yet
    }

    return { cases, workflows };
  }

  /**
   * Verifies the cryptographic hash chain of the Write-Ahead Log on disk.
   */
  public verifyWalIntegrity(): {
    isValid: boolean;
    valid: boolean;
    totalRecords: number;
    entryCount: number;
    brokenAtSeq?: number;
    reason?: string;
  } {
    if (!fs.existsSync(this.walFilePath)) {
      return { isValid: true, valid: true, totalRecords: 0, entryCount: 0 };
    }

    const lines = fs.readFileSync(this.walFilePath, 'utf8').split(/\r?\n/).filter(Boolean);
    let expectedPrev = 'GENESIS_WAL';

    for (let i = 0; i < lines.length; i++) {
      try {
        const rec = JSON.parse(lines[i]) as WalRecord;
        if (rec.previousWalHash !== expectedPrev) {
          return {
            isValid: false,
            valid: false,
            totalRecords: lines.length,
            entryCount: lines.length,
            brokenAtSeq: rec.seq,
            reason: `WAL chain link broken at seq ${rec.seq}: expected previousWalHash ${expectedPrev}, got ${rec.previousWalHash}`,
          };
        }
        const recomputed = sha256({
          seq: rec.seq,
          timestamp: rec.timestamp,
          eventType: rec.eventType,
          tenantId: rec.tenantId,
          entityId: rec.entityId,
          payloadDigest: sha256(rec.payload),
          previousWalHash: rec.previousWalHash,
        });
        if (recomputed !== rec.walHash) {
          return {
            isValid: false,
            valid: false,
            totalRecords: lines.length,
            entryCount: lines.length,
            brokenAtSeq: rec.seq,
            reason: `WAL payload hash mismatch at seq ${rec.seq}`,
          };
        }
        expectedPrev = rec.walHash;
      } catch {
        return {
          isValid: false,
          valid: false,
          totalRecords: lines.length,
          entryCount: lines.length,
          brokenAtSeq: i + 1,
          reason: `Corrupted JSON line in WAL at line ${i + 1}`,
        };
      }
    }

    return { isValid: true, valid: true, totalRecords: lines.length, entryCount: lines.length };
  }

  public listBackups(): StorageBackupManifest[] {
    this.ensureDirectories();
    try {
      const files = fs.readdirSync(this.backupDir).filter((f) => f.endsWith('.json'));
      const manifests: StorageBackupManifest[] = [];
      for (const f of files) {
        try {
          const fullPath = path.join(this.backupDir, f);
          const bundle = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
          manifests.push({
            backupId: bundle.backupId || f.replace(/\.json$/, ''),
            createdAt: bundle.createdAt || new Date().toISOString(),
            caseCount: (bundle.cases || []).length,
            workflowCount: (bundle.workflows || []).length,
            walSequence: bundle.walSequence || 0,
            lastWalHash: bundle.lastWalHash || 'GENESIS_WAL',
            snapshotSha256: bundle.snapshotSha256 || '',
            sha256: bundle.snapshotSha256 || '',
            backupFilePath: fullPath,
            filePath: fullPath,
          });
        } catch {
          // ignore malformed file
        }
      }
      return manifests;
    } catch {
      return [];
    }
  }

  /**
   * Creates an immutable checksummed backup bundle of all cases, audit records, and workflows.
   */
  public createBackup(casesOrLabel?: PaymentComplianceCase[] | string, workflows: any[] = []): StorageBackupManifest {
    this.ensureDirectories();
    let cases: PaymentComplianceCase[];
    let wfList: any[] = workflows;
    if (Array.isArray(casesOrLabel)) {
      cases = casesOrLabel;
    } else {
      const recovered = this.loadAndRecoverState();
      cases = Array.from(recovered.cases.values());
      if (wfList.length === 0) {
        wfList = Array.from(recovered.workflows.values());
      }
    }
    const labelSuffix = typeof casesOrLabel === 'string' ? `_${casesOrLabel.replace(/[^a-zA-Z0-9_-]/g, '')}` : '';
    const backupId = `bkp_${Date.now()}${labelSuffix}_${crypto.randomUUID().slice(0, 6)}`;
    const createdAt = new Date().toISOString();
    const backupPayload = {
      backupId,
      createdAt,
      walSequence: this.walSeq,
      lastWalHash: this.lastWalHash,
      cases,
      workflows: wfList,
    };
    const snapshotSha256 = sha256({ cases, workflows: wfList, walSequence: this.walSeq });
    const backupFilePath = path.join(this.backupDir, `${backupId}.json`);

    const fullBundle = {
      ...backupPayload,
      snapshotSha256,
    };

    fs.writeFileSync(backupFilePath, JSON.stringify(fullBundle, null, 2), 'utf8');

    return {
      backupId,
      createdAt,
      caseCount: cases.length,
      workflowCount: wfList.length,
      walSequence: this.walSeq,
      lastWalHash: this.lastWalHash,
      snapshotSha256,
      sha256: snapshotSha256,
      backupFilePath,
      filePath: backupFilePath,
    };
  }

  /**
   * Restores state from a verified backup bundle, validating its SHA-256 digest before applying.
   */
  public restoreFromBackup(backupIdOrPath: string): {
    cases: PaymentComplianceCase[];
    transactions: any[];
    auditLog: any[];
    workflows: any[];
    manifest: StorageBackupManifest;
  } {
    const candidatePath = fs.existsSync(backupIdOrPath)
      ? backupIdOrPath
      : path.join(this.backupDir, `${backupIdOrPath.replace(/\.json$/, '')}.json`);

    if (!fs.existsSync(candidatePath)) {
      throw new Error(`Backup file not found: ${backupIdOrPath}`);
    }

    const raw = fs.readFileSync(candidatePath, 'utf8');
    const bundle = JSON.parse(raw);
    const recomputedSha = sha256({
      cases: bundle.cases || [],
      workflows: bundle.workflows || [],
      walSequence: bundle.walSequence || 0,
    });

    if (recomputedSha !== bundle.snapshotSha256) {
      throw new Error(
        `Backup integrity verification failed for ${backupIdOrPath}: expected SHA-256 ${bundle.snapshotSha256}, got ${recomputedSha}`
      );
    }

    const casesList: PaymentComplianceCase[] = bundle.cases || [];
    this.saveCheckpoint(casesList, bundle.workflows || []);

    const transactions = casesList.map((c) => c.transaction).filter(Boolean);
    const auditLog = casesList.flatMap((c) => c.auditTrail || []);

    return {
      cases: casesList,
      transactions,
      auditLog,
      workflows: bundle.workflows || [],
      manifest: {
        backupId: bundle.backupId,
        createdAt: bundle.createdAt,
        caseCount: casesList.length,
        workflowCount: (bundle.workflows || []).length,
        walSequence: bundle.walSequence || 0,
        lastWalHash: bundle.lastWalHash || 'GENESIS_WAL',
        snapshotSha256: bundle.snapshotSha256,
        sha256: bundle.snapshotSha256,
        backupFilePath: candidatePath,
        filePath: candidatePath,
      },
    };
  }
}

export const durableStorage = new DurableStorageEngine();
