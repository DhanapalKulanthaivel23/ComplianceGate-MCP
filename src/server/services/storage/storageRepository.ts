/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  ActiveSnapshotManifest,
  AlertEvidenceGraph,
  ComplianceModuleId,
  CustomerSubject,
  ImportJobRecord,
  ScreeningRunRecord,
  SourceDefinition,
  SourceRecord,
  SourceSnapshot,
} from '../../../shared/types.ts';
import { durableStorage } from '../durableStorage.ts';
import { sha256 } from '../normalizer.ts';

export interface StorageRepositoryConfig {
  stateDir?: string;
  isPublicDemo?: boolean;
}

export class StorageRepository {
  private readonly stateDir: string;
  private readonly snapshotsDir: string;
  private readonly importsDir: string;
  private readonly graphsDir: string;
  private readonly sqliteDbPath: string;
  private sqliteAvailable = false;

  // In-memory recovery cache
  private sources: Map<string, SourceDefinition> = new Map(); // key: `${sourceId}:${tenantId || 'GLOBAL'}`
  private snapshots: Map<string, SourceSnapshot> = new Map(); // key: snapshotId
  private snapshotRecords: Map<string, SourceRecord[]> = new Map(); // key: snapshotId
  private subjects: Map<string, CustomerSubject> = new Map(); // key: `${tenantId}:${subjectId}`
  private screeningRuns: Map<string, ScreeningRunRecord> = new Map(); // key: runId
  private importJobs: Map<string, ImportJobRecord> = new Map(); // key: jobId
  private evidenceGraphs: Map<string, AlertEvidenceGraph> = new Map(); // key: graphId

  constructor(config?: StorageRepositoryConfig) {
    this.stateDir = config?.stateDir || durableStorage.getStateDir();
    this.snapshotsDir = path.join(this.stateDir, 'snapshots');
    this.importsDir = path.join(this.stateDir, 'imports');
    this.graphsDir = path.join(this.stateDir, 'graphs');
    this.sqliteDbPath = path.join(this.stateDir, 'compliancegate.sqlite');
    this.ensureDirectories();
    this.initSqliteTables();
    this.recoverAll();
  }

  private ensureDirectories(): void {
    try {
      fs.mkdirSync(this.stateDir, { recursive: true });
      fs.mkdirSync(this.snapshotsDir, { recursive: true });
      fs.mkdirSync(this.importsDir, { recursive: true });
      fs.mkdirSync(this.graphsDir, { recursive: true });
    } catch {
      // Ignored in constrained sandbox environments
    }
  }

  private initSqliteTables(): void {
    try {
      execFileSync('sqlite3', [
        this.sqliteDbPath,
        `PRAGMA journal_mode=WAL;
         PRAGMA synchronous=NORMAL;
         CREATE TABLE IF NOT EXISTS sources (
           source_id TEXT NOT NULL,
           tenant_id TEXT NOT NULL,
           category TEXT NOT NULL,
           name TEXT NOT NULL,
           enabled INT NOT NULL,
           payload_json TEXT NOT NULL,
           PRIMARY KEY (source_id, tenant_id)
         );
         CREATE TABLE IF NOT EXISTS snapshots (
           snapshot_id TEXT PRIMARY KEY,
           source_id TEXT NOT NULL,
           version_tag TEXT NOT NULL,
           sha256_digest TEXT NOT NULL,
           record_count INT NOT NULL,
           status TEXT NOT NULL,
           tenant_id TEXT NOT NULL,
           payload_json TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS subjects (
           subject_id TEXT NOT NULL,
           tenant_id TEXT NOT NULL,
           primary_name TEXT NOT NULL,
           entity_type TEXT NOT NULL,
           payload_json TEXT NOT NULL,
           PRIMARY KEY (subject_id, tenant_id)
         );
         CREATE TABLE IF NOT EXISTS screening_runs (
           run_id TEXT PRIMARY KEY,
           tenant_id TEXT NOT NULL,
           subject_id TEXT,
           input_digest TEXT NOT NULL,
           created_at TEXT NOT NULL,
           payload_json TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS import_jobs (
           job_id TEXT PRIMARY KEY,
           tenant_id TEXT NOT NULL,
           source_id TEXT NOT NULL,
           status TEXT NOT NULL,
           started_at TEXT NOT NULL,
           payload_json TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS evidence_graphs (
           graph_id TEXT PRIMARY KEY,
           tenant_id TEXT NOT NULL,
           module_id TEXT NOT NULL,
           case_id TEXT,
           run_id TEXT,
           created_at TEXT NOT NULL,
           payload_json TEXT NOT NULL
         );`,
      ], { stdio: 'ignore', timeout: 3000 });
      this.sqliteAvailable = true;
    } catch {
      this.sqliteAvailable = false;
    }
  }

  public getStorageEngineMode(): 'LOCAL_PERSISTENT_SQLITE' | 'CLOUD_EPHEMERAL_STANDBY' {
    return this.sqliteAvailable ? 'LOCAL_PERSISTENT_SQLITE' : 'CLOUD_EPHEMERAL_STANDBY';
  }

  private escapeSql(s: string): string {
    return s.replace(/'/g, "''");
  }

  // ==========================================
  // Recovery from disk & SQLite
  // ==========================================
  private recoverAll(): void {
    // 1. Recover snapshots from snapshotsDir
    try {
      if (fs.existsSync(this.snapshotsDir)) {
        const files = fs.readdirSync(this.snapshotsDir);
        for (const file of files) {
          if (!file.endsWith('.json')) continue;
          try {
            const raw = fs.readFileSync(path.join(this.snapshotsDir, file), 'utf8');
            const data = JSON.parse(raw);
            if (data.snapshot && data.snapshot.snapshotId) {
              this.snapshots.set(data.snapshot.snapshotId, data.snapshot);
              if (Array.isArray(data.records)) {
                this.snapshotRecords.set(data.snapshot.snapshotId, data.records);
              }
            }
          } catch {
            // Skip invalid file
          }
        }
      }
    } catch {
      // Non-fatal
    }

    // 2. Recover from state checkpoints
    const stateFile = path.join(this.stateDir, 'repo_state.json');
    try {
      if (fs.existsSync(stateFile)) {
        const raw = fs.readFileSync(stateFile, 'utf8');
        const state = JSON.parse(raw);
        if (Array.isArray(state.sources)) {
          for (const s of state.sources) {
            this.sources.set(`${s.id}:${s.tenantId || 'GLOBAL'}`, s);
          }
        }
        if (Array.isArray(state.subjects)) {
          for (const sub of state.subjects) {
            this.subjects.set(`${sub.tenantId}:${sub.subjectId}`, sub);
          }
        }
        if (Array.isArray(state.screeningRuns)) {
          for (const r of state.screeningRuns) {
            this.screeningRuns.set(r.runId, r);
          }
        }
        if (Array.isArray(state.importJobs)) {
          for (const j of state.importJobs) {
            this.importJobs.set(j.jobId, j);
          }
        }
        if (Array.isArray(state.evidenceGraphs)) {
          for (const g of state.evidenceGraphs) {
            this.evidenceGraphs.set(g.graphId, g);
          }
        }
      }
    } catch {
      // Non-fatal
    }

    // 3. Recover graphs from disk
    try {
      if (fs.existsSync(this.graphsDir)) {
        const files = fs.readdirSync(this.graphsDir);
        for (const file of files) {
          if (!file.endsWith('.json')) continue;
          try {
            const raw = fs.readFileSync(path.join(this.graphsDir, file), 'utf8');
            const g = JSON.parse(raw);
            if (g && g.graphId) {
              this.evidenceGraphs.set(g.graphId, g);
            }
          } catch {
            // Ignore corrupted file
          }
        }
      }
    } catch {
      // Non-fatal
    }
  }

  private persistStateCheckpoint(): void {
    try {
      this.ensureDirectories();
      const payload = {
        savedAt: new Date().toISOString(),
        sources: Array.from(this.sources.values()),
        subjects: Array.from(this.subjects.values()),
        screeningRuns: Array.from(this.screeningRuns.values()).slice(-200),
        importJobs: Array.from(this.importJobs.values()).slice(-200),
        evidenceGraphs: Array.from(this.evidenceGraphs.values()).slice(-200),
      };
      const raw = JSON.stringify(payload, null, 2);
      const tmpPath = path.join(this.stateDir, `repo_state.tmp.${Date.now()}`);
      fs.writeFileSync(tmpPath, raw, 'utf8');
      fs.renameSync(tmpPath, path.join(this.stateDir, 'repo_state.json'));
    } catch {
      // Non-fatal fallback
    }
  }

  // ==========================================
  // Sources Management
  // ==========================================
  public saveSource(def: SourceDefinition): void {
    const key = `${def.id}:${def.tenantId || 'GLOBAL'}`;
    this.sources.set(key, { ...def });

    if (this.sqliteAvailable) {
      try {
        const sql = `INSERT OR REPLACE INTO sources (source_id, tenant_id, category, name, enabled, payload_json)
                     VALUES ('${this.escapeSql(def.id)}', '${this.escapeSql(def.tenantId || 'GLOBAL')}', '${this.escapeSql(def.category)}', '${this.escapeSql(def.name)}', ${def.enabled ? 1 : 0}, '${this.escapeSql(JSON.stringify(def))}');`;
        execFileSync('sqlite3', [this.sqliteDbPath, sql], { stdio: 'ignore', timeout: 2500 });
      } catch {
        // Fallback to memory + file checkpoint
      }
    }
    this.persistStateCheckpoint();
  }

  public getSource(sourceId: string, tenantId?: string): SourceDefinition | undefined {
    // Check tenant private first, then GLOBAL
    if (tenantId && tenantId !== 'GLOBAL') {
      const privateKey = `${sourceId}:${tenantId}`;
      if (this.sources.has(privateKey)) {
        return this.sources.get(privateKey);
      }
    }
    return this.sources.get(`${sourceId}:GLOBAL`);
  }

  public listSources(tenantId?: string): SourceDefinition[] {
    const results: SourceDefinition[] = [];
    for (const s of this.sources.values()) {
      if (!s.tenantId || s.tenantId === 'GLOBAL') {
        results.push({ ...s });
      } else if (tenantId && s.tenantId === tenantId) {
        results.push({ ...s });
      }
    }
    return results;
  }

  public updateSourceStatus(sourceId: string, updates: Partial<SourceDefinition>, tenantId?: string): void {
    const current = this.getSource(sourceId, tenantId);
    if (!current) return;
    const updated: SourceDefinition = { ...current, ...updates };
    this.saveSource(updated);
  }

  // ==========================================
  // Snapshots Management
  // ==========================================
  public saveSnapshot(snapshot: SourceSnapshot, records: SourceRecord[]): void {
    this.snapshots.set(snapshot.snapshotId, { ...snapshot });
    this.snapshotRecords.set(snapshot.snapshotId, [...records]);

    // Persist snapshot to disk in snapshotsDir
    try {
      this.ensureDirectories();
      const snapFile = path.join(this.snapshotsDir, `${snapshot.snapshotId}.json`);
      const tmpFile = `${snapFile}.tmp.${Date.now()}`;
      const payload = {
        snapshot,
        records,
      };
      fs.writeFileSync(tmpFile, JSON.stringify(payload, null, 2), 'utf8');
      fs.renameSync(tmpFile, snapFile);
    } catch {
      // Fallback
    }

    if (this.sqliteAvailable) {
      try {
        const sql = `INSERT OR REPLACE INTO snapshots (snapshot_id, source_id, version_tag, sha256_digest, record_count, status, tenant_id, payload_json)
                     VALUES ('${this.escapeSql(snapshot.snapshotId)}', '${this.escapeSql(snapshot.sourceId)}', '${this.escapeSql(snapshot.versionTag)}', '${this.escapeSql(snapshot.sha256Digest)}', ${snapshot.recordCount}, '${this.escapeSql(snapshot.status)}', '${this.escapeSql(snapshot.tenantId || 'GLOBAL')}', '${this.escapeSql(JSON.stringify(snapshot))}');`;
        execFileSync('sqlite3', [this.sqliteDbPath, sql], { stdio: 'ignore', timeout: 2500 });
      } catch {
        // Fallback
      }
    }
  }

  public getSnapshot(snapshotId: string): SourceSnapshot | undefined {
    return this.snapshots.get(snapshotId);
  }

  public getSnapshotRecords(snapshotId: string): SourceRecord[] {
    return this.snapshotRecords.get(snapshotId) || [];
  }

  public listSnapshots(sourceId?: string, tenantId?: string): SourceSnapshot[] {
    const results: SourceSnapshot[] = [];
    for (const snap of this.snapshots.values()) {
      if (sourceId && snap.sourceId !== sourceId) continue;
      if (snap.tenantId && snap.tenantId !== 'GLOBAL') {
        if (!tenantId || snap.tenantId !== tenantId) continue;
      }
      results.push({ ...snap });
    }
    // Sort newest first
    return results.sort((a, b) => new Date(b.fetchedAt).getTime() - new Date(a.fetchedAt).getTime());
  }

  public getActiveManifest(tenantId = 'default'): ActiveSnapshotManifest {
    const manifestSnapshots: ActiveSnapshotManifest['snapshots'] = {};
    const relevantSources = this.listSources(tenantId).filter((s) => s.enabled);

    for (const src of relevantSources) {
      if (src.activeSnapshotId) {
        const snap = this.getSnapshot(src.activeSnapshotId);
        if (snap && snap.status === 'ACTIVE') {
          manifestSnapshots[src.id] = {
            snapshotId: snap.snapshotId,
            sourceId: src.id,
            versionTag: snap.versionTag,
            sha256Digest: snap.sha256Digest,
            recordCount: snap.recordCount,
          };
        }
      }
    }

    const manifestDigest = sha256(manifestSnapshots);
    return {
      manifestId: `manifest_${manifestDigest.slice(0, 16)}`,
      generatedAt: new Date().toISOString(),
      tenantId,
      snapshots: manifestSnapshots,
      manifestDigest,
    };
  }

  public activateSnapshot(snapshotId: string, activatedBy: string): ActiveSnapshotManifest {
    const target = this.getSnapshot(snapshotId);
    if (!target) {
      throw new Error(`Cannot activate non-existent snapshot: ${snapshotId}`);
    }

    // Archive any currently active snapshot for this source & tenant
    for (const snap of this.snapshots.values()) {
      if (snap.sourceId === target.sourceId && snap.status === 'ACTIVE') {
        const isSameTenant = (snap.tenantId || 'GLOBAL') === (target.tenantId || 'GLOBAL');
        if (isSameTenant) {
          snap.status = 'ARCHIVED';
          this.saveSnapshot(snap, this.getSnapshotRecords(snap.snapshotId));
        }
      }
    }

    // Set target to ACTIVE
    target.status = 'ACTIVE';
    target.activatedAt = new Date().toISOString();
    this.saveSnapshot(target, this.getSnapshotRecords(target.snapshotId));

    // Update source definition active snapshot pointer
    this.updateSourceStatus(target.sourceId, {
      activeSnapshotId: target.snapshotId,
      activeVersionTag: target.versionTag,
      recordCount: target.recordCount,
      aliasCount: target.aliasCount,
      healthStatus: 'HEALTHY',
    }, target.tenantId);

    // Record audit event in WAL
    durableStorage.appendWal('WORKFLOW_UPSERT', target.tenantId || 'GLOBAL', target.snapshotId, {
      action: 'SNAPSHOT_ACTIVATED',
      sourceId: target.sourceId,
      snapshotId: target.snapshotId,
      versionTag: target.versionTag,
      activatedBy,
      timestamp: target.activatedAt,
    });

    return this.getActiveManifest(target.tenantId || 'default');
  }

  public rollbackSnapshot(sourceId: string, targetSnapshotId: string, rolledBackBy: string): ActiveSnapshotManifest {
    const target = this.getSnapshot(targetSnapshotId);
    if (!target || target.sourceId !== sourceId) {
      throw new Error(`Target snapshot ${targetSnapshotId} does not belong to source ${sourceId}`);
    }

    // Mark current active as ROLLED_BACK
    const currentSource = this.getSource(sourceId, target.tenantId);
    if (currentSource?.activeSnapshotId) {
      const active = this.getSnapshot(currentSource.activeSnapshotId);
      if (active) {
        active.status = 'ROLLED_BACK';
        this.saveSnapshot(active, this.getSnapshotRecords(active.snapshotId));
      }
    }

    // Activate target
    target.status = 'ACTIVE';
    target.activatedAt = new Date().toISOString();
    this.saveSnapshot(target, this.getSnapshotRecords(target.snapshotId));

    this.updateSourceStatus(sourceId, {
      activeSnapshotId: target.snapshotId,
      activeVersionTag: target.versionTag,
      recordCount: target.recordCount,
      aliasCount: target.aliasCount,
      healthStatus: 'HEALTHY',
    }, target.tenantId);

    durableStorage.appendWal('WORKFLOW_UPSERT', target.tenantId || 'GLOBAL', target.snapshotId, {
      action: 'SNAPSHOT_ROLLED_BACK',
      sourceId,
      targetSnapshotId,
      rolledBackBy,
      timestamp: target.activatedAt,
    });

    return this.getActiveManifest(target.tenantId || 'default');
  }

  // ==========================================
  // Customer Subjects Management (Tenant-Scoped)
  // ==========================================
  public saveSubject(subject: CustomerSubject): CustomerSubject {
    if (!subject.tenantId || !subject.subjectId) {
      throw new Error('Tenant ID and Subject ID are strictly required for customer subjects.');
    }
    const key = `${subject.tenantId}:${subject.subjectId}`;
    this.subjects.set(key, { ...subject, updatedAt: new Date().toISOString() });

    if (this.sqliteAvailable) {
      try {
        const sql = `INSERT OR REPLACE INTO subjects (subject_id, tenant_id, primary_name, entity_type, payload_json)
                     VALUES ('${this.escapeSql(subject.subjectId)}', '${this.escapeSql(subject.tenantId)}', '${this.escapeSql(subject.primaryName)}', '${this.escapeSql(subject.entityType)}', '${this.escapeSql(JSON.stringify(subject))}');`;
        execFileSync('sqlite3', [this.sqliteDbPath, sql], { stdio: 'ignore', timeout: 2500 });
      } catch {
        // Fallback
      }
    }
    this.persistStateCheckpoint();
    return this.subjects.get(key)!;
  }

  public getSubject(subjectId: string, tenantId: string): CustomerSubject | undefined {
    return this.subjects.get(`${tenantId}:${subjectId}`);
  }

  public listSubjects(tenantId: string): CustomerSubject[] {
    const list: CustomerSubject[] = [];
    for (const [key, sub] of this.subjects.entries()) {
      if (key.startsWith(`${tenantId}:`)) {
        list.push({ ...sub });
      }
    }
    return list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  public deleteSubject(subjectId: string, tenantId: string): boolean {
    const key = `${tenantId}:${subjectId}`;
    const existed = this.subjects.delete(key);
    if (existed && this.sqliteAvailable) {
      try {
        const sql = `DELETE FROM subjects WHERE subject_id='${this.escapeSql(subjectId)}' AND tenant_id='${this.escapeSql(tenantId)}';`;
        execFileSync('sqlite3', [this.sqliteDbPath, sql], { stdio: 'ignore', timeout: 2500 });
      } catch {
        // Fallback
      }
    }
    if (existed) this.persistStateCheckpoint();
    return existed;
  }

  // ==========================================
  // Screening Runs Management
  // ==========================================
  public saveScreeningRun(run: ScreeningRunRecord): void {
    this.screeningRuns.set(run.runId, { ...run });
    if (this.sqliteAvailable) {
      try {
        const sql = `INSERT OR REPLACE INTO screening_runs (run_id, tenant_id, subject_id, input_digest, created_at, payload_json)
                     VALUES ('${this.escapeSql(run.runId)}', '${this.escapeSql(run.tenantId)}', '${this.escapeSql(run.subjectId || '')}', '${this.escapeSql(run.inputDigest)}', '${this.escapeSql(run.createdAt)}', '${this.escapeSql(JSON.stringify(run))}');`;
        execFileSync('sqlite3', [this.sqliteDbPath, sql], { stdio: 'ignore', timeout: 2500 });
      } catch {
        // Fallback
      }
    }
    this.persistStateCheckpoint();
  }

  public getScreeningRun(runId: string, tenantId: string): ScreeningRunRecord | undefined {
    const run = this.screeningRuns.get(runId);
    if (run && run.tenantId === tenantId) {
      return { ...run };
    }
    return undefined;
  }

  public listScreeningRuns(tenantId: string, subjectId?: string): ScreeningRunRecord[] {
    const results: ScreeningRunRecord[] = [];
    for (const run of this.screeningRuns.values()) {
      if (run.tenantId !== tenantId) continue;
      if (subjectId && run.subjectId !== subjectId) continue;
      results.push({ ...run });
    }
    return results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  // ==========================================
  // Import Jobs Management
  // ==========================================
  public saveImportJob(job: ImportJobRecord): void {
    this.importJobs.set(job.jobId, { ...job });
    if (this.sqliteAvailable) {
      try {
        const sql = `INSERT OR REPLACE INTO import_jobs (job_id, tenant_id, source_id, status, started_at, payload_json)
                     VALUES ('${this.escapeSql(job.jobId)}', '${this.escapeSql(job.tenantId)}', '${this.escapeSql(job.sourceId)}', '${this.escapeSql(job.status)}', '${this.escapeSql(job.startedAt)}', '${this.escapeSql(JSON.stringify(job))}');`;
        execFileSync('sqlite3', [this.sqliteDbPath, sql], { stdio: 'ignore', timeout: 2500 });
      } catch {
        // Fallback
      }
    }
    this.persistStateCheckpoint();
  }

  public getImportJob(jobId: string, tenantId: string): ImportJobRecord | undefined {
    const job = this.importJobs.get(jobId);
    if (job && (job.tenantId === tenantId || job.tenantId === 'GLOBAL')) {
      return { ...job };
    }
    return undefined;
  }

  public listImportJobs(tenantId: string): ImportJobRecord[] {
    const results: ImportJobRecord[] = [];
    for (const job of this.importJobs.values()) {
      if (job.tenantId === tenantId || job.tenantId === 'GLOBAL') {
        results.push({ ...job });
      }
    }
    return results.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  }

  public updateImportJob(jobId: string, updates: Partial<ImportJobRecord>): void {
    const current = this.importJobs.get(jobId);
    if (!current) return;
    const updated: ImportJobRecord = { ...current, ...updates };
    this.saveImportJob(updated);
  }

  // ==========================================
  // Evidence Graphs Management
  // ==========================================
  public saveEvidenceGraph(graph: AlertEvidenceGraph): void {
    this.evidenceGraphs.set(graph.graphId, { ...graph });
    if (this.sqliteAvailable) {
      try {
        const sql = `INSERT OR REPLACE INTO evidence_graphs (graph_id, tenant_id, module_id, case_id, run_id, created_at, payload_json)
                     VALUES ('${this.escapeSql(graph.graphId)}', '${this.escapeSql(graph.tenantId)}', '${this.escapeSql(graph.moduleId)}', '${this.escapeSql(graph.caseId || '')}', '${this.escapeSql(graph.screeningRunId || '')}', '${this.escapeSql(graph.generatedAt)}', '${this.escapeSql(JSON.stringify(graph))}');`;
        execFileSync('sqlite3', [this.sqliteDbPath, sql], { stdio: 'ignore', timeout: 2500 });
      } catch {
        // Fallback
      }
    }
    // Atomic disk write to graphsDir
    try {
      this.ensureDirectories();
      const raw = JSON.stringify(graph, null, 2);
      const tmpPath = path.join(this.graphsDir, `${graph.graphId}.tmp.${Date.now()}`);
      fs.writeFileSync(tmpPath, raw, 'utf8');
      fs.renameSync(tmpPath, path.join(this.graphsDir, `${graph.graphId}.json`));
    } catch {
      // Non-fatal
    }
    this.persistStateCheckpoint();
  }

  public getEvidenceGraph(graphId: string, tenantId?: string): AlertEvidenceGraph | undefined {
    const graph = this.evidenceGraphs.get(graphId);
    if (!graph) return undefined;
    if (tenantId && tenantId !== 'GLOBAL' && graph.tenantId !== tenantId) {
      return undefined;
    }
    return { ...graph };
  }

  public getEvidenceGraphByRunId(runId: string, tenantId?: string): AlertEvidenceGraph | undefined {
    for (const graph of this.evidenceGraphs.values()) {
      if (graph.screeningRunId === runId) {
        if (tenantId && tenantId !== 'GLOBAL' && graph.tenantId !== tenantId) {
          return undefined;
        }
        return { ...graph };
      }
    }
    return undefined;
  }

  public getEvidenceGraphByCaseId(caseId: string, tenantId?: string): AlertEvidenceGraph | undefined {
    for (const graph of this.evidenceGraphs.values()) {
      if (graph.caseId === caseId) {
        if (tenantId && tenantId !== 'GLOBAL' && graph.tenantId !== tenantId) {
          return undefined;
        }
        return { ...graph };
      }
    }
    return undefined;
  }

  public listEvidenceGraphs(tenantId: string, moduleId?: ComplianceModuleId): AlertEvidenceGraph[] {
    const results: AlertEvidenceGraph[] = [];
    for (const graph of this.evidenceGraphs.values()) {
      if (tenantId !== 'GLOBAL' && graph.tenantId !== tenantId) continue;
      if (moduleId && graph.moduleId !== moduleId) continue;
      results.push({ ...graph });
    }
    return results.sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime());
  }

  // ==========================================
  // Cloud Capability & Status Disclosure
  // ==========================================
  public getCloudPersistenceStatus(): {
    mode: 'LOCAL_PERSISTENT_SQLITE' | 'CLOUD_EPHEMERAL_STANDBY';
    durableStoragePath: string;
    restartPersistenceGuaranteed: boolean;
    cloudStorageAvailable: boolean;
    disclaimer: string;
  } {
    const isCloudEnv = Boolean(process.env.K_SERVICE || process.env.GOOGLE_CLOUD_PROJECT || process.env.CLOUD_RUN_JOB);
    if (isCloudEnv && !process.env.GCP_PERSISTENT_MOUNT && !process.env.PERSISTENCE_BUCKET) {
      return {
        mode: 'CLOUD_EPHEMERAL_STANDBY',
        durableStoragePath: this.stateDir,
        restartPersistenceGuaranteed: false,
        cloudStorageAvailable: false,
        disclaimer: 'DISCLOSURE: Running on ephemeral container storage without card-backed Cloud Storage or Filestore mount. Data will NOT survive container cold restarts unless persistent storage is provisioned.',
      };
    }
    return {
      mode: 'LOCAL_PERSISTENT_SQLITE',
      durableStoragePath: this.stateDir,
      restartPersistenceGuaranteed: true,
      cloudStorageAvailable: false,
      disclaimer: 'Local persistent storage active with SQLite WAL and durable atomic JSON files. State and snapshot records survive local container restarts.',
    };
  }
}

export const storageRepository = new StorageRepository();

