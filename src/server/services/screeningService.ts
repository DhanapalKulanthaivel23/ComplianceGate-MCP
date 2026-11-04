/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import {
  ActiveSnapshotManifest,
  CandidateFindingStatus,
  CanonicalParty,
  CoverageStatus,
  CustomerSubject,
  EntityType,
  FindingSeverity,
  FourDimensionScreeningResult,
  Identifier,
  InputCompleteness,
  MatchDetail,
  PartyScreeningOutcome,
  ReviewOutcome,
  ScreeningRunRecord,
} from '../../shared/types.ts';
import { memorySearchIndex } from './memoryIndex.ts';
import { normalizeEntityName, sha256 } from './normalizer.ts';
import { parseCsvLine, parseCsvRecords } from './sources/officialParsers.ts';
import { storageRepository } from './storage/storageRepository.ts';
import { subjectRepositoryService } from './subjectRepository.ts';
import { evidenceGraphService } from './evidenceGraphService.ts';

export class ScreeningService {
  private readonly engineVersion = 'ComplianceGate-Unified-v2026.11';
  private readonly policyVersion = 'POL-2026.11-SHARED-DATA';

  /**
   * Primary entry point for multi-dimensional screening across all sources.
   * Returns complete four-dimension result:
   * 1. inputCompleteness
   * 2. sourceCoverage
   * 3. candidateFindings
   * 4. reviewOutcome
   */
  public async screenEntity(params: {
    name: string;
    entityType?: EntityType;
    country?: string;
    identifiers?: Identifier[];
    sourceIds?: string[];
    tenantId?: string;
    subjectId?: string;
    subjectRevision?: number;
  }): Promise<ScreeningRunRecord> {
    const tenantId = params.tenantId || 'default';
    const rawName = (params.name || '').trim();

    // 1. Evaluate Input Completeness
    let inputCompleteness: InputCompleteness = 'COMPLETE';
    if (!rawName) {
      inputCompleteness = 'MISSING_CRITICAL';
    } else if (!params.country && (!params.identifiers || params.identifiers.length === 0)) {
      inputCompleteness = 'INCOMPLETE';
    }

    // 2. Evaluate Source Coverage & Requested Sources
    let sourceCoverage: CoverageStatus = 'COMPLETE';
    const sourceGaps: string[] = [];

    if (!memorySearchIndex.isReady()) {
      sourceCoverage = 'UNAVAILABLE';
      sourceGaps.push('Memory search index is unready or building (INDEX_NOT_READY).');
    } else if (params.sourceIds && params.sourceIds.length > 0) {
      // Validate every explicitly requested sourceId
      for (const sId of params.sourceIds) {
        const sourceDef = storageRepository.getSource(sId, tenantId);
        if (!sourceDef) {
          sourceCoverage = 'UNAVAILABLE';
          sourceGaps.push(`Requested source "${sId}" is not recognized in catalogue.`);
        } else if (!sourceDef.enabled) {
          if (sourceCoverage === 'COMPLETE') sourceCoverage = 'INSUFFICIENT';
          sourceGaps.push(`Requested source "${sId}" is disabled.`);
        } else if (!sourceDef.activeSnapshotId || sourceDef.healthStatus === 'UNAVAILABLE') {
          sourceCoverage = 'UNAVAILABLE';
          sourceGaps.push(`Requested source "${sId}" is not loaded (status: NOT_LOADED).`);
        } else if (sourceDef.healthStatus === 'DEGRADED') {
          if (sourceCoverage === 'COMPLETE' || sourceCoverage === 'PARTIAL_STALE') sourceCoverage = 'DEGRADED';
          sourceGaps.push(`Requested source "${sId}" is in degraded health.`);
        } else if (sourceDef.healthStatus === 'STALE') {
          if (sourceCoverage === 'COMPLETE') sourceCoverage = 'PARTIAL_STALE';
          sourceGaps.push(`Requested source "${sId}" has exceeded freshness TTL.`);
        }
      }
    } else {
      const sources = storageRepository.listSources(tenantId).filter((s) => s.enabled);
      const requiredSources = sources.filter((s) => s.isRequired);
      if (requiredSources.length === 0) {
        sourceCoverage = 'UNAVAILABLE';
        sourceGaps.push('Zero required sanctions sources are enabled.');
      } else if (requiredSources.some((s) => s.healthStatus === 'DEGRADED')) {
        sourceCoverage = 'DEGRADED';
        sourceGaps.push('One or more required sanctions sources are degraded.');
      } else if (requiredSources.some((s) => s.healthStatus === 'STALE')) {
        sourceCoverage = 'PARTIAL_STALE';
        sourceGaps.push('One or more required sanctions sources are stale.');
      }
    }

    // 3. Search Memory Index (Strictly Tenant-Scoped)
    let searchResult: {
      matches: MatchDetail[];
      manifest: ActiveSnapshotManifest;
      isTruncated: boolean;
    };

    if (rawName && memorySearchIndex.isReady() && sourceCoverage !== 'UNAVAILABLE') {
      searchResult = memorySearchIndex.searchEntity({
        name: rawName,
        entityType: params.entityType,
        country: params.country,
        identifiers: params.identifiers,
        sourceIds: params.sourceIds,
        tenantId,
      });
    } else {
      // Degraded, empty query, or unconfigured source fallback
      const manifest = storageRepository.getActiveManifest(tenantId);
      searchResult = {
        matches: [],
        manifest,
        isTruncated: false,
      };
    }

    // 4. Evaluate Candidate Findings
    const hasExactId = searchResult.matches.some((m) => m.isExactIdentifier);
    let candidateFindings: CandidateFindingStatus = 'NO_CANDIDATE';
    let findingSeverity: FindingSeverity = 'NO_MATCH_FOUND';

    if (hasExactId) {
      candidateFindings = 'EXACT_IDENTIFIER_MATCH';
      findingSeverity = 'EXACT_IDENTIFIER_MATCH';
    } else if (searchResult.matches.length > 0) {
      candidateFindings = 'CANDIDATE_MATCH';
      findingSeverity = 'FUZZY_NAME_CANDIDATE';
    }

    // 5. Evaluate Review Outcome (Objective four-dimension routing)
    let reviewOutcome: ReviewOutcome = 'AUTO_RELEASE';
    const reviewReasons: string[] = [];

    if (inputCompleteness === 'MISSING_CRITICAL') {
      reviewOutcome = 'REQUIRES_HUMAN_REVIEW';
      reviewReasons.push('Critical missing input: Entity name is empty or blank.');
    } else if (candidateFindings === 'EXACT_IDENTIFIER_MATCH') {
      reviewOutcome = 'HOLD_FOR_INVESTIGATION';
      reviewReasons.push('Exact typed identifier hit matched official sanctions designation.');
    } else if (candidateFindings === 'CANDIDATE_MATCH') {
      reviewOutcome = 'REQUIRES_HUMAN_REVIEW';
      reviewReasons.push('Fuzzy candidate match detected requiring identity adjudication.');
    }

    if (sourceCoverage === 'PARTIAL_STALE' || sourceCoverage === 'DEGRADED' || sourceCoverage === 'UNAVAILABLE' || sourceCoverage === 'INSUFFICIENT') {
      reviewOutcome = 'REQUIRES_HUMAN_REVIEW';
      reviewReasons.push(`Source coverage is ${sourceCoverage}. Clearance withheld pending healthy source data.`);
      for (const gap of sourceGaps) {
        reviewReasons.push(gap);
      }
    }

    const highestScore = searchResult.matches.length > 0 ? searchResult.matches[0].similarityScore : 0;
    const inputDigest = sha256({
      name: rawName,
      entityType: params.entityType,
      country: params.country,
      identifiers: params.identifiers,
    });

    const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const createdAt = new Date().toISOString();

    const dimensions: FourDimensionScreeningResult = {
      inputCompleteness,
      sourceCoverage,
      candidateFindings,
      reviewOutcome,
    };

    const runRecord: ScreeningRunRecord = {
      runId,
      tenantId,
      subjectId: params.subjectId,
      subjectRevision: params.subjectRevision,
      inputDigest,
      queryEntity: {
        name: rawName,
        entityType: params.entityType,
        country: params.country,
        identifiers: params.identifiers,
      },
      engineVersion: this.engineVersion,
      policyVersion: this.policyVersion,
      manifestDigest: searchResult.manifest.manifestDigest,
      manifestSnapshotCount: Object.keys(searchResult.manifest.snapshots).length,
      candidateCount: searchResult.matches.length,
      candidates: searchResult.matches,
      isTruncated: searchResult.isTruncated,
      dimensions,
      findingSeverity,
      highestScore,
      requiresHumanReview: reviewOutcome !== 'AUTO_RELEASE',
      reviewReasons,
      normalizationDetails: {
        normalizedName: normalizeEntityName(rawName),
        defragmented: rawName.includes('  ') || rawName.includes('   '),
        script: /[а-яА-ЯёЁ]/.test(rawName) ? 'CYRILLIC' : /[\u0600-\u06FF]/.test(rawName) ? 'ARABIC' : 'LATIN',
      },
      evidenceDigest: sha256({
        runId,
        inputDigest,
        manifestDigest: searchResult.manifest.manifestDigest,
        candidateIds: searchResult.matches.map((m) => m.entryId),
        dimensions,
        createdAt,
      }),
      createdAt,
    };

    // Save run in persistent storage
    storageRepository.saveScreeningRun(runRecord);

    // Build and persist Alert Evidence Graph pinned to this run and manifest
    try {
      const graph = evidenceGraphService.buildGraphForScreeningRun(runRecord, tenantId);
      storageRepository.saveEvidenceGraph(graph);
    } catch {
      // Non-fatal fallback
    }

    // If linked to a subject, update subject's screening status
    if (params.subjectId) {
      subjectRepositoryService.updateScreeningResult(params.subjectId, tenantId, runRecord);
    }

    return runRecord;
  }

  /**
   * Scoped re-screening of a registered customer subject.
   * Preserves previous run history and creates a linked new run.
   */
  public async rescreenSubject(subjectId: string, tenantId: string): Promise<ScreeningRunRecord> {
    const subject = storageRepository.getSubject(subjectId, tenantId);
    if (!subject) {
      throw new Error(`Subject not found for re-screening: ${subjectId} (tenant: ${tenantId})`);
    }

    return this.screenEntity({
      name: subject.primaryName,
      entityType: subject.entityType,
      country: subject.jurisdiction,
      identifiers: subject.typedIdentifiers,
      tenantId: subject.tenantId,
      subjectId: subject.subjectId,
      subjectRevision: Date.now(),
    });
  }

  /**
   * Re-screens all active registered customer subjects for a tenant.
   */
  public async rescreenAllActiveSubjects(tenantId: string): Promise<{
    screenedCount: number;
    runs: ScreeningRunRecord[];
  }> {
    const subjects = storageRepository.listSubjects(tenantId).filter((s) => s.retentionPolicy === 'RE_SCREEN_ACTIVE');
    const runs: ScreeningRunRecord[] = [];

    for (const sub of subjects) {
      const run = await this.rescreenSubject(sub.subjectId, tenantId);
      runs.push(run);
    }

    return {
      screenedCount: runs.length,
      runs,
    };
  }

  /**
   * Synchronous adapter bridge for existing domain modules (Payments, Trade, Maritime, Air, etc.)
   * Maps CanonicalParty to unified memorySearchIndex search.
   */
  public screenPartySync(party: CanonicalParty, tenantId = 'default'): PartyScreeningOutcome {
    if (!party || !party.name || !party.name.trim()) {
      return {
        party,
        findingSeverity: 'NO_MATCH_FOUND',
        highestScore: 0,
        matches: [],
        policyNotes: 'Empty party name skipped from screening.',
      };
    }

    // Ensure memory search index has bootstrapped
    if (!memorySearchIndex.isReady()) {
      // Synchronous recovery if index not ready
      const manifest = storageRepository.getActiveManifest(tenantId);
      return {
        party,
        findingSeverity: 'NO_MATCH_FOUND',
        highestScore: 0,
        matches: [],
        policyNotes: 'Screening index building: returning unassessed status with review requirement.',
      };
    }

    const { matches } = memorySearchIndex.searchEntity({
      name: party.name,
      entityType: party.role?.includes('VESSEL') ? 'VESSEL' : 'ORGANIZATION',
      country: typeof party.address === 'string' ? party.address : party.address?.country,
      identifiers: party.identifiers,
      tenantId,
    });

    const hasExactId = matches.some((m) => m.isExactIdentifier);
    let findingSeverity: FindingSeverity = 'NO_MATCH_FOUND';
    if (hasExactId) {
      findingSeverity = 'EXACT_IDENTIFIER_MATCH';
    } else if (matches.length > 0) {
      findingSeverity = 'FUZZY_NAME_CANDIDATE';
    }

    const highestScore = matches.length > 0 ? matches[0].similarityScore : 0;
    return {
      party,
      findingSeverity,
      highestScore,
      matches,
      policyNotes: `Screened against ComplianceGate Unified Memory Index (${matches.length} candidates found).`,
    };
  }

  /**
   * Batch screening for customer subjects from CSV or JSON string.
   * Full input reconciliation: totalSubmitted = validCount + rejectedCount.
   */
  public async batchScreenSubjects(
    rawContent: string,
    format: 'CSV' | 'JSON',
    tenantId = 'default'
  ): Promise<{
    totalProcessed: number;
    totalSubmitted: number;
    validCount: number;
    rejectedCount: number;
    runs: ScreeningRunRecord[];
    rejectedRows: Array<{ rowNumber: number; reason: string }>;
  }> {
    const runs: ScreeningRunRecord[] = [];
    const rejectedRows: Array<{ rowNumber: number; reason: string }> = [];

    if (format === 'JSON') {
      let list: any[] = [];
      try {
        const parsed = JSON.parse(rawContent);
        list = Array.isArray(parsed) ? parsed : [parsed];
        for (let i = 0; i < list.length; i++) {
          const item = list[i];
          if (!item || !item.name || typeof item.name !== 'string' || !item.name.trim()) {
            rejectedRows.push({ rowNumber: i + 1, reason: 'Missing mandatory name attribute' });
            continue;
          }
          const run = await this.screenEntity({
            name: item.name.trim(),
            entityType: item.entityType,
            country: item.country,
            identifiers: item.identifiers,
            tenantId,
          });
          runs.push(run);
        }
      } catch (err: any) {
        rejectedRows.push({ rowNumber: 1, reason: `JSON parse error: ${err.message}` });
      }
      return {
        totalProcessed: runs.length,
        totalSubmitted: list.length + (list.length === 0 && rejectedRows.length > 0 ? 1 : 0),
        validCount: runs.length,
        rejectedCount: rejectedRows.length,
        runs,
        rejectedRows,
      };
    }

    // RFC 4180 CSV parsing with full support for embedded/quoted newlines
    const records = parseCsvRecords(rawContent);
    if (records.length === 0) {
      return { totalProcessed: 0, totalSubmitted: 0, validCount: 0, rejectedCount: 0, runs, rejectedRows };
    }

    const header = records[0].map((h) => h.trim().toLowerCase());
    const nameIdx = header.findIndex((h) => h === 'name' || h === 'entity_name' || h === 'full_name');
    const typeIdx = header.findIndex((h) => h === 'type' || h === 'entity_type');
    const countryIdx = header.findIndex((h) => h === 'country' || h === 'domicile' || h === 'nationality');
    const idIdx = header.findIndex((h) => h === 'id' || h === 'identifier');

    if (nameIdx === -1) {
      rejectedRows.push({ rowNumber: 1, reason: 'CSV requires a "name" or "entity_name" header column' });
      return { totalProcessed: 0, totalSubmitted: 1, validCount: 0, rejectedCount: 1, runs, rejectedRows };
    }

    for (let i = 1; i < records.length; i++) {
      const cols = records[i];
      const name = cols[nameIdx]?.trim();
      if (!name) {
        rejectedRows.push({ rowNumber: i + 1, reason: 'Missing mandatory name' });
        continue;
      }

      const entityType = (cols[typeIdx]?.trim().toUpperCase() as EntityType) || 'ORGANIZATION';
      const country = cols[countryIdx]?.trim();
      const identifierVal = cols[idIdx]?.trim();
      const identifiers = identifierVal
        ? [{ type: 'OTHER' as any, value: identifierVal, country }]
        : undefined;

      const run = await this.screenEntity({
        name,
        entityType,
        country,
        identifiers,
        tenantId,
      });
      runs.push(run);
    }

    const totalSubmitted = records.length - 1;
    return {
      totalProcessed: runs.length,
      totalSubmitted,
      validCount: runs.length,
      rejectedCount: rejectedRows.length,
      runs,
      rejectedRows,
    };
  }
}

export const screeningService = new ScreeningService();
