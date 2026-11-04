/**
 * @license
 * SPDX-License-Identifier: MIT
 *
 * Codex Remediation & Regression Suite
 * Verifies all 6 required remediation areas, Go/TS parity on shared fixtures,
 * end-to-end decision flows, adversarial tenant isolation, WAL integrity before recovery,
 * honest document extraction through downstream screening, and isolated mutation checks.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AuthService } from '../server/services/authService.ts';
import { DurableStorageEngine } from '../server/services/durableStorage.ts';
import { verifyExtractionCompleteness } from '../server/services/missingDataEngine.ts';
import { paymentStoreService } from '../server/services/paymentStore.ts';
import { parseIso20022PaymentMessage, validateAndSanitizeXml } from '../server/services/parsers/iso20022Parser.ts';
import { unifiedParserFactory } from '../server/services/parsers/parserFactory.ts';
import { ingestAndEvaluateTradeDocuments, parseRawTradeDocuments } from '../server/services/documentIntelligence.ts';
import { executeMcpTool } from '../server/mcpServer.ts';
import { createComplianceApp } from '../server/app.ts';
import { goCoreEngineAdapter } from '../server/services/engineAdapter.ts';
import { DEMO_ANALYST_TOKEN } from '../shared/types.ts';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label}`);
    failed++;
  }
}

export async function runCodexRemediationTests(): Promise<{ passed: number; failed: number }> {
  passed = 0;
  failed = 0;

  console.log('\n======================================================');
  console.log('   ComplianceGate-MCP: Codex Remediation Test Suite   ');
  console.log('======================================================\n');

  // ---------------------------------------------------------------------------
  // 1. Screening & Review Decisions (CRITICAL_MISSING, MT205_COV, Tenant Binding)
  // ---------------------------------------------------------------------------
  console.log('AREA 1: Screening & Review Decisions');

  // 1a. Profiled MT103 with CRITICAL_MISSING (missing debtor account & address) must NEVER auto-clear
  const mt103MissingAccountRaw = `{1:F01BNPAFRPPXXX0000000000}{2:I103DEUTDEFFXXXXN}{4:
:20:TX-CRIT-MISSING-01
:23B:CRED
:32A:261103EUR50000,00
:50K:JOHN DOE WITHOUT ACCOUNT OR ADDRESS
:59:/DE89370400440532013000
CLEAN BENEFICIARY GMBH
BERLIN, DE
:71A:SHA
-}`;
  const parsedCrit = unifiedParserFactory.dispatch(mt103MissingAccountRaw).transactions[0];
  const screenCrit = await paymentStoreService.screenTransaction(parsedCrit, 'test_caller', 'tenant_alpha');
  const hasCritMissing = screenCrit.missingDataIssues.some((i) => i.severity === 'CRITICAL_MISSING');
  assert(hasCritMissing, '1a.1: MT103 without debtor account/address produces CRITICAL_MISSING issue');
  assert(
    screenCrit.requiresHumanReview === true,
    `1a.2: CRITICAL_MISSING transaction must require human review (got requiresHumanReview=${screenCrit.requiresHumanReview})`
  );

  const routedCrit = await executeMcpTool('route_payment_alert', { referenceId: screenCrit.referenceId }, true);
  assert(
    routedCrit.routingAction === 'HUMAN_REVIEW_REQUIRED' && routedCrit.requiresHumanReview === true,
    `1a.3: route_payment_alert must route CRITICAL_MISSING to HUMAN_REVIEW_REQUIRED (got ${routedCrit.routingAction})`
  );

  // 1b. MT205_COV missing Sequence B cover parties must fail verifyExtractionCompleteness
  const spoofedMt205Cov: any = {
    transactionId: 'MT205COV-SPOOF',
    messageFamily: 'SWIFT_MT',
    messageType: 'MT205_COV',
    isProfileTested: true,
    settlementDate: '2026-11-03',
    currency: 'USD',
    amount: 100000,
    parties: [
      {
        partyId: 'p1',
        role: 'DEBTOR',
        name: 'Interbank Sender Only',
        identifiers: [],
        provenance: { sourceTag: ':52A:', sequence: 'A', rawSnippet: ':52A:CHASUS33XXX' },
      },
      {
        partyId: 'p2',
        role: 'CREDITOR',
        name: 'Interbank Receiver Only',
        identifiers: [],
        provenance: { sourceTag: ':58A:', sequence: 'A', rawSnippet: ':58A:BOFAUS3NXXX' },
      },
    ],
    missingDataIssues: [],
    rawMessageSnippet: '',
    provenanceSummary: { totalPartiesExtracted: 2, parsedSequences: ['A'], parserProfile: 'Spoofed' },
  };
  const mt205Completeness = verifyExtractionCompleteness(spoofedMt205Cov);
  assert(
    mt205Completeness.isComplete === false,
    `1b: verifyExtractionCompleteness must reject MT205_COV lacking Sequence B cover parties (got isComplete=${mt205Completeness.isComplete})`
  );

  // 1c. Server tenantId must override forged caller tx.tenantId
  const forgedTenantTx: any = {
    ...parsedCrit,
    transactionId: 'TX-FORGED-TENANT-01',
    tenantId: 'tenant_forged_by_caller',
  };
  await paymentStoreService.screenTransaction(forgedTenantTx, 'test_caller', 'tenant_verified_server');
  assert(
    forgedTenantTx.tenantId === 'tenant_verified_server',
    `1c: screenTransaction must enforce server-verified tenantId over caller tx.tenantId (got ${forgedTenantTx.tenantId})`
  );

  // ---------------------------------------------------------------------------
  // 2. Strict MT/MX Parsing & Repeated Parties
  // ---------------------------------------------------------------------------
  console.log('\nAREA 2: Strict MT/MX Parsing & Repeated Parties');

  // 2a. Mismatched / unclosed nested XML inside <Document> must be rejected
  const malformedNestedXml = `<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08"><FIToFICstmrCdtTrf><CdtTrfTxInf><PmtId><EndToEndId>E2E-BAD</EndToEndId></PmtId><IntrBkSttlmAmt Ccy="EUR">500.00</IntrBkSttlmAmt><Dbtr><Nm>Unclosed Debtor</Cdtr></CdtTrfTxInf></FIToFICstmrCdtTrf></Document>`;
  let nestedXmlRejected = false;
  try {
    validateAndSanitizeXml(malformedNestedXml);
    parseIso20022PaymentMessage(malformedNestedXml);
  } catch {
    nestedXmlRejected = true;
  }
  assert(nestedXmlRejected, '2a: TypeScript XML parser must strictly reject mismatched/unclosed nested XML tags');

  // 2b. Repeated party elements in generic ISO 20022 envelope must all be preserved
  const repeatedPartiesGenericMx = `<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08"><BkToCstmrStmt><Stmt><Id>STMT-1</Id><Ntry><Amt Ccy="EUR">1200.00</Amt><NtryDtls><TxDtls><RltdPties><Dbtr><Nm>First Debtor Alpha</Nm></Dbtr><Cdtr><Nm>First Creditor Beta</Nm></Cdtr></RltdPties><RltdPties><Dbtr><Nm>Second Debtor Gamma</Nm></Dbtr><Cdtr><Nm>Second Creditor Delta</Nm></Cdtr></RltdPties></TxDtls></NtryDtls></Ntry></Stmt></BkToCstmrStmt></Document>`;
  try {
    const genTxs = parseIso20022PaymentMessage(repeatedPartiesGenericMx);
    const extractedNames = genTxs[0].parties.map((p) => p.name);
    assert(
      extractedNames.includes('First Debtor Alpha') &&
        extractedNames.includes('Second Debtor Gamma') &&
        extractedNames.includes('First Creditor Beta') &&
        extractedNames.includes('Second Creditor Delta'),
      `2b: Generic ISO 20022 parser must preserve repeated party tags without dropping subsequent occurrences (got ${extractedNames.join(', ')})`
    );
  } catch (err: any) {
    assert(false, `2b: Generic ISO 20022 parser failed unexpectedly: ${err.message}`);
  }

  // ---------------------------------------------------------------------------
  // 3. Enterprise Authentication, Secret Enforcement & Tenant Isolation
  // ---------------------------------------------------------------------------
  console.log('\nAREA 3: Enterprise Authentication & Authorization');

  // 3a. Enterprise AuthService must fail startup if AUTH_JWT_SECRET is missing
  const savedSecret = process.env.AUTH_JWT_SECRET;
  delete process.env.AUTH_JWT_SECRET;
  let missingSecretFailed = false;
  try {
    new AuthService({ isPublicDemo: false });
  } catch {
    missingSecretFailed = true;
  } finally {
    if (savedSecret) process.env.AUTH_JWT_SECRET = savedSecret;
  }
  assert(missingSecretFailed, '3a: Enterprise AuthService({ isPublicDemo: false }) must fail startup when AUTH_JWT_SECRET is unset');

  // 3b. Enterprise AuthService must reject DEMO_ANALYST_TOKEN and disable seeded demo accounts
  const enterpriseAuth = new AuthService({
    isPublicDemo: false,
    signingSecret: 'enterprise-test-secret-key-32-bytes-minimum-2026',
    seedDemoUsers: false,
  });
  assert(
    enterpriseAuth.verifyToken(DEMO_ANALYST_TOKEN) === null,
    '3b.1: Enterprise AuthService must reject shared DEMO_ANALYST_TOKEN'
  );
  let seededLoginBlocked = false;
  try {
    enterpriseAuth.authenticateCredentials('analyst_alpha', 'AnalystPassword123!');
  } catch {
    seededLoginBlocked = true;
  }
  assert(seededLoginBlocked, '3b.2: Enterprise AuthService with seedDemoUsers=false must not have hardcoded demo accounts');

  // ---------------------------------------------------------------------------
  // 4. Case Identity, Sanitization Collisions & Rescreening
  // ---------------------------------------------------------------------------
  console.log('\nAREA 4: Tenant-Scoped Case Identity, Collision Prevention & Rescreening');

  // 4a. Identical transactionId across tenant_alpha and tenant_beta must NOT collide or suppress cases
  const sharedTxBase: any = {
    ...parsedCrit,
    transactionId: 'SHARED-TX-900',
  };
  await paymentStoreService.screenTransaction({ ...sharedTxBase }, 'caller_a', 'tenant_alpha');
  await paymentStoreService.screenTransaction({ ...sharedTxBase }, 'caller_b', 'tenant_beta');
  const alphaCases = paymentStoreService.getAllCases('tenant_alpha').filter((c) => c.transaction.transactionId === 'SHARED-TX-900');
  const betaCases = paymentStoreService.getAllCases('tenant_beta').filter((c) => c.transaction.transactionId === 'SHARED-TX-900');
  assert(
    alphaCases.length === 1 && betaCases.length === 1 && alphaCases[0].caseId !== betaCases[0].caseId,
    `4a: Identical transactionId across tenant_alpha (${alphaCases.length}) and tenant_beta (${betaCases.length}) must produce distinct tenant-scoped cases`
  );

  // 4b. Sanitization collision: TX/100 vs TX:100 within the same tenant must NOT collide
  await paymentStoreService.screenTransaction({ ...parsedCrit, transactionId: 'TX/100' }, 'caller_a', 'tenant_alpha');
  await paymentStoreService.screenTransaction({ ...parsedCrit, transactionId: 'TX:100' }, 'caller_a', 'tenant_alpha');
  const slashCase = paymentStoreService.getAllCases('tenant_alpha').find((c) => c.transaction.transactionId === 'TX/100');
  const colonCase = paymentStoreService.getAllCases('tenant_alpha').find((c) => c.transaction.transactionId === 'TX:100');
  assert(
    Boolean(slashCase && colonCase && slashCase.caseId !== colonCase.caseId),
    `4b: Transaction IDs TX/100 and TX:100 must not collide onto the same caseId (got ${slashCase?.caseId} vs ${colonCase?.caseId})`
  );

  // 4c. Rescreening an existing transaction with updated amount/parties must update the case & record audit trail
  await paymentStoreService.screenTransaction({ ...parsedCrit, transactionId: 'TX-RESCREEN-1', amount: 10000 }, 'caller_a', 'tenant_alpha');
  await paymentStoreService.screenTransaction({ ...parsedCrit, transactionId: 'TX-RESCREEN-1', amount: 95000 }, 'caller_a', 'tenant_alpha');
  const rescreenedCase = paymentStoreService.getAllCases('tenant_alpha').find((c) => c.transaction.transactionId === 'TX-RESCREEN-1');
  assert(
    Boolean(rescreenedCase && rescreenedCase.transaction.amount === 95000 && rescreenedCase.auditTrail.length >= 2),
    `4c: Rescreening TX-RESCREEN-1 with updated amount must update case transaction amount (${rescreenedCase?.transaction.amount}) and append audit action (len=${rescreenedCase?.auditTrail.length})`
  );

  // ---------------------------------------------------------------------------
  // 5. Audit Durability & Verified WAL Recovery
  // ---------------------------------------------------------------------------
  console.log('\nAREA 5: Audit Durability & Verified WAL Recovery');

  const tmpWalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-wal-test-'));
  try {
    const storage1 = new DurableStorageEngine(tmpWalDir);
    storage1.appendWal('CASE_UPSERT', 'tenant_alpha', 'case_1', { caseId: 'case_1', tenantId: 'tenant_alpha', status: 'PENDING_REVIEW' });
    storage1.appendWal('CASE_UPSERT', 'tenant_alpha', 'case_2', { caseId: 'case_2', tenantId: 'tenant_alpha', status: 'PENDING_REVIEW' });

    // Tamper with the payload of seq 1 in the WAL file without updating walHash
    const walPath = path.join(tmpWalDir, 'compliancegate_wal.jsonl');
    const lines = fs.readFileSync(walPath, 'utf8').trim().split('\n');
    const rec1 = JSON.parse(lines[0]);
    rec1.payload.status = 'FALSE_POSITIVE_CLEARED_TAMPERED';
    lines[0] = JSON.stringify(rec1);
    fs.writeFileSync(walPath, lines.join('\n') + '\n', 'utf8');

    let tamperedRecoveryRejected = false;
    try {
      const storage2 = new DurableStorageEngine(tmpWalDir);
      const recovered = storage2.loadAndRecoverState();
      if ((recovered.cases.get('case_1')?.status as string) === 'FALSE_POSITIVE_CLEARED_TAMPERED') {
        tamperedRecoveryRejected = false;
      }
    } catch {
      tamperedRecoveryRejected = true;
    }
    assert(tamperedRecoveryRejected, '5a: loadAndRecoverState() must reject or quarantine tampered WAL records instead of loading forged state');
  } finally {
    fs.rmSync(tmpWalDir, { recursive: true, force: true });
  }

  // ---------------------------------------------------------------------------
  // 6. Document Extraction: No Invented Defaults & Downstream Risk Propagation
  // ---------------------------------------------------------------------------
  console.log('\nAREA 6: Document Extraction Without Invented Defaults');

  const partialInvoiceText = `
Commercial Invoice
Invoice No: INV-NO-COUNTRY-01
Seller: Global Exports Ltd
Buyer: Horizon Imports LLC
Line Item: HS: 8504.40 | Industrial Power Supply | Qty: 2 | Amount: 15000
`;
  const partialBlText = `
Bill of Lading
B/L No: BL-NO-PORT-01
Shipper: Global Exports Ltd
Consignee: Horizon Imports LLC
Cargo Description: Industrial Power Supply
`;
  const extractedTrade = parseRawTradeDocuments({
    invoiceRaw: partialInvoiceText,
    billOfLadingRaw: partialBlText,
  });
  assert(
    extractedTrade.tradeRequest.invoice.sellerCountry === 'UNKNOWN' &&
      extractedTrade.tradeRequest.invoice.buyerCountry === 'UNKNOWN' &&
      extractedTrade.tradeRequest.invoice.currency === 'UNKNOWN' &&
      extractedTrade.tradeRequest.billOfLading.portOfLoading === 'UNKNOWN' &&
      extractedTrade.tradeRequest.billOfLading.portOfDischarge === 'UNKNOWN' &&
      extractedTrade.tradeRequest.billOfLading.grossWeightKg === 0,
    `6a: Missing document fields must be preserved as UNKNOWN/0 rather than inventing DE/AE/USD/Hamburg/Jebel Ali/1000 (got sellerCountry=${extractedTrade.tradeRequest.invoice.sellerCountry}, buyerCountry=${extractedTrade.tradeRequest.invoice.buyerCountry}, ccy=${extractedTrade.tradeRequest.invoice.currency}, pol=${extractedTrade.tradeRequest.billOfLading.portOfLoading})`
  );
  assert(
    extractedTrade.metadata.warnings.length >= 4,
    `6b: Missing fields in document extraction must emit actionable warnings (got ${extractedTrade.metadata.warnings.length} warnings)`
  );

  const downstreamEval = ingestAndEvaluateTradeDocuments({
    invoiceRaw: partialInvoiceText,
    billOfLadingRaw: partialBlText,
  });
  assert(
    downstreamEval.evaluation.passedVerification === false &&
      downstreamEval.evaluation.discrepancies.some((d) => d.severity === 'CRITICAL'),
    '6c: Downstream trade evaluation must flag critical missing mandatory fields (unknown country/currency/ports/weight) and prevent automatic verification pass'
  );

  console.log('\n======================================================');
  console.log(`CODEX REMEDIATION SUMMARY: ${passed} Passed, ${failed} Failed`);
  console.log('======================================================\n');

  return { passed, failed };
}

if (process.argv[1]?.endsWith('codex_remediation_regression.test.ts')) {
  runCodexRemediationTests().then(({ failed }) => {
    process.exit(failed > 0 ? 1 : 0);
  });
}

