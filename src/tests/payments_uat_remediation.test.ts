/**
 * @license
 * SPDX-License-Identifier: MIT
 *
 * Payments UAT Independent Test Verification & Regression Suite
 *
 * Verifies the 5 requirements identified by independent UAT testing:
 * 1. Strict settlement date validation (rejecting impossible calendar dates in TS and Go)
 * 2. Critical missing information enforcement (requiresHumanReview=true and HUMAN_REVIEW_REQUIRED routing)
 * 3. XML well-formedness validation (rejecting unclosed elements, mismatched tags, XXE/DTD)
 * 4. Separate presentation of Coverage vs Completeness vs Match Findings vs Review Decision in Single & Batch
 * 5. Explanatory decision messages returning blocking issue codes and corrections
 */

import { parseField32A, isValidCalendarDate } from '../server/services/parsers/swiftMtParser.ts';
import { parseIso20022PaymentMessage, validateAndSanitizeXml } from '../server/services/parsers/iso20022Parser.ts';
import { unifiedParserFactory } from '../server/services/parsers/parserFactory.ts';
import { paymentStoreService } from '../server/services/paymentStore.ts';
import { executeMcpTool } from '../server/mcpServer.ts';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

let passCount = 0;
let failCount = 0;

function assert(condition: boolean, msg: string): void {
  if (!condition) {
    failCount++;
    throw new Error(`[ASSERTION FAILED] ${msg}`);
  }
  passCount++;
}

export async function runPaymentsUatSuite(): Promise<{ passed: number; failed: number }> {
  passCount = 0;
  failCount = 0;
  console.log('================================================================');
  console.log(' RUNNING PAYMENTS UAT REMEDIATION TEST SUITE');
  console.log('================================================================');

  // ---------------------------------------------------------------------------
  // 1. Settlement Date Validation
  // ---------------------------------------------------------------------------
  console.log('\n[TEST 1] Calendar Date Validation & Impossible Date Rejection');

  // 1a. Direct validator unit checks
  assert(!isValidCalendarDate(2026, 99, 32), 'isValidCalendarDate rejects month 99, day 32');
  assert(!isValidCalendarDate(2026, 0, 15), 'isValidCalendarDate rejects month 0');
  assert(!isValidCalendarDate(2026, 13, 15), 'isValidCalendarDate rejects month 13');
  assert(!isValidCalendarDate(2026, 1, 0), 'isValidCalendarDate rejects day 0');
  assert(!isValidCalendarDate(2026, 1, 32), 'isValidCalendarDate rejects day 32');
  assert(!isValidCalendarDate(2026, 4, 31), 'isValidCalendarDate rejects April 31 (30-day month)');
  assert(!isValidCalendarDate(2026, 6, 31), 'isValidCalendarDate rejects June 31 (30-day month)');
  assert(!isValidCalendarDate(2026, 9, 31), 'isValidCalendarDate rejects Sept 31 (30-day month)');
  assert(!isValidCalendarDate(2026, 11, 31), 'isValidCalendarDate rejects Nov 31 (30-day month)');
  assert(!isValidCalendarDate(2026, 2, 29), 'isValidCalendarDate rejects Feb 29 in non-leap year (2026)');
  assert(isValidCalendarDate(2024, 2, 29), 'isValidCalendarDate accepts Feb 29 in leap year (2024)');
  assert(isValidCalendarDate(2028, 2, 29), 'isValidCalendarDate accepts Feb 29 in leap year (2028)');
  assert(!isValidCalendarDate(2024, 2, 30), 'isValidCalendarDate rejects Feb 30 in leap year (2024)');

  // 1b. parseField32A rejection of reported defect :32A:269932EUR100,00
  let defectRejected = false;
  try {
    parseField32A('269932EUR100,00');
  } catch (err: any) {
    defectRejected = err.message.includes('impossible calendar date') && err.message.includes('2026-99-32');
  }
  assert(defectRejected, 'parseField32A strictly rejects reported impossible date :32A:269932EUR100,00');

  // 1c. parseField32A rejection across calendar edge vectors
  const invalid32ACases = [
    '261315EUR100,00',
    '260015EUR100,00',
    '260100EUR100,00',
    '260132EUR100,00',
    '260431EUR100,00',
    '260229EUR100,00',
  ];
  for (const bad32A of invalid32ACases) {
    let thrown = false;
    try {
      parseField32A(bad32A);
    } catch (err: any) {
      thrown = err.message.includes('impossible calendar date');
    }
    assert(thrown, `parseField32A rejected impossible calendar vector: ${bad32A}`);
  }

  // 1d. parseField32A accepts valid leap year Feb 29
  const validLeapRes = parseField32A('240229EUR100,00');
  assert(validLeapRes.date === '2024-02-29', 'parseField32A parses valid leap year Feb 29 (2024-02-29)');

  // 1e. Full MT message parsing rejection of impossible dates
  const fullMtBadDate = `{1:F01DEUTDEDDXXX0000000000}{2:I103HSBCHKHHAXXXN}{4:\n:20:BAD-DATE-01\n:23B:CRED\n:32A:269932EUR100,00\n:50K:/DE89370400440532013000\nVALID DEBTOR GMBH\n:59:/HK0011223344\nVALID CREDITOR LTD\n:71A:SHA\n-}`;
  let mtMsgRejected = false;
  try {
    unifiedParserFactory.dispatch(fullMtBadDate);
  } catch (err: any) {
    mtMsgRejected = err.message.includes('impossible calendar date');
  }
  assert(mtMsgRejected, 'unifiedParserFactory rejects full MT103 containing impossible calendar date in :32A:');

  // 1f. ISO 20022 MX rejection of impossible calendar dates
  const mxBadDate = `<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08"><FIToFICstmrCdtTrf><GrpHdr><MsgId>M1</MsgId><IntrBkSttlmDt>2026-99-32</IntrBkSttlmDt></GrpHdr><CdtTrfTxInf><PmtId><EndToEndId>E1</EndToEndId></PmtId><IntrBkSttlmAmt Ccy="EUR">100.00</IntrBkSttlmAmt><Dbtr><Nm>Debtor</Nm></Dbtr><Cdtr><Nm>Creditor</Nm></Cdtr></CdtTrfTxInf></FIToFICstmrCdtTrf></Document>`;
  let mxMsgRejected = false;
  try {
    parseIso20022PaymentMessage(mxBadDate);
  } catch (err: any) {
    mxMsgRejected = err.message.includes('impossible calendar date') && err.message.includes('2026-99-32');
  }
  assert(mxMsgRejected, 'parseIso20022PaymentMessage strictly rejects impossible calendar date in <IntrBkSttlmDt>');

  // 1g. Verify Go core binary equivalence on settlement dates
  const goCorePath = path.resolve(process.cwd(), 'core/bin/compliancegate-core');
  if (existsSync(goCorePath)) {
    let goRejected = false;
    try {
      execFileSync(goCorePath, ['-parse-mt', fullMtBadDate], { stdio: 'pipe' });
    } catch {
      goRejected = true;
    }
    assert(goRejected, 'Go core binary rejects impossible calendar date :32A:269932EUR100,00');
    console.log('✓ Go core settlement date parity verified');
  }

  // ---------------------------------------------------------------------------
  // 2. Enforce Review for Critical Missing Information
  // ---------------------------------------------------------------------------
  console.log('\n[TEST 2] Enforce Review for Critical Missing Information');

  // MT103 with clean watchlist names (NO MATCH), but missing debtor account and address lines (:50K: only has name)
  const mt103MissingDebtorDetails = `{1:F01DEUTDEDDXXX0000000000}{2:I103HSBCHKHHAXXXN}{4:\n:20:REF-CRIT-01\n:23B:CRED\n:32A:261102EUR50000,00\n:50K:JOHN DOE ENTERPRISES\n:59:/GB29NWBK60161331926819\nACME LOGISTICS UK\nLONDON, GB\n:71A:SHA\n-}`;
  const parsedIncomplete = unifiedParserFactory.dispatch(mt103MissingDebtorDetails);
  assert(parsedIncomplete.transactions.length === 1, 'Parsed 1 transaction from incomplete MT103');

  const incompleteTx = parsedIncomplete.transactions[0];
  const criticalIssues = incompleteTx.missingDataIssues.filter((i) => i.severity === 'CRITICAL_MISSING');
  assert(criticalIssues.length >= 1, `Identified at least 1 critical missing data issue (found ${criticalIssues.length})`);
  assert(
    criticalIssues.some((i) => i.partyRole === 'DEBTOR' || i.field.toLowerCase().includes('debtor')),
    'Identified missing debtor account/identity issue'
  );

  // Screen transaction
  const screenIncomplete = await paymentStoreService.screenTransaction(incompleteTx, 'uat_test_runner');
  assert(screenIncomplete.coverageStatus === 'COMPLETE', 'Watchlist coverage is COMPLETE');
  assert(screenIncomplete.findingSeverity === 'NO_MATCH_FOUND', 'Finding severity is NO_MATCH_FOUND (clean party names)');
  assert(
    screenIncomplete.requiresHumanReview === true,
    `CRITICAL: requiresHumanReview MUST be true when critical missing data is detected (got ${screenIncomplete.requiresHumanReview})`
  );
  assert(Boolean(screenIncomplete.caseId), 'Case was automatically registered in store for human investigation');

  // Route payment alert via MCP
  const mcpRoute = await executeMcpTool('route_payment_alert', { referenceId: screenIncomplete.referenceId }, false);
  assert(
    mcpRoute.routingAction === 'HUMAN_REVIEW_REQUIRED',
    `mcpRoute.routingAction MUST be HUMAN_REVIEW_REQUIRED (got ${mcpRoute.routingAction})`
  );
  assert(mcpRoute.requiresHumanReview === true, 'mcpRoute.requiresHumanReview is true');
  assert(mcpRoute.hasCriticalMissing === true, 'mcpRoute.hasCriticalMissing is true');
  assert(mcpRoute.blockingIssueCodes.length >= 1, 'mcpRoute returns blocking issue codes');
  assert(
    !mcpRoute.message.includes('No matching entries found on active watchlists.') || mcpRoute.message.includes('Human review required'),
    `mcpRoute explains human review is required, does not mislead with pure NO_MATCH (got: "${mcpRoute.message}")`
  );
  console.log(`✓ Explanatory decision message: "${mcpRoute.message}"`);

  // ---------------------------------------------------------------------------
  // 3. Reject Malformed XML & Distinguish Well-Formedness from Schema Validation
  // ---------------------------------------------------------------------------
  console.log('\n[TEST 3] XML Well-Formedness & Schema Separation');

  // 3a. Unclosed inner element (causing mismatched parent closure)
  const unclosedInnerXml = `<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08"><FIToFICstmrCdtTrf><GrpHdr><MsgId>M1</MsgId></GrpHdr><CdtTrfTxInf><PmtId><EndToEndId>E1</EndToEndId></PmtId><IntrBkSttlmAmt Ccy="EUR">100.00</IntrBkSttlmAmt><Cdtr><Nm>Creditor</Nm></Cdtr></FIToFICstmrCdtTrf></Document>`;
  let unclosedRejected = false;
  try {
    validateAndSanitizeXml(unclosedInnerXml);
  } catch (err: any) {
    unclosedRejected = err.message.includes('Malformed XML') && err.message.includes('CdtTrfTxInf');
  }
  assert(unclosedRejected, 'validateAndSanitizeXml strictly rejects unclosed inner XML element');

  // 3a2. Unclosed element at EOF (Document tag never closed)
  let unclosedEofRejected = false;
  try {
    validateAndSanitizeXml('<Document><InnerElement>text</InnerElement>');
  } catch (err: any) {
    unclosedEofRejected = err.message.includes('unclosed XML elements');
  }
  assert(unclosedEofRejected, 'validateAndSanitizeXml strictly rejects unclosed XML element at EOF');

  // 3b. Mismatched closing tag
  const mismatchedXml = `<Document><GrpHdr><MsgId>M1</WrongTag></GrpHdr></Document>`;
  let mismatchedRejected = false;
  try {
    validateAndSanitizeXml(mismatchedXml);
  } catch (err: any) {
    mismatchedRejected = err.message.includes('mismatched closing tag');
  }
  assert(mismatchedRejected, 'validateAndSanitizeXml strictly rejects mismatched closing tag');

  // 3c. XXE / DOCTYPE injection
  const xxeXml = `<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><Document><x>&xxe;</x></Document>`;
  let xxeRejected = false;
  try {
    validateAndSanitizeXml(xxeXml);
  } catch (err: any) {
    xxeRejected = err.message.includes('DOCTYPE and ENTITY expansions are strictly prohibited');
  }
  assert(xxeRejected, 'validateAndSanitizeXml strictly blocks DOCTYPE/ENTITY expansions');

  // 3d. Distinguish well-formed unprofiled MX from malformed XML
  const wellFormedUnprofiledMx = `<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08"><BkToCstmrStmt><GrpHdr><MsgId>STMT-2026-001</MsgId></GrpHdr><Stmt><Id>S1</Id><Acct><Id><IBAN>DE89370400440532013000</IBAN></Id></Acct><Bal><Amt Ccy="EUR">50000.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-11-02</Dt></Dt></Bal></Stmt></BkToCstmrStmt></Document>`;
  const parsedUnprofiled = unifiedParserFactory.dispatch(wellFormedUnprofiledMx);
  assert(parsedUnprofiled.transactions.length === 1, 'Well-formed unprofiled XML parsed successfully into generic envelope');
  assert(parsedUnprofiled.transactions[0].isProfileTested === false, 'Generic envelope has isProfileTested=false');
  const screenUnprofiled = await paymentStoreService.screenTransaction(parsedUnprofiled.transactions[0], 'uat_runner');
  assert(screenUnprofiled.coverageStatus === 'INSUFFICIENT', 'Unprofiled MX has coverageStatus=INSUFFICIENT');
  assert(screenUnprofiled.requiresHumanReview === true, 'Unprofiled MX requires human review');

  // ---------------------------------------------------------------------------
  // 4. Batch Processing: Complete vs Incomplete Handling
  // ---------------------------------------------------------------------------
  console.log('\n[TEST 4] Batch Ingestion: Complete vs Incomplete Handling');

  // Complete MT103 (valid account, name, address for debtor and creditor)
  const completeMt103 = `{1:F01DEUTDEDDXXX0000000000}{2:I103HSBCHKHHAXXXN}{4:\n:20:COMPLETE-TX-01\n:23B:CRED\n:32A:261102EUR10000,00\n:50K:/DE89370400440532013000\nCLEAN SUPPLIER GMBH\nFRANKFURT, DE\n:59:/GB29NWBK60161331926819\nCLEAN BUYER PLC\nLONDON, GB\n:71A:SHA\n-}`;

  // Incomplete MT103 (missing debtor account and address)
  const incompleteMt103 = `{1:F01DEUTDEDDXXX0000000000}{2:I103HSBCHKHHAXXXN}{4:\n:20:INCOMPLETE-TX-02\n:23B:CRED\n:32A:261102EUR25000,00\n:50K:UNKNOWN SENDER CORP\n:59:/GB29NWBK60161331926819\nCLEAN BUYER PLC\nLONDON, GB\n:71A:SHA\n-}`;

  const batchRaw = `${completeMt103}\n\n${incompleteMt103}`;
  const batchDispatched = unifiedParserFactory.dispatch(batchRaw);
  assert(batchDispatched.transactions.length === 2, `Batch dispatched 2 transactions (got ${batchDispatched.transactions.length})`);

  const tx1 = batchDispatched.transactions[0];
  const tx2 = batchDispatched.transactions[1];

  const screenTx1 = await paymentStoreService.screenTransaction(tx1, 'batch_runner');
  const screenTx2 = await paymentStoreService.screenTransaction(tx2, 'batch_runner');

  // Tx 1 assertions
  const tx1Critical = tx1.missingDataIssues.filter((i) => i.severity === 'CRITICAL_MISSING');
  assert(tx1Critical.length === 0, 'Tx 1 has 0 critical missing data issues');
  assert(screenTx1.coverageStatus === 'COMPLETE', 'Tx 1 coverageStatus is COMPLETE');
  assert(screenTx1.findingSeverity === 'NO_MATCH_FOUND', 'Tx 1 findingSeverity is NO_MATCH_FOUND');
  assert(screenTx1.requiresHumanReview === false, 'Tx 1 requiresHumanReview is false (eligible for automated release)');

  // Tx 2 assertions
  const tx2Critical = tx2.missingDataIssues.filter((i) => i.severity === 'CRITICAL_MISSING');
  assert(tx2Critical.length >= 1, `Tx 2 has critical missing data issues (got ${tx2Critical.length})`);
  assert(screenTx2.coverageStatus === 'COMPLETE', 'Tx 2 coverageStatus is COMPLETE');
  assert(screenTx2.findingSeverity === 'NO_MATCH_FOUND', 'Tx 2 findingSeverity is NO_MATCH_FOUND');
  assert(screenTx2.requiresHumanReview === true, 'Tx 2 requiresHumanReview is TRUE (held for missing data despite complete coverage)');
  assert(Boolean(screenTx2.caseId), 'Tx 2 registered an investigation case in the store');

  console.log('✓ Batch processing demonstrates strict segregation between complete and incomplete payments');

  // ---------------------------------------------------------------------------
  // 5. Tenant Isolation & Tamper Detection
  // ---------------------------------------------------------------------------
  console.log('\n[TEST 5] Tenant Isolation on Server-Held References');

  const tenantAlphaTx = { ...tx1, transactionId: 'TX-TENANT-ALPHA' };
  const tenantAlphaScreen = await paymentStoreService.screenTransaction(tenantAlphaTx, 'analyst_alpha', 'tenant_alpha');

  // Cross-tenant resolution attempt
  let crossTenantBlocked = false;
  try {
    paymentStoreService.resolveReference(tenantAlphaScreen.referenceId, 'analyst_beta', 'tenant_beta');
  } catch (err: any) {
    crossTenantBlocked = err.message.includes('Cross-tenant access denied');
  }
  assert(crossTenantBlocked, 'Cross-tenant reference token resolution is strictly rejected');

  console.log('\n================================================================');
  console.log(` ALL PAYMENTS UAT REMEDIATION TESTS PASSED: ${passCount} Assertions`);
  console.log('================================================================');
  return { passed: passCount, failed: failCount };
}

// Auto-run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runPaymentsUatSuite().catch((err) => {
    console.error('\n❌ TEST SUITE FAILED:', err);
    process.exit(1);
  });
}
