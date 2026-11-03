/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import {
  parseSwiftMT103,
  parseSwiftMT202COV,
  parseGenericSwiftMT,
  parseSwiftPaymentMessage,
  parseField32A,
} from '../server/services/parsers/swiftMtParser.ts';
import {
  parsePacs008,
  parsePacs009COV,
  parsePacs004,
  parsePain001,
  parseGenericIso20022,
  parseIso20022PaymentMessage,
  validateAndSanitizeXml,
  unescapeXmlEntities,
  extractAmountAndCurrency,
} from '../server/services/parsers/iso20022Parser.ts';
import { auditPaymentMissingData } from '../server/services/missingDataEngine.ts';
import { normalizeEntityName, normalizeIdentifier, tokenSortRatio } from '../server/services/normalizer.ts';
import { embeddedSyntheticEngine, clientRemoteEngineAdapter } from '../server/services/engineAdapter.ts';
import { paymentStoreService } from '../server/services/paymentStore.ts';
import { watchlistService } from '../server/services/watchlist.ts';
import {
  createOfficialMcpServer,
  MCP_TOOLS,
  redactSensitiveDataForAgent,
} from '../server/mcpServer.ts';
import { SYNTHETIC_PAYMENT_FIXTURES } from '../server/services/syntheticFixtures.ts';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { unifiedParserFactory } from '../server/services/parsers/parserFactory.ts';
import {
  DEMO_ANALYST_TOKEN,
  SUPPORTED_SWIFT_MT_TYPES,
  SUPPORTED_ISO20022_MX_TYPES,
  VERIFIED_TESTED_PROFILES,
} from '../shared/types.ts';
import { createComplianceApp } from '../server/app.ts';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

// Simple lightweight assertion runner
let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

export async function runPaymentsTests(): Promise<{ passed: number; failed: number }> {
  passed = 0;
  failed = 0;
  console.log('\n======================================================');
  console.log('   ComplianceGate-MCP: Payments Gateway Test Suite    ');
  console.log('======================================================\n');

  // ----------------------------------------------------------------
  // Test 1: SWIFT MT103 Parsing
  // ----------------------------------------------------------------
  console.log('TEST 1: SWIFT MT103 Parsing & Extraction');
  const mt103Fixture = SYNTHETIC_PAYMENT_FIXTURES.find((f) => f.id === 'mt103_sanctioned_beneficiary')!;
  const mt103Tx = parseSwiftMT103(mt103Fixture.rawContent);
  assert(mt103Tx.messageType === 'MT103', 'Correctly identified messageType as MT103');
  assert(mt103Tx.currency === 'EUR', `Extracted currency EUR (got ${mt103Tx.currency})`);
  assert(mt103Tx.amount === 1250000.0, `Extracted amount 1,250,000.00 (got ${mt103Tx.amount})`);
  const mt103Debtor = mt103Tx.parties.find((p) => p.role === 'DEBTOR');
  const mt103Creditor = mt103Tx.parties.find((p) => p.role === 'CREDITOR');
  assert(!!mt103Debtor && mt103Debtor.name.includes('BAVARIA INDUSTRIAL'), 'Extracted ordering customer (Debtor)');
  assert(!!mt103Creditor && mt103Creditor.name.includes('AL-HUDA INTERNATIONAL'), 'Extracted beneficiary customer (Creditor)');
  assert(mt103Creditor?.accountNumber === 'AE390331234567890123456', 'Extracted beneficiary account number');
  assert(
    !!mt103Creditor?.address?.rawLines &&
      mt103Creditor.address.rawLines.some((l) => l.includes('SHEIKH ZAYED ROAD')),
    'Preserved full multi-line address lines including Sheikh Zayed Road'
  );

  // ----------------------------------------------------------------
  // Test 2: SWIFT MT202 COV Cover Sanctions Evasion Vector
  // ----------------------------------------------------------------
  console.log('\nTEST 2: SWIFT MT202 COV Cover Payment (Sequence A vs Sequence B)');
  const mt202Fixture = SYNTHETIC_PAYMENT_FIXTURES.find((f) => f.id === 'mt202_cov_sanctions_evasion')!;
  const mt202Tx = parseSwiftMT202COV(mt202Fixture.rawContent);
  assert(mt202Tx.messageType === 'MT202_COV', 'Identified messageType as MT202_COV');
  const seqAParties = mt202Tx.parties.filter((p) => p.provenance.sequence === 'A');
  const seqBParties = mt202Tx.parties.filter((p) => p.provenance.sequence === 'B');
  assert(seqAParties.length >= 2, `Sequence A interbank parties extracted (found ${seqAParties.length})`);
  assert(seqBParties.length >= 2, `Sequence B cover parties extracted (found ${seqBParties.length})`);
  const covDebtor = seqBParties.find((p) => p.role === 'DEBTOR');
  assert(!!covDebtor && covDebtor.name.includes('OCEANIC AURORA'), 'Extracted underlying cover debtor (Oceanic Aurora Maritime Ltd)');

  // ----------------------------------------------------------------
  // Test 3: ISO 20022 pacs.008.001.08 XML Parsing
  // ----------------------------------------------------------------
  console.log('\nTEST 3: ISO 20022 pacs.008 XML Customer Credit Transfer');
  const pacs008Fixture = SYNTHETIC_PAYMENT_FIXTURES.find((f) => f.id === 'pacs008_customer_credit_transfer')!;
  const pacs008Txs = parsePacs008(pacs008Fixture.rawContent);
  assert(pacs008Txs.length === 1, 'Extracted 1 pacs.008 transaction');
  const p008 = pacs008Txs[0];
  assert(p008.currency === 'EUR' && p008.amount === 890000.0, 'Extracted settlement currency EUR and amount 890,000');
  const ultmtDebtor = p008.parties.find((p) => p.role === 'ULTIMATE_DEBTOR');
  assert(!!ultmtDebtor && ultmtDebtor.name === 'Dmitry Sergeyevich Volkov', 'Extracted Ultimate Debtor name');
  const passportId = ultmtDebtor?.identifiers.find((i) => i.type === 'PASSPORT');
  assert(passportId?.value === 'RU-DEMO-8829140', `Extracted Ultimate Debtor passport ID: ${passportId?.value}`);

  // ----------------------------------------------------------------
  // Test 4: ISO 20022 pacs.009 COV FI Credit Transfer with Cover
  // ----------------------------------------------------------------
  console.log('\nTEST 4: ISO 20022 pacs.009 COV Interbank Transfer with Cover');
  const pacs009Fixture = SYNTHETIC_PAYMENT_FIXTURES.find((f) => f.id === 'pacs009_cov_interbank_transfer')!;
  const pacs009Txs = parsePacs009COV(pacs009Fixture.rawContent);
  assert(pacs009Txs.length === 1, 'Extracted 1 pacs.009 COV transaction');
  const p009 = pacs009Txs[0];
  const coverCreditor = p009.parties.find((p) => p.role === 'CREDITOR' && p.provenance.sequence === 'B');
  assert(!!coverCreditor && coverCreditor.name.includes('Al-Furqan'), 'Extracted underlying cover creditor (Al-Furqan Foundation)');

  // ----------------------------------------------------------------
  // Test 5: ISO 20022 pacs.004 Payment Return (Original vs Return)
  // ----------------------------------------------------------------
  console.log('\nTEST 5: ISO 20022 pacs.004 Payment Return');
  const pacs004Fixture = SYNTHETIC_PAYMENT_FIXTURES.find((f) => f.id === 'pacs004_payment_return')!;
  const pacs004Txs = parsePacs004(pacs004Fixture.rawContent);
  assert(pacs004Txs.length === 1, 'Extracted pacs.004 return transaction');
  const p004 = pacs004Txs[0];
  assert(p004.returnReasonCode === 'AC04', `Captured return reason code AC04 (got ${p004.returnReasonCode})`);
  assert(p004.amount === 750000.0, 'Captured returned amount 750,000');
  const origDebtor = p004.parties.find((p) => p.role === 'ORIGINAL_DEBTOR');
  assert(!!origDebtor && origDebtor.name.includes('Al Huda'), 'Extracted original debtor for rescreening');

  // ----------------------------------------------------------------
  // Test 6: ISO 20022 pain.001 Multi-Transaction Batch
  // ----------------------------------------------------------------
  console.log('\nTEST 6: ISO 20022 pain.001 Corporate Multi-Transaction Batch');
  const pain001Fixture = SYNTHETIC_PAYMENT_FIXTURES.find((f) => f.id === 'pain001_multi_tx_batch')!;
  const pain001Txs = parsePain001(pain001Fixture.rawContent);
  assert(pain001Txs.length === 2, `Parsed ALL 2 transactions in batch (got ${pain001Txs.length})`);
  assert(pain001Txs[0].transactionId === 'BATCH-TX-001-CLEAN', 'First transaction correctly extracted');
  assert(pain001Txs[1].transactionId === 'BATCH-TX-002-SANCTIONED', 'Second transaction correctly extracted');
  const tx2Creditor = pain001Txs[1].parties.find((p) => p.role === 'CREDITOR');
  assert(Boolean(tx2Creditor?.identifiers.some((i) => i.type === 'LEI' && i.value === '549300DEMOBEIJING01')), 'Extracted LEI for Tx 2 Creditor');

  // ----------------------------------------------------------------
  // Test 7: Generic Envelope Parsers Fallback
  // ----------------------------------------------------------------
  console.log('\nTEST 7: Generic Envelopes Fallback (MT & MX)');
  const genericMt = `{1:F01TEST}{2:I101TEST}{4:
:20:GEN-MT-01
:32A:261102USD50000,00
:50K:GENERIC SENDER
:59:GENERIC BENEFICIARY
-}`;
  const genericMtTx = parseGenericSwiftMT(genericMt, 'MT101');
  assert(genericMtTx.messageType === 'MT101', 'Generic MT extracted with messageType MT101');
  assert(!genericMtTx.isProfileTested, 'Flagged isProfileTested = false for generic envelope');

  const genericMx = `<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08">
    <MsgId>CAMT053-TEST</MsgId>
    <Dbtr><Nm>STATEMENT HOLDER</Nm></Dbtr>
  </Document>`;
  const genericMxTxs = parseGenericIso20022(genericMx, 'CAMT_053');
  assert(genericMxTxs.length === 1 && genericMxTxs[0].messageType === 'CAMT_053', 'Generic MX camt.053 extracted safely');

  // ----------------------------------------------------------------
  // Test 8: Configurable Missing Data Profile Evaluation
  // ----------------------------------------------------------------
  console.log('\nTEST 8: Configurable Missing-Data Evaluation (FATF Rec 16 Profile)');
  const missingFixture = SYNTHETIC_PAYMENT_FIXTURES.find((f) => f.id === 'mt103_missing_travel_rule')!;
  const missingTx = parseSwiftMT103(missingFixture.rawContent);
  const issues = auditPaymentMissingData(missingTx, 'FATF_REC16_WIRE_PROFILE');
  const critical = issues.filter((i) => i.severity === 'CRITICAL_MISSING');
  assert(critical.length >= 2, `Identified ${critical.length} critical missing fields for incomplete originator/beneficiary`);
  assert(issues.some((i) => i.ruleId === 'ORIG_04_DEBTOR_LOCATION_MISSING'), 'Flagged missing debtor postal address and national ID');

  // ----------------------------------------------------------------
  // Test 9: Multi-Script Unicode Normalization
  // ----------------------------------------------------------------
  console.log('\nTEST 9: Multi-Script Unicode Normalization & Matching');
  // Arabic
  const arabicInput = 'طارق عبد الكريم المنصور';
  const arabicNorm = normalizeEntityName(arabicInput);
  assert(arabicNorm.length > 0 && arabicNorm === arabicInput, 'Preserved Arabic script during normalization');

  // Chinese
  const chineseInput = '北京地平线微电子有限公司';
  const chineseNorm = normalizeEntityName(chineseInput);
  assert(chineseNorm === chineseInput, 'Preserved Chinese characters during normalization');

  // Cyrillic
  const cyrillicInput = 'Дмитрий Сергеевич Волков';
  const cyrillicNorm = normalizeEntityName(cyrillicInput);
  assert(cyrillicNorm.includes('дмитрий'), 'Preserved and lowercased Cyrillic script');

  // Latin diacritics flattening
  const germanAccents = 'Müller & Söhne GmbH';
  const germanNorm = normalizeEntityName(germanAccents);
  assert(germanNorm.includes('muller') && germanNorm.includes('sohne'), `Flattened German umlauts: ${germanNorm}`);

  // Token sort ratio
  const score = tokenSortRatio('Oceanic Aurora Shipping Co', 'Oceanic Aurora Maritime Ltd');
  assert(score >= 0.60, `Computed token sort ratio: ${score}`);

  // ----------------------------------------------------------------
  // Test 10: Exact Identifier Candidate Matching
  // ----------------------------------------------------------------
  console.log('\nTEST 10: Exact Identifier Candidate Matching (LEI & BIC)');
  const leiParty = {
    partyId: 'p_lei_test',
    role: 'CREDITOR' as const,
    name: 'Horizon Microelectronics',
    identifiers: [{ type: 'LEI' as const, value: '549300DEMOBEIJING01' }],
    provenance: {},
  };
  const leiOutcome = await embeddedSyntheticEngine.screenParty(leiParty);
  assert(leiOutcome.findingSeverity === 'EXACT_IDENTIFIER_MATCH', 'Exact LEI match produced EXACT_IDENTIFIER_MATCH');
  assert(leiOutcome.highestScore === 1.0, 'Exact identifier score is 1.0');

  // ----------------------------------------------------------------
  // Test 11: List Freshness Gate & Severity Independence
  // ----------------------------------------------------------------
  console.log('\nTEST 11: List Freshness Gate & Severity Independence');
  // Set EU list to stale
  watchlistService.toggleSimulatedStale('DEMO_EU_FSF', true);
  const resultStale = await paymentStoreService.screenTransaction(mt103Tx, 'test_caller');
  assert(resultStale.coverageStatus === 'PARTIAL_STALE', 'CoverageStatus correctly flagged PARTIAL_STALE');
  assert(
    resultStale.findingSeverity !== 'NO_MATCH_FOUND',
    `Stale list DID NOT suppress candidate match (Severity: ${resultStale.findingSeverity})`
  );
  watchlistService.resetAllFresh();

  // ----------------------------------------------------------------
  // Test 12: Server-Held Result Reference Validation
  // ----------------------------------------------------------------
  console.log('\nTEST 12: Server-Held Result Reference Validation & Expiry');
  const freshResult = await paymentStoreService.screenTransaction(mt103Tx, 'test_caller');
  const resolved = paymentStoreService.resolveReference(freshResult.referenceId, 'test_caller');
  assert(resolved.transactionId === freshResult.transactionId, 'Successfully resolved valid server reference');

  let forgeryThrew = false;
  try {
    paymentStoreService.resolveReference('ref_forged_uuid_12345');
  } catch {
    forgeryThrew = true;
  }
  assert(forgeryThrew, 'Rejected forged / unknown server reference');

  // ----------------------------------------------------------------
  // Test 13: Case Adjudication & Mandatory Rationale
  // ----------------------------------------------------------------
  console.log('\nTEST 13: Case Adjudication & Mandatory Rationale Enforcement');
  const allCases = paymentStoreService.getAllCases();
  assert(allCases.length > 0, `Cases registered: ${allCases.length}`);
  const targetCase = allCases[0];

  let shortRationaleThrew = false;
  try {
    paymentStoreService.adjudicateCase(targetCase.caseId, 'CONFIRM_ENTITY_MATCH', 'short');
  } catch {
    shortRationaleThrew = true;
  }
  assert(shortRationaleThrew, 'Rejected adjudication with rationale < 10 characters');

  const adjudicated = paymentStoreService.adjudicateCase(
    targetCase.caseId,
    'CONFIRM_ENTITY_MATCH',
    'Confirmed exact matching entity following senior sanctions officer review.'
  );
  assert(adjudicated.status === 'ALERT_CONFIRMED', 'Case transitioned to ALERT_CONFIRMED');

  // ----------------------------------------------------------------
  // Test 14: Tamper-Evident Hash Chain Verification
  // ----------------------------------------------------------------
  console.log('\nTEST 14: Tamper-Evident Hash Chain Verification');
  const integrityCheck = paymentStoreService.verifyCaseIntegrity(adjudicated);
  assert(integrityCheck.isValid, 'Hash chain verified: unaltered case is VALID');

  // Simulate tampering
  const tamperedCase = JSON.parse(JSON.stringify(adjudicated));
  tamperedCase.transaction.amount = 999999999;
  const tamperedCheck = paymentStoreService.verifyCaseIntegrity(tamperedCase);
  assert(!tamperedCheck.isValid, 'Tamper detected: payload modification triggers hash mismatch');

  // ----------------------------------------------------------------
  // Test 15: Client Remote Engine Adapter Contract
  // ----------------------------------------------------------------
  console.log('\nTEST 15: Client Remote Engine Adapter (Unconfigured Failure)');
  const unconfiguredHealth = await clientRemoteEngineAdapter.getHealth();
  assert(unconfiguredHealth.status === 'STANDBY_UNCONFIGURED', 'Remote adapter reports STANDBY_UNCONFIGURED');
  let remoteThrew = false;
  try {
    await clientRemoteEngineAdapter.screenParty(leiParty);
  } catch (err: any) {
    remoteThrew = err.message.includes('Remote engine endpoint not configured');
  }
  assert(remoteThrew, 'Unconfigured remote adapter throws explicit configuration error');

  // ----------------------------------------------------------------
  // Test 16: Official MCP SDK Client over InMemoryTransport
  // ----------------------------------------------------------------
  console.log('\nTEST 16: Official MCP SDK Client Protocol over InMemoryTransport');
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpTestServer = createOfficialMcpServer(true);
  await mcpTestServer.connect(serverTransport);

  const mcpTestClient = new Client(
    { name: 'compliancegate-test-runner', version: '1.0.0' },
    { capabilities: {} }
  );
  await mcpTestClient.connect(clientTransport);

  // 1. Test tools list
  const mcpToolsList = await mcpTestClient.listTools();
  assert(mcpToolsList.tools.length >= 7, `Official MCP Client listed ${mcpToolsList.tools.length} registered tools`);
  assert(
    mcpToolsList.tools.some((t) => t.name === 'screen_payment') &&
      mcpToolsList.tools.some((t) => t.name === 'extract_payment_parties') &&
      mcpToolsList.tools.some((t) => t.name === 'route_payment_alert'),
    'Official MCP Client verified essential compliance tools registered'
  );

  // 2. Test callTool generate_test_payments
  const fixtureCall = await mcpTestClient.callTool({
    name: 'generate_test_payments',
    arguments: {},
  });
  const fixtureData = JSON.parse((fixtureCall.content as any)[0].text);
  assert(
    fixtureData.totalFixtures >= 7,
    `Official MCP Client callTool generate_test_payments returned ${fixtureData.totalFixtures} fixtures`
  );

  // 3. Test callTool list_health
  const healthCall = await mcpTestClient.callTool({
    name: 'list_health',
    arguments: {},
  });
  const healthData = JSON.parse((healthCall.content as any)[0].text);
  assert(
    healthData.totalLists >= 5 && healthData.isFresh === true,
    `Official MCP Client callTool list_health verified ${healthData.totalLists} fresh watchlists`
  );

  // 4. Test callTool extract_payment_parties with PII redaction
  const extractCall = await mcpTestClient.callTool({
    name: 'extract_payment_parties',
    arguments: {
      rawMessage: mt103Fixture.rawContent,
    },
  });
  const extractData = JSON.parse((extractCall.content as any)[0].text);
  assert(
    extractData.totalTransactions === 1,
    'Official MCP Client extracted 1 transaction via tool'
  );
  // Redaction check: account numbers in agent context must be redacted
  const extractedCreditor = extractData.transactions[0].parties.find((p: any) => p.role === 'CREDITOR');
  assert(
    extractedCreditor.accountNumber.includes('****'),
    `Official MCP Client enforced PII masking for agent context: ${extractedCreditor.accountNumber}`
  );

  await mcpTestClient.close();
  await mcpTestServer.close();

  // ----------------------------------------------------------------
  // Test 17: MCP Deep Sensitive Data Redaction
  // ----------------------------------------------------------------
  console.log('\nTEST 17: MCP Agent Context Sensitive Data Redaction');
  const rawDataWithPii = {
    accountNumber: 'DE12500700100123456789',
    identifiers: [{ type: 'PASSPORT', value: 'RU-DEMO-8829140' }],
    customerName: 'Secret Corporate Customer',
  };
  const redacted = redactSensitiveDataForAgent(rawDataWithPii);
  assert(redacted.accountNumber.includes('****'), `Redacted account number: ${redacted.accountNumber}`);
  assert(redacted.identifiers[0].value.includes('****'), `Redacted passport ID: ${redacted.identifiers[0].value}`);
  assert(redacted.customerName === 'Secret Corporate Customer', 'Preserved non-sensitive customer name');

  // ----------------------------------------------------------------
  // Test 18: MT202 COV Without Literal "COV" String (Regression)
  // ----------------------------------------------------------------
  console.log('\nTEST 18: MT202 COV Without Literal "COV" in Body (Header 202 Priority)');
  const realisticMt202Cov = `{1:F01CHASUS33AXXX0000000000}{2:I202BARCGB22XXXXN}{4:
:20:TX202-NO-COV-WORD
:21:RELATION-REF-77
:32A:261102USD1500000,00
:52A:CHASUS33XXX
:57A:SCBLGB2LXXX
:58A:BARCGB22XXX
:50K:/US1234567890123456
ORIGINAL UNDERLYING DEBTOR CORP
100 WALL STREET
NEW YORK, NY, US
:59:/GB99BARC20000012345678
BENEFICIARY UNDERLYING CREDITOR LTD
25 BANK STREET
LONDON, E14 5JP, GB
:70:UNDERLYING COMMERCIAL SHIPMENT
-}`;
  const parsedRealistic202 = parseSwiftPaymentMessage(realisticMt202Cov);
  assert(
    parsedRealistic202.messageType === 'MT202_COV',
    `Routed to MT202_COV based on Block 2 {2:I202} and Sequence B tags (got ${parsedRealistic202.messageType})`
  );
  const realisticSeqA = parsedRealistic202.parties.filter((p) => p.provenance.sequence === 'A');
  const realisticSeqB = parsedRealistic202.parties.filter((p) => p.provenance.sequence === 'B');
  assert(realisticSeqA.length >= 2, `Extracted Sequence A interbank parties (${realisticSeqA.length})`);
  assert(realisticSeqB.length >= 2, `Extracted Sequence B underlying customer parties (${realisticSeqB.length})`);
  const bDebtor = realisticSeqB.find((p) => p.role === 'DEBTOR');
  assert(!!bDebtor && bDebtor.name.includes('ORIGINAL UNDERLYING DEBTOR'), 'Extracted Sequence B ordering debtor');

  // ----------------------------------------------------------------
  // Test 19: Safe Error Rejection on Gibberish Input
  // ----------------------------------------------------------------
  console.log('\nTEST 19: Safe Error Rejection on Malformed & Gibberish Input');
  let gibberishThrew = false;
  try {
    parseSwiftPaymentMessage('NOT A PAYMENT AT ALL. GIBBERISH DATA WITHOUT SWIFT BLOCKS OR TAGS.');
  } catch (err: any) {
    gibberishThrew = err.message.includes('Unrecognized or malformed SWIFT MT message');
  }
  assert(gibberishThrew, 'Explicitly rejected unformatted gibberish without falling back to MT103');

  let emptyThrew = false;
  try {
    parseSwiftPaymentMessage('   ');
  } catch (err: any) {
    emptyThrew = err.message.includes('Empty payment payload');
  }
  assert(emptyThrew, 'Explicitly rejected empty payload');

  // ----------------------------------------------------------------
  // Test 20: Safe Error Rejection on Missing or Invalid Field :32A:
  // ----------------------------------------------------------------
  console.log('\nTEST 20: Mandatory Field :32A: Enforcement (No Fabricated Defaults)');
  const mt103Without32A = `{1:F01TEST}{2:I103TEST}{4:
:20:REF-NO-32A
:50K:SENDER
:59:RECEIVER
-}`;
  let missing32AThrew = false;
  try {
    parseSwiftMT103(mt103Without32A);
  } catch (err: any) {
    missing32AThrew = err.message.includes('Field :32A: (Value Date, Currency, Amount) missing');
  }
  assert(missing32AThrew, 'Explicitly rejected MT103 missing mandatory Field :32A:');

  let invalid32AThrew = false;
  try {
    parseField32A('INVALID_AMOUNT_STRING');
  } catch (err: any) {
    invalid32AThrew = err.message.includes('Malformed Field :32A:');
  }
  assert(invalid32AThrew, 'Explicitly rejected malformed Field :32A: value format');

  // ----------------------------------------------------------------
  // Test 21: ISO 20022 XML Namespaces, Prefixes, Single Quotes & Entity Unescaping
  // ----------------------------------------------------------------
  console.log('\nTEST 21: ISO 20022 XML Namespaces, Prefixes, Single Quotes & Entity Unescaping');
  // XML with namespace prefix 'pacs:' and single quotes on attributes
  const prefixedXml = `<?xml version='1.0' encoding='UTF-8'?>
<pacs:Document xmlns:pacs='urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08'>
  <pacs:FIToFICstmrCdtTrf>
    <pacs:GrpHdr>
      <pacs:MsgId>PREFIX-DEMO-991</pacs:MsgId>
    </pacs:GrpHdr>
    <pacs:CdtTrfTxInf>
      <pacs:PmtId>
        <pacs:EndToEndId>PREFIX-E2E-001</pacs:EndToEndId>
      </pacs:PmtId>
      <pacs:IntrBkSttlmAmt Ccy='EUR'>120000.00</pacs:IntrBkSttlmAmt>
      <pacs:Dbtr>
        <pacs:Nm>Johnson &amp; Sons Marine Ltd &lt;UK&gt;</pacs:Nm>
      </pacs:Dbtr>
      <pacs:Cdtr>
        <pacs:Nm>Pacific Import &apos;Export&apos; SA</pacs:Nm>
      </pacs:Cdtr>
    </pacs:CdtTrfTxInf>
  </pacs:FIToFICstmrCdtTrf>
</pacs:Document>`;

  const parsedPrefixed = parseIso20022PaymentMessage(prefixedXml);
  assert(parsedPrefixed.length === 1, 'Parsed prefixed <pacs:Document> successfully');
  assert(parsedPrefixed[0].amount === 120000.0, 'Extracted amount from prefixed tag with single quotes');
  assert(parsedPrefixed[0].currency === 'EUR', 'Extracted currency EUR from single quotes attribute');
  const prefDbtr = parsedPrefixed[0].parties.find((p) => p.role === 'DEBTOR');
  const prefCdtr = parsedPrefixed[0].parties.find((p) => p.role === 'CREDITOR');
  assert(prefDbtr?.name === 'Johnson & Sons Marine Ltd <UK>', `Unescaped &amp; and &lt;&gt;: ${prefDbtr?.name}`);
  assert(prefCdtr?.name === "Pacific Import 'Export' SA", `Unescaped &apos;: ${prefCdtr?.name}`);

  // Test unescapeXmlEntities directly
  const unescapedString = unescapeXmlEntities('A &amp; B &lt; C &gt; D &quot;E&quot; &apos;F&apos;');
  assert(unescapedString === `A & B < C > D "E" 'F'`, 'Direct unescapeXmlEntities test verified');

  // ----------------------------------------------------------------
  // Test 22: ISO 20022 XXE and Malformed XML Rejection
  // ----------------------------------------------------------------
  console.log('\nTEST 22: ISO 20022 XXE and Malformed XML Rejection');
  let xxeThrew = false;
  try {
    validateAndSanitizeXml('<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><doc>&xxe;</doc>');
  } catch (err: any) {
    xxeThrew = err.message.includes('DOCTYPE and ENTITY expansions are strictly prohibited');
  }
  assert(xxeThrew, 'Explicitly rejected XML containing DOCTYPE/ENTITY expansion (XXE protection)');

  let malformedXmlThrew = false;
  try {
    validateAndSanitizeXml('This is plain text with no XML brackets');
  } catch (err: any) {
    malformedXmlThrew = err.message.includes('Malformed XML');
  }
  assert(malformedXmlThrew, 'Explicitly rejected malformed non-XML string');

  // ----------------------------------------------------------------
  // Test 23: Real Express HTTP Routes Authentication & SSRF Security
  // ----------------------------------------------------------------
  console.log('\nTEST 23: Real Express HTTP Routes Authentication & SSRF Security');
  const app = createComplianceApp({ isPublicDemo: true });
  const server = app.listen(0);
  const address = server.address() as import('net').AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // 1. Unauthenticated POST to protected route returns 401
    const unauthRes = await fetch(`${baseUrl}/api/cases/case_sample_1/adjudicate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'CONFIRM_ENTITY_MATCH', rationale: 'Testing unauthenticated access attempt.' }),
    });
    assert(unauthRes.status === 401, `Unauthenticated request returned 401 (got ${unauthRes.status})`);

    // 2. Query URL token (?token=...) is strictly rejected with 401 (prevents URL/log leakage)
    const queryTokenRes = await fetch(`${baseUrl}/api/cases/case_sample_1/adjudicate?token=${DEMO_ANALYST_TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'CONFIRM_ENTITY_MATCH', rationale: 'Testing query-token rejection.' }),
    });
    assert(queryTokenRes.status === 401, `Query parameter token (?token=) was rejected with 401 (got ${queryTokenRes.status})`);

    // 3. Invalid header token returns 401
    const badTokenRes = await fetch(`${baseUrl}/api/cases/case_sample_1/adjudicate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-analyst-token': 'invalid_forged_key' },
      body: JSON.stringify({ decision: 'CONFIRM_ENTITY_MATCH', rationale: 'Testing invalid token.' }),
    });
    assert(badTokenRes.status === 401, `Invalid token returned 401 (got ${badTokenRes.status})`);

    // 4. Remote engine configuration is blocked with 403 in public demo mode (SSRF protection)
    const ssrfRes = await fetch(`${baseUrl}/api/engine/configure-remote`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-analyst-token': DEMO_ANALYST_TOKEN,
      },
      body: JSON.stringify({ endpointUrl: 'http://169.254.169.254/computeMetadata/v1/' }),
    });
    const ssrfJson = await ssrfRes.json() as any;
    assert(ssrfRes.status === 403, `Remote engine configuration blocked with 403 (got ${ssrfRes.status})`);
    assert(ssrfJson.code === 'SSRF_PROTECTION_ENABLED', 'Returns SSRF_PROTECTION_ENABLED code');

    // 5. Valid Bearer Authorization token succeeds on session endpoint with simulated sandbox role
    const sessionRes = await fetch(`${baseUrl}/api/auth/session`, {
      headers: { Authorization: `Bearer ${DEMO_ANALYST_TOKEN}` },
    });
    const sessionJson = await sessionRes.json() as any;
    assert(sessionRes.status === 200, `Session endpoint returned 200 (got ${sessionRes.status})`);
    assert(sessionJson.isAuthenticated === true, 'Session is marked authenticated');
    assert(sessionJson.role === 'compliance_officer_sandbox', `Role explicitly labelled sandbox: ${sessionJson.role}`);
    assert(sessionJson.isProductionCredential === false, 'Session flags isProductionCredential=false');

    // 6. Valid header authentication on adjudication
    const cases = paymentStoreService.getAllCases('default');
    if (cases.length > 0) {
      const authAdjRes = await fetch(`${baseUrl}/api/cases/${cases[0].caseId}/adjudicate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-analyst-token': DEMO_ANALYST_TOKEN,
        },
        body: JSON.stringify({
          decision: 'CLEAR_FALSE_POSITIVE',
          rationale: 'Legitimate corporate supplier verified via commercial register registry.',
        }),
      });
      assert(authAdjRes.status === 200, `Valid header-authenticated adjudication returned 200 (got ${authAdjRes.status})`);
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  // Unauthenticated evidence bundle masking test
  const sampleEvidenceBundle = {
    caseId: 'case_test_99',
    accountNumber: 'DE12500700100123456789',
    parties: [
      {
        name: 'Target Customer',
        accountNumber: 'FR7630006000019988776655443',
        identifiers: [{ type: 'PASSPORT', value: 'RU-DEMO-8829140' }],
      },
    ],
  };
  const redactedEvidence = redactSensitiveDataForAgent(sampleEvidenceBundle);
  assert(
    redactedEvidence.accountNumber.includes('****') &&
      redactedEvidence.parties[0].accountNumber.includes('****') &&
      redactedEvidence.parties[0].identifiers[0].value.includes('****'),
    'Unauthenticated evidence export verifies all PII is redacted'
  );

  // ----------------------------------------------------------------
  // Test 24: Unified Parser Factory (All MT Categories 1-9 & All MX Domains)
  // ----------------------------------------------------------------
  console.log('\nTEST 24: Unified Parser Factory (All MT Categories 1-9 & All MX Domains)');
  // MT700 Documentary Credit (:32B: currency/amount without date, :50: Applicant, :59: Beneficiary)
  const mt700Sample = `{1:F01DEUTDEDDXXX0000000000}{2:I700HSBCHKHHAXXXN}{4:
:20:LC-2026-70091
:31C:261102
:32B:USD850000,00
:50:NORDIC INDUSTRIAL EXPORTS GMBH
HAMBURG, GERMANY
:59:/AE990011223344
AL-HUDA INTERNATIONAL TRADING LLC
DUBAI, UAE
:41A:HSBCHKHHXXX
-}`;
  const mt700Dispatched = unifiedParserFactory.dispatch(mt700Sample);
  assert(mt700Dispatched.header.family === 'SWIFT_MT', 'Factory detected SWIFT_MT family for MT700');
  assert(mt700Dispatched.header.detectedType === 'MT700', `Factory detected MT700 (got ${mt700Dispatched.header.detectedType})`);
  assert(mt700Dispatched.transactions[0].amount === 850000.0 && mt700Dispatched.transactions[0].currency === 'USD', 'Extracted :32B: USD 850,000.00 in MT700');
  assert(mt700Dispatched.transactions[0].parties.length === 3, 'Extracted Applicant (:50:), Beneficiary (:59:), and Available With Bank (:41A:) in MT700');

  // MT199 Free-Format Message (extracts Sender & Receiver BICs from Block 1 and Block 2)
  const mt199Sample = `{1:F01BNPAFRPPXXX0000000000}{2:I199CHASUS33XXXXN}{4:
:20:INQ-2026-199
:21:ORIG-REF-001
:79:COMPLIANCE QUERY REGARDING BENEFICIARY OWNERSHIP
-}`;
  const mt199Dispatched = unifiedParserFactory.dispatch(mt199Sample);
  assert(mt199Dispatched.header.detectedType === 'MT199', `Factory detected MT199 (got ${mt199Dispatched.header.detectedType})`);
  assert(mt199Dispatched.transactions[0].parties.length === 2, 'Extracted Block 1 Sender BIC and Block 2 Receiver BIC for MT199');

  // ISO 20022 BAH (<AppHdr> head.001) + sese.023 Securities Settlement Instruction
  const bahAndSeseSample = `<BizData>
    <AppHdr xmlns="urn:iso:std:iso:20022:tech:xsd:head.001.001.02">
      <Fr><FIId><FinInstnId><BICFI>DEUTDEFFXXX</BICFI></FinInstnId></FIId></Fr>
      <To><FIId><FinInstnId><BICFI>PARBFRPPXXX</BICFI></FinInstnId></FIId></To>
      <BizMsgIdr>BAH-SESE-2026-01</BizMsgIdr>
      <MsgDefIdr>sese.023.001.09</MsgDefIdr>
    </AppHdr>
    <Document xmlns="urn:iso:std:iso:20022:tech:xsd:sese.023.001.09">
      <SctiesSttlmTxInstr>
        <TxId>SESE-TX-01</TxId>
        <SttlmAmt Ccy="EUR">500000.00</SttlmAmt>
        <Buyr><Nm>ALPINE CAPITAL AG</Nm></Buyr>
        <Sellr><Nm>Nordic Volga Logistics OOO</Nm></Sellr>
      </SctiesSttlmTxInstr>
    </Document>
  </BizData>`;
  const seseDispatched = unifiedParserFactory.dispatch(bahAndSeseSample);
  assert(seseDispatched.header.family === 'ISO20022_MX', 'Factory detected ISO20022_MX family for BAH+sese.023');
  assert(seseDispatched.header.headerFormat === 'ISO20022_BAH_ENVELOPE', 'Factory identified ISO20022_BAH_ENVELOPE');
  assert(seseDispatched.header.detectedType === 'SESE_023', `Factory routed to SESE_023 (got ${seseDispatched.header.detectedType})`);
  assert(seseDispatched.transactions[0].amount === 500000 && seseDispatched.transactions[0].currency === 'EUR', 'Extracted EUR 500,000 from sese.023');

  // Verify unprofiled MT/MX messages NEVER falsely report COMPLETE screening
  const unprofiledMtScreen = await paymentStoreService.screenTransaction(mt199Dispatched.transactions[0], 'test_caller');
  assert(
    unprofiledMtScreen.coverageStatus === 'INSUFFICIENT' && unprofiledMtScreen.requiresHumanReview === true,
    `Unprofiled MT199 never falsely reports COMPLETE screening (got coverageStatus=${unprofiledMtScreen.coverageStatus}, requiresHumanReview=${unprofiledMtScreen.requiresHumanReview})`
  );
  assert(
    mt199Dispatched.transactions[0].missingDataIssues.some((i) => i.ruleId === 'PROF_01_UNPROFILED_MESSAGE_ENVELOPE'),
    'Unprofiled MT199 flagged with PROF_01_UNPROFILED_MESSAGE_ENVELOPE critical missing data issue'
  );

  const unprofiledMxScreen = await paymentStoreService.screenTransaction(seseDispatched.transactions[0], 'test_caller');
  assert(
    unprofiledMxScreen.coverageStatus === 'INSUFFICIENT' && unprofiledMxScreen.requiresHumanReview === true,
    `Unprofiled MX sese.023 never falsely reports COMPLETE screening (got coverageStatus=${unprofiledMxScreen.coverageStatus})`
  );

  // Verify pacs.009 without <UndrlygCstmrCdtTrf> routes to PACS_009 (non-COV) with isProfileTested=false
  const pacs009NoCovXml = `<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.009.001.08">
    <FICdtTrf>
      <GrpHdr><MsgId>FI-009-NOCOV</MsgId><IntrBkSttlmDt>2026-11-02</IntrBkSttlmDt></GrpHdr>
      <CdtTrfTxInf>
        <PmtId><EndToEndId>E2E-009-NOCOV</EndToEndId></PmtId>
        <IntrBkSttlmAmt Ccy="USD">500000.00</IntrBkSttlmAmt>
        <InstgAgt><FinInstnId><BICFI>DEUTDEFFXXX</BICFI></FinInstnId></InstgAgt>
        <InstdAgt><FinInstnId><BICFI>CHASUS33XXX</BICFI></FinInstnId></InstdAgt>
      </CdtTrfTxInf>
    </FICdtTrf>
  </Document>`;
  const pacs009NoCovDispatched = unifiedParserFactory.dispatch(pacs009NoCovXml);
  assert(
    pacs009NoCovDispatched.header.detectedType === 'PACS_009' &&
      pacs009NoCovDispatched.transactions[0].messageType === 'PACS_009' &&
      pacs009NoCovDispatched.transactions[0].isProfileTested === false,
    `pacs.009 without <UndrlygCstmrCdtTrf> classified as PACS_009 with isProfileTested=false (got ${pacs009NoCovDispatched.header.detectedType})`
  );

  // Verify MT103_STP enforces Option-A BIC Straight-Through Processing rules:
  // Valid MT103_STP (Option A agent) -> isProfileTested = true; Invalid MT103_STP (:57D: free text) -> isProfileTested = false
  const mt103StpValidRaw = `{1:F01DEUTDEDDXXX0000000000}{2:I103HSBCHKHHAXXXN}{3:{119:STP}}{4:
:20:STP-2026-01
:23B:CRED
:32A:261102EUR10000,00
:50K:/DE89370400440532013000
ACME GMBH
BERLIN, DE
:57A:NWBKGB2LXXX
:59:/GB29NWBK60161331926819
BETA LTD
LONDON, GB
-}`;
  const mt103StpDispatched = unifiedParserFactory.dispatch(mt103StpValidRaw);
  assert(
    mt103StpDispatched.transactions[0].messageType === 'MT103_STP' &&
      mt103StpDispatched.transactions[0].isProfileTested === true,
    'Valid MT103_STP (Option-A BIC agent) passes STP profile validation (isProfileTested=true)'
  );

  const mt103StpInvalidRaw = mt103StpValidRaw.replace(':57A:NWBKGB2LXXX', ':57D:NON STP FREE TEXT BANK\nLONDON');
  const mt103StpInvalidDispatched = unifiedParserFactory.dispatch(mt103StpInvalidRaw);
  assert(
    mt103StpInvalidDispatched.transactions[0].messageType === 'MT103_STP' &&
      mt103StpInvalidDispatched.transactions[0].isProfileTested === false,
    'MT103_STP with prohibited :57D: agent option accurately sets isProfileTested=false'
  );

  // Verify MT103_REMIT enforces mandatory :77T: Extended Remittance and prohibits :70:
  const mt103RemitValidRaw = `{1:F01DEUTDEDDXXX0000000000}{2:I103HSBCHKHHAXXXN}{3:{119:REMIT}}{4:
:20:REMIT-2026-01
:23B:CRED
:32A:261102EUR15000,00
:50K:/DE89370400440532013000
ACME GMBH
BERLIN, DE
:59:/GB29NWBK60161331926819
BETA LTD
LONDON, GB
:77T:/EREF/INV-2026-9988//URI/https://remit.example.com/inv9988
-}`;
  const mt103RemitDispatched = unifiedParserFactory.dispatch(mt103RemitValidRaw);
  assert(
    mt103RemitDispatched.transactions[0].messageType === 'MT103_REMIT' &&
      mt103RemitDispatched.transactions[0].isProfileTested === true &&
      Boolean(mt103RemitDispatched.transactions[0].remittanceInformation?.includes('INV-2026-9988')),
    'Valid MT103_REMIT with :77T: passes REMIT profile validation (isProfileTested=true)'
  );

  // Verify MT205_COV enforces Sequence A + Sequence B domestic cover structure
  const mt205CovRaw = `{1:F01CHASUS33AXXX0000000000}{2:I205BOFAUS3NXXXXN}{3:{119:COV}}{4:
:20:COV205-2026-01
:21:ORIG-REF-205
:32A:261102USD250000,00
:52A:CHASUS33XXX
:58A:BOFAUS3NXXX
:50K:/123456789
US DOMESTIC SENDER INC
NEW YORK, US
:59:/987654321
US DOMESTIC BENEFICIARY LLC
CHICAGO, US
-}`;
  const mt205CovDispatched = unifiedParserFactory.dispatch(mt205CovRaw);
  assert(
    mt205CovDispatched.transactions[0].messageType === 'MT205_COV' &&
      mt205CovDispatched.transactions[0].isProfileTested === true &&
      mt205CovDispatched.transactions[0].parties.some((p) => p.provenance.sequence === 'A') &&
      mt205CovDispatched.transactions[0].parties.some((p) => p.provenance.sequence === 'B'),
    'Valid MT205_COV with Sequence A and Sequence B passes cover profile validation (isProfileTested=true)'
  );

  // Verify server-side enforcement: spoofing isProfileTested=true on an unprofiled messageType cannot auto-clear
  const spoofedTx = {
    ...mt700Dispatched.transactions[0],
    isProfileTested: true,
    missingDataIssues: [],
  };
  const spoofedScreen = await paymentStoreService.screenTransaction(spoofedTx, 'test_caller');
  assert(
    spoofedScreen.coverageStatus === 'INSUFFICIENT' &&
      spoofedScreen.requiresHumanReview === true &&
      spoofedScreen.missingDataIssues.some((i) => i.ruleId === 'PROF_01_UNPROFILED_MESSAGE_ENVELOPE'),
    'Server-side screening overrides spoofed isProfileTested=true on MT700 and enforces INSUFFICIENT + human review'
  );

  // Verify malformed MT (blocks with no body tags) and malformed/non-ISO20022 XML are rejected
  let malformedMtBlocksThrew = false;
  try {
    unifiedParserFactory.dispatch('{1:F01BNPAFRPPXXX0000000000}{2:I199CHASUS33XXXXN}{4:\nCORRUPTED BODY WITH NO TAGS\n-}');
  } catch {
    malformedMtBlocksThrew = true;
  }
  assert(malformedMtBlocksThrew, 'Rejected malformed SWIFT FIN message lacking valid Block 4 tags');

  let unclosedXmlThrew = false;
  try {
    unifiedParserFactory.dispatch('<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08"><FIToFICstmrCdtTrf>');
  } catch {
    unclosedXmlThrew = true;
  }
  assert(unclosedXmlThrew, 'Rejected truncated/unclosed XML document');

  let nonIsoXmlThrew = false;
  try {
    unifiedParserFactory.dispatch('<randomRoot><foo>bar</foo></randomRoot>');
  } catch {
    nonIsoXmlThrew = true;
  }
  assert(nonIsoXmlThrew, 'Rejected arbitrary non-ISO 20022 XML document');

  // Verify /api/payments/parse endpoint routes MT and MX via UnifiedParserFactory
  const parseTestServer = app.listen(0);
  const parsePort = (parseTestServer.address() as import('net').AddressInfo).port;
  try {
    const parseRes = await fetch(`http://127.0.0.1:${parsePort}/api/payments/parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rawMessage: mt700Sample }),
    });
    const parseJson = (await parseRes.json()) as any;
    assert(parseRes.status === 200 && parseJson.header?.detectedType === 'MT700', 'POST /api/payments/parse dynamically routed MT700 via factory');

    // Verify /api/health/lists/reload is blocked in PUBLIC_SYNTHETIC_DEMO mode
    const reloadBlockRes = await fetch(`http://127.0.0.1:${parsePort}/api/health/lists/reload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-analyst-token': DEMO_ANALYST_TOKEN },
    });
    assert(reloadBlockRes.status === 403, `POST /api/health/lists/reload blocked with 403 in public demo mode (got ${reloadBlockRes.status})`);
  } finally {
    await new Promise<void>((resolve) => parseTestServer.close(() => resolve()));
  }

  // ----------------------------------------------------------------
  // Test 25: Environment Variable Watchlist Folder Loading & Public Demo Boundary
  // ----------------------------------------------------------------
  console.log('\nTEST 25: Environment Variable Watchlist Folder Loading & Public Demo Boundary');
  const tmpListDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-watchlist-test-'));
  const prevPublicDemo = process.env.IS_PUBLIC_DEMO;
  try {
    const customListFile = path.join(tmpListDir, 'custom_ofac.json');
    fs.writeFileSync(
      customListFile,
      JSON.stringify([
        {
          id: 'ENV-SDN-999',
          listId: 'DEMO_OFAC_SDN',
          name: 'Env Loaded Test Maritime Corp',
          aliases: ['Env Maritime'],
          entityType: 'ORGANIZATION',
          identifiers: [{ type: 'LEI', value: '549300ENVTESTLEI9999' }],
          country: 'Panama',
          programs: ['DEMO-ENV-TEST'],
        },
      ]),
      'utf8'
    );

    process.env.WATCHLIST_DIRS = tmpListDir;

    // 1. In PUBLIC_SYNTHETIC_DEMO mode (default), client folders MUST NOT be loaded
    process.env.IS_PUBLIC_DEMO = 'true';
    const publicDemoReload = watchlistService.reloadFromEnvironment();
    assert(
      publicDemoReload.loadedEntries === 0 && publicDemoReload.blockedByPublicDemo === true,
      'Public synthetic demo strictly blocked loading client folder data'
    );
    assert(
      !watchlistService.getAllEntries().some((e) => e.id === 'ENV-SDN-999'),
      'Public synthetic demo never exposes external client list records'
    );

    // 2. In ENTERPRISE_GATEWAY mode (IS_PUBLIC_DEMO=false), client folders from env vars load cleanly
    process.env.IS_PUBLIC_DEMO = 'false';
    const reloadRes = watchlistService.reloadFromEnvironment();
    assert(reloadRes.loadedEntries === 1, `Loaded 1 custom entry from WATCHLIST_DIRS in enterprise mode (got ${reloadRes.loadedEntries})`);
    assert(reloadRes.configuredFolders.includes(tmpListDir), 'WatchlistService reported configured WATCHLIST_DIRS folder');

    // Screen a party against the environment-loaded entry to verify screening works identically
    const envScreenOutcome = await embeddedSyntheticEngine.screenParty({
      partyId: 'p_env_test',
      role: 'CREDITOR',
      name: 'Env Loaded Test Maritime Corp',
      identifiers: [{ type: 'LEI', value: '549300ENVTESTLEI9999' }],
      provenance: {},
    });
    assert(
      envScreenOutcome.findingSeverity === 'EXACT_IDENTIFIER_MATCH',
      'Screening engine matched environment-loaded watchlist record without altering screening behavior'
    );
  } finally {
    delete process.env.WATCHLIST_DIRS;
    if (prevPublicDemo === undefined) {
      delete process.env.IS_PUBLIC_DEMO;
    } else {
      process.env.IS_PUBLIC_DEMO = prevPublicDemo;
    }
    watchlistService.reloadFromEnvironment();
    fs.rmSync(tmpListDir, { recursive: true, force: true });
  }

  // ----------------------------------------------------------------
  // Test 26: Exhaustive Verification of All 148 MT Types & All 112 MX Types (33 Domains)
  // ----------------------------------------------------------------
  console.log('\nTEST 26: Exhaustive Verification of All 148 SWIFT MT Types & All 112 ISO 20022 MX Types (33 Domains)');
  let mtTestedCount = 0;
  let mtFailedCount = 0;

  for (const mtType of SUPPORTED_SWIFT_MT_TYPES) {
    const m = mtType.match(/^MT(\d{3})(?:_(STP|REMIT|COV))?$/);
    if (!m) continue;
    const digits = m[1];
    const variant = m[2];
    const block3 = variant ? `{3:{119:${variant}}}` : '';
    const extraTags =
      mtType === 'MT103_REMIT'
        ? '\n:77T:/EREF/REMIT-DOC-001'
        : mtType === 'MT202_COV' || mtType === 'MT205_COV'
          ? '\n:21:REL-COV-01\n:52A:BNPAFRPPXXX\n:58A:CHASUS33XXX'
          : '';
    const partyTags =
      mtType === 'MT202' || mtType === 'MT205'
        ? `\n:21:REL-${mtType}\n:52A:BNPAFRPPXXX\n:58A:CHASUS33XXX`
        : `\n:50K:/12345678\nORIGINATOR CORP\nPARIS, FR\n:59:/87654321\nBENEFICIARY INC\nNEW YORK, US`;
    const rawMt = `{1:F01BNPAFRPPXXX0000000000}{2:I${digits}CHASUS33XXXXN}${block3}{4:\n:20:REF-${mtType}\n:23B:CRED\n:32A:261102USD10000,00${extraTags}${partyTags}\n-}`;
    try {
      const dispatched = unifiedParserFactory.dispatch(rawMt);
      const tx = dispatched.transactions[0];
      const expectedProfileTested = (VERIFIED_TESTED_PROFILES as readonly string[]).includes(mtType);
      if (tx.messageType === mtType && tx.parties.length >= 2 && tx.isProfileTested === expectedProfileTested) {
        mtTestedCount++;
      } else {
        mtFailedCount++;
        console.error(`  ✗ MT mismatch on ${mtType}: got type=${tx.messageType}, parties=${tx.parties.length}, isProfileTested=${tx.isProfileTested}`);
      }
    } catch (err: any) {
      mtFailedCount++;
      console.error(`  ✗ MT error on ${mtType}: ${err.message}`);
    }
  }
  assert(
    mtTestedCount === SUPPORTED_SWIFT_MT_TYPES.length && mtFailedCount === 0,
    `Exhaustively dispatched, parsed, and verified all ${SUPPORTED_SWIFT_MT_TYPES.length} SWIFT MT types across Categories 1–9 (passed=${mtTestedCount}, failed=${mtFailedCount})`
  );

  let mxTestedCount = 0;
  let mxFailedCount = 0;
  const mxDomainsSeen = new Set<string>();

  for (const mxType of SUPPORTED_ISO20022_MX_TYPES) {
    const parts = mxType.split('_');
    const domain = parts[0].toLowerCase();
    const num = parts[1];
    const variant = parts[2]; // e.g., STP, COV, ADV
    mxDomainsSeen.add(domain);

    let rawXml = '';
    if (mxType === 'PACS_008') {
      rawXml = `<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08"><FIToFICstmrCdtTrf><CdtTrfTxInf><PmtId><EndToEndId>E2E-PACS008</EndToEndId></PmtId><IntrBkSttlmAmt Ccy="EUR">5000.00</IntrBkSttlmAmt><Dbtr><Nm>ALPHA DEBTOR</Nm></Dbtr><Cdtr><Nm>BETA CREDITOR</Nm></Cdtr></CdtTrfTxInf></FIToFICstmrCdtTrf></Document>`;
    } else if (mxType === 'PACS_009_COV') {
      rawXml = `<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.009.001.08"><FICdtTrf><CdtTrfTxInf><PmtId><EndToEndId>E2E-PACS009COV</EndToEndId></PmtId><IntrBkSttlmAmt Ccy="USD">15000.00</IntrBkSttlmAmt><InstgAgt><FinInstnId><BICFI>BNPAFRPPXXX</BICFI></FinInstnId></InstgAgt><InstdAgt><FinInstnId><BICFI>CHASUS33XXX</BICFI></FinInstnId></InstdAgt><UndrlygCstmrCdtTrf><Dbtr><Nm>UNDERLYING DEBTOR</Nm></Dbtr><Cdtr><Nm>UNDERLYING CREDITOR</Nm></Cdtr></UndrlygCstmrCdtTrf></CdtTrfTxInf></FICdtTrf></Document>`;
    } else if (mxType === 'PACS_004') {
      rawXml = `<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.004.001.09"><PmtRtr><TxInf><RtrId>RTR-01</RtrId><RtrdIntrBkSttlmAmt Ccy="EUR">1200.00</RtrdIntrBkSttlmAmt><OrgnlTxRef><Dbtr><Pty><Nm>ORIG DEBTOR</Nm></Pty></Dbtr><Cdtr><Pty><Nm>ORIG CREDITOR</Nm></Pty></Cdtr></OrgnlTxRef></TxInf></PmtRtr></Document>`;
    } else if (mxType === 'PAIN_001') {
      rawXml = `<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.09"><CstmrCdtTrfInitn><PmtInf><PmtInfId>PMT-01</PmtInfId><Dbtr><Nm>PAIN DEBTOR</Nm></Dbtr><CdtTrfTxInf><PmtId><EndToEndId>E2E-PAIN1</EndToEndId></PmtId><Amt><InstdAmt Ccy="EUR">2500.00</InstdAmt></Amt><Cdtr><Nm>PAIN CREDITOR</Nm></Cdtr></CdtTrfTxInf></PmtInf></CstmrCdtTrfInitn></Document>`;
    } else {
      const svcTag = variant ? `<SvcLvl><Prtry>${variant}</Prtry></SvcLvl>` : '';
      rawXml = `<Document xmlns="urn:iso:std:iso:20022:tech:xsd:${domain}.${num}.001.08"><BizMsg><MsgId>MSG-${mxType}</MsgId>${svcTag}<Amt Ccy="EUR">1000.00</Amt><Dbtr><Nm>PARTY A ${mxType}</Nm></Dbtr><Cdtr><Nm>PARTY B ${mxType}</Nm></Cdtr></BizMsg></Document>`;
    }

    try {
      const dispatched = unifiedParserFactory.dispatch(rawXml);
      const tx = dispatched.transactions[0];
      const expectedProfileTested = (VERIFIED_TESTED_PROFILES as readonly string[]).includes(mxType);
      if (tx.messageType === mxType && tx.parties.length >= 2 && tx.isProfileTested === expectedProfileTested) {
        mxTestedCount++;
      } else {
        mxFailedCount++;
        console.error(`  ✗ MX mismatch on ${mxType}: got type=${tx.messageType}, parties=${tx.parties.length}, isProfileTested=${tx.isProfileTested}`);
      }
    } catch (err: any) {
      mxFailedCount++;
      console.error(`  ✗ MX error on ${mxType}: ${err.message}`);
    }
  }
  assert(
    mxTestedCount === SUPPORTED_ISO20022_MX_TYPES.length && mxFailedCount === 0,
    `Exhaustively dispatched, parsed, and verified all ${SUPPORTED_ISO20022_MX_TYPES.length} ISO 20022 MX types (passed=${mxTestedCount}, failed=${mxFailedCount})`
  );
  assert(
    mxDomainsSeen.size === 33,
    `Verified all 33 ISO 20022 4-letter business domains in automated test suite (got ${mxDomainsSeen.size} domains)`
  );

  // ----------------------------------------------------------------
  // Summary
  // ----------------------------------------------------------------
  console.log('\n======================================================');
  console.log(`PAYMENTS TEST SUMMARY: ${passed} Passed, ${failed} Failed`);
  console.log('======================================================\n');

  return { passed, failed };
}

// Auto-run if executed directly as main script
const isMainScript = process.argv[1]?.endsWith('payments_gateway.test.ts');
if (isMainScript) {
  runPaymentsTests()
    .then((res) => {
      if (res.failed > 0) process.exit(1);
    })
    .catch((err) => {
      console.error('Test execution error:', err);
      process.exit(1);
    });
}
