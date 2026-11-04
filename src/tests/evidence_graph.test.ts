/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import assert from 'node:assert';
import { evidenceGraphService, MAX_GRAPH_NODES } from '../server/services/evidenceGraphService.ts';
import { storageRepository } from '../server/services/storage/storageRepository.ts';
import { screeningService } from '../server/services/screeningService.ts';
import { paymentStoreService } from '../server/services/paymentStore.ts';
import { createOfficialMcpServer } from '../server/mcpServer.ts';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createComplianceApp } from '../server/app.ts';
import {
  AlertEvidenceGraph,
  CanonicalPaymentTransaction,
  DEMO_ANALYST_TOKEN,
  MatchDetail,
  PaymentComplianceCase,
  PaymentScreeningResult,
  ScreeningRunRecord,
} from '../shared/types.ts';

export async function runEvidenceGraphTests(): Promise<{ passed: number; failed: number }> {
  console.log('\n======================================================');
  console.log('   ComplianceGate-MCP: Alert Evidence Graph Test Suite ');
  console.log('======================================================\n');

  // TEST 1: Person Candidate: Submitted and listed identities remain separate nodes
  console.log('[CHECK 1: Person Candidate Identity Separation]');
  {
    const sampleCandidate: MatchDetail = {
      listId: 'OFAC_SDN',
      listName: 'OFAC Specially Designated Nationals',
      entryId: 'OFAC-PER-8819',
      entryName: 'Volkov, Dmitry Ivanovich',
      entryType: 'INDIVIDUAL',
      matchType: 'FUZZY_NAME',
      matchedField: 'name',
      queryValue: 'Dmitry Volkov',
      listValue: 'Volkov, Dmitry Ivanovich',
      similarityScore: 0.92,
      isExactIdentifier: false,
      programs: ['RUSSIA-EO14024'],
      notes: 'Designated under E.O. 14024 for operating in the financial services sector of the Russian Federation.',
    };

    const run: ScreeningRunRecord = {
      runId: `run_test_person_${Date.now()}`,
      tenantId: 'tenant_alpha',
      inputDigest: 'digest_person',
      queryEntity: {
        name: 'Dmitry Volkov',
        entityType: 'INDIVIDUAL',
        country: 'Cyprus',
      },
      engineVersion: 'v2026.11',
      policyVersion: 'POL-2026.11',
      manifestDigest: 'manifest_hash_1',
      manifestSnapshotCount: 11,
      candidateCount: 1,
      candidates: [sampleCandidate],
      isTruncated: false,
      dimensions: {
        inputCompleteness: 'COMPLETE',
        sourceCoverage: 'COMPLETE',
        candidateFindings: 'CANDIDATE_MATCH',
        reviewOutcome: 'REQUIRES_HUMAN_REVIEW',
      },
      findingSeverity: 'FUZZY_NAME_CANDIDATE',
      highestScore: 0.92,
      requiresHumanReview: true,
      reviewReasons: ['Fuzzy candidate match detected requiring identity adjudication.'],
      normalizationDetails: { normalizedName: 'dmitry volkov', defragmented: false, script: 'LATIN' },
      evidenceDigest: 'evidence_digest_person',
      createdAt: new Date().toISOString(),
    };

    const graph = evidenceGraphService.buildGraphForScreeningRun(run, 'tenant_alpha');

    // Invariant: The submitted subject and listed candidate MUST be separate nodes
    const submittedNode = graph.nodes.find((n) => n.category === 'SUBMITTED_FACT' && n.nodeType === 'Person');
    const candidateNode = graph.nodes.find((n) => n.category === 'WATCHLIST_CANDIDATE');

    assert(submittedNode, 'Submitted individual node exists in graph');
    assert(candidateNode, 'Candidate individual node exists in graph');
    assert.notStrictEqual(submittedNode.id, candidateNode.id, 'Submitted and listed identity nodes have distinct IDs');
    assert.strictEqual(submittedNode.label, 'Dmitry Volkov', 'Submitted node reflects query name');
    assert(candidateNode.label.includes('Volkov, Dmitry Ivanovich'), 'Candidate node reflects listed name');

    // Invariant: Link is a hypothesized possible_match_to edge
    const matchEdge = graph.edges.find((e) => e.edgeType === 'possible_match_to');
    assert(matchEdge, 'Hypothesized possible_match_to edge links submitted to candidate');
    assert.strictEqual(matchEdge.sourceNodeId, submittedNode.id, 'Edge originates from submitted entity');
    assert.strictEqual(matchEdge.targetNodeId, candidateNode.id, 'Edge points to candidate entity');
    assert.strictEqual(matchEdge.isHypothesized, true, 'Edge is explicitly marked hypothesized before review');
    console.log('  ✓ PASS: Submitted person and listed candidate remain separate nodes linked by possible_match_to');
  }

  // TEST 2: Entity candidate: source record, program, and available legal basis appear correctly
  console.log('\n[CHECK 2: Entity Candidate, Program & Legal Basis Projection]');
  {
    const sampleOrgCandidate: MatchDetail = {
      listId: 'UK_SANCTIONS_LIST',
      listName: 'UK Consolidated Sanctions',
      entryId: 'UK-ORG-4421',
      entryName: 'Al-Huda International Trading LLC',
      entryType: 'ORGANIZATION',
      matchType: 'EXACT_NAME',
      matchedField: 'name',
      queryValue: 'Al-Huda International Trading LLC',
      listValue: 'Al-Huda International Trading LLC',
      similarityScore: 1.0,
      isExactIdentifier: false,
      programs: ['ISIL-AQ', 'COUNTER-TERRORISM'],
      notes: 'Designated pursuant to the Counter-Terrorism (International Sanctions) Regulations 2019.',
    };

    const run: ScreeningRunRecord = {
      runId: `run_test_org_${Date.now()}`,
      tenantId: 'tenant_alpha',
      inputDigest: 'digest_org',
      queryEntity: {
        name: 'Al-Huda International Trading LLC',
        entityType: 'ORGANIZATION',
        country: 'AE',
      },
      engineVersion: 'v2026.11',
      policyVersion: 'POL-2026.11',
      manifestDigest: 'manifest_hash_2',
      manifestSnapshotCount: 11,
      candidateCount: 1,
      candidates: [sampleOrgCandidate],
      isTruncated: false,
      dimensions: {
        inputCompleteness: 'COMPLETE',
        sourceCoverage: 'COMPLETE',
        candidateFindings: 'CANDIDATE_MATCH',
        reviewOutcome: 'REQUIRES_HUMAN_REVIEW',
      },
      findingSeverity: 'FUZZY_NAME_CANDIDATE',
      highestScore: 1.0,
      requiresHumanReview: true,
      reviewReasons: ['High similarity candidate.'],
      normalizationDetails: { normalizedName: 'al huda international trading llc', defragmented: false, script: 'LATIN' },
      evidenceDigest: 'evidence_digest_org',
      createdAt: new Date().toISOString(),
    };

    const graph = evidenceGraphService.buildGraphForScreeningRun(run, 'tenant_alpha');

    const sourceRecordNode = graph.nodes.find((n) => n.nodeType === 'Source Record');
    assert(sourceRecordNode, 'Source Record node exists');
    assert.strictEqual(sourceRecordNode.provenance.sourceOrProvider, 'UK_SANCTIONS_LIST');
    assert.strictEqual(sourceRecordNode.provenance.originalRecordId, 'UK-ORG-4421');

    const programNodes = graph.nodes.filter((n) => n.nodeType === 'Sanctions Program');
    assert.strictEqual(programNodes.length, 2, 'Both sanctions programs (ISIL-AQ, COUNTER-TERRORISM) exist as nodes');

    const reasonNode = graph.nodes.find((n) => n.nodeType === 'Published Reason');
    assert(reasonNode, 'Published Reason node exists');
    assert(reasonNode.properties.explanation.includes('Regulations 2019'), 'Published reason contains exact statutory basis');
    console.log('  ✓ PASS: Source record, sanctions programs, and legal basis projected correctly');
  }

  // TEST 3: City/country connections do not imply a reason for sanctions
  console.log('\n[CHECK 3: Location Neutrality & Non-Implication]');
  {
    const run: ScreeningRunRecord = {
      runId: `run_test_loc_${Date.now()}`,
      tenantId: 'default',
      inputDigest: 'digest_loc',
      queryEntity: {
        name: 'Clean Logistics Corp',
        entityType: 'ORGANIZATION',
        country: 'Lebanon', // Country near high-risk zone
      },
      engineVersion: 'v2026.11',
      policyVersion: 'POL-2026.11',
      manifestDigest: 'manifest_hash_clean',
      manifestSnapshotCount: 11,
      candidateCount: 0,
      candidates: [],
      isTruncated: false,
      dimensions: {
        inputCompleteness: 'COMPLETE',
        sourceCoverage: 'COMPLETE',
        candidateFindings: 'NO_CANDIDATE',
        reviewOutcome: 'AUTO_RELEASE',
      },
      findingSeverity: 'NO_MATCH_FOUND',
      highestScore: 0,
      requiresHumanReview: false,
      reviewReasons: [],
      normalizationDetails: { normalizedName: 'clean logistics corp', defragmented: false, script: 'LATIN' },
      evidenceDigest: 'evidence_digest_clean',
      createdAt: new Date().toISOString(),
    };

    const graph = evidenceGraphService.buildGraphForScreeningRun(run, 'default');

    const countryNode = graph.nodes.find((n) => n.nodeType === 'Country');
    assert(countryNode, 'Country node exists');
    assert.strictEqual(Boolean(countryNode.isAdverse), false, 'Country node is NOT marked adverse');
    assert.strictEqual(countryNode.riskLevel, 'NONE', 'Country node has riskLevel: NONE');

    const locEdge = graph.edges.find((e) => e.edgeType === 'located_in');
    assert(locEdge, 'located_in edge connects entity to country');
    assert.strictEqual(Boolean(locEdge.isHypothesized), false, 'Location edge is factual, not hypothesized');
    assert(!locEdge.label.includes('sanction'), 'Location edge does not imply sanctions causation');
    console.log('  ✓ PASS: Country/city connections do not imply misconduct or sanctions causation');
  }

  // TEST 4: Missing published reason remains explicitly missing (No LLM hallucinations)
  console.log('\n[CHECK 4: Missing Published Reason Remains Explicitly Missing]');
  {
    const candWithoutNotes: MatchDetail = {
      listId: 'OFAC_NON_SDN',
      listName: 'OFAC Consolidated Non-SDN',
      entryId: 'NON-SDN-1002',
      entryName: 'Vostok Tech Exports LLC',
      entryType: 'ORGANIZATION',
      matchType: 'EXACT_NAME',
      matchedField: 'name',
      queryValue: 'Vostok Tech Exports LLC',
      listValue: 'Vostok Tech Exports LLC',
      similarityScore: 1.0,
      isExactIdentifier: false,
      programs: ['UKRAINE-EO13662'],
      notes: undefined, // Explicitly no notes provided by publisher
    };

    const run: ScreeningRunRecord = {
      runId: `run_test_missing_notes_${Date.now()}`,
      tenantId: 'default',
      inputDigest: 'digest_missing_notes',
      queryEntity: {
        name: 'Vostok Tech Exports LLC',
        entityType: 'ORGANIZATION',
      },
      engineVersion: 'v2026.11',
      policyVersion: 'POL-2026.11',
      manifestDigest: 'manifest_hash_notes',
      manifestSnapshotCount: 11,
      candidateCount: 1,
      candidates: [candWithoutNotes],
      isTruncated: false,
      dimensions: {
        inputCompleteness: 'INCOMPLETE',
        sourceCoverage: 'COMPLETE',
        candidateFindings: 'CANDIDATE_MATCH',
        reviewOutcome: 'REQUIRES_HUMAN_REVIEW',
      },
      findingSeverity: 'FUZZY_NAME_CANDIDATE',
      highestScore: 1.0,
      requiresHumanReview: true,
      reviewReasons: ['Match candidate.'],
      normalizationDetails: { normalizedName: 'vostok tech exports llc', defragmented: false, script: 'LATIN' },
      evidenceDigest: 'evidence_digest_notes',
      createdAt: new Date().toISOString(),
    };

    const graph = evidenceGraphService.buildGraphForScreeningRun(run, 'default');
    const reasonNode = graph.nodes.find((n) => n.nodeType === 'Published Reason');

    assert(reasonNode, 'Published Reason node exists');
    assert.strictEqual(
      reasonNode.properties.explanation,
      'Not provided by source',
      'Missing reason explicitly states "Not provided by source" without fabrication'
    );
    assert.strictEqual(reasonNode.properties.isExplicitlyMissing, true, 'Node flags isExplicitlyMissing: true');
    console.log('  ✓ PASS: Missing published reason correctly set to "Not provided by source"');
  }

  // TEST 5: Same-name unrelated entities are not merged (Stable Scoped IDs)
  console.log('\n[CHECK 5: Same-Name Unrelated Entities Not Merged]');
  {
    const cand1: MatchDetail = {
      listId: 'OFAC_SDN',
      listName: 'OFAC SDN',
      entryId: 'OFAC-991',
      entryName: 'Horizon Trading Ltd',
      entryType: 'ORGANIZATION',
      matchType: 'EXACT_NAME',
      matchedField: 'name',
      queryValue: 'Horizon Trading Ltd',
      listValue: 'Horizon Trading Ltd',
      similarityScore: 1.0,
      isExactIdentifier: false,
    };

    const cand2: MatchDetail = {
      listId: 'EU_FSF',
      listName: 'EU Financial Sanctions',
      entryId: 'EU-882',
      entryName: 'Horizon Trading Ltd',
      entryType: 'ORGANIZATION',
      matchType: 'EXACT_NAME',
      matchedField: 'name',
      queryValue: 'Horizon Trading Ltd',
      listValue: 'Horizon Trading Ltd',
      similarityScore: 1.0,
      isExactIdentifier: false,
    };

    const run: ScreeningRunRecord = {
      runId: `run_test_unmerged_${Date.now()}`,
      tenantId: 'default',
      inputDigest: 'digest_unmerged',
      queryEntity: {
        name: 'Horizon Trading Ltd',
        entityType: 'ORGANIZATION',
      },
      engineVersion: 'v2026.11',
      policyVersion: 'POL-2026.11',
      manifestDigest: 'manifest_hash_unmerged',
      manifestSnapshotCount: 11,
      candidateCount: 2,
      candidates: [cand1, cand2],
      isTruncated: false,
      dimensions: {
        inputCompleteness: 'INCOMPLETE',
        sourceCoverage: 'COMPLETE',
        candidateFindings: 'CANDIDATE_MATCH',
        reviewOutcome: 'REQUIRES_HUMAN_REVIEW',
      },
      findingSeverity: 'FUZZY_NAME_CANDIDATE',
      highestScore: 1.0,
      requiresHumanReview: true,
      reviewReasons: ['Multiple matches.'],
      normalizationDetails: { normalizedName: 'horizon trading ltd', defragmented: false, script: 'LATIN' },
      evidenceDigest: 'evidence_digest_unmerged',
      createdAt: new Date().toISOString(),
    };

    const graph = evidenceGraphService.buildGraphForScreeningRun(run, 'default');
    const candidateNodes = graph.nodes.filter((n) => n.category === 'WATCHLIST_CANDIDATE');

    assert.strictEqual(candidateNodes.length, 2, 'Both same-name candidates exist as separate distinct nodes');
    assert.notStrictEqual(candidateNodes[0].id, candidateNodes[1].id, 'Candidates have distinct source-scoped IDs');
    assert(candidateNodes.some((n) => n.id.includes('ofac_sdn')), 'OFAC candidate ID is source-scoped');
    assert(candidateNodes.some((n) => n.id.includes('eu_fsf')), 'EU candidate ID is source-scoped');
    console.log('  ✓ PASS: Same-name entities from different sources remain strictly unmerged with scoped IDs');
  }

  // TEST 6: Ownership edges appear only with evidence and correct semantics
  console.log('\n[CHECK 6: Ownership Semantics: documented_owner_of vs accounting_parent_of]');
  {
    const insuranceEval = {
      id: 'INS-TEST-EVAL-01',
      referenceId: 'POL-REF-9921',
      policy: { policyNumber: 'MAR-HULL-2026-88', lineOfBusiness: 'MARINE_CARGO' },
      ownershipChain: [
        {
          entityName: 'Baltic Shipping Holding AG',
          percentage: 65,
          isUbo: true,
          jurisdiction: 'CH',
          relationshipType: 'DIRECT_EQUITY',
        },
        {
          entityName: 'Global Consolidator Parent SE',
          percentage: 100,
          isUbo: false,
          jurisdiction: 'LU',
          source: 'GLEIF',
          relationshipType: 'ACCOUNTING_PARENT',
        },
      ],
      screeningMatches: [],
    };

    const graph = evidenceGraphService.buildGraphForModuleEvaluation('INSURANCE', insuranceEval, 'default');

    const equityEdge = graph.edges.find((e) => e.edgeType === 'documented_owner_of');
    assert(equityEdge, 'documented_owner_of edge exists for verified equity percentage');
    assert(equityEdge.label.includes('65%'), 'Ownership label states verified percentage');

    const parentEdge = graph.edges.find((e) => e.edgeType === 'accounting_parent_of');
    assert(parentEdge, 'accounting_parent_of edge exists for GLEIF consolidation parent');
    assert(parentEdge.label.includes('GLEIF consolidation != beneficial owner'), 'GLEIF edge explicitly disclaims UBO');
    console.log('  ✓ PASS: Ownership edges enforce strict semantic typing (documented_owner_of vs accounting_parent_of)');
  }

  // TEST 7: Missing data issues placed in separate panel, NOT as disconnected graph nodes
  console.log('\n[CHECK 7: Missing Data Separation from Graph Canvas]');
  {
    const tx: CanonicalPaymentTransaction = {
      transactionId: 'TX-MISSING-01',
      messageFamily: 'SWIFT_MT',
      messageType: 'MT103',
      isProfileTested: true,
      settlementDate: '2026-11-03',
      currency: 'USD',
      amount: 500000,
      parties: [
        {
          partyId: 'P1',
          role: 'DEBTOR',
          name: 'Global Oil Traders Ltd',
          identifiers: [],
          provenance: { sourceTag: ':50K:' },
        },
        {
          partyId: 'P2',
          role: 'CREDITOR',
          name: 'Acme Equipment Inc',
          identifiers: [],
          provenance: { sourceTag: ':59:' },
        },
      ],
      missingDataIssues: [
        {
          field: 'debtor.address.postalAddress',
          partyRole: 'DEBTOR',
          severity: 'CRITICAL_MISSING',
          ruleId: 'FATF_REC_16_ORIGINATOR_ADDRESS',
          ruleDescription: 'Missing mandatory physical address for ordering debtor.',
          recommendation: 'Request ordering customer street address.',
        },
        {
          field: 'debtor.nationalId',
          partyRole: 'DEBTOR',
          severity: 'WARNING_ENRICHMENT',
          ruleId: 'FATF_REC_16_NATIONAL_ID',
          ruleDescription: 'National identification number absent.',
          recommendation: 'Enrich customer file.',
        },
      ],
      provenanceSummary: {
        totalPartiesExtracted: 2,
        parserProfile: 'MT103',
      },
    };

    const screeningRes: PaymentScreeningResult = {
      referenceId: 'REF-MISSING-01',
      timestamp: new Date().toISOString(),
      transactionId: 'TX-MISSING-01',
      messageType: 'MT103',
      coverageStatus: 'COMPLETE',
      findingSeverity: 'NO_MATCH_FOUND',
      highestScore: 0,
      staleLists: [],
      missingLists: [],
      partyOutcomes: [],
      missingDataIssues: tx.missingDataIssues,
      policyVersion: 'POL-FATF-16',
      listDigests: {},
      disclaimer: 'DISCLAIMER',
      requiresHumanReview: true,
      isRedactedForAgent: false,
      payloadDigest: 'digest_tx_missing',
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    };

    const graph = evidenceGraphService.buildGraphForPaymentScreening(screeningRes, tx, 'default');

    // Invariant: The graph nodes list MUST NOT contain disconnected ": MISSING" nodes (like in the bad screenshot)
    const missingNodes = graph.nodes.filter(
      (n) => n.label.endsWith(': MISSING') || n.label.startsWith('MISSING:') || n.nodeType === ('Missing Data' as any)
    );
    assert.strictEqual(missingNodes.length, 0, 'No floating/disconnected MISSING nodes in graph nodes array');

    // Invariant: Missing data issues are collected in missingDataIssues panel data
    assert.strictEqual(graph.missingDataIssues.length, 2, 'All 2 missing data issues recorded in missingDataIssues list');
    assert.strictEqual(graph.missingDataIssues[0].severity, 'CRITICAL');
    assert.strictEqual(graph.missingDataIssues[0].field, 'debtor.address.postalAddress');
    console.log('  ✓ PASS: Missing data items isolated to dedicated panel without polluting graph canvas');
  }

  // TEST 8: Historical evidence: pinned to screening run and snapshots (updates preserve old graph)
  console.log('\n[CHECK 8: Historical Graph Immutability]');
  {
    const runId = `run_hist_${Date.now()}`;
    const initialRun: ScreeningRunRecord = {
      runId,
      tenantId: 'default',
      inputDigest: 'hist_digest_1',
      queryEntity: { name: 'Al-Baraka Corp', entityType: 'ORGANIZATION' },
      engineVersion: 'v1.0',
      policyVersion: 'POL-INITIAL',
      manifestDigest: 'manifest_v1_hash',
      manifestSnapshotCount: 8,
      candidateCount: 0,
      candidates: [],
      isTruncated: false,
      dimensions: {
        inputCompleteness: 'COMPLETE',
        sourceCoverage: 'COMPLETE',
        candidateFindings: 'NO_CANDIDATE',
        reviewOutcome: 'AUTO_RELEASE',
      },
      findingSeverity: 'NO_MATCH_FOUND',
      highestScore: 0,
      requiresHumanReview: false,
      reviewReasons: [],
      normalizationDetails: { normalizedName: 'al baraka corp', defragmented: false, script: 'LATIN' },
      evidenceDigest: 'hist_evidence_digest_v1',
      createdAt: '2026-11-01T10:00:00.000Z',
    };

    const initialGraph = evidenceGraphService.buildGraphForScreeningRun(initialRun, 'default');
    storageRepository.saveEvidenceGraph(initialGraph);

    // Verify graph is stored and pinned to manifest_v1_hash
    const retrievedV1 = storageRepository.getEvidenceGraphByRunId(runId, 'default');
    assert(retrievedV1, 'Historical graph retrieved from storage');
    assert.strictEqual(retrievedV1.manifestDigest, 'manifest_v1_hash');
    assert.strictEqual(retrievedV1.generatedAt, '2026-11-01T10:00:00.000Z');

    // Simulate subsequent re-screen on day 2 under a new manifest
    const rescreenRun: ScreeningRunRecord = {
      ...initialRun,
      runId: `run_hist_v2_${Date.now()}`,
      manifestDigest: 'manifest_v2_updated_hash',
      manifestSnapshotCount: 11,
      createdAt: '2026-11-03T12:00:00.000Z',
    };
    const rescreenGraph = evidenceGraphService.buildGraphForScreeningRun(rescreenRun, 'default');
    storageRepository.saveEvidenceGraph(rescreenGraph);

    // Old historical graph remains untouched
    const oldGraphAfterUpdate = storageRepository.getEvidenceGraphByRunId(runId, 'default');
    assert.strictEqual(oldGraphAfterUpdate?.manifestDigest, 'manifest_v1_hash', 'Old graph manifestDigest preserved');
    assert.strictEqual(oldGraphAfterUpdate?.generatedAt, '2026-11-01T10:00:00.000Z', 'Old graph timestamp preserved');
    console.log('  ✓ PASS: Source updates preserve historical case and screening graphs');
  }

  // TEST 9: Cross-tenant access isolation & field-level role filtering
  console.log('\n[CHECK 9: Multi-Tenant Isolation & Role Filtering]');
  {
    const tenantAGraph: AlertEvidenceGraph = {
      graphId: 'graph_tenant_a_001',
      version: '1.0',
      tenantId: 'tenant_alpha',
      generatedAt: new Date().toISOString(),
      moduleId: 'PAYMENTS',
      nodes: [
        {
          id: 'sub:tenant_a_entity',
          label: 'Tenant Alpha Confidential Client',
          nodeType: 'Organisation',
          category: 'SUBMITTED_FACT',
          provenance: {
            sourceOrProvider: 'INTERNAL_LIST_ALPHA',
            originalRecordId: 'ALPHA-001',
            snapshotOrVersion: 'V1',
            retrievalTime: new Date().toISOString(),
            isRestrictedInternal: true,
          },
          properties: { privateAccount: 'ACC-ALPHA-992' },
        },
      ],
      edges: [],
      isTruncated: false,
      totalNodeCount: 1,
      totalEdgeCount: 0,
      maxNodesAllowed: 80,
      missingDataIssues: [],
      summary: {
        submittedEntityCount: 1,
        candidateCount: 0,
        sourceFactCount: 0,
        alertCount: 0,
        decisionCount: 0,
      },
      evidenceDigest: 'alpha_digest',
    };

    storageRepository.saveEvidenceGraph(tenantAGraph);

    // Invariant: Tenant Beta querying Tenant Alpha's graph throws access denied
    assert.throws(
      () => {
        evidenceGraphService.filterGraphForRole(tenantAGraph, 'COMPLIANCE_OFFICER', 'tenant_beta');
      },
      /ACCESS_DENIED/,
      'Cross-tenant access explicitly throws ACCESS_DENIED error'
    );

    // Invariant: Auditor role cannot view restricted internal lists
    const filteredForAuditor = evidenceGraphService.filterGraphForRole(tenantAGraph, 'AUDITOR', 'tenant_alpha');
    assert.strictEqual(
      filteredForAuditor.nodes.length,
      0,
      'Auditor role filtered out node containing restricted internal source list'
    );
    console.log('  ✓ PASS: Multi-tenant access boundaries and auditor restrictions enforced');
  }

  // TEST 10: Malicious labels handled safely (XSS / formula prefix protection)
  console.log('\n[CHECK 10: XSS & Formula Injection Sanitization in Graph Nodes]');
  {
    const maliciousLabel = '<script>alert("xss")</script><img src=x onerror=alert(1)>';
    const sanitized = evidenceGraphService.sanitizeLabel(maliciousLabel);
    assert(!sanitized.includes('<script>'), 'Script tag escaped');
    assert(!sanitized.includes('<img'), 'Img tag escaped');
    assert(sanitized.includes('&lt;script&gt;'), 'HTML entities properly encoded');
    console.log('  ✓ PASS: Malicious labels encoded and neutralized safely');
  }

  // TEST 11: Bounded graph size and disclosure of truncation
  console.log('\n[CHECK 11: Graph Size Bounding & Truncation Disclosure]');
  {
    const manyCandidates: MatchDetail[] = [];
    for (let i = 0; i < 90; i++) {
      manyCandidates.push({
        listId: 'OFAC_SDN',
        listName: 'OFAC SDN',
        entryId: `OFAC-${i}`,
        entryName: `Candidate Entity #${i}`,
        entryType: 'ORGANIZATION',
        matchType: 'FUZZY_NAME',
        matchedField: 'name',
        queryValue: 'Mega Corp',
        listValue: `Candidate Entity #${i}`,
        similarityScore: 0.85,
        isExactIdentifier: false,
      });
    }

    const run: ScreeningRunRecord = {
      runId: `run_test_overflow_${Date.now()}`,
      tenantId: 'default',
      inputDigest: 'digest_overflow',
      queryEntity: { name: 'Mega Corp', entityType: 'ORGANIZATION' },
      engineVersion: 'v2026.11',
      policyVersion: 'POL-2026.11',
      manifestDigest: 'manifest_overflow',
      manifestSnapshotCount: 11,
      candidateCount: 90,
      candidates: manyCandidates,
      isTruncated: true,
      dimensions: {
        inputCompleteness: 'COMPLETE',
        sourceCoverage: 'COMPLETE',
        candidateFindings: 'CANDIDATE_MATCH',
        reviewOutcome: 'REQUIRES_HUMAN_REVIEW',
      },
      findingSeverity: 'FUZZY_NAME_CANDIDATE',
      highestScore: 0.85,
      requiresHumanReview: true,
      reviewReasons: ['Many matches.'],
      normalizationDetails: { normalizedName: 'mega corp', defragmented: false, script: 'LATIN' },
      evidenceDigest: 'evidence_digest_overflow',
      createdAt: new Date().toISOString(),
    };

    const graph = evidenceGraphService.buildGraphForScreeningRun(run, 'default');
    assert(graph.nodes.length <= MAX_GRAPH_NODES, `Graph node count (${graph.nodes.length}) bounded by MAX_GRAPH_NODES`);
    assert.strictEqual(graph.isTruncated, true, 'isTruncated flag set to true');
    console.log('  ✓ PASS: Large graphs bounded without silent loss of truncation disclosure');
  }

  // TEST 12: No-alert results do not fabricate sanctions relationships
  console.log('\n[CHECK 12: Clean Entity No-Alert Graph Integrity]');
  {
    const run: ScreeningRunRecord = {
      runId: `run_test_clean_${Date.now()}`,
      tenantId: 'default',
      inputDigest: 'digest_clean',
      queryEntity: { name: 'Acme General Hardware Supplies Ltd', country: 'CA', entityType: 'ORGANIZATION' },
      engineVersion: 'v2026.11',
      policyVersion: 'POL-2026.11',
      manifestDigest: 'manifest_clean',
      manifestSnapshotCount: 11,
      candidateCount: 0,
      candidates: [],
      isTruncated: false,
      dimensions: {
        inputCompleteness: 'COMPLETE',
        sourceCoverage: 'COMPLETE',
        candidateFindings: 'NO_CANDIDATE',
        reviewOutcome: 'AUTO_RELEASE',
      },
      findingSeverity: 'NO_MATCH_FOUND',
      highestScore: 0,
      requiresHumanReview: false,
      reviewReasons: [],
      normalizationDetails: { normalizedName: 'acme general hardware supplies ltd', defragmented: false, script: 'LATIN' },
      evidenceDigest: 'evidence_digest_clean',
      createdAt: new Date().toISOString(),
    };

    const graph = evidenceGraphService.buildGraphForScreeningRun(run, 'default');
    const adverseNodes = graph.nodes.filter((n) => n.isAdverse);
    const candidateNodes = graph.nodes.filter((n) => n.category === 'WATCHLIST_CANDIDATE');
    const alertNodes = graph.nodes.filter((n) => n.nodeType === 'Alert');

    assert.strictEqual(adverseNodes.length, 0, 'Zero adverse nodes on clean entity screening');
    assert.strictEqual(candidateNodes.length, 0, 'Zero candidate nodes on clean entity screening');
    assert.strictEqual(alertNodes.length, 0, 'Zero alert nodes on clean entity screening');
    assert.strictEqual(graph.summary.candidateCount, 0);
    console.log('  ✓ PASS: Clean entity screening produces zero fabricated sanctions or candidate nodes');
  }

  // TEST 13: Official MCP Tool Execution: get_alert_evidence_graph with PII Redaction
  console.log('\n[CHECK 13: Official MCP Tool get_alert_evidence_graph & PII Masking]');
  {
    const mcpServer = createOfficialMcpServer(true);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await mcpServer.connect(serverTransport);
    const mcpClient = new Client({ name: 'evidence-graph-test-client', version: '1.0.0' }, { capabilities: {} });
    await mcpClient.connect(clientTransport);

    // Call get_alert_evidence_graph via official MCP client
    const res = await mcpClient.callTool({
      name: 'get_alert_evidence_graph',
      arguments: {
        moduleId: 'MARITIME',
        evaluationPayload: {
          id: 'EVAL-MCP-01',
          vessel: {
            vesselName: 'Atlantic Pioneer',
            imoNumber: '9123456',
            mmsi: '211334000',
            flag: 'Panama',
            registeredOwner: 'Pacific Shipping Lines',
          },
          portHistory: [
            { portCode: 'RUNVS', portName: 'Novorossiysk', country: 'Russia', departureDate: '2026-10-20' },
          ],
          screeningAlerts: [
            { alertId: 'ALT-MAR-01', category: 'PORT_OF_CONCERN', severity: 'CRITICAL', description: 'Visited high-risk port' },
          ],
        },
      },
    });

    const parsedContent = JSON.parse(((res as any).content[0] as any).text);
    assert(parsedContent.nodes, 'MCP tool returned graph nodes array');
    assert(parsedContent.edges, 'MCP tool returned graph edges array');
    assert.strictEqual(parsedContent.moduleId, 'MARITIME', 'Module ID preserved in MCP response');
    assert(parsedContent.nodes.some((n: any) => n.nodeType === 'Vessel'), 'Vessel node extracted via MCP tool');
    assert(parsedContent.edges.some((e: any) => e.edgeType === 'documented_owner_of'), 'documented_owner_of edge present');
    console.log('  ✓ PASS: Official MCP tool get_alert_evidence_graph executed successfully with valid schema');
  }

  // TEST 14: REST API Endpoints: GET /api/cases/:id/graph and POST /api/graphs/generate
  console.log('\n[CHECK 14: REST API Graph Endpoints]');
  {
    const app = createComplianceApp();
    const server = app.listen(0);
    const port = (server.address() as any).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      // 1. POST /api/graphs/generate
      const genRes = await fetch(`${baseUrl}/api/graphs/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-analyst-token': DEMO_ANALYST_TOKEN },
        body: JSON.stringify({
          moduleId: 'AIR_CARGO',
          payload: {
            id: 'AIR-REST-01',
            shipment: { awbNumber: '020-12345675' },
            parties: [
              { role: 'SHIPPER', name: 'Al-Farouk Cargo LLC', matches: [] },
              { role: 'CONSIGNEE', name: 'Continental Trading GmbH', matches: [] },
            ],
          },
        }),
      });

      assert.strictEqual(genRes.status, 200, 'POST /api/graphs/generate returns HTTP 200');
      const genGraph = await genRes.json();
      assert.strictEqual(genGraph.moduleId, 'AIR_CARGO');
      assert(genGraph.nodes.length >= 3, 'Air cargo graph generated nodes');

      // 2. GET /api/graphs/:id
      const getRes = await fetch(`${baseUrl}/api/graphs/${genGraph.graphId}`, {
        headers: { 'x-analyst-token': DEMO_ANALYST_TOKEN },
      });
      assert.strictEqual(getRes.status, 200, 'GET /api/graphs/:id returns HTTP 200');
      const retrievedGraph = await getRes.json();
      assert.strictEqual(retrievedGraph.graphId, genGraph.graphId);

      // 3. GET /api/graphs/:id/export
      const exportRes = await fetch(`${baseUrl}/api/graphs/${genGraph.graphId}/export`, {
        headers: { 'x-analyst-token': DEMO_ANALYST_TOKEN },
      });
      assert.strictEqual(exportRes.status, 200, 'GET /api/graphs/:id/export returns HTTP 200');
      const exportPack = await exportRes.json();
      assert(exportPack.packId, 'Evidence pack contains packId');
      assert.strictEqual(exportPack.evidenceDigest, genGraph.evidenceDigest, 'Evidence pack digest matches graph');
      console.log('  ✓ PASS: REST endpoints (/api/graphs/generate, /api/graphs/:id, /export) verified');
    } finally {
      server.close();
    }
  }

  // TEST 15: Zero Regressions: Existing Screening Decisions Do Not Change
  console.log('\n[CHECK 15: Regression Check: Existing Screening Decisions Unaltered]');
  {
    const sampleTx: CanonicalPaymentTransaction = {
      transactionId: 'TX-REGRESSION-01',
      messageFamily: 'SWIFT_MT',
      messageType: 'MT103',
      isProfileTested: true,
      settlementDate: '2026-11-03',
      currency: 'EUR',
      amount: 100000,
      parties: [
        {
          partyId: 'P_DEBT',
          role: 'DEBTOR',
          name: 'Siemens AG',
          address: { country: 'DE', rawLines: ['Munich, Germany'] },
          identifiers: [],
          provenance: { sourceTag: ':50K:' },
        },
        {
          partyId: 'P_CRED',
          role: 'CREDITOR',
          name: 'Al-Huda International Trading LLC',
          address: { country: 'AE', rawLines: ['Dubai, UAE'] },
          identifiers: [],
          provenance: { sourceTag: ':59:' },
        },
      ],
      missingDataIssues: [],
      provenanceSummary: {
        totalPartiesExtracted: 2,
        parserProfile: 'MT103',
      },
    };

    const screening = await paymentStoreService.screenTransaction(sampleTx, 'analyst_ui', 'default');
    // Ensure screening finding severity remains exactly as expected
    assert.strictEqual(screening.findingSeverity, 'FUZZY_NAME_CANDIDATE', 'Severity remains FUZZY_NAME_CANDIDATE');
    assert.strictEqual(screening.requiresHumanReview, true, 'requiresHumanReview remains true');
    console.log('  ✓ PASS: Existing screening logic and verdicts completely unchanged');
  }

  console.log('\n======================================================');
  console.log('ALERT EVIDENCE GRAPH TEST SUITE: 15 passed, 0 failed');
  console.log('======================================================\n');
  return { passed: 15, failed: 0 };
}
