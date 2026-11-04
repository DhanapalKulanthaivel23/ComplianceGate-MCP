/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import assert from 'node:assert';
import { memorySearchIndex } from '../server/services/memoryIndex.ts';
import { screeningService } from '../server/services/screeningService.ts';
import { sourceRegistryService } from '../server/services/sourceRegistry.ts';
import { storageRepository } from '../server/services/storage/storageRepository.ts';
import { moduleWorkflowStore } from '../server/services/moduleWorkflowStore.ts';
import { referenceLookupService } from '../server/services/referenceLookupService.ts';
import { evidenceGraphService } from '../server/services/evidenceGraphService.ts';
import { evaluateInsurancePolicy } from '../server/services/modules/insuranceService.ts';
import { evaluateMaritimeVessel } from '../server/services/modules/maritimeService.ts';
import { createComplianceApp } from '../server/app.ts';
import { DEMO_ANALYST_TOKEN } from '../shared/types.ts';
import { parseCsvRecords } from '../server/services/sources/officialParsers.ts';

export async function runWorkflowAndIsolationAcceptanceSuite() {
  console.log('\n======================================================');
  console.log('   ComplianceGate-MCP: Workflow & Tenant Isolation    ');
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

  // CHECK 1: Tenant Private List Upload & Tenant-Scoped Search Isolation
  await test('CHECK 1: Tenant B cannot receive candidates from Tenant A private list', async () => {
    const tenantA = 'tenant_alpha_01';
    const tenantB = 'tenant_beta_02';

    // 1. Create private custom source for Tenant A
    const canarySourceId = `PRIVATE_CANARY_SRC_${Date.now()}`;
    sourceRegistryService.createCustomSource(
      {
        sourceId: canarySourceId,
        name: 'Tenant Alpha Canary Watchlist',
        publisher: 'Tenant Alpha Security',
        category: 'INTERNAL_WATCHLIST',
        format: 'CSV',
      },
      tenantA
    );

    // 2. Ingest private canary entry for Tenant A
    const canaryCsv = `name,type,country,id,remarks\n"ZQX Synthetic Canary 7319",ORGANIZATION,Panama,CANARY-7319,"Alpha internal investigation"`;
    await sourceRegistryService.ingestAndValidate({
      sourceId: canarySourceId,
      tenantId: tenantA,
      rawContent: canaryCsv,
      filename: 'alpha_canary.csv',
      format: 'CSV',
      autoActivate: true,
      actor: 'alpha_analyst',
    });

    // Rebuild index for Tenant A
    await memorySearchIndex.rebuildIndex(tenantA);

    // 3. Search as Tenant A -> MUST MATCH
    const resA = await screeningService.screenEntity({
      name: 'ZQX Synthetic Canary 7319',
      entityType: 'ORGANIZATION',
      tenantId: tenantA,
    });
    assert(resA.candidateCount > 0, 'Tenant A search matches private canary');
    assert(
      resA.candidates.some((c) => (c.entryName || c.queryValue || '').includes('Synthetic Canary')),
      'Canary candidate found in Tenant A results'
    );

    // 4. Search as Tenant B -> MUST NOT MATCH (Zero leak!)
    const resB = await screeningService.screenEntity({
      name: 'ZQX Synthetic Canary 7319',
      entityType: 'ORGANIZATION',
      tenantId: tenantB,
    });
    assert.strictEqual(resB.candidateCount, 0, 'Tenant B search returns 0 candidates for Tenant A canary');
  });

  // CHECK 2: Cross-Module Screening Inherits Tenant Overlay
  await test('CHECK 2: Module screening (Insurance) matches Tenant A private canary and isolates Tenant B', async () => {
    const tenantA = 'tenant_alpha_01';
    const tenantB = 'tenant_beta_02';

    // Screen policy in Tenant A
    const evalA = await evaluateInsurancePolicy({
      tenantId: tenantA,
      policyNumber: 'POL-ALPHA-901',
      screeningStage: 'PRE_BIND_UNDERWRITING',
      lineOfBusiness: 'MARINE_HULL_AND_CARGO',
      sumInsured: 5000000,
      currency: 'USD',
      policyParties: [
        {
          role: 'PRIMARY_INSURED',
          name: 'ZQX Synthetic Canary 7319',
          country: 'PA',
          entityType: 'ORGANIZATION',
        },
      ],
      corporateEntityUbo: {
        entityName: 'ZQX Synthetic Canary 7319',
        beneficialOwners: [
          {
            name: 'ZQX Synthetic Canary 7319',
            country: 'PA',
            ownershipPercentage: 100,
            ownershipType: 'DIRECT',
          },
        ],
      },
    });

    // Tenant A primary insured hit canary
    assert(evalA.policyParties[0].matches.length > 0, 'Tenant A primary insured matched canary list');
    assert(
      evalA.underwritingDecision === 'REFER_TO_SENIOR_COUNSEL' || evalA.underwritingDecision === 'BLOCK_AND_HOLD',
      'Tenant A insurance policy held or referred for matching private canary'
    );

    // Screen same policy in Tenant B -> Clean
    const evalB = await evaluateInsurancePolicy({
      tenantId: tenantB,
      policyNumber: 'POL-BETA-901',
      screeningStage: 'PRE_BIND_UNDERWRITING',
      lineOfBusiness: 'MARINE_HULL_AND_CARGO',
      sumInsured: 5000000,
      currency: 'USD',
      policyParties: [
        {
          role: 'PRIMARY_INSURED',
          name: 'ZQX Synthetic Canary 7319',
          country: 'PA',
          entityType: 'ORGANIZATION',
        },
      ],
      corporateEntityUbo: {
        entityName: 'ZQX Synthetic Canary 7319',
        beneficialOwners: [
          {
            name: 'ZQX Synthetic Canary 7319',
            country: 'PA',
            ownershipPercentage: 100,
            ownershipType: 'DIRECT',
          },
        ],
      },
    });

    assert.strictEqual(evalB.policyParties[0].matches.length, 0, 'Tenant B policy has 0 matches');
    if (evalB.underwritingDecision !== 'APPROVED') {
      console.log('DEBUG evalB:', {
        underwritingDecision: evalB.underwritingDecision,
        reviewReasons: evalB.reviewReasons,
        completenessStatus: evalB.completenessStatus,
        requiresHumanReview: evalB.requiresHumanReview,
      });
    }
    assert.strictEqual(
      evalB.underwritingDecision,
      'APPROVED',
      'Tenant B insurance policy is approved because Tenant A canary is invisible'
    );
  });

  // CHECK 3: Strict Source Selection Integrity (Unknown sources trigger UNAVAILABLE)
  await test('CHECK 3: Unknown or unloaded source selection triggers UNAVAILABLE + REQUIRES_HUMAN_REVIEW', async () => {
    const res = await screeningService.screenEntity({
      name: 'Clean Generic Corporation',
      entityType: 'ORGANIZATION',
      sourceIds: ['NON_EXISTENT_LIST_9999'],
      tenantId: 'default',
    });

    assert.strictEqual(res.dimensions?.sourceCoverage, 'UNAVAILABLE', 'Coverage marked UNAVAILABLE');
    assert.strictEqual(res.requiresHumanReview, true, 'Human review mandatory for missing source');
    assert.strictEqual(res.dimensions?.reviewOutcome, 'REQUIRES_HUMAN_REVIEW', 'Outcome requires human review');
  });

  // CHECK 4: File & Subject Batch Intake Exact Reconciliation
  await test('CHECK 4: Batch intake guarantees totalSubmitted === validCount + rejectedCount', async () => {
    const testCsv = `name,type,country,id\n"Acme Corp",ORGANIZATION,United States,REG-01\n,ORGANIZATION,Germany,MISSING-NAME\n"Beta Logistics",ORGANIZATION,France,REG-02\n`;
    
    // Test RFC 4180 parsing with multiline quoted field
    const multilineCsv = `name,type,country,id\n"Acme Multi-Hop\nTrading Global",ORGANIZATION,US,REG-01\n"Second Company",ORGANIZATION,UK,REG-02`;
    const parsedRows = parseCsvRecords(multilineCsv);
    assert.strictEqual(parsedRows.length, 3, 'RFC 4180 maintains quoted multiline as single row (header + 2 data rows)');
    assert(parsedRows[1][0].includes('\n'), 'Field contains embedded newline intact');

    // Run batch screening via screeningService
    const batchRes = await screeningService.batchScreenSubjects(
      testCsv,
      'CSV',
      'default'
    );

    assert.strictEqual(batchRes.totalSubmitted, 3, 'Total submitted is 3');
    assert.strictEqual(batchRes.validCount, 2, 'Valid count is 2');
    assert.strictEqual(batchRes.rejectedCount, 1, 'Rejected count is 1 (missing name)');
    assert.strictEqual(
      batchRes.totalSubmitted,
      batchRes.validCount + batchRes.rejectedCount,
      'Exact balance invariant satisfied: totalSubmitted === validCount + rejectedCount'
    );
  });

  // CHECK 5: Durable Case Adjudication via Write-Ahead Log
  await test('CHECK 5: Case adjudication transitions persist to WAL with valid cryptographic chain', async () => {
    // Create workflow
    const wf = moduleWorkflowStore.createWorkflow({
      moduleId: 'TRADE_AND_CARGO',
      subjectReference: 'TRD-TEST-WAL-001',
      subjectSummary: 'Bill of Lading with Discrepancies',
      findings: ['Dual-Use Proliferation Warning'],
      tenantId: 'default',
      actorId: 'test_analyst',
    });

    assert(wf.workflowId.startsWith('wf_TRADE_AND_CARGO_'), 'Workflow created with correct prefix');
    assert.strictEqual(wf.status, 'OPEN_RECONCILIATION', 'Initial status is OPEN_RECONCILIATION');

    // Complete all mandatory checklist items
    for (const item of wf.checklist.filter((i) => i.required)) {
      moduleWorkflowStore.completeChecklistItem({
        workflowId: wf.workflowId,
        itemId: item.itemId,
        evidenceNotes: 'Verified shipping manifest and classification against regulatory standards',
        actorId: 'test_analyst',
      });
    }

    // Transition with mandatory rationale
    const afterTransition = moduleWorkflowStore.transitionWorkflow({
      workflowId: wf.workflowId,
      targetStatus: 'APPROVED_WITH_EVIDENCE',
      rationale: 'Port authority confirmed goods classification conforms to dual-use general licence #49281.',
      actorId: 'test_compliance_officer',
    });

    assert.strictEqual(afterTransition.status, 'APPROVED_WITH_EVIDENCE', 'Status transitioned to APPROVED_WITH_EVIDENCE');

    // Verify hash chain
    const verifyResult = moduleWorkflowStore.verifyWorkflowChain(wf.workflowId);
    assert.strictEqual(verifyResult.isValid, true, 'Cryptographic audit trail hash chain is intact');
  });

  // CHECK 6: Reference Lookup Fact Separation (No fabricated enrichments)
  await test('CHECK 6: Reference lookup does not insert fabricated corporate parents or taxonomies', async () => {
    const leiRes = referenceLookupService.lookupGleif('549300DEMOOAURORA00');
    assert.strictEqual(leiRes.isFound, true, 'LEI record found');
    assert.strictEqual(leiRes.adverseFinding, false, 'Reference lookup is not adverse');
    // Ensure consolidation parent is factually identified as accounting parent, not verified beneficial owner
    assert(
      leiRes.legalNotice.includes('NOT be represented as verified beneficial ownership'),
      'Clear regulatory disclaimer present'
    );
  });

  // CHECK 7: Alert Evidence Graph Zero Floating : MISSING Nodes
  await test('CHECK 7: Alert Evidence Graph has zero floating ": MISSING" nodes', async () => {
    const graph = evidenceGraphService.buildGraphForModuleEvaluation(
      'TRADE_AND_CARGO',
      {
        id: 'TRD-TEST-GRAPH-001',
        referenceId: 'BL-99001',
        documentsScreened: { blNumber: 'BL-99001' },
        parties: [
          { name: 'Amber Coast Foods', role: 'SHIPPER', country: 'US', matches: [] },
          { name: 'Silver Birch Exporters', role: 'CONSIGNEE', country: 'CY', matches: [] },
        ],
        dualUseHits: [
          { hsCode: '8401.20', proliferationCategory: 'NUCLEAR_DUAL_USE', licensingRequirement: 'LICENCE_REQUIRED' },
        ],
        discrepancies: [
          { category: 'PORT_OF_LOADING_MISMATCH', description: 'Port mismatch between LC and BL', severity: 'CRITICAL', sourceDoc: 'BL', comparedDoc: 'LC' },
        ],
      },
      'default'
    );

    // Verify zero floating MISSING nodes
    const badNodes = graph.nodes.filter(
      (n) => n.label.endsWith(': MISSING') || n.label.startsWith('MISSING:') || (n.nodeType as any) === 'Missing Data'
    );
    assert.strictEqual(badNodes.length, 0, `Zero floating : MISSING nodes in graph (found ${badNodes.length})`);
    assert(graph.missingDataIssues.length > 0, 'Discrepancy correctly recorded in missingDataIssues table');
  });

  // CHECK 8: Honest Storage Engine Capability Mode
  await test('CHECK 8: Honest storage mode disclosure reports LOCAL_PERSISTENT_SQLITE / CLOUD_EPHEMERAL_STANDBY', async () => {
    // 1. Local environment report
    const localStatus = storageRepository.getCloudPersistenceStatus();
    assert(
      localStatus.mode === 'LOCAL_PERSISTENT_SQLITE' || localStatus.mode === 'CLOUD_EPHEMERAL_STANDBY',
      `Storage reports honest capability mode: ${localStatus.mode}`
    );
    assert(localStatus.disclaimer.length > 0, 'Disclaimer present in local mode');

    // 2. Simulated Cloud Run ephemeral environment (without persistence bucket/mount)
    process.env.K_SERVICE = 'compliancegate-service';
    delete process.env.GCP_PERSISTENT_MOUNT;
    delete process.env.PERSISTENCE_BUCKET;
    const cloudStatus = storageRepository.getCloudPersistenceStatus();
    assert.strictEqual(cloudStatus.mode, 'CLOUD_EPHEMERAL_STANDBY', 'Reports CLOUD_EPHEMERAL_STANDBY under Cloud Run');
    assert.strictEqual(cloudStatus.restartPersistenceGuaranteed, false, 'Does not claim persistent container storage');
    assert(
      cloudStatus.disclaimer.includes('Data will NOT survive container cold restarts'),
      'Discloses cold container restart limitation honestly'
    );
    delete process.env.K_SERVICE;
  });

  console.log('\n======================================================');
  console.log(`WORKFLOW & TENANT ISOLATION SUITE: ${passed} passed, ${failed} failed`);
  console.log('======================================================\n');

  if (failed > 0) {
    throw new Error(`Workflow and Isolation Suite failed with ${failed} failure(s)`);
  }

  return { passed, failed };
}

if (process.argv[1] && process.argv[1].endsWith('workflow_and_isolation_acceptance.test.ts')) {
  runWorkflowAndIsolationAcceptanceSuite().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
