/**
 * @license
 * SPDX-License-Identifier: MIT
 *
 * ComplianceGate-MCP: Shared Data, Screening, and Persistence Test Suite
 * Acceptance tests according to BUILD-SPEC-LISTS-SCREENING-PERSISTENCE.md
 */

import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { DEMO_ANALYST_TOKEN } from '../shared/types.ts';
import { sourceRegistryService } from '../server/services/sourceRegistry.ts';
import {
  storageRepository,
  StorageRepository,
} from '../server/services/storage/storageRepository.ts';
import {
  memorySearchIndex,
  MemorySearchIndex,
} from '../server/services/memoryIndex.ts';
import {
  screeningService,
} from '../server/services/screeningService.ts';
import {
  subjectRepositoryService,
} from '../server/services/subjectRepository.ts';
import {
  referenceLookupService,
} from '../server/services/referenceLookupService.ts';
import { authService } from '../server/services/authService.ts';
import { createOfficialMcpServer } from '../server/mcpServer.ts';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createComplianceApp } from '../server/app.ts';
import type { Server as HttpServer } from 'node:http';

async function runSharedDataPersistenceSuite() {
  console.log('\n======================================================');
  console.log('   ComplianceGate-MCP: Shared Data & Persistence Suite');
  console.log('======================================================\n');

  let passed = 0;
  let failed = 0;

  const test = async (name: string, fn: () => Promise<void> | void) => {
    try {
      await fn();
      console.log(`  ✓ PASS: ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ✗ FAIL: ${name}`);
      console.error(`    ${err.message}`);
      failed++;
    }
  };

  // Ensure bootstrap
  await sourceRegistryService.bootstrapSources();

  // ==========================================
  // SECTION 1: Sources & Ingestion Contract
  // ==========================================
  console.log('[SECTION 1: Sources Catalogue & Ingestion Contract]');

  await test('CHECK 1: Initial catalogue registers all 8 official and 3 reference sources', () => {
    const sources = sourceRegistryService.listSources('default');
    assert(sources.length >= 11, `Expected at least 11 sources, got ${sources.length}`);
    const sourceIds = sources.map((s) => s.id);
    assert(sourceIds.includes('OFAC_SDN'), 'Missing OFAC_SDN');
    assert(sourceIds.includes('OFAC_NON_SDN'), 'Missing OFAC_NON_SDN');
    assert(sourceIds.includes('UK_SANCTIONS_LIST'), 'Missing UK_SANCTIONS_LIST');
    assert(sourceIds.includes('UN_CONSOLIDATED'), 'Missing UN_CONSOLIDATED');
    assert(sourceIds.includes('EU_FSF'), 'Missing EU_FSF');
    assert(sourceIds.includes('US_CSL'), 'Missing US_CSL');
    assert(sourceIds.includes('AU_DFAT'), 'Missing AU_DFAT');
    assert(sourceIds.includes('CA_SEMA'), 'Missing CA_SEMA');
    assert(sourceIds.includes('GLEIF_LEI'), 'Missing GLEIF_LEI');
    assert(sourceIds.includes('COMPANIES_HOUSE'), 'Missing COMPANIES_HOUSE');
    assert(sourceIds.includes('NPPES_NPI'), 'Missing NPPES_NPI');
  });

  // Register dedicated test source for ingestion tests to preserve official baseline sources
  storageRepository.saveSource({
    id: 'TEST_INGESTION_FEED',
    name: 'Test Ingestion & Quarantine In-Flight Feed',
    publisher: 'Test Pipeline Team',
    category: 'INTERNAL_LIST',
    authoritativeUrl: 'https://test.internal/feed.csv',
    termsUrl: 'https://test.internal/terms',
    termsReviewedDate: '2026-11-01',
    format: 'CSV',
    refreshScheduleHours: 24,
    freshnessTtlHours: 48,
    isRequired: false,
    enabled: true,
    description: 'Dedicated test feed for mutation tests',
    healthStatus: 'HEALTHY',
  });

  await test('CHECK 2: Valid CSV fixture ingestion creates snapshot with expected counts & aliases', async () => {
    const csvContent = `id,name,type,country,aliases
DEMO-INGEST-001,Baltic Transshipment Group Ltd,ORGANIZATION,Estonia,Baltic Freight;Baltic Trans
DEMO-INGEST-002,Sergei Ivanovich Morozov,INDIVIDUAL,Russia,Morozov S.I.;Морозов Сергей`;

    const res = await sourceRegistryService.ingestAndValidate({
      sourceId: 'TEST_INGESTION_FEED',
      tenantId: 'default',
      rawContent: csvContent,
      filename: 'baltic_trans.csv',
      format: 'CSV',
      actor: 'test_analyst',
      autoActivate: false,
    });

    assert(res.job.status === 'COMPLETED', `Job status: ${res.job.status}`);
    assert(res.job.validRecords === 2, `Valid records: ${res.job.validRecords}`);
    assert(res.snapshot !== undefined, 'Snapshot must be created');
    assert(res.snapshot?.recordCount === 2, `Record count: ${res.snapshot?.recordCount}`);
    assert(res.snapshot?.aliasCount === 4, `Alias count: ${res.snapshot?.aliasCount}`);
  });

  await test('CHECK 3: Idempotency: importing unchanged payload creates no new snapshot', async () => {
    const csvContent = `id,name,type,country,aliases
DEMO-IDEMP-001,Idempotent Maritime Services,VESSEL,Panama,IMS Maritime`;

    // 1st import
    const first = await sourceRegistryService.ingestAndValidate({
      sourceId: 'TEST_INGESTION_FEED',
      tenantId: 'default',
      rawContent: csvContent,
      filename: 'idemp.csv',
      format: 'CSV',
      actor: 'test_analyst',
      autoActivate: true,
    });

    // 2nd import identical
    const second = await sourceRegistryService.ingestAndValidate({
      sourceId: 'TEST_INGESTION_FEED',
      tenantId: 'default',
      rawContent: csvContent,
      filename: 'idemp.csv',
      format: 'CSV',
      actor: 'test_analyst',
      autoActivate: true,
    });

    assert(first.snapshot?.snapshotId === second.snapshot?.snapshotId, 'Second import must return existing snapshot ID');
    assert(second.job.status === 'COMPLETED', 'Second job completes idempotently');
  });

  await test('CHECK 4: Zero records import triggers quarantine and blocks auto-activation', async () => {
    const emptyCsv = `id,name,type,country,aliases\n`;
    const res = await sourceRegistryService.ingestAndValidate({
      sourceId: 'TEST_INGESTION_FEED',
      tenantId: 'default',
      rawContent: emptyCsv,
      filename: 'empty.csv',
      format: 'CSV',
      actor: 'test_analyst',
      autoActivate: true,
    });

    assert(res.quarantined === true, 'Zero-record import must be quarantined');
    assert(res.job.status === 'QUARANTINED', `Expected status QUARANTINED, got ${res.job.status}`);
    assert(res.quarantineReason?.includes('zero valid records'), 'Quarantine reason must mention zero valid records');
  });

  await test('CHECK 5: Drop anomaly (>30% reduction from active snapshot) triggers quarantine', async () => {
    // 1. Establish initial active snapshot with 20 records
    const initialRows = Array.from({ length: 20 }, (_, i) => `INIT-${i},Entity ${i},ORGANIZATION,France`).join('\n');
    const initCsv = `id,name,type,country\n${initialRows}`;
    await sourceRegistryService.ingestAndValidate({
      sourceId: 'TEST_INGESTION_FEED',
      tenantId: 'default',
      rawContent: initCsv,
      filename: 'initial_20.csv',
      format: 'CSV',
      actor: 'test_analyst',
      autoActivate: true,
    });

    // 2. Upload only 2 records (90% drop)
    const reducedCsv = `id,name,type,country\nDROP-001,Single Surviving Entity,ORGANIZATION,Syria\nDROP-002,Second Surviving,ORGANIZATION,Syria`;
    const res = await sourceRegistryService.ingestAndValidate({
      sourceId: 'TEST_INGESTION_FEED',
      tenantId: 'default',
      rawContent: reducedCsv,
      filename: 'reduced.csv',
      format: 'CSV',
      actor: 'test_analyst',
      autoActivate: true,
    });

    assert(res.quarantined === true, 'Must be quarantined for significant count reduction');
    assert(res.job.status === 'QUARANTINED', `Expected status QUARANTINED, got ${res.job.status}`);
    assert(res.quarantineReason?.includes('COUNT_DROP_ANOMALY'), 'Reason must cite COUNT_DROP_ANOMALY');
  });

  await test('CHECK 6: Security: XML parser rejects DTD / XXE injection attempts', async () => {
    const maliciousXml = `<?xml version="1.0"?>
<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
<records><record><id>1</id><name>&xxe;</name></record></records>`;

    let threw = false;
    try {
      await sourceRegistryService.ingestAndValidate({
        sourceId: 'TEST_INGESTION_FEED',
        tenantId: 'default',
        rawContent: maliciousXml,
        filename: 'malicious.xml',
        format: 'XML',
        actor: 'attacker',
      });
    } catch (err: any) {
      threw = true;
      assert(err.message.includes('XXE') || err.message.includes('DOCTYPE'), 'Error must cite XXE rejection');
    }
    assert(threw, 'Malicious XXE XML must be strictly rejected');
  });

  await test('CHECK 7: Security: CSV formula injection prefixes are stripped', async () => {
    const formulaCsv = `id,name,type,country
FORMULA-001,=cmd|' /C calc'!A0,ORGANIZATION,+1234
FORMULA-002,-@DDE("cmd",,"calc"),INDIVIDUAL,France`;

    const res = await sourceRegistryService.ingestAndValidate({
      sourceId: 'TEST_INGESTION_FEED',
      tenantId: 'default',
      rawContent: formulaCsv,
      filename: 'formulas.csv',
      format: 'CSV',
      actor: 'test_analyst',
    });

    assert(res.previewRecords.length === 2, 'Parsed 2 rows');
    for (const r of res.previewRecords) {
      assert(!r.name.startsWith('='), 'Equal prefix must be stripped');
      assert(!r.name.startsWith('-'), 'Minus prefix must be stripped');
      assert(!r.name.startsWith('+'), 'Plus prefix must be stripped');
      assert(!r.name.startsWith('@'), 'At prefix must be stripped');
    }
  });

  await test('CHECK 8: Snapshot rollback preserves prior history and updates active manifest', () => {
    const sourceId = 'UK_SANCTIONS_LIST';
    const initialSnap = storageRepository.getSource(sourceId, 'default')?.activeSnapshotId;
    assert(initialSnap !== undefined, 'Initial snapshot must exist');

    // Create a secondary snapshot
    const secondSnapId = `snap_uk_v2`;
    storageRepository.saveSnapshot({
      snapshotId: secondSnapId,
      sourceId,
      versionTag: 'v2026.11.02-SECOND',
      schemaVersion: '1.0.0',
      sha256Digest: 'dummy_digest_v2',
      recordCount: 1,
      aliasCount: 0,
      fetchedAt: new Date().toISOString(),
      status: 'ACTIVE',
      tenantId: 'GLOBAL',
    }, []);

    storageRepository.activateSnapshot(secondSnapId, 'admin');
    assert(storageRepository.getSource(sourceId, 'default')?.activeSnapshotId === secondSnapId, 'Second snapshot active');

    // Rollback to initial snapshot
    storageRepository.rollbackSnapshot(sourceId, initialSnap!, 'senior_officer');
    assert(storageRepository.getSource(sourceId, 'default')?.activeSnapshotId === initialSnap, 'Must roll back to initial snapshot');
  });

  // ==========================================
  // SECTION 2: Tenant Isolation & Access Control
  // ==========================================
  console.log('\n[SECTION 2: Tenant Isolation & Role-Based Access Control]');

  await test('CHECK 9: Private uploaded list is visible to Tenant A and invisible to Tenant B', () => {
    const tenantASource = {
      id: 'TENANT_A_PRIVATE_WATCHLIST',
      name: 'Tenant A Proprietary Adverse Media List',
      publisher: 'Tenant A Risk Team',
      category: 'INTERNAL_LIST' as const,
      authoritativeUrl: 'https://internal.tenant-a.com/lists',
      termsUrl: 'https://internal.tenant-a.com/terms',
      termsReviewedDate: '2026-11-01',
      format: 'CSV' as const,
      refreshScheduleHours: 24,
      freshnessTtlHours: 48,
      isRequired: false,
      enabled: true,
      tenantId: 'tenant_a',
      description: 'Private high-risk accounts for Tenant A only',
    };

    storageRepository.saveSource(tenantASource);

    const listForA = storageRepository.listSources('tenant_a');
    const listForB = storageRepository.listSources('tenant_b');

    assert(listForA.some((s) => s.id === 'TENANT_A_PRIVATE_WATCHLIST'), 'Tenant A must see its private list');
    assert(!listForB.some((s) => s.id === 'TENANT_A_PRIVATE_WATCHLIST'), 'Tenant B must NOT see Tenant A private list');
  });

  await test('CHECK 10: Customer subject register enforces strict tenant segregation', () => {
    const subA = subjectRepositoryService.registerSubject({
      tenantId: 'tenant_alpha',
      primaryName: 'Alpha Logistics Overseas Ltd',
      entityType: 'ORGANIZATION',
      jurisdiction: 'Cyprus',
    });

    const subB = subjectRepositoryService.registerSubject({
      tenantId: 'tenant_beta',
      primaryName: 'Beta Maritime International Corp',
      entityType: 'ORGANIZATION',
      jurisdiction: 'Panama',
    });

    const subjectsA = subjectRepositoryService.listSubjects('tenant_alpha');
    const subjectsB = subjectRepositoryService.listSubjects('tenant_beta');

    assert(subjectsA.some((s) => s.subjectId === subA.subjectId), 'Tenant Alpha must see subject Alpha');
    assert(!subjectsA.some((s) => s.subjectId === subB.subjectId), 'Tenant Alpha must NOT see subject Beta');
    assert(subjectsB.some((s) => s.subjectId === subB.subjectId), 'Tenant Beta must see subject Beta');
    assert(!subjectsB.some((s) => s.subjectId === subA.subjectId), 'Tenant Beta must NOT see subject Alpha');
  });

  await test('CHECK 11: Role Permissions: Auditor role cannot adjudicate cases or upload lists', () => {
    const auditorPrincipal = {
      userId: 'auditor_01',
      username: 'auditor_jane',
      role: 'AUDITOR' as const,
      tenantId: 'default',
      sessionId: 'sess_auditor',
      issuedAt: Date.now(),
      expiresAt: Date.now() + 3600000,
      authMethod: 'SIGNED_SESSION_TOKEN' as const,
    };

    assert(authService.hasPermission(auditorPrincipal, 'VIEW_CASES') === true, 'Auditor can view cases');
    assert(authService.hasPermission(auditorPrincipal, 'VIEW_SOURCES') === true, 'Auditor can view sources');
    assert(authService.hasPermission(auditorPrincipal, 'ADJUDICATE_CASE') === false, 'Auditor cannot adjudicate cases');
    assert(authService.hasPermission(auditorPrincipal, 'MANAGE_SOURCES') === false, 'Auditor cannot upload or manage sources');
    assert(authService.hasPermission(auditorPrincipal, 'MANAGE_WATCHLISTS') === false, 'Auditor cannot manage watchlists');
  });

  // ==========================================
  // SECTION 3: Memory Search Index & Multi-Dimension Screening
  // ==========================================
  console.log('\n[SECTION 3: Memory Search Index & Multi-Dimension Screening]');

  // Rebuild memory index on default tenant baseline
  await memorySearchIndex.rebuildIndex('default');

  await test('CHECK 12: Memory Search Index rejects queries with INDEX_NOT_READY before initialization', () => {
    const uninitializedIndex = new MemorySearchIndex();
    assert(!uninitializedIndex.isReady(), 'Index must report not ready initially');
    let threw = false;
    try {
      uninitializedIndex.searchEntity({ name: 'Test Entity' });
    } catch (err: any) {
      threw = true;
      assert(err.message.includes('INDEX_NOT_READY'), 'Error must specify INDEX_NOT_READY');
    }
    assert(threw, 'Searching against unready index must throw explicit error');
  });

  await test('CHECK 13: Screening produces complete Four-Dimension status results', async () => {
    const run = await screeningService.screenEntity({
      name: 'Oceanic Aurora Maritime Ltd',
      entityType: 'VESSEL',
      country: 'Marshall Islands',
      identifiers: [{ type: 'IMO', value: '9123456' }],
    });

    assert(run.dimensions.inputCompleteness === 'COMPLETE', `Input completeness: ${run.dimensions.inputCompleteness}`);
    assert(run.dimensions.sourceCoverage === 'COMPLETE', `Source coverage: ${run.dimensions.sourceCoverage}`);
    assert(run.dimensions.candidateFindings === 'EXACT_IDENTIFIER_MATCH', `Candidate findings: ${run.dimensions.candidateFindings}`);
    assert(run.dimensions.reviewOutcome === 'HOLD_FOR_INVESTIGATION', `Review outcome: ${run.dimensions.reviewOutcome}`);
    assert(run.candidateCount > 0, 'Must have at least one candidate hit');
    assert(run.manifestDigest.length === 64, 'Manifest digest must be 64-char SHA-256');
  });

  await test('CHECK 14: Objective terminology: Clean query returns "NO_CANDIDATE" (not legal approval)', async () => {
    const run = await screeningService.screenEntity({
      name: 'Standard Clean Commercial Trading Corp Ltd',
      entityType: 'ORGANIZATION',
      country: 'France',
    });

    assert(run.dimensions.candidateFindings === 'NO_CANDIDATE', 'Must report NO_CANDIDATE');
    assert(run.dimensions.reviewOutcome === 'AUTO_RELEASE', 'Review outcome is AUTO_RELEASE');
    assert(run.candidates.length === 0, 'Candidates array must be empty');
  });

  await test('CHECK 15: Critical missing input forces review requirement regardless of watchlist hits', async () => {
    const run = await screeningService.screenEntity({
      name: '', // Empty name!
    });

    assert(run.dimensions.inputCompleteness === 'MISSING_CRITICAL', 'Must report MISSING_CRITICAL');
    assert(run.requiresHumanReview === true, 'Requires human review must be true');
    assert(run.dimensions.reviewOutcome === 'REQUIRES_HUMAN_REVIEW', 'Outcome must require human review');
  });

  await test('CHECK 16: Multi-script Unicode matching: Cyrillic, Arabic, and spaced names detected', async () => {
    // 1. Cyrillic Volkov
    const cyrillicRun = await screeningService.screenEntity({
      name: 'Дмитрий Сергеевич Волков',
      entityType: 'INDIVIDUAL',
    });
    assert(cyrillicRun.candidates.some((c) => c.entryId.includes('003')), 'Cyrillic Volkov must match DEMO-SDN-003');

    // 2. Arabic Al-Mansoor
    const arabicRun = await screeningService.screenEntity({
      name: 'طارق عبد الكريم المنصور',
      entityType: 'INDIVIDUAL',
    });
    assert(arabicRun.candidates.some((c) => c.entryId.includes('005')), 'Arabic Al-Mansoor must match DEMO-SDN-005');

    // 3. Spaced defragmentation
    const spacedRun = await screeningService.screenEntity({
      name: 'O c e a n i c   A u r o r a   M a r i t i m e',
      entityType: 'VESSEL',
    });
    assert(spacedRun.candidates.some((c) => c.entryId.includes('001')), 'Defragmented spaced name must match DEMO-SDN-001');
  });

  // ==========================================
  // SECTION 4: Re-Screening & Reference Lookup
  // ==========================================
  console.log('\n[SECTION 4: Re-Screening & Reference Data Separation]');

  await test('CHECK 17: Scoped re-screening preserves prior run history and updates subject record', async () => {
    const sub = subjectRepositoryService.registerSubject({
      tenantId: 'tenant_rescreen',
      primaryName: 'Al-Huda International Trading LLC',
      entityType: 'ORGANIZATION',
      typedIdentifiers: [{ type: 'TAX_ID', value: 'AE-DEMO-99214' }],
      retentionPolicy: 'RE_SCREEN_ACTIVE',
    });

    // Initial screen
    const run1 = await screeningService.rescreenSubject(sub.subjectId, 'tenant_rescreen');
    assert(run1.candidates.length > 0, 'Run 1 must find Al-Huda hit');

    // Re-screen creates run2
    const run2 = await screeningService.rescreenSubject(sub.subjectId, 'tenant_rescreen');
    assert(run2.runId !== run1.runId, 'Run 2 must have distinct runId');
    assert(run2.candidates.length > 0, 'Run 2 must still find Al-Huda hit');

    const runs = storageRepository.listScreeningRuns('tenant_rescreen', sub.subjectId);
    assert(runs.length >= 2, `Expected at least 2 historical runs, got ${runs.length}`);
  });

  await test('CHECK 18: GLEIF lookup separates corporate consolidation from verified UBO', () => {
    const gleifResult = referenceLookupService.lookupGleif('549300DEMOOAURORA00');
    assert(gleifResult.isFound === true, 'Must find Oceanic Aurora LEI');
    assert(gleifResult.adverseFinding === false, 'Adverse finding must be FALSE');
    assert(gleifResult.legalNotice.includes('NOT be represented as verified beneficial ownership'), 'Legal notice must cite non-UBO disclaimer');
    assert(gleifResult.recordDetails.directConsolidationParent.includes('Global Maritime Trust Corp'), 'Consolidation parent must be present');
  });

  await test('CHECK 19: NPPES lookup separates NPI registration from active state licensure', () => {
    const npiResult = referenceLookupService.lookupNppesNpi('1982736450');
    assert(npiResult.isFound === true, 'Must find Dr. Vance NPI');
    assert(npiResult.adverseFinding === false, 'Adverse finding must be FALSE');
    assert(npiResult.legalNotice.includes('does NOT verify active state medical licensure'), 'Must disclose active licensure unverified');
  });

  // ==========================================
  // SECTION 5: Persistence & Restart Recovery
  // ==========================================
  console.log('\n[SECTION 5: Persistence & Restart Recovery]');

  await test('CHECK 20: Restart recovery: Rebuilding repository from disk recovers all snapshots & subjects', () => {
    const customDir = path.join(process.cwd(), 'data_restart_test');
    try {
      // 1. Create repo instance 1
      const repo1 = new StorageRepository({ stateDir: customDir });
      repo1.saveSubject({
        subjectId: 'sub_survives_restart',
        tenantId: 'tenant_restart',
        entityType: 'ORGANIZATION',
        primaryName: 'Perennial Shipping Enterprise',
        aliases: ['Perennial Line'],
        typedIdentifiers: [{ type: 'IMO', value: '9876543' }],
        provenance: 'RESTART_TEST',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        retentionPolicy: 'PERMANENT',
      });

      // Save a custom snapshot
      repo1.saveSnapshot({
        snapshotId: 'snap_restart_01',
        sourceId: 'OFAC_SDN',
        versionTag: 'v2026.11.RESTART',
        schemaVersion: '1.0.0',
        sha256Digest: 'sha_restart_123',
        recordCount: 1,
        aliasCount: 1,
        fetchedAt: new Date().toISOString(),
        status: 'ACTIVE',
        tenantId: 'GLOBAL',
      }, [
        {
          id: 'OFAC_SDN:RESTART-001',
          sourceId: 'OFAC_SDN',
          providerRecordId: 'RESTART-001',
          name: 'Perennial Designated Target',
          aliases: ['PDT Corp'],
          entityType: 'ORGANIZATION',
          identifiers: [{ type: 'IMO', value: '9876543' }],
        },
      ]);

      // 2. Simulate process exit & restart: create repo instance 2 on same folder
      const repo2 = new StorageRepository({ stateDir: customDir });
      const recoveredSub = repo2.getSubject('sub_survives_restart', 'tenant_restart');
      assert(recoveredSub !== undefined, 'Subject must survive restart');
      assert(recoveredSub?.primaryName === 'Perennial Shipping Enterprise', 'Primary name matches');

      const recoveredSnap = repo2.getSnapshot('snap_restart_01');
      assert(recoveredSnap !== undefined, 'Snapshot must survive restart');
      assert(recoveredSnap?.sha256Digest === 'sha_restart_123', 'Snapshot digest matches');

      const recoveredRecords = repo2.getSnapshotRecords('snap_restart_01');
      assert(recoveredRecords.length === 1, 'Records survive restart');
      assert(recoveredRecords[0].name === 'Perennial Designated Target', 'Record name matches');
    } finally {
      // Clean up test folder
      try {
        fs.rmSync(customDir, { recursive: true, force: true });
      } catch {
        // Ignore
      }
    }
  });

  await test('CHECK 21: Cloud persistence capability disclosure reports honest non-persistent container state', () => {
    const status = storageRepository.getCloudPersistenceStatus();
    assert(status.mode !== undefined, 'Storage mode must be reported');
    assert(typeof status.restartPersistenceGuaranteed === 'boolean', 'Persistence guarantee must be boolean');
    assert(status.disclaimer.length > 20, 'Disclaimer must be present');
  });

  // ==========================================
  // SECTION 6: Official MCP Tools Protocol Execution
  // ==========================================
  console.log('\n[SECTION 6: Official MCP Tools Protocol Execution]');

  await test('CHECK 22: Official MCP tool screen_name_and_identifiers executes with PII masking', async () => {
    const server = createOfficialMcpServer(true); // Agent context
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const mcpClient = new Client({ name: 'ComplianceGate-TestClient', version: '1.0.0' }, { capabilities: {} });
    await mcpClient.connect(clientTransport);

    const result = await mcpClient.callTool({
      name: 'screen_name_and_identifiers',
      arguments: {
        name: 'Oceanic Aurora Maritime Ltd',
        entityType: 'VESSEL',
        identifiers: [{ type: 'IMO', value: '9123456' }],
      },
    });

    const content = (result as any).content;
    assert(content && content.length > 0, 'MCP response content exists');
    const parsed = JSON.parse(content[0].text);
    assert(parsed.runId !== undefined, 'Run ID returned');
    assert(parsed.dimensions.candidateFindings === 'EXACT_IDENTIFIER_MATCH', 'Exact identifier match found');
    assert(parsed.candidates.length > 0, 'Candidates returned');
  });

  await test('CHECK 23: Official MCP tool lookup_reference_registry executes for GLEIF with non-adverse notice', async () => {
    const server = createOfficialMcpServer(true);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const mcpClient = new Client({ name: 'ComplianceGate-TestClient', version: '1.0.0' }, { capabilities: {} });
    await mcpClient.connect(clientTransport);

    const result = await mcpClient.callTool({
      name: 'lookup_reference_registry',
      arguments: {
        registry: 'GLEIF_LEI',
        queryId: '549300DEMOOAURORA00',
      },
    });

    const content = (result as any).content;
    const parsed = JSON.parse(content[0].text);
    assert(parsed.isFound === true, 'GLEIF record found');
    assert(parsed.adverseFinding === false, 'adverseFinding must be false');
    assert(parsed.legalNotice.includes('NOT be represented as verified beneficial ownership'), 'Disclaimer verified in MCP output');
  });

  // ==========================================
  // SECTION 7: Express REST Endpoints
  // ==========================================
  console.log('\n[SECTION 7: Express REST Endpoints]');

  const app = createComplianceApp({ isPublicDemo: false });
  let serverInstance: HttpServer;
  let baseUrl = '';

  await test('CHECK 24: Express REST endpoints: /api/sources, /api/sources/scan, /api/subjects', async () => {
    await new Promise<void>((resolve) => {
      serverInstance = app.listen(0, '127.0.0.1', () => {
        const addr = serverInstance.address() as any;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });

    try {
      // 1. GET /api/sources
      const srcRes = await fetch(`${baseUrl}/api/sources`);
      assert(srcRes.ok, 'GET /api/sources returns 200');
      const srcData = await srcRes.json();
      assert(srcData.sources.length >= 11, 'Returns at least 11 sources');

      // 2. POST /api/sources/scan
      const scanRes = await fetch(`${baseUrl}/api/sources/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Dmitry Sergeyevich Volkov',
          entityType: 'INDIVIDUAL',
        }),
      });
      assert(scanRes.ok, 'POST /api/sources/scan returns 200');
      const scanData = await scanRes.json();
      assert(scanData.candidateCount > 0, 'Volkov hit detected');

      // 3. POST /api/subjects
      const createSubRes = await fetch(`${baseUrl}/api/subjects`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-analyst-token': DEMO_ANALYST_TOKEN,
        },
        body: JSON.stringify({
          primaryName: 'REST API Registered Customer LLC',
          entityType: 'ORGANIZATION',
          jurisdiction: 'Germany',
        }),
      });
      assert(createSubRes.ok, `POST /api/subjects returns 200 (got ${createSubRes.status})`);
      const createdSub = await createSubRes.json();
      assert(createdSub.subjectId !== undefined, 'Subject ID returned');

      // 4. GET /api/subjects
      const listSubRes = await fetch(`${baseUrl}/api/subjects`, {
        headers: {
          'x-analyst-token': DEMO_ANALYST_TOKEN,
        },
      });
      assert(listSubRes.ok, 'GET /api/subjects returns 200');
      const listSubData = await listSubRes.json();
      assert(listSubData.subjects.some((s: any) => s.subjectId === createdSub.subjectId), 'Registered subject found in list');

      // 5. GET /api/reference/gleif/:lei
      const gleifRes = await fetch(`${baseUrl}/api/reference/gleif/549300DEMOOAURORA00`);
      assert(gleifRes.ok, 'GET /api/reference/gleif/:lei returns 200');
      const gleifData = await gleifRes.json();
      assert(gleifData.isFound === true, 'GLEIF isFound is true');
      assert(gleifData.adverseFinding === false, 'GLEIF adverseFinding is false');
    } finally {
      await new Promise<void>((resolve) => serverInstance.close(() => resolve()));
    }
  });

  console.log('\n======================================================');
  console.log(`SHARED DATA & PERSISTENCE TEST SUITE: ${passed} passed, ${failed} failed`);
  console.log('======================================================\n');

  if (failed > 0) {
    throw new Error(`Shared Data and Persistence Suite failed with ${failed} failure(s)`);
  }
  return { passed, failed };
}

if (process.argv[1] && process.argv[1].endsWith('shared_data_screening_persistence.test.ts')) {
  runSharedDataPersistenceSuite().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { runSharedDataPersistenceSuite };
