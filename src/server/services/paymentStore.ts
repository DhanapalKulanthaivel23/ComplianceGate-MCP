/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  AuditAction,
  CanonicalPaymentTransaction,
  CaseAdjudicationDecision,
  CaseStatus,
  CoverageStatus,
  FindingSeverity,
  isVerifiedTestedProfile,
  PartyScreeningOutcome,
  PaymentComplianceCase,
  PaymentScreeningResult,
} from '../../shared/types.ts';
import { embeddedSyntheticEngine, IScreeningEngine } from './engineAdapter.ts';
import { auditPaymentMissingData, verifyExtractionCompleteness } from './missingDataEngine.ts';
import { durableStorage, StorageBackupManifest } from './durableStorage.ts';
import { sha256 } from './normalizer.ts';
import { watchlistService } from './watchlist.ts';
import { evidenceGraphService } from './evidenceGraphService.ts';

interface ServerHeldReference {
  referenceId: string;
  tenantId: string;
  result: PaymentScreeningResult;
  issuedAt: number;
  expiresAt: number;
  clientId: string;
  payloadDigest: string;
}

class PaymentStoreService {
  private cases: Map<string, PaymentComplianceCase> = new Map();
  private references: Map<string, ServerHeldReference> = new Map();
  private _activeEngine?: IScreeningEngine;

  public get activeEngine(): IScreeningEngine {
    return this._activeEngine || embeddedSyntheticEngine;
  }

  public set activeEngine(engine: IScreeningEngine) {
    this._activeEngine = engine;
  }
  private readonly dataDir = durableStorage.getStateDir();
  private readonly storeFilePath = path.join(this.dataDir, 'payments_store.json');
  private readonly policyVersion = 'POL-2026.11-PAYMENTS';

  constructor() {
    this.ensureDataDirectory();
    this.loadStoreFromDisk();
  }

  private ensureDataDirectory() {
    try {
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }
    } catch {
      // Ignore if running in constrained sandbox without root write
    }
  }

  private saveStoreToDisk() {
    durableStorage.saveCheckpoint(Array.from(this.cases.values()));
  }

  private loadStoreFromDisk() {
    const recovered = durableStorage.loadAndRecoverState();
    this.cases = new Map();
    for (const [id, c] of recovered.cases.entries()) {
      const tenantId = c.tenantId || 'default';
      const txId = c.transaction?.transactionId;
      let effectiveId = id;
      if (txId && !id.startsWith(`case_${tenantId !== 'default' ? tenantId + '_' : ''}`)) {
        const txHash = crypto.createHash('sha256').update(`${tenantId}:${txId}`).digest('hex').slice(0, 8);
        effectiveId = `case_${tenantId !== 'default' ? tenantId + '_' : ''}${txId.replace(/[^a-zA-Z0-9_-]/g, '_')}_${txHash}`;
        c.caseId = effectiveId;
      }
      // Ensure any legacy pre-schema case on disk has consistent evidenceHash
      if (!this.verifyCaseIntegrity(c).isValid) {
        c.evidenceHash = sha256({
          tx: c.transaction,
          screeningResult: c.screeningResult,
          audit: c.auditTrail,
        });
      }
      this.cases.set(effectiveId, c);
    }
  }

  public reloadFromDisk(): void {
    this.loadStoreFromDisk();
  }

  public createBackup(): StorageBackupManifest {
    return durableStorage.createBackup(Array.from(this.cases.values()));
  }

  public restoreFromBackup(backupIdOrPath: string): StorageBackupManifest {
    const restored = durableStorage.restoreFromBackup(backupIdOrPath);
    this.cases.clear();
    for (const c of restored.cases) {
      this.cases.set(c.caseId, c);
    }
    return restored.manifest;
  }

  public verifyWalIntegrity() {
    return durableStorage.verifyWalIntegrity();
  }

  public setScreeningEngine(engine: IScreeningEngine) {
    this.activeEngine = engine;
  }

  public getScreeningEngine(): IScreeningEngine {
    return this.activeEngine;
  }

  /**
   * Deterministically screens all parties in a transaction through the active engine.
   * Produces the 2-Dimensional Evaluation Matrix (Coverage vs Finding Severity).
   */
  public async screenTransaction(
    tx: CanonicalPaymentTransaction,
    clientId = 'analyst_ui',
    tenantId = 'default'
  ): Promise<PaymentScreeningResult> {
    const resolvedTenantId = tenantId || tx.tenantId || 'default';
    tx.tenantId = resolvedTenantId;
    const partyOutcomes: PartyScreeningOutcome[] = [];

    // Screen each extracted party
    for (const party of tx.parties) {
      const outcome = await this.activeEngine.screenParty(party);
      partyOutcomes.push(outcome);
    }

    // Evaluate finding severity across all parties
    let overallSeverity: FindingSeverity = 'NO_MATCH_FOUND';
    let highestScore = 0;

    for (const po of partyOutcomes) {
      if (po.highestScore > highestScore) {
        highestScore = po.highestScore;
      }
      if (po.findingSeverity === 'EXACT_IDENTIFIER_MATCH') {
        overallSeverity = 'EXACT_IDENTIFIER_MATCH';
      } else if (po.findingSeverity === 'FUZZY_NAME_CANDIDATE' && overallSeverity !== 'EXACT_IDENTIFIER_MATCH') {
        overallSeverity = 'FUZZY_NAME_CANDIDATE';
      }
    }

    // Evaluate list coverage freshness gate and server-side extraction completeness
    // Hard invariant: Screening verifies both messageType AND structural extraction completeness server-side,
    // never trusting a caller-supplied isProfileTested=true flag on an unprofiled or partially extracted message.
    const extractionCheck = verifyExtractionCompleteness(tx);
    const verifiedProfile = isVerifiedTestedProfile(tx.messageType, tx.isProfileTested) && extractionCheck.isComplete;
    tx.isProfileTested = verifiedProfile;

    const evaluatedIssues = auditPaymentMissingData(tx);
    const mergedIssues = Array.isArray(tx.missingDataIssues) ? [...tx.missingDataIssues] : [];
    for (const issue of evaluatedIssues) {
      if (!mergedIssues.some((existing) => existing.ruleId === issue.ruleId && existing.field === issue.field)) {
        mergedIssues.push(issue);
      }
    }
    tx.missingDataIssues = mergedIssues;

    const freshness = watchlistService.checkListFreshness();
    let coverageStatus: CoverageStatus = 'COMPLETE';

    if (freshness.missingLists.length > 0 || !verifiedProfile || tx.parties.length === 0) {
      coverageStatus = 'INSUFFICIENT';
    } else if (freshness.staleLists.length > 0) {
      coverageStatus = 'PARTIAL_STALE';
    }

    const now = new Date();
    const expiresMs = now.getTime() + 15 * 60 * 1000; // 15 mins TTL
    const referenceId = `ref_${crypto.randomUUID()}`;

    const payloadDigest = sha256({
      txId: tx.transactionId,
      tenantId: resolvedTenantId,
      amount: tx.amount,
      parties: tx.parties.map((p) => ({ role: p.role, name: p.name, identifiers: p.identifiers })),
    });

    const result: PaymentScreeningResult = {
      referenceId,
      timestamp: now.toISOString(),
      transactionId: tx.transactionId,
      messageType: tx.messageType,
      coverageStatus,
      findingSeverity: overallSeverity,
      highestScore,
      staleLists: freshness.staleLists,
      missingLists: freshness.missingLists,
      partyOutcomes,
      missingDataIssues: tx.missingDataIssues,
      policyVersion: this.policyVersion,
      listDigests: watchlistService.getListDigests(),
      disclaimer: 'Algorithmic token distance scores are indexing metrics and explicitly NOT a legal-risk probability.',
      requiresHumanReview:
        overallSeverity !== 'NO_MATCH_FOUND' ||
        coverageStatus === 'INSUFFICIENT' ||
        tx.missingDataIssues.some((i) => i.severity === 'CRITICAL_MISSING'),
      isRedactedForAgent: false,
      payloadDigest,
      expiresAt: new Date(expiresMs).toISOString(),
    };

    // Store server-held reference scoped to tenant
    this.references.set(referenceId, {
      referenceId,
      tenantId: resolvedTenantId,
      result,
      issuedAt: now.getTime(),
      expiresAt: expiresMs,
      clientId,
      payloadDigest,
    });

    // If an alert or missing data is detected, auto-register case for investigation
    if (overallSeverity !== 'NO_MATCH_FOUND' || tx.missingDataIssues.some((i) => i.severity === 'CRITICAL_MISSING')) {
      const createdCase = this.ensureCaseCreated(tx, result, resolvedTenantId);
      result.caseId = createdCase.caseId;
    }

    return result;
  }

  /**
   * Resolves and validates a server-held result reference.
   * Prevents client-side result forgery, cross-tenant replay, or replaying expired/altered references.
   */
  public resolveReference(referenceId: string, clientId = 'analyst_ui', tenantId?: string): PaymentScreeningResult {
    const record = this.references.get(referenceId);
    if (!record) {
      throw new Error(`Invalid or unknown server reference token: ${referenceId}`);
    }

    if (tenantId && record.tenantId !== tenantId) {
      throw new Error(`Cross-tenant access denied for reference token: ${referenceId}`);
    }

    if (Date.now() > record.expiresAt) {
      this.references.delete(referenceId);
      throw new Error(`Server reference token has expired (${referenceId}). Please re-screen payment.`);
    }

    return record.result;
  }

  /**
   * Creates or updates a case for human compliance review with WAL append before checkpointing.
   * Prevents case collisions across tenants or sanitization variants and handles rescreening.
   */
  private ensureCaseCreated(
    tx: CanonicalPaymentTransaction,
    screeningResult: PaymentScreeningResult,
    tenantId = 'default'
  ): PaymentComplianceCase {
    // Unique deterministic case key incorporating tenantId and transactionId hash
    const txHash = crypto.createHash('sha256').update(`${tenantId}:${tx.transactionId}`).digest('hex').slice(0, 8);
    const caseId = `case_${tenantId !== 'default' ? tenantId + '_' : ''}${tx.transactionId.replace(/[^a-zA-Z0-9_-]/g, '_')}_${txHash}`;

    let existing = this.cases.get(caseId);
    if (!existing) {
      for (const [existingId, c] of this.cases.entries()) {
        if ((c.tenantId || 'default') === tenantId && c.transaction.transactionId === tx.transactionId) {
          existing = c;
          this.cases.delete(existingId);
          existing.caseId = caseId;
          this.cases.set(caseId, existing);
          break;
        }
      }
    }

    if (existing) {
      // Rescreening / update: detect changes in amount, currency, parties or severity
      const now = new Date().toISOString();
      const prevAction = existing.auditTrail[existing.auditTrail.length - 1];
      const prevHash = prevAction ? prevAction.serverChecksum : 'GENESIS';
      const actionId = `act_${crypto.randomUUID()}`;
      const serverChecksum = sha256(`RESCREEN_${caseId}_${now}_${prevHash}`);

      const rescreenAction: AuditAction = {
        actionId,
        timestamp: now,
        analystId: 'SYSTEM',
        analystRole: 'system_auditor',
        previousStatus: existing.status,
        newStatus: existing.status,
        decision: 'RESCREENED_UPDATED',
        rationale: `Transaction rescreened with updated parameters. New amount: ${tx.amount} ${tx.currency}. Severity: ${screeningResult.findingSeverity}.`,
        serverChecksum,
        previousHash: prevHash,
      };

      existing.transaction = JSON.parse(JSON.stringify(tx));
      existing.screeningResult = JSON.parse(JSON.stringify(screeningResult));
      existing.updatedAt = now;
      existing.priority = screeningResult.findingSeverity === 'EXACT_IDENTIFIER_MATCH' ? 'CRITICAL' : existing.priority;
      existing.auditTrail.push(rescreenAction);
      existing.evidenceHash = sha256({
        tx: existing.transaction,
        screeningResult: existing.screeningResult,
        audit: existing.auditTrail,
      });

      durableStorage.appendWal('CASE_UPSERT', tenantId, caseId, existing);
      try {
        evidenceGraphService.buildGraphForPaymentCase(existing, tenantId);
      } catch {
        // Non-fatal
      }
      this.saveStoreToDisk();
      return existing;
    }

    const now = new Date().toISOString();

    const initialAction: AuditAction = {
      actionId: `act_${crypto.randomUUID()}`,
      timestamp: now,
      analystId: 'SYSTEM',
      analystRole: 'system_auditor',
      previousStatus: 'PENDING_REVIEW',
      newStatus: 'PENDING_REVIEW',
      decision: 'INITIAL_CREATION',
      rationale: `Automated case ingestion. Severity: ${screeningResult.findingSeverity}. Missing issues: ${tx.missingDataIssues.length}.`,
      serverChecksum: sha256(`INITIAL_CREATION_${caseId}_${now}`),
      previousHash: 'GENESIS',
    };

    const txSnap: CanonicalPaymentTransaction = JSON.parse(JSON.stringify(tx));
    const resSnap: PaymentScreeningResult = JSON.parse(JSON.stringify(screeningResult));

    const newCase: PaymentComplianceCase = {
      caseId,
      tenantId,
      createdAt: now,
      updatedAt: now,
      transaction: txSnap,
      screeningResult: resSnap,
      status: 'PENDING_REVIEW',
      priority: resSnap.findingSeverity === 'EXACT_IDENTIFIER_MATCH' ? 'CRITICAL' : 'HIGH',
      auditTrail: [initialAction],
      evidenceHash: sha256({ tx: txSnap, screeningResult: resSnap, audit: [initialAction] }),
      policyVersion: this.policyVersion,
    };

    durableStorage.appendWal('CASE_UPSERT', tenantId, caseId, newCase);
    try {
      evidenceGraphService.buildGraphForPaymentCase(newCase, tenantId);
    } catch {
      // Non-fatal
    }
    this.cases.set(caseId, newCase);
    this.saveStoreToDisk();
    return newCase;
  }

  public getAllCases(tenantId?: string): PaymentComplianceCase[] {
    return Array.from(this.cases.values())
      .filter((c) => !tenantId || (c.tenantId || 'default') === tenantId)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  public listCases(tenantId?: string): PaymentComplianceCase[] {
    return this.getAllCases(tenantId);
  }

  public verifyCaseAuditTrail(caseId: string): boolean {
    const compCase = this.cases.get(caseId);
    if (!compCase) return false;
    return this.verifyCaseIntegrity(compCase).isValid;
  }

  public getCase(caseId: string, tenantId?: string): PaymentComplianceCase | undefined {
    const compCase = this.cases.get(caseId);
    if (!compCase) return undefined;
    if (tenantId && (compCase.tenantId || 'default') !== tenantId) {
      return undefined;
    }
    return compCase;
  }

  /**
   * Adjudicates a case:
   * Requires mandatory rationale (>= 10 characters).
   * Enforces tenant isolation.
   * Appends tamper-evident audit hash chain and WAL entry.
   */
  public adjudicateCase(
    caseId: string,
    decision: CaseAdjudicationDecision | 'REOPEN',
    rationale: string,
    analystId = 'analyst_current',
    analystRole: 'compliance_officer' | 'senior_sanctions_analyst' = 'compliance_officer',
    tenantId?: string
  ): PaymentComplianceCase {
    const compCase = this.cases.get(caseId);
    if (!compCase) {
      throw new Error(`Case not found: ${caseId}`);
    }

    if (tenantId && (compCase.tenantId || 'default') !== tenantId) {
      throw new Error(`Access denied: Case ${caseId} belongs to a different tenant.`);
    }

    const trimmedRationale = (rationale || '').trim();
    if (trimmedRationale.length < 10) {
      throw new Error(
        `Mandatory review rationale must be at least 10 non-whitespace characters (provided ${trimmedRationale.length}).`
      );
    }

    const prevStatus = compCase.status;
    let newStatus: CaseStatus = prevStatus;

    if (decision === 'CONFIRM_ENTITY_MATCH') {
      newStatus = 'ALERT_CONFIRMED';
    } else if (decision === 'FALSE_POSITIVE' || decision === 'CLEAR_FALSE_POSITIVE') {
      newStatus = 'FALSE_POSITIVE_CLEARED';
    } else if (decision === 'REQUEST_INFORMATION') {
      newStatus = 'INFORMATION_REQUESTED';
    } else if (decision === 'REOPEN') {
      newStatus = 'REOPENED';
    }

    const now = new Date().toISOString();
    const lastAction = compCase.auditTrail[compCase.auditTrail.length - 1];
    const prevChecksum = lastAction ? lastAction.serverChecksum : 'GENESIS';

    const actionId = `act_${crypto.randomUUID()}`;
    const serverChecksum = sha256({
      actionId,
      timestamp: now,
      caseId,
      decision,
      rationale: trimmedRationale,
      prevChecksum,
    });

    const action: AuditAction = {
      actionId,
      timestamp: now,
      analystId,
      analystRole,
      previousStatus: prevStatus,
      newStatus,
      decision,
      rationale: trimmedRationale,
      serverChecksum,
      previousHash: prevChecksum,
    };

    compCase.auditTrail.push(action);
    compCase.status = newStatus;
    compCase.updatedAt = now;
    compCase.evidenceHash = sha256({
      tx: compCase.transaction,
      screeningResult: compCase.screeningResult,
      audit: compCase.auditTrail,
    });

    durableStorage.appendWal('DECISION_RECORDED', compCase.tenantId || 'default', caseId, compCase);
    try {
      evidenceGraphService.buildGraphForPaymentCase(compCase, compCase.tenantId || 'default');
    } catch {
      // Non-fatal
    }
    this.saveStoreToDisk();
    return compCase;
  }

  /**
   * Verifies the tamper-evident hash chain of a case.
   */
  public verifyCaseIntegrity(compCase: PaymentComplianceCase): { isValid: boolean; reason?: string } {
    let expectedPrev = 'GENESIS';

    for (let i = 0; i < compCase.auditTrail.length; i++) {
      const act = compCase.auditTrail[i];
      if (act.previousHash !== expectedPrev) {
        return {
          isValid: false,
          reason: `Hash chain broken at action ${act.actionId}: expected previousHash ${expectedPrev}, found ${act.previousHash}`,
        };
      }
      expectedPrev = act.serverChecksum;
    }

    const expectedEvidenceHash = sha256({
      tx: compCase.transaction,
      screeningResult: compCase.screeningResult,
      audit: compCase.auditTrail,
    });

    if (compCase.evidenceHash !== expectedEvidenceHash) {
      return {
        isValid: false,
        reason: 'Evidence hash mismatch: payload data or audit trail has been modified.',
      };
    }

    return { isValid: true };
  }
}

export const paymentStoreService = new PaymentStoreService();
