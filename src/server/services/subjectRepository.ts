/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import {
  CustomerSubject,
  EntityType,
  Identifier,
  ScreeningRunRecord,
} from '../../shared/types.ts';
import { storageRepository } from './storage/storageRepository.ts';

export class SubjectRepositoryService {
  /**
   * Registers or updates a customer subject.
   * Strict tenant scoping: subjects are segregated per tenant.
   */
  public registerSubject(params: {
    tenantId: string;
    subjectId?: string;
    entityType: EntityType;
    primaryName: string;
    aliases?: string[];
    typedIdentifiers?: Identifier[];
    jurisdiction?: string;
    contextData?: Record<string, any>;
    provenance?: string;
    retentionPolicy?: CustomerSubject['retentionPolicy'];
  }): CustomerSubject {
    if (!params.tenantId) {
      throw new Error('Tenant ID is mandatory for subject registration.');
    }
    if (!params.primaryName || params.primaryName.trim().length === 0) {
      throw new Error('Primary name is mandatory for customer subject.');
    }

    const now = new Date().toISOString();
    const subjectId = params.subjectId || `sub_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    const existing = storageRepository.getSubject(subjectId, params.tenantId);
    const subject: CustomerSubject = {
      subjectId,
      tenantId: params.tenantId,
      entityType: params.entityType,
      primaryName: params.primaryName.trim(),
      aliases: (params.aliases || []).map((a) => a.trim()).filter(Boolean),
      typedIdentifiers: params.typedIdentifiers || [],
      jurisdiction: params.jurisdiction,
      contextData: params.contextData,
      provenance: params.provenance || (existing ? existing.provenance : 'MANUAL_ENTRY'),
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
      retentionPolicy: params.retentionPolicy || (existing ? existing.retentionPolicy : 'RE_SCREEN_ACTIVE'),
      lastScreenedAt: existing?.lastScreenedAt,
      lastScreeningRunId: existing?.lastScreeningRunId,
      lastReviewOutcome: existing?.lastReviewOutcome,
    };

    return storageRepository.saveSubject(subject);
  }

  public getSubject(subjectId: string, tenantId: string): CustomerSubject | undefined {
    return storageRepository.getSubject(subjectId, tenantId);
  }

  public listSubjects(tenantId: string): CustomerSubject[] {
    return storageRepository.listSubjects(tenantId);
  }

  public deleteSubject(subjectId: string, tenantId: string): boolean {
    return storageRepository.deleteSubject(subjectId, tenantId);
  }

  public updateScreeningResult(
    subjectId: string,
    tenantId: string,
    run: ScreeningRunRecord
  ): CustomerSubject | undefined {
    const sub = storageRepository.getSubject(subjectId, tenantId);
    if (!sub) return undefined;

    sub.lastScreenedAt = run.createdAt;
    sub.lastScreeningRunId = run.runId;
    sub.lastReviewOutcome = run.dimensions.reviewOutcome;
    return storageRepository.saveSubject(sub);
  }
}

export const subjectRepositoryService = new SubjectRepositoryService();

