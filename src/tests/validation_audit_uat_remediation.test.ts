/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import {
  runValidationAndAuditBenchmark,
  runExtendedValidationSuite,
  BASELINE_EVASION_SPECS,
} from '../server/services/modules/validationAndAuditService.ts';
import { executeMcpTool } from '../server/mcpServer.ts';
import { normalizeEntityName, tokenSortRatio, sha256 } from '../server/services/normalizer.ts';
import { embeddedSyntheticEngine } from '../server/services/engineAdapter.ts';
import { paymentStoreService } from '../server/services/paymentStore.ts';
import { PaymentComplianceCase } from '../shared/types.ts';
import { createComplianceApp } from '../server/app.ts';
import http from 'node:http';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
  console.log(`  ✓ PASS: ${message}`);
}

export async function runValidationAuditUatSuite(): Promise<{ passed: number; failed: number }> {
  console.log('\n================================================================');
  console.log('   RUNNING VALIDATION & AUDIT UAT REMEDIATION TEST SUITE');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  async function runCheck(name: string, fn: () => void | Promise<void>) {
    console.log(`\n[${name}]`);
    try {
      await fn();
      passed++;
    } catch (err: any) {
      console.error(`  ✗ FAIL: ${name} ->`, err.message);
      failed++;
    }
  }

  // ---------------------------------------------------------------------------
  // Check 1: Spacing Evasion Defragmentation & Positives (EVASION-CASE-004)
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 1: Spacing Evasion Defragmentation & Positives (EVASION-CASE-004)', () => {
    const rawFragmented = 'O c e a n i c   A u r o r a   M a r i t i m e';
    const normalized = normalizeEntityName(rawFragmented);

    assert(normalized === 'oceanic aurora maritime', `Defragmented to "oceanic aurora maritime", got "${normalized}"`);

    const partyRes = embeddedSyntheticEngine.screenPartySync({
      partyId: 'evasion_4',
      role: 'DEBTOR',
      name: rawFragmented,
      identifiers: [],
      provenance: { sourceTag: 'TEST', rawSnippet: rawFragmented },
    });

    assert(partyRes.matches.length > 0, 'Fragmented name produced candidate matches');
    assert(
      partyRes.matches.some(m => m.entryName === 'Oceanic Aurora Maritime Ltd' && m.listId === 'DEMO_OFAC_SDN'),
      'Matched intended baseline Oceanic Aurora Maritime Ltd on DEMO_OFAC_SDN'
    );
    assert(partyRes.highestScore >= 0.85, `Candidate score is ${partyRes.highestScore} (>= 0.85)`);

    // Additional fragmented positive
    const volkovFragmented = 'D m i t r y   S e r g e y e v i c h   V o l k o v';
    const normVolkov = normalizeEntityName(volkovFragmented);
    assert(normVolkov === 'dmitry sergeyevich volkov', `Defragmented Volkov to "${normVolkov}"`);
  });

  // ---------------------------------------------------------------------------
  // Check 2: Benign Negative Controls Spacing Preservation
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 2: Benign Negative Controls Spacing Preservation', () => {
    // Normal single-letter words or benign text should NOT collapse incorrectly
    const benignCases = [
      { input: 'Lumen Lighting Design SAS', expected: 'lumen lighting design sas' },
      { input: 'A and B Corp', expected: 'a and b corp' },
      { input: 'John F Kennedy Logistics', expected: 'john f kennedy logistics' },
      { input: 'Alpine Precision Medical AG', expected: 'alpine precision medical ag' },
    ];

    for (const b of benignCases) {
      const norm = normalizeEntityName(b.input);
      assert(norm === b.expected, `Preserved benign word boundaries: "${norm}" === "${b.expected}"`);

      // Screen benign entities to verify NO false-positive match candidates
      const screenRes = embeddedSyntheticEngine.screenPartySync({
        partyId: 'benign_test',
        role: 'DEBTOR',
        name: b.input,
        identifiers: [],
        provenance: { sourceTag: 'TEST' },
      });
      assert(screenRes.matches.length === 0, `Benign entity "${b.input}" produced 0 candidate matches`);
    }
  });

  // ---------------------------------------------------------------------------
  // Check 3: Intended Target Entity and List Verification (Not Just Any Match)
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 3: Intended Target Entity and List Verification', () => {
    const bench = runValidationAndAuditBenchmark();

    // Verify each passing case matches its declared baselineEntity and targetList
    for (const tc of bench.testCases) {
      if (tc.expectedDetection) {
        assert(tc.passed === true, `Case ${tc.caseId} passed`);
        assert(tc.actualDetection === true, `Case ${tc.caseId} detected intended target`);
        assert(!!tc.matchedEntity, `Case ${tc.caseId} recorded matchedEntity provenance`);
        assert(tc.matchedList === tc.targetList, `Case ${tc.caseId} matched target list ${tc.targetList}`);
        assert(tc.verdict === 'TRUE_POSITIVE', `Case ${tc.caseId} verdict is TRUE_POSITIVE`);
      } else {
        assert(tc.passed === true, `Negative control ${tc.caseId} passed`);
        assert(tc.actualDetection === false, `Negative control ${tc.caseId} detected 0 matches`);
        assert(tc.verdict === 'TRUE_NEGATIVE', `Negative control ${tc.caseId} verdict is TRUE_NEGATIVE`);
      }
    }
  });

  // ---------------------------------------------------------------------------
  // Check 4: Wrong Entity or List Regression Check
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 4: Wrong Entity or List Regression Check', () => {
    // If an evasion payload matches Dmitry Volkov on DEMO_OFAC_SDN,
    // but the test case declares baselineEntity as "Nordic Volga Logistics" on "DEMO_EU_FSF",
    // the benchmark must NOT credit it as detecting the wrong entity!
    const volkovPayload = 'Dmitry Sergeyevich Volkov';
    const outcome = embeddedSyntheticEngine.screenPartySync({
      partyId: 'reg_1',
      role: 'DEBTOR',
      name: volkovPayload,
      identifiers: [],
      provenance: { sourceTag: 'TEST' },
    });

    // Verify Volkov matches
    assert(outcome.matches.length > 0, 'Volkov matches on OFAC SDN');

    // Simulate verification against WRONG expected baseline entity
    const wrongBaseline = 'Nordic Volga Logistics OOO';
    const wrongTargetList = 'DEMO_EU_FSF';

    const matchingTarget = outcome.matches.find((m) => {
      const listMatches = m.listId === wrongTargetList;
      const normalizedMatchName = normalizeEntityName(m.entryName || m.listValue);
      const normalizedBaseline = normalizeEntityName(wrongBaseline);
      const nameMatches =
        normalizedMatchName.includes(normalizedBaseline) ||
        normalizedBaseline.includes(normalizedMatchName) ||
        tokenSortRatio(normalizedMatchName, normalizedBaseline) >= 0.70;
      return listMatches && nameMatches;
    });

    assert(!matchingTarget, 'Did not erroneously credit Volkov match as detecting Nordic Volga on EU list');
  });

  // ---------------------------------------------------------------------------
  // Check 5: Accurate Test Descriptions & Fixed Suite Labeling
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 5: Accurate Test Descriptions & Fixed Suite Labeling', () => {
    const bench = runValidationAndAuditBenchmark();

    assert(bench.datasetMetadata.isDynamicGenerator === false, 'Explicitly marked as fixed synthetic suite (isDynamicGenerator: false)');
    assert(bench.datasetMetadata.suiteVersion === 'v2026.11', 'Suite version is v2026.11');
    assert(bench.totalCasesTested === 8, 'Fixed 8-case suite tested');

    // Verify accurate non-misleading descriptions
    const case5 = bench.testCases.find(c => c.caseId === 'EVASION-CASE-005')!;
    assert(case5.description.includes('prefix alteration') || case5.description.includes('M/V'), 'Case 5 accurately describes vessel prefix alteration');

    const case7 = bench.testCases.find(c => c.caseId === 'EVASION-CASE-007')!;
    assert(case7.description.includes('suffix alteration') || case7.description.includes('Trust'), 'Case 7 accurately describes organizational suffix alteration');

    const case8 = bench.testCases.find(c => c.caseId === 'EVASION-CASE-008')!;
    assert(case8.description.includes('Negative control') || case8.description.includes('benign'), 'Case 8 accurately describes benign negative control');
  });

  // ---------------------------------------------------------------------------
  // Check 6: Reproducibility Details & Snapshots
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 6: Reproducibility Details & Snapshots', () => {
    const bench = runValidationAndAuditBenchmark();

    assert(typeof bench.engineVersion === 'string' && bench.engineVersion.includes('ComplianceGate-Core'), 'Includes engineVersion');
    assert(typeof bench.policyVersion === 'string' && bench.policyVersion.includes('POL-'), 'Includes policyVersion');
    assert(bench.thresholdConfig.exactCutoff === 1.0, 'Includes exactCutoff threshold 1.0');
    assert(bench.thresholdConfig.fuzzyCutoff === 0.82, 'Includes fuzzyCutoff threshold 0.82');
    assert(typeof bench.datasetMetadata.datasetDigest === 'string' && bench.datasetMetadata.datasetDigest.length === 64, 'Includes 64-char datasetDigest');
    assert(Array.isArray(bench.datasetMetadata.listSnapshots) && bench.datasetMetadata.listSnapshots.length >= 4, 'Includes watchlist snapshot list');
  });

  // ---------------------------------------------------------------------------
  // Check 7: Accurate Metrics Arithmetic & Confusion Matrix
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 7: Accurate Metrics Arithmetic & Confusion Matrix', () => {
    const bench = runValidationAndAuditBenchmark();
    const cm = bench.benchmarkMetrics.confusionMatrix;

    assert(cm.truePositives === 7, `True Positives = 7 (got ${cm.truePositives})`);
    assert(cm.trueNegatives === 1, `True Negatives = 1 (got ${cm.trueNegatives})`);
    assert(cm.falsePositives === 0, `False Positives = 0 (got ${cm.falsePositives})`);
    assert(cm.falseNegatives === 0, `False Negatives = 0 (got ${cm.falseNegatives})`);

    // Verify mathematical definitions
    const expectedPrecision = cm.truePositives / (cm.truePositives + cm.falsePositives);
    const expectedRecall = cm.truePositives / (cm.truePositives + cm.falseNegatives);
    const expectedF1 = (2 * expectedPrecision * expectedRecall) / (expectedPrecision + expectedRecall);

    assert(bench.benchmarkMetrics.precision === expectedPrecision, `Precision arithmetic: ${bench.benchmarkMetrics.precision} === ${expectedPrecision}`);
    assert(bench.benchmarkMetrics.recall === expectedRecall, `Recall arithmetic: ${bench.benchmarkMetrics.recall} === ${expectedRecall}`);
    assert(bench.benchmarkMetrics.f1Score === parseFloat(expectedF1.toFixed(4)), `F1 arithmetic matches: ${bench.benchmarkMetrics.f1Score}`);
    assert(bench.benchmarkMetrics.latencyMeasurementScope.length > 10, 'Explicit measurement scope documented');
  });

  // ---------------------------------------------------------------------------
  // Check 8: Audit Ledger Verification & Isolated Tamper Tests
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 8: Audit Ledger Verification & Isolated Tamper Tests', () => {
    const bench = runValidationAndAuditBenchmark();
    const ledger = bench.historicalLedgerVerification;

    assert(typeof ledger.totalRecordsAudited === 'number', 'Audited total records count');
    assert(typeof ledger.details === 'string', 'Details explanation provided');

    // Test isolated mock case tamper detection without mutating singleton state
    // Build valid 2-step audit chain
    const step1Checksum = sha256({ id: 'act_1', action: 'INIT', prev: 'GENESIS' });
    const step2Checksum = sha256({ id: 'act_2', action: 'ADJUDICATE', prev: step1Checksum });

    const auditTrail = [
      { actionId: 'act_1', action: 'SCREEN_COMPLETED', previousHash: 'GENESIS', serverChecksum: step1Checksum },
      { actionId: 'act_2', action: 'ALERT_CONFIRMED', previousHash: step1Checksum, serverChecksum: step2Checksum },
    ];

    const mockCase: PaymentComplianceCase = {
      caseId: 'CASE-TAMPER-TEST-001',
      transaction: {
        transactionId: 'TX-MOCK-001',
        format: 'SWIFT_MT',
        messageType: 'MT103',
        parties: [],
        timestamp: new Date().toISOString(),
      } as any,
      screeningResult: {} as any,
      status: 'ALERT_CONFIRMED',
      priority: 'CRITICAL',
      assignedOfficer: 'analyst_1',
      policyVersion: 'POL-2026.11',
      auditTrail: auditTrail as any,
      evidenceHash: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    mockCase.evidenceHash = sha256({
      tx: mockCase.transaction,
      screeningResult: mockCase.screeningResult,
      audit: mockCase.auditTrail,
    });

    // 1) Verify intact valid chain
    const validCheck = paymentStoreService.verifyCaseIntegrity(mockCase);
    assert(validCheck.isValid === true, 'Intact 2-step hash chain is verified valid');

    // 2) Tamper: Altered payload
    const tamperedPayload = { ...mockCase, transaction: { ...mockCase.transaction, rawMessage: 'MUTATED_PAYLOAD' } };
    const tamperPayloadCheck = paymentStoreService.verifyCaseIntegrity(tamperedPayload);
    assert(tamperPayloadCheck.isValid === false, 'Detected altered transaction payload');
    assert(tamperPayloadCheck.reason?.includes('Evidence hash mismatch') === true, 'Evidence hash mismatch reason returned');

    // 3) Tamper: Deleted event (remove step 1)
    const deletedEventCase = {
      ...mockCase,
      auditTrail: [auditTrail[1]] as any,
      evidenceHash: sha256({ tx: mockCase.transaction, screeningResult: mockCase.screeningResult, audit: [auditTrail[1]] }),
    };
    const deletedCheck = paymentStoreService.verifyCaseIntegrity(deletedEventCase);
    assert(deletedCheck.isValid === false, 'Detected deleted event (broken previousHash link to GENESIS)');

    // 4) Tamper: Reordered events (swap step 1 and step 2)
    const reorderedCase = {
      ...mockCase,
      auditTrail: [auditTrail[1], auditTrail[0]] as any,
      evidenceHash: sha256({ tx: mockCase.transaction, screeningResult: mockCase.screeningResult, audit: [auditTrail[1], auditTrail[0]] }),
    };
    const reorderCheck = paymentStoreService.verifyCaseIntegrity(reorderedCase);
    assert(reorderCheck.isValid === false, 'Detected reordered events');
  });

  // ---------------------------------------------------------------------------
  // Check 9: API Endpoints (GET / POST Consistency & JSON 404 Fallback)
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 9: API Endpoints (GET / POST Consistency & JSON 404 Fallback)', async () => {
    const app = createComplianceApp({ isPublicDemo: true });
    const server = http.createServer(app);

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address() as any;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      // 1) POST /api/modules/validation/benchmark
      const postBench = await fetch(`${baseUrl}/api/modules/validation/benchmark`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      assert(postBench.ok, 'POST /api/modules/validation/benchmark returns 200');
      const postBenchData = await postBench.json();
      assert(postBenchData.totalCasesTested === 8, 'POST benchmark returns 8 cases');

      // 2) GET /api/modules/validation/benchmark
      const getBench = await fetch(`${baseUrl}/api/modules/validation/benchmark`);
      assert(getBench.ok, 'GET /api/modules/validation/benchmark returns 200');
      const getBenchData = await getBench.json();
      assert(getBenchData.totalCasesTested === 8, 'GET benchmark returns 8 cases');

      // 3) GET /api/modules/validation/extended
      const getExt = await fetch(`${baseUrl}/api/modules/validation/extended`);
      assert(getExt.ok, 'GET /api/modules/validation/extended returns 200');
      const extData = await getExt.json();
      assert(extData.goldenDatasetSize >= 15, 'Extended validation returns golden dataset');
      assert(Array.isArray(extData.thresholdSensitivity), 'Extended validation returns threshold sensitivity');

      // 4) POST /api/modules/validation/extended
      const postExt = await fetch(`${baseUrl}/api/modules/validation/extended`, { method: 'POST' });
      assert(postExt.ok, 'POST /api/modules/validation/extended returns 200');

      // 5) Unknown API route MUST return JSON 404, never HTML!
      const unknownRes = await fetch(`${baseUrl}/api/modules/validation/unknown-route-test`);
      assert(unknownRes.status === 404, 'Unknown API route returns HTTP 404');
      const contentType = unknownRes.headers.get('content-type') || '';
      assert(contentType.includes('application/json'), 'Unknown API route returns application/json, not HTML');
      const unknownData = await unknownRes.json();
      assert(unknownData.error.includes('API endpoint not found'), 'Clean JSON error payload returned');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  // ---------------------------------------------------------------------------
  // Check 10: Official MCP Tool run_validation_benchmark Execution
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 10: Official MCP Tool run_validation_benchmark Execution', async () => {
    const mcpResult = await executeMcpTool('run_validation_benchmark', {}, true);

    assert(typeof mcpResult === 'object', 'MCP tool returned validation result');
    assert(mcpResult.totalCasesTested === 8, 'Evaluated all 8 test vectors via MCP');
    assert(mcpResult.casesPassed === 8, 'All 8 benchmark cases passed via MCP');
    assert(typeof mcpResult.evidenceDigest === 'string' && mcpResult.evidenceDigest.length === 64, 'Generated SHA-256 evidence digest');
  });

  console.log('\n================================================================');
  console.log(`VALIDATION & AUDIT TEST SUITE COMPLETE: ${passed} passed, ${failed} failed`);
  console.log('================================================================\n');

  return { passed, failed };
}
