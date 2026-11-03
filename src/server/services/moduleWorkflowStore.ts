/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import crypto from 'node:crypto';
import { ComplianceModuleId } from '../../shared/types.ts';
import { durableStorage } from './durableStorage.ts';
import { sha256 } from './normalizer.ts';

export type ModuleWorkflowType =
  | 'TRADE_DOCUMENT_RECONCILIATION'
  | 'OWNERSHIP_AND_UBO_REVIEW'
  | 'HEALTHCARE_CLAIMS_INTEGRITY_REVIEW'
  | 'MARKET_SURVEILLANCE_INVESTIGATION'
  | 'CRYPTO_TRAVEL_RULE_INVESTIGATION';

export type WorkflowStatus =
  | 'OPEN_REVIEW'
  | 'OPEN_RECONCILIATION'
  | 'IN_RECONCILIATION'
  | 'ESCALATED_TO_SENIOR_COUNSEL'
  | 'ESCALATED_SENIOR_COMPLIANCE'
  | 'APPROVED_WITH_EVIDENCE'
  | 'REJECTED_AND_BLOCKED'
  | 'REJECTED_BLOCKED';

export interface WorkflowChecklistItem {
  itemId: string;
  label: string;
  category: string;
  required: boolean;
  completed: boolean;
  completedBy?: string;
  completedAt?: string;
  evidenceNote?: string;
}

export interface WorkflowAuditStep {
  stepId: string;
  timestamp: string;
  actorId: string;
  actorRole: string;
  previousStatus: WorkflowStatus;
  newStatus: WorkflowStatus;
  action: string;
  rationale: string;
  previousHash: string;
  stepHash: string;
}

export interface ModuleWorkflowRecord {
  workflowId: string;
  tenantId: string;
  moduleId: ComplianceModuleId;
  workflowType: ModuleWorkflowType;
  status: WorkflowStatus;
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  subjectReference: string;
  createdAt: string;
  updatedAt: string;
  assignedAnalyst?: string;
  evaluationSnapshot: any;
  checklist: WorkflowChecklistItem[];
  auditTrail: WorkflowAuditStep[];
  evidenceHash: string;
}

function buildDefaultChecklist(moduleId: ComplianceModuleId | string): {
  workflowType: ModuleWorkflowType;
  checklist: WorkflowChecklistItem[];
} {
  const norm = String(moduleId).toUpperCase();
  if (norm.includes('TRADE') || norm.includes('AIR')) {
    return {
      workflowType: 'TRADE_DOCUMENT_RECONCILIATION',
      checklist: [
        {
          itemId: 'chk_doc_match',
          label: 'Reconcile Invoice, Transport Document (B/L or AWB), and Packing List quantities/weights/ports',
          category: 'DOCUMENT_RECONCILIATION',
          required: true,
          completed: false,
        },
        {
          itemId: 'chk_dual_use',
          label: 'Verify HS codes and dual-use goods proliferation classification / export license',
          category: 'EXPORT_CONTROL',
          required: true,
          completed: false,
        },
        {
          itemId: 'chk_party_screen',
          label: 'Screen Exporter, Importer, Notify Party, and Vessel against consolidated sanctions lists',
          category: 'SANCTIONS_SCREENING',
          required: true,
          completed: false,
        },
      ],
    };
  }
  if (norm.includes('INSURANCE') || norm.includes('MARITIME')) {
    return {
      workflowType: 'OWNERSHIP_AND_UBO_REVIEW',
      checklist: [
        {
          itemId: 'chk_ubo_tree',
          label: 'Verify corporate beneficial ownership hierarchy and OFAC 50% aggregate calculation',
          category: 'OWNERSHIP_REVIEW',
          required: true,
          completed: false,
        },
        {
          itemId: 'chk_vessel_port',
          label: 'Review vessel IMO registry, AIS dark-period logs, and port call clearance',
          category: 'MARITIME_UNDERWRITING',
          required: false,
          completed: false,
        },
      ],
    };
  }
  if (norm.includes('HEALTHCARE')) {
    return {
      workflowType: 'HEALTHCARE_CLAIMS_INTEGRITY_REVIEW',
      checklist: [
        {
          itemId: 'chk_npi_dea',
          label: 'Verify practitioner NPI Luhn and DEA registration validity',
          category: 'CREDENTIAL_VERIFICATION',
          required: true,
          completed: false,
        },
        {
          itemId: 'chk_oig_sam',
          label: 'Confirm OIG-LEIE / SAM.gov exclusion status and check federal waiver documentation',
          category: 'CLAIMS_REVIEW',
          required: true,
          completed: false,
        },
      ],
    };
  }
  if (norm.includes('SECURITIES')) {
    return {
      workflowType: 'MARKET_SURVEILLANCE_INVESTIGATION',
      checklist: [
        {
          itemId: 'chk_isin_ssi',
          label: 'Verify ISIN instrument against EU/OFAC Sectoral Sanctions Directives (maturity & new-debt restrictions)',
          category: 'SURVEILLANCE',
          required: true,
          completed: false,
        },
        {
          itemId: 'chk_counterparty',
          label: 'Screen executing broker, client account, and beneficial owner',
          category: 'COUNTERPARTY_REVIEW',
          required: true,
          completed: false,
        },
      ],
    };
  }
  return {
    workflowType: 'CRYPTO_TRAVEL_RULE_INVESTIGATION',
    checklist: [
      {
        itemId: 'chk_ivms101',
        label: 'Verify FATF Rec 16 / IVMS101 Originator and Beneficiary VASP & identity fields',
        category: 'TRAVEL_RULE',
        required: true,
        completed: false,
      },
      {
        itemId: 'chk_mixer_exposure',
        label: 'Review on-chain mixer/cluster exposure attribution',
        category: 'BLOCKCHAIN_FORENSICS',
        required: true,
        completed: false,
      },
    ],
  };
}

export class ModuleWorkflowStore {
  private workflows: Map<string, ModuleWorkflowRecord> = new Map();

  constructor() {
    const recovered = durableStorage.loadAndRecoverState();
    this.workflows = recovered.workflows;
  }

  public createWorkflow(params: {
    moduleId: ComplianceModuleId;
    subjectReference?: string;
    subjectId?: string;
    subjectSummary?: string;
    evaluationSnapshot?: any;
    findings?: string[];
    priority?: 'CRITICAL' | 'HIGH' | 'MEDIUM';
    tenantId?: string;
    actorId?: string;
  }): ModuleWorkflowRecord {
    const tenantId = params.tenantId || 'default';
    const subjectRef = params.subjectReference || params.subjectId || `SUBJ-${Date.now()}`;
    const evalSnapshot = params.evaluationSnapshot || {
      subjectSummary: params.subjectSummary || subjectRef,
      findings: params.findings || [],
    };
    const workflowId = `wf_${params.moduleId}_${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    const { workflowType, checklist } = buildDefaultChecklist(params.moduleId);

    const stepId = `wstp_${crypto.randomUUID().slice(0, 8)}`;
    const stepHash = sha256({
      stepId,
      workflowId,
      timestamp: now,
      action: 'WORKFLOW_INITIATED',
      previousHash: 'GENESIS',
    });

    const initialStep: WorkflowAuditStep = {
      stepId,
      timestamp: now,
      actorId: params.actorId || 'SYSTEM',
      actorRole: 'system_auditor',
      previousStatus: 'OPEN_RECONCILIATION',
      newStatus: 'OPEN_RECONCILIATION',
      action: 'WORKFLOW_INITIATED',
      rationale: `Initiated ${workflowType} workflow for ${params.moduleId} subject [${subjectRef}].`,
      previousHash: 'GENESIS',
      stepHash,
    };

    const record: ModuleWorkflowRecord = {
      workflowId,
      tenantId,
      moduleId: params.moduleId,
      workflowType,
      status: 'OPEN_RECONCILIATION',
      priority: params.priority || 'HIGH',
      subjectReference: subjectRef,
      createdAt: now,
      updatedAt: now,
      evaluationSnapshot: evalSnapshot,
      checklist,
      auditTrail: [initialStep],
      evidenceHash: sha256({
        workflowId,
        evaluationSnapshot: evalSnapshot,
        checklist,
        auditTrail: [initialStep],
      }),
    };

    durableStorage.appendWal('WORKFLOW_UPSERT', tenantId, workflowId, record);
    this.workflows.set(workflowId, record);
    return record;
  }

  public completeChecklistItem(params: {
    workflowId: string;
    itemId: string;
    evidenceNote?: string;
    evidenceNotes?: string;
    actorId: string;
    actorRole?: string;
    tenantId?: string;
  }): ModuleWorkflowRecord {
    const wf = this.getWorkflow(params.workflowId, params.tenantId);
    if (!wf) {
      throw new Error(`Workflow not found: ${params.workflowId}`);
    }
    const note = (params.evidenceNote || params.evidenceNotes || '').trim();
    if (note.length < 5) {
      throw new Error('Checklist completion requires an evidence note of at least 5 characters.');
    }

    const item = wf.checklist.find((i) => i.itemId === params.itemId);
    if (!item) {
      throw new Error(`Checklist item ${params.itemId} not found in workflow ${params.workflowId}.`);
    }

    const now = new Date().toISOString();
    item.completed = true;
    item.completedBy = params.actorId;
    item.completedAt = now;
    item.evidenceNote = note;

    const prevStatus = wf.status;
    if (wf.status === 'OPEN_REVIEW' || wf.status === 'OPEN_RECONCILIATION') {
      wf.status = 'IN_RECONCILIATION';
    }

    this.appendStep(
      wf,
      params.actorId,
      params.actorRole || 'ANALYST',
      prevStatus,
      wf.status,
      `CHECKLIST_COMPLETED:${params.itemId}`,
      note
    );

    durableStorage.appendWal('WORKFLOW_UPSERT', wf.tenantId, wf.workflowId, wf);
    return wf;
  }

  public transitionWorkflow(params: {
    workflowId: string;
    newStatus?: WorkflowStatus;
    targetStatus?: WorkflowStatus;
    rationale: string;
    actorId: string;
    actorRole?: string;
    assignedRole?: string;
    tenantId?: string;
  }): ModuleWorkflowRecord {
    const wf = this.getWorkflow(params.workflowId, params.tenantId);
    if (!wf) {
      throw new Error(`Workflow not found: ${params.workflowId}`);
    }
    const target = (params.newStatus || params.targetStatus)!;

    const trimmedRationale = (params.rationale || '').trim();
    if (trimmedRationale.length < 10) {
      throw new Error('Workflow transition requires a mandatory rationale of at least 10 characters.');
    }

    // Cannot approve a workflow unless all required checklist items are completed
    if (target === 'APPROVED_WITH_EVIDENCE') {
      const incompleteRequired = wf.checklist.filter((c) => c.required && !c.completed);
      if (incompleteRequired.length > 0) {
        throw new Error(
          `Cannot approve workflow ${wf.workflowId}: ${incompleteRequired.length} mandatory checklist item(s) remain incomplete (${incompleteRequired.map((i) => i.itemId).join(', ')}).`
        );
      }
    }

    const prevStatus = wf.status;
    wf.status = target;

    this.appendStep(
      wf,
      params.actorId,
      params.actorRole || params.assignedRole || 'SENIOR_OFFICER',
      prevStatus,
      target,
      `STATUS_TRANSITION:${target}`,
      trimmedRationale
    );

    durableStorage.appendWal('WORKFLOW_UPSERT', wf.tenantId, wf.workflowId, wf);
    return wf;
  }

  private appendStep(
    wf: ModuleWorkflowRecord,
    actorId: string,
    actorRole: string,
    previousStatus: WorkflowStatus,
    newStatus: WorkflowStatus,
    action: string,
    rationale: string
  ): void {
    const now = new Date().toISOString();
    const lastStep = wf.auditTrail[wf.auditTrail.length - 1];
    const previousHash = lastStep ? lastStep.stepHash : 'GENESIS';
    const stepId = `wstp_${crypto.randomUUID().slice(0, 8)}`;
    const stepHash = sha256({
      stepId,
      workflowId: wf.workflowId,
      timestamp: now,
      action,
      rationale,
      previousHash,
    });

    wf.auditTrail.push({
      stepId,
      timestamp: now,
      actorId,
      actorRole,
      previousStatus,
      newStatus,
      action,
      rationale,
      previousHash,
      stepHash,
    });
    wf.updatedAt = now;
    wf.evidenceHash = sha256({
      workflowId: wf.workflowId,
      evaluationSnapshot: wf.evaluationSnapshot,
      checklist: wf.checklist,
      auditTrail: wf.auditTrail,
    });
  }

  public verifyWorkflowIntegrity(wf: ModuleWorkflowRecord): { isValid: boolean; valid: boolean; reason?: string } {
    let expectedPrev = 'GENESIS';
    for (const step of wf.auditTrail) {
      if (step.previousHash !== expectedPrev) {
        return {
          isValid: false,
          valid: false,
          reason: `Workflow hash chain broken at step ${step.stepId}: expected ${expectedPrev}, got ${step.previousHash}`,
        };
      }
      expectedPrev = step.stepHash;
    }
    const recomputedEvidence = sha256({
      workflowId: wf.workflowId,
      evaluationSnapshot: wf.evaluationSnapshot,
      checklist: wf.checklist,
      auditTrail: wf.auditTrail,
    });
    if (recomputedEvidence !== wf.evidenceHash) {
      return {
        isValid: false,
        valid: false,
        reason: `Workflow evidence hash mismatch: expected ${wf.evidenceHash}, got ${recomputedEvidence}`,
      };
    }
    return { isValid: true, valid: true };
  }

  public verifyWorkflowChain(workflowId: string): { isValid: boolean; valid: boolean; reason?: string } {
    const wf = this.getWorkflow(workflowId);
    if (!wf) return { isValid: false, valid: false, reason: 'Workflow not found' };
    return this.verifyWorkflowIntegrity(wf);
  }

  public getWorkflow(workflowId: string, tenantId?: string): ModuleWorkflowRecord | undefined {
    const wf = this.workflows.get(workflowId);
    if (!wf) return undefined;
    if (tenantId && wf.tenantId !== tenantId) return undefined;
    return wf;
  }

  public listWorkflows(tenantId?: string, moduleId?: ComplianceModuleId): ModuleWorkflowRecord[] {
    return Array.from(this.workflows.values())
      .filter((w) => (!tenantId || w.tenantId === tenantId) && (!moduleId || w.moduleId === moduleId))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }
}

export const moduleWorkflowStore = new ModuleWorkflowStore();
