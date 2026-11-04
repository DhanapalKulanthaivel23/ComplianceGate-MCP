/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import {
  ActiveSnapshotManifest,
  CanonicalParty,
  CoverageStatus,
  EntityType,
  FindingSeverity,
  FourDimensionScreeningResult,
  Identifier,
  MatchDetail,
  PartyScreeningOutcome,
  SourceRecord,
} from '../../shared/types.ts';
import {
  normalizeEntityName,
  normalizeIdentifier,
  sha256,
  tokenSetRatio,
  tokenSortRatio,
} from './normalizer.ts';
import { storageRepository } from './storage/storageRepository.ts';

export type IndexReadinessStatus =
  | 'INDEX_NOT_READY'
  | 'INDEX_BUILDING'
  | 'INDEX_READY'
  | 'INDEX_DEGRADED';

export interface IndexStats {
  status: IndexReadinessStatus;
  totalRecords: number;
  totalNamesAndAliases: number;
  totalTypedIdentifiers: number;
  activeManifestDigest: string;
  loadedAt: string;
  buildDurationMs: number;
}

interface InternalIndexRecord {
  record: SourceRecord;
  sourceId: string;
  sourceName: string;
  primaryNorm: string;
  aliasesNorm: string[];
  tokens: Set<string>;
}

export interface IndexStore {
  recordsById: Map<string, SourceRecord>;
  nameIndex: Map<string, InternalIndexRecord[]>;
  tokenIndex: Map<string, InternalIndexRecord[]>;
  identifierIndex: Map<string, InternalIndexRecord[]>;
  activeManifest: ActiveSnapshotManifest;
}

export class MemorySearchIndex {
  private status: IndexReadinessStatus = 'INDEX_NOT_READY';
  private globalStore: IndexStore | null = null;
  private tenantStores: Map<string, IndexStore> = new Map();
  private loadedAt = '';
  private buildDurationMs = 0;
  private fuzzyThreshold = 0.82;

  constructor() {
    // Initial build can be triggered explicitly or synchronously on bootstrap
  }

  public getStatus(): IndexReadinessStatus {
    return this.status;
  }

  public isReady(): boolean {
    return (this.status === 'INDEX_READY' || this.status === 'INDEX_DEGRADED') && this.globalStore !== null;
  }

  public getStats(tenantId = 'default'): IndexStats {
    let totalRecords = 0;
    let nameCount = 0;
    let identifierCount = 0;

    const stores: IndexStore[] = [];
    if (this.globalStore) stores.push(this.globalStore);
    if (tenantId !== 'GLOBAL' && this.tenantStores.has(tenantId)) {
      stores.push(this.tenantStores.get(tenantId)!);
    }

    const seenRecs = new Set<string>();
    for (const st of stores) {
      for (const recId of st.recordsById.keys()) {
        seenRecs.add(recId);
      }
      nameCount += st.nameIndex.size;
      for (const list of st.identifierIndex.values()) {
        identifierCount += list.length;
      }
    }
    totalRecords = seenRecs.size;

    const manifest = (tenantId !== 'GLOBAL' && this.tenantStores.has(tenantId))
      ? this.tenantStores.get(tenantId)!.activeManifest
      : this.globalStore?.activeManifest;

    return {
      status: this.status,
      totalRecords,
      totalNamesAndAliases: nameCount,
      totalTypedIdentifiers: identifierCount,
      activeManifestDigest: manifest?.manifestDigest || 'NONE',
      loadedAt: this.loadedAt,
      buildDurationMs: this.buildDurationMs,
    };
  }

  public getActiveManifest(tenantId = 'default'): ActiveSnapshotManifest | null {
    if (tenantId !== 'GLOBAL' && this.tenantStores.has(tenantId)) {
      return { ...this.tenantStores.get(tenantId)!.activeManifest };
    }
    return this.globalStore ? { ...this.globalStore.activeManifest } : null;
  }

  /**
   * Helper to build an immutable IndexStore for a given manifest and tenant scope.
   */
  private buildStore(manifest: ActiveSnapshotManifest, tenantId: string): IndexStore {
    const recordsById = new Map<string, SourceRecord>();
    const nameIndex = new Map<string, InternalIndexRecord[]>();
    const tokenIndex = new Map<string, InternalIndexRecord[]>();
    const identifierIndex = new Map<string, InternalIndexRecord[]>();

    for (const [sourceId, snapMeta] of Object.entries(manifest.snapshots)) {
      const records = storageRepository.getSnapshotRecords(snapMeta.snapshotId);
      const sourceDef = storageRepository.getSource(sourceId, tenantId);
      const sourceName = sourceDef?.name || sourceId;

      for (const rec of records) {
        recordsById.set(rec.id, rec);
        const primaryNorm = normalizeEntityName(rec.name);
        const aliasesNorm = (rec.aliases || []).map((a) => normalizeEntityName(a)).filter(Boolean);

        const tokenSet = new Set<string>();
        for (const word of primaryNorm.split(/\s+/)) {
          if (word.length >= 2) tokenSet.add(word);
        }
        for (const alias of aliasesNorm) {
          for (const word of alias.split(/\s+/)) {
            if (word.length >= 2) tokenSet.add(word);
          }
        }

        const indexedRec: InternalIndexRecord = {
          record: rec,
          sourceId,
          sourceName,
          primaryNorm,
          aliasesNorm,
          tokens: tokenSet,
        };

        // Name index (primary + aliases)
        if (primaryNorm) {
          const existing = nameIndex.get(primaryNorm) || [];
          existing.push(indexedRec);
          nameIndex.set(primaryNorm, existing);
        }
        for (const an of aliasesNorm) {
          const existing = nameIndex.get(an) || [];
          existing.push(indexedRec);
          nameIndex.set(an, existing);
        }

        // Token index
        for (const tok of tokenSet) {
          const existing = tokenIndex.get(tok) || [];
          existing.push(indexedRec);
          tokenIndex.set(tok, existing);
        }

        // Identifier index (type + normValue)
        if (Array.isArray(rec.identifiers)) {
          for (const id of rec.identifiers) {
            const normVal = normalizeIdentifier(id.type, id.value);
            if (normVal) {
              const idKey = `${id.type.toUpperCase()}:${normVal}`;
              const existing = identifierIndex.get(idKey) || [];
              existing.push(indexedRec);
              identifierIndex.set(idKey, existing);

              // If country is specified, also index with country
              if (id.country) {
                const countryKey = `${id.type.toUpperCase()}:${id.country.toUpperCase()}:${normVal}`;
                const existingCountry = identifierIndex.get(countryKey) || [];
                existingCountry.push(indexedRec);
                identifierIndex.set(countryKey, existingCountry);
              }
            }
          }
        }
      }
    }

    return {
      recordsById,
      nameIndex,
      tokenIndex,
      identifierIndex,
      activeManifest: manifest,
    };
  }

  /**
   * Rebuilds the search index from currently activated snapshots.
   * Performs an atomic pointer swap so running queries continue to use their pinned state.
   */
  public async rebuildIndex(tenantId = 'default'): Promise<IndexStats> {
    const startTime = Date.now();
    this.status = 'INDEX_BUILDING';

    try {
      // 1. Build or refresh global official store
      const globalManifest = storageRepository.getActiveManifest('GLOBAL');
      this.globalStore = this.buildStore(globalManifest, 'GLOBAL');

      // 2. Build tenant store if specified and not GLOBAL
      if (tenantId && tenantId !== 'GLOBAL') {
        const tenantManifest = storageRepository.getActiveManifest(tenantId);
        const tenantStore = this.buildStore(tenantManifest, tenantId);
        this.tenantStores.set(tenantId, tenantStore);
      }

      this.loadedAt = new Date().toISOString();
      this.buildDurationMs = Date.now() - startTime;
      this.status = 'INDEX_READY';

      return this.getStats(tenantId);
    } catch (err: any) {
      this.status = 'INDEX_DEGRADED';
      throw new Error(`Failed to build memory search index: ${err.message}`);
    }
  }

  /**
   * Screens a query entity against the active index.
   * Enforces strict tenant scoping: Tenant B can NEVER match Tenant A's private lists.
   * If the index is not ready, throws an explicit INDEX_NOT_READY error rather than returning false negative.
   */
  public searchEntity(query: {
    name: string;
    entityType?: EntityType;
    country?: string;
    identifiers?: Identifier[];
    sourceIds?: string[];
    tenantId?: string;
  }): {
    matches: MatchDetail[];
    manifest: ActiveSnapshotManifest;
    isTruncated: boolean;
  } {
    if (!this.isReady()) {
      throw new Error('Screening deferred: Memory search index is not ready (INDEX_NOT_READY). Never screening against an uninitialized index.');
    }

    const effectiveTenantId = query.tenantId || 'default';
    const storesToQuery: IndexStore[] = [];
    if (this.globalStore) {
      storesToQuery.push(this.globalStore);
    }
    if (effectiveTenantId !== 'GLOBAL' && this.tenantStores.has(effectiveTenantId)) {
      storesToQuery.push(this.tenantStores.get(effectiveTenantId)!);
    }

    const pinnedManifest = (effectiveTenantId !== 'GLOBAL' && this.tenantStores.has(effectiveTenantId))
      ? this.tenantStores.get(effectiveTenantId)!.activeManifest
      : this.globalStore!.activeManifest;

    const matches: MatchDetail[] = [];
    const seenMatchKeys = new Set<string>();

    const targetSources = query.sourceIds && query.sourceIds.length > 0 ? new Set(query.sourceIds) : null;
    const queryNameNorm = normalizeEntityName(query.name);

    // 1. Exact Typed Identifier Search across authorized stores
    if (query.identifiers && query.identifiers.length > 0) {
      for (const qId of query.identifiers) {
        const normVal = normalizeIdentifier(qId.type, qId.value);
        if (!normVal) continue;

        const candidateKeys = [`${qId.type.toUpperCase()}:${normVal}`];
        if (qId.country) {
          candidateKeys.push(`${qId.type.toUpperCase()}:${qId.country.toUpperCase()}:${normVal}`);
        }

        for (const cKey of candidateKeys) {
          for (const store of storesToQuery) {
            const hits = store.identifierIndex.get(cKey) || [];
            for (const item of hits) {
              if (targetSources && !targetSources.has(item.sourceId)) continue;
              const matchKey = `ID:${item.record.id}:${qId.type}:${normVal}`;
              if (seenMatchKeys.has(matchKey)) continue;
              seenMatchKeys.add(matchKey);

              matches.push({
                listId: item.sourceId,
                listName: item.sourceName,
                entryId: item.record.id,
                entryName: item.record.name,
                entryType: item.record.entityType,
                matchType: 'EXACT_IDENTIFIER',
                matchedField: `identifiers.${qId.type}`,
                queryValue: `${qId.type}:${qId.value}`,
                listValue: `${qId.type}:${normVal}`,
                similarityScore: 1.0,
                isExactIdentifier: true,
                programs: item.record.programs,
                notes: `Exact identifier match on ${qId.type} [${qId.value}]. Mandatory human legal adjudication required.`,
              });
            }
          }
        }
      }
    }

    // 2. Name & Alias Matching (Exact + Token Fuzzy) across authorized stores
    if (queryNameNorm.length >= 2) {
      // Direct exact normalized name hits
      for (const store of storesToQuery) {
        const exactHits = store.nameIndex.get(queryNameNorm) || [];
        for (const item of exactHits) {
          if (targetSources && !targetSources.has(item.sourceId)) continue;
          const matchKey = `NAME:${item.record.id}`;
          if (seenMatchKeys.has(matchKey)) continue;
          seenMatchKeys.add(matchKey);

          matches.push({
            listId: item.sourceId,
            listName: item.sourceName,
            entryId: item.record.id,
            entryName: item.record.name,
            entryType: item.record.entityType,
            matchType: 'EXACT_NAME',
            matchedField: 'name',
            queryValue: query.name,
            listValue: item.record.name,
            similarityScore: 1.0,
            isExactIdentifier: false,
            programs: item.record.programs,
            notes: 'Exact normalized name match across designated official/licensed records.',
          });
        }
      }

      // Fuzzy candidate retrieval via token overlap
      const queryTokens = queryNameNorm.split(/\s+/).filter((t) => t.length >= 2);
      const candidateRecords = new Map<string, InternalIndexRecord>();

      for (const tok of queryTokens) {
        for (const store of storesToQuery) {
          const hits = store.tokenIndex.get(tok) || [];
          for (const h of hits) {
            if (targetSources && !targetSources.has(h.sourceId)) continue;
            candidateRecords.set(h.record.id, h);
          }
        }
      }

      // Evaluate candidates with token-sort and token-set ratios
      for (const candidate of candidateRecords.values()) {
        const matchKey = `NAME:${candidate.record.id}`;
        if (seenMatchKeys.has(matchKey)) continue;

        // Primary name similarity
        const primaryScore = Math.max(
          tokenSortRatio(queryNameNorm, candidate.primaryNorm),
          tokenSetRatio(queryNameNorm, candidate.primaryNorm)
        );

        let bestScore = primaryScore;
        let matchedField = 'name';
        let matchedValue = candidate.record.name;
        let isAlias = false;

        // Check aliases
        for (let i = 0; i < candidate.aliasesNorm.length; i++) {
          const aNorm = candidate.aliasesNorm[i];
          const aScore = Math.max(
            tokenSortRatio(queryNameNorm, aNorm),
            tokenSetRatio(queryNameNorm, aNorm)
          );
          if (aScore > bestScore) {
            bestScore = aScore;
            matchedField = 'alias';
            matchedValue = candidate.record.aliases[i];
            isAlias = true;
          }
        }

        if (bestScore >= this.fuzzyThreshold) {
          seenMatchKeys.add(matchKey);
          matches.push({
            listId: candidate.sourceId,
            listName: candidate.sourceName,
            entryId: candidate.record.id,
            entryName: candidate.record.name,
            entryType: candidate.record.entityType,
            matchType: isAlias ? 'FUZZY_ALIAS' : bestScore >= 0.99 ? 'EXACT_NAME' : 'FUZZY_NAME',
            matchedField,
            queryValue: query.name,
            listValue: matchedValue,
            similarityScore: Number(bestScore.toFixed(4)),
            isExactIdentifier: false,
            programs: candidate.record.programs,
            notes: `Algorithmic token similarity score ${bestScore.toFixed(4)}. Explicitly an algorithmic distance metric, NOT a legal-risk probability.`,
          });
        }
      }
    }

    // Sort matches: Exact identifier hits first, then highest score
    matches.sort((a, b) => {
      if (a.isExactIdentifier && !b.isExactIdentifier) return -1;
      if (!a.isExactIdentifier && b.isExactIdentifier) return 1;
      return b.similarityScore - a.similarityScore;
    });

    const isTruncated = matches.length > 50;
    const topMatches = matches.slice(0, 50);

    return {
      matches: topMatches,
      manifest: pinnedManifest,
      isTruncated,
    };
  }
}

export const memorySearchIndex = new MemorySearchIndex();
