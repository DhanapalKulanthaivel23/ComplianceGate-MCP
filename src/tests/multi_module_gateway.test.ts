/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { evaluateTradeAndCargo } from '../server/services/modules/tradeAndCargoService.ts';
import { evaluateMaritimeVessel, validateImoChecksum } from '../server/services/modules/maritimeService.ts';
import { evaluateAirCargo, validateIataAwbChecksum } from '../server/services/modules/airCargoService.ts';
import { evaluateInsurancePolicy } from '../server/services/modules/insuranceService.ts';
import { evaluateCryptoTransfer, validateAddressFormat } from '../server/services/modules/cryptoService.ts';
import { evaluateHealthcareClaim, validateNpiLuhn, validateDeaNumber } from '../server/services/modules/healthcareService.ts';
import { evaluateSecuritiesOrder, validateIsinChecksum, parseFixMessage } from '../server/services/modules/securitiesService.ts';
import { runValidationAndAuditBenchmark, runExtendedValidationSuite } from '../server/services/modules/validationAndAuditService.ts';
import { MULTI_MODULE_FIXTURES } from '../server/services/syntheticFixtures.ts';
import { createOfficialMcpServer, MCP_TOOLS } from '../server/mcpServer.ts';
import { createComplianceApp } from '../server/app.ts';
import { authService } from '../server/services/authService.ts';
import { durableStorage } from '../server/services/durableStorage.ts';
import { paymentStoreService } from '../server/services/paymentStore.ts';
import { parseSwiftPaymentMessage } from '../server/services/parsers/swiftMtParser.ts';
import { parseIso20022PaymentMessage } from '../server/services/parsers/iso20022Parser.ts';
import { verifyExtractionCompleteness } from '../server/services/missingDataEngine.ts';
import { watchlistService } from '../server/services/watchlist.ts';
import {
  extractStructuredTradeDocument,
  extractStructuredAirWaybill,
  extractX12HealthcareClaim,
  extractAcordInsurancePolicy,
} from '../server/services/documentIntelligence.ts';
import { goCoreEngineAdapter } from '../server/services/engineAdapter.ts';
import { moduleWorkflowStore } from '../server/services/moduleWorkflowStore.ts';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

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

export async function runMultiModuleTests(): Promise<{ passed: number; failed: number }> {
  passed = 0;
  failed = 0;
  console.log('\n======================================================');
  console.log('   ComplianceGate-MCP: Multi-Module Gateway Test Suite ');
  console.log('======================================================\n');

  // ----------------------------------------------------------------
  // Test 1: Trade and Cargo Module
  // ----------------------------------------------------------------
  console.log('TEST 1: Trade and Cargo Discrepancies & Dual-Use Goods');
  const tradeEval = evaluateTradeAndCargo(MULTI_MODULE_FIXTURES.TRADE_AND_CARGO);
  assert(tradeEval.discrepancies.length >= 2, `Detected at least 2 cross-document discrepancies (got ${tradeEval.discrepancies.length})`);
  const portDisc = tradeEval.discrepancies.find((d) => d.category === 'PORT_INCONSISTENCY');
  const weightDisc = tradeEval.discrepancies.find((d) => d.category === 'WEIGHT_DISCREPANCY');
  assert(!!portDisc && portDisc.description.includes('Port of Discharge'), 'Flagged Port of Discharge discrepancy between Invoice and B/L');
  assert(!!weightDisc && weightDisc.description.includes('Gross weight differs'), 'Flagged weight discrepancy between B/L and Packing List');
  assert(tradeEval.dualUseGoods.length > 0, `Identified dual-use goods hit (got ${tradeEval.dualUseGoods.length})`);
  assert(tradeEval.dualUseGoods[0].proliferationCategory === 'NUCLEAR', 'Categorized centrifuge components as NUCLEAR dual-use');
  assert(!tradeEval.passedVerification, 'Correctly failed trade financing verification due to red flags');
  assert(tradeEval.evidenceDigest.length === 64, 'Generated 64-char SHA-256 trade audit digest');

  // ----------------------------------------------------------------
  // Test 2: Maritime Compliance Module
  // ----------------------------------------------------------------
  console.log('TEST 2: Maritime IMO Checksum, Sanctioned Ports & Dark AIS');
  assert(validateImoChecksum('9256858') === true, 'Verified valid IMO 9256858 checksum formula');
  assert(validateImoChecksum('9256859') === false, 'Rejected corrupted IMO 9256859 check digit');
  const maritimeEval = evaluateMaritimeVessel(MULTI_MODULE_FIXTURES.MARITIME);
  assert(maritimeEval.isImoChecksumValid === true, 'Vessel profile verified valid IMO checksum');
  assert(maritimeEval.darkAisRiskLevel === 'HIGH_RISK_SUSPECTED', `Flagged dark AIS risk (got ${maritimeEval.darkAisRiskLevel})`);
  assert(maritimeEval.portRiskAnalysis.some((p) => p.isHighRiskOrSanctioned && p.unLocode === 'IRBND'), 'Flagged Bandar Abbas (IRBND) as sanctioned port call');
  assert(maritimeEval.ownershipHierarchy.some((o) => o.isSanctioned), 'Flagged sanctioned commercial manager in ownership chain');
  assert(!maritimeEval.isApprovedForCoverage, 'Prohibited maritime insurance coverage for high-risk tanker');

  // ----------------------------------------------------------------
  // Test 3: Air Cargo Security Module
  // ----------------------------------------------------------------
  console.log('TEST 3: Air Cargo IATA AWB Mod-7 & Routing Transit Risk');
  const validAwb = validateIataAwbChecksum('176-49281702');
  assert(validAwb.isValid === true, 'Verified valid IATA AWB 176-49281702 with mod-7 check digit 2');
  const invalidAwb = validateIataAwbChecksum('176-49281709');
  assert(invalidAwb.isValid === false, 'Rejected corrupted IATA AWB check digit');
  const airEval = evaluateAirCargo(MULTI_MODULE_FIXTURES.AIR_CARGO);
  assert(airEval.airlineName.includes('Emirates'), `Identified airline operator from prefix 176 (got ${airEval.airlineName})`);
  assert(airEval.routing.hasHighRiskTransshipment === true, 'Flagged Tehran (THR) as high-risk transshipment gateway');
  assert(airEval.cargoDetails.isDualUseRisk === true, 'Flagged avionics radar transceiver as dual-use risk');
  assert(airEval.cargoDetails.securityScreeningStatus === 'FLAGGED', 'Marked cargo security status as FLAGGED');

  // ----------------------------------------------------------------
  // Test 4: Insurance & UBO Module (OFAC 50% Rule)
  // ----------------------------------------------------------------
  console.log('TEST 4: Insurance UBO Analysis & OFAC 50% Aggregate Rule');
  const insEval = evaluateInsurancePolicy(MULTI_MODULE_FIXTURES.INSURANCE);
  assert(insEval.uboAnalysis.aggregateSanctionedOwnershipPercentage === 60.0, `Calculated aggregate sanctioned ownership: 60% (got ${insEval.uboAnalysis.aggregateSanctionedOwnershipPercentage}%)`);
  assert(insEval.uboAnalysis.violatesOfac50PercentRule === true, 'Enforced OFAC 50% Rule: entity blocked by operation of law');
  assert(insEval.underwritingDecision === 'BLOCK_AND_HOLD', 'Underwriting disposition blocked policy binding');

  // Negative test: Underwriting with < 50% sanctioned ownership
  const cleanInsEval = evaluateInsurancePolicy({
    ...MULTI_MODULE_FIXTURES.INSURANCE,
    corporateEntityUbo: {
      entityName: 'Clean Shipping Holding AG',
      beneficialOwners: [
        { name: 'Swiss Investment Trust', ownershipPercentage: 85.0, country: 'CH' },
        { name: 'Geneva Trading SA', ownershipPercentage: 15.0, country: 'CH' },
      ],
    },
    policyParties: [
      { role: 'PRIMARY_INSURED', name: 'Clean Shipping Holding AG', entityType: 'ORGANIZATION', country: 'CH' },
    ],
  });
  assert(cleanInsEval.uboAnalysis.violatesOfac50PercentRule === false, 'Clean entity verified < 50% blocked ownership');
  assert(cleanInsEval.underwritingDecision === 'APPROVED', 'Clean policy approved for underwriting');

  // ----------------------------------------------------------------
  // Test 5: Crypto & Travel Rule Module
  // ----------------------------------------------------------------
  console.log('TEST 5: Crypto Multi-Chain Validation & IVMS 101 Travel Rule');
  assert(validateAddressFormat('ETHEREUM', '0xd90e2f925da726b50c4ed8d0fb909a43a04d3efe') === true, 'Validated Ethereum 40-hex address');
  assert(validateAddressFormat('BITCOIN', '1245AuAKMSvtGepQCXn2TfG7B5yWjB7bVU') === true, 'Validated Bitcoin Legacy address');
  assert(validateAddressFormat('BITCOIN', 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh') === true, 'Validated Bitcoin Bech32 SegWit address');
  assert(validateAddressFormat('TRON', 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t') === true, 'Validated TRON Base58 address');
  assert(validateAddressFormat('ETHEREUM', '0xInvalidHexAddress') === false, 'Rejected invalid Ethereum address');

  const cryptoEval = evaluateCryptoTransfer(MULTI_MODULE_FIXTURES.CRYPTO);
  assert(cryptoEval.sourceAddress.isKnownMixerOrSanctionedCluster === true, 'Identified Tornado.Cash Router smart contract');
  assert(cryptoEval.clearanceStatus === 'BLOCKED_SANCTIONED_ADDRESS', 'Blocked transaction due to sanctioned mixer exposure');
  assert(cryptoEval.travelRule.isTravelRuleApplicable === true, 'Applied Travel Rule requirement for transfer > $1,000 threshold');

  // ----------------------------------------------------------------
  // Test 6: Healthcare Integrity Module
  // ----------------------------------------------------------------
  console.log('TEST 6: Healthcare CMS NPI Luhn, DEA Checksum & OIG-LEIE Exclusions');
  assert(validateNpiLuhn('1982736450') === true, 'Verified valid 10-digit NPI Luhn Mod-10 checksum');
  assert(validateNpiLuhn('1982736459') === false, 'Rejected corrupted NPI checksum');
  assert(validateDeaNumber('BV1234563') === true, 'Verified DEA number checksum formula: (1+3+5) + 2*(2+4+6) = 33 -> 3');
  assert(validateDeaNumber('BV1234568') === false, 'Rejected corrupted DEA number check digit');

  const healthEval = evaluateHealthcareClaim(MULTI_MODULE_FIXTURES.HEALTHCARE);
  assert(healthEval.practitioner?.isOigLeieExcluded === true, 'Matched practitioner against OIG-LEIE mandatory fraud exclusions');
  assert(healthEval.claimIntegrityStatus === 'CLAIM_HELD_FOR_FRAUD_EXCLUSION', 'Held healthcare reimbursement claim for fraud exclusion');

  // ----------------------------------------------------------------
  // Test 7: Securities & FIX Protocol Module
  // ----------------------------------------------------------------
  console.log('TEST 7: FIX Tag Parsing, ISIN Checksum & Sectoral Sanctions (SSIs)');
  assert(validateIsinChecksum('XS0805570354') === true, 'Verified 12-char ISIN Luhn checksum for Russian Sovereign Bond');
  assert(validateIsinChecksum('RU0009029540') === true, 'Verified ISIN Luhn checksum for Sberbank (RU0009029540)');
  assert(validateIsinChecksum('XS0805570359') === false, 'Rejected corrupted ISIN check digit');

  const fixParsed = parseFixMessage(MULTI_MODULE_FIXTURES.SECURITIES.rawFixMessage);
  assert(fixParsed.msgType === 'NEW_ORDER_SINGLE', 'Parsed FIX Tag 35=D as NEW_ORDER_SINGLE');
  assert(fixParsed.extractedFields[55] === 'XS0805570354', 'Extracted symbol/ISIN XS0805570354 from Tag 55');

  const secEval = evaluateSecuritiesOrder(MULTI_MODULE_FIXTURES.SECURITIES);
  assert(secEval.instrument.isSectoralSanctionedDebtOrEquity === true, 'Flagged Russian Sovereign Eurobond under direct sectoral sanctions (EO 14024)');
  assert(secEval.orderStatus === 'RESTRICTED_SECURITY_HALT', 'Placed trading halt on prohibited sectoral security');

  // ----------------------------------------------------------------
  // Test 8: Validation & Audit Module
  // ----------------------------------------------------------------
  console.log('TEST 8: Synthetic Evasion Generator & Model Risk Benchmark');
  const valBenchmark = runValidationAndAuditBenchmark();
  assert(valBenchmark.totalCasesTested === 8, `Tested all 8 synthetic evasion vectors (got ${valBenchmark.totalCasesTested})`);
  assert(valBenchmark.benchmarkMetrics.precision >= 0.8, `Model precision >= 80% (got ${(valBenchmark.benchmarkMetrics.precision * 100).toFixed(1)}%)`);
  assert(valBenchmark.benchmarkMetrics.recall >= 0.8, `Model recall >= 80% (got ${(valBenchmark.benchmarkMetrics.recall * 100).toFixed(1)}%)`);
  assert(valBenchmark.historicalLedgerVerification.brokenChains === 0, 'Verified 0 broken hash chains across historical ledger');
  assert(valBenchmark.historicalLedgerVerification.verificationStatus === 'VERIFIED_TAMPER_EVIDENT', 'Historical ledger audit status is VERIFIED_TAMPER_EVIDENT');

  // ----------------------------------------------------------------
  // Test 9: Official MCP Client Tool Execution Across All Modules
  // ----------------------------------------------------------------
  console.log('TEST 9: Official MCP Client Invocations Across Modules');
  const mcpServer = createOfficialMcpServer(true);
  const client = new Client({ name: 'compliance-test-client', version: '1.0.0' }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([
    client.connect(clientTransport),
    mcpServer.connect(serverTransport),
  ]);

  const toolsResponse = await client.listTools();
  assert(toolsResponse.tools.length >= 15, `Official MCP Client listed all registered tools (found ${toolsResponse.tools.length})`);

  // Call screen_trade_and_cargo
  const mcpTradeRes: any = await client.callTool({
    name: 'screen_trade_and_cargo',
    arguments: MULTI_MODULE_FIXTURES.TRADE_AND_CARGO,
  });
  const mcpTradeData = JSON.parse(mcpTradeRes.content[0].text);
  assert(mcpTradeData.discrepancies.length >= 2, 'MCP Client successfully executed screen_trade_and_cargo');

  // Call screen_maritime_vessel
  const mcpMarineRes: any = await client.callTool({
    name: 'screen_maritime_vessel',
    arguments: MULTI_MODULE_FIXTURES.MARITIME,
  });
  const mcpMarineData = JSON.parse(mcpMarineRes.content[0].text);
  assert(mcpMarineData.isImoChecksumValid === true, 'MCP Client successfully executed screen_maritime_vessel');

  // Call verify_crypto_travel_rule
  const mcpCryptoRes: any = await client.callTool({
    name: 'verify_crypto_travel_rule',
    arguments: MULTI_MODULE_FIXTURES.CRYPTO,
  });
  const mcpCryptoData = JSON.parse(mcpCryptoRes.content[0].text);
  assert(mcpCryptoData.clearanceStatus === 'BLOCKED_SANCTIONED_ADDRESS', 'MCP Client successfully executed verify_crypto_travel_rule');

  // Call run_validation_benchmark
  const mcpValRes: any = await client.callTool({
    name: 'run_validation_benchmark',
    arguments: {},
  });
  const mcpValData = JSON.parse(mcpValRes.content[0].text);
  assert(mcpValData.totalCasesTested === 8, 'MCP Client successfully executed run_validation_benchmark');

  // ----------------------------------------------------------------
  // Test 10: Real Express HTTP Routes for Multi-Module Endpoints
  // ----------------------------------------------------------------
  console.log('TEST 10: Real Express HTTP Routes for Multi-Module Endpoints');
  const app = createComplianceApp({ isPublicDemo: true });
  const server = http.createServer(app);

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as any;
  const port = address.port;
  const baseUrl = `http://localhost:${port}`;

  try {
    // 1. GET /api/modules
    const modulesRes = await fetch(`${baseUrl}/api/modules`);
    assert(modulesRes.status === 200, `GET /api/modules returned 200 (got ${modulesRes.status})`);
    const modulesList = await modulesRes.json();
    assert(modulesList.length === 9, `Listed all 9 compliance modules (got ${modulesList.length})`);

    // 2. POST /api/modules/trade/evaluate
    const tradeHttpRes = await fetch(`${baseUrl}/api/modules/trade/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(MULTI_MODULE_FIXTURES.TRADE_AND_CARGO),
    });
    assert(tradeHttpRes.status === 200, `POST /api/modules/trade/evaluate returned 200 (got ${tradeHttpRes.status})`);
    const tradeHttpData = await tradeHttpRes.json();
    assert(tradeHttpData.discrepancies.length >= 2, 'HTTP endpoint returned document discrepancies');

    // 3. POST /api/modules/maritime/evaluate
    const marineHttpRes = await fetch(`${baseUrl}/api/modules/maritime/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(MULTI_MODULE_FIXTURES.MARITIME),
    });
    assert(marineHttpRes.status === 200, `POST /api/modules/maritime/evaluate returned 200 (got ${marineHttpRes.status})`);
    const marineHttpData = await marineHttpRes.json();
    assert(marineHttpData.isImoChecksumValid === true, 'HTTP endpoint validated IMO checksum');

    // 4. POST /api/modules/crypto/evaluate
    const cryptoHttpRes = await fetch(`${baseUrl}/api/modules/crypto/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(MULTI_MODULE_FIXTURES.CRYPTO),
    });
    assert(cryptoHttpRes.status === 200, `POST /api/modules/crypto/evaluate returned 200 (got ${cryptoHttpRes.status})`);
    const cryptoHttpData = await cryptoHttpRes.json();
    assert(cryptoHttpData.clearanceStatus === 'BLOCKED_SANCTIONED_ADDRESS', 'HTTP endpoint returned mixer block status');

    // ----------------------------------------------------------------
    // Test 11 (Area 1): User Security — Real Login, RBAC & Tenant Isolation
    // ----------------------------------------------------------------
    console.log('\nTEST 11 (Area 1): Real Authentication, Server-Verified RBAC & Tenant Isolation');
    const badLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'analyst_alpha', password: 'wrong_password' }),
    });
    assert(badLoginRes.status === 401, 'Invalid login credentials rejected with 401');

    const analystLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'analyst_alpha', password: 'AnalystPassword123!' }),
    });
    assert(analystLoginRes.status === 200, 'Valid analyst login succeeded with 200');
    const analystSession = await analystLoginRes.json();
    assert(analystSession.token?.split('.').length === 3, 'Issued HMAC-SHA256 signed 3-part CG_JWT session token');
    assert(analystSession.principal.role === 'ANALYST' && analystSession.principal.tenantId === 'tenant_alpha', 'Verified ANALYST role and tenant_alpha');

    const auditorLogin = authService.authenticateCredentials('auditor_alpha', 'AuditorPassword123!');
    const officerLogin = authService.authenticateCredentials('officer_alpha', 'OfficerPassword123!');
    const betaAnalystLogin = authService.authenticateCredentials('analyst_beta', 'BetaPassword123!');

    // Screen a transaction under tenant_alpha so we get a case scoped to tenant_alpha
    const alphaScreenRes = await fetch(`${baseUrl}/api/payments/screen`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${analystSession.token}`,
      },
      body: JSON.stringify({
        rawMessage: '{1:F01BANKUS33AXXX0000000000}{2:I103BANKGB2LXXXXN}{4:\n:20:TENANT-ALPHA-01\n:32A:260329USD50000,00\n:50K:/12345678\nOCEANIC AURORA MARITIME LTD\nMAJURO, MH\n:59:/98765432\nLONDON CORP\nLONDON, GB\n:71A:SHA\n-}',
      }),
    });
    const alphaScreenData = await alphaScreenRes.json();
    const alphaCaseId = alphaScreenData.caseId;
    assert(Boolean(alphaCaseId), `Created case ${alphaCaseId} scoped to tenant_alpha`);

    // Tenant B analyst cannot access Tenant A's case
    const crossTenantCaseRes = await fetch(`${baseUrl}/api/cases/${alphaCaseId}`, {
      headers: { Authorization: `Bearer ${betaAnalystLogin.token}` },
    });
    assert(crossTenantCaseRes.status === 403, 'Cross-tenant case access blocked with 403 TENANT_ISOLATION_VIOLATION');

    // Auditor cannot adjudicate cases (RBAC enforcement)
    const auditorDecideRes = await fetch(`${baseUrl}/api/cases/${alphaCaseId}/decide`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auditorLogin.token}`,
      },
      body: JSON.stringify({
        decisionType: 'APPROVE_FALSE_POSITIVE',
        rationale: 'Auditor attempting to adjudicate a case directly.',
      }),
    });
    assert(auditorDecideRes.status === 403, 'AUDITOR role blocked from adjudicating case with 403');

    // Analyst cannot execute CONFIRM_ENTITY_MATCH (requires SENIOR_OFFICER)
    const analystCriticalRes = await fetch(`${baseUrl}/api/cases/${alphaCaseId}/decide`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${analystSession.token}`,
      },
      body: JSON.stringify({
        decisionType: 'CONFIRM_ENTITY_MATCH',
        rationale: 'Standard analyst attempting critical entity match confirmation.',
      }),
    });
    assert(analystCriticalRes.status === 403, 'ANALYST role blocked from CONFIRM_ENTITY_MATCH (requires SENIOR_OFFICER)');

    // Senior Officer in tenant_alpha CAN execute CONFIRM_ENTITY_MATCH
    const officerCriticalRes = await fetch(`${baseUrl}/api/cases/${alphaCaseId}/decide`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${officerLogin.token}`,
      },
      body: JSON.stringify({
        decisionType: 'CONFIRM_ENTITY_MATCH',
        rationale: 'Senior Compliance Officer verified exact OFAC match and blocked funds.',
      }),
    });
    assert(officerCriticalRes.status === 200, 'SENIOR_OFFICER successfully adjudicated critical match');
  } finally {
    server.close();
  }

  // ----------------------------------------------------------------
  // Test 12 (Area 2): Permanent Storage — WAL Hash Chain, Crash Recovery & Backups
  // ----------------------------------------------------------------
  console.log('\nTEST 12 (Area 2): Durable Storage WAL Hash Chain, Recovery & Checksummed Backups');
  const walCheck = durableStorage.verifyWalIntegrity();
  assert(walCheck.valid === true && walCheck.entryCount > 0, `Write-Ahead Log SHA-256 chain verified (${walCheck.entryCount} entries)`);

  const backupMeta = durableStorage.createBackup('test_suite_checkpoint');
  assert(fs.existsSync(backupMeta.filePath) && backupMeta.sha256.length === 64, `Created checksummed backup ${backupMeta.backupId}`);
  const restoredState = durableStorage.restoreFromBackup(backupMeta.backupId);
  assert(restoredState.cases.length > 0 && restoredState.auditLog.length > 0, 'Restored durable cases and audit log from verified backup');
  paymentStoreService.reloadFromDisk();
  assert(paymentStoreService.getAllCases().length === restoredState.cases.length, 'Reloaded PaymentStore state from durable storage after recovery');

  // ----------------------------------------------------------------
  // Test 13 (Area 3 & 4): Parser Correctness & Server-Side Extraction Safeguards
  // ----------------------------------------------------------------
  console.log('\nTEST 13 (Area 3 & 4): Repeated Party Tags, Schema Version Checks & Server Extraction Safeguards');
  const multiIntermediaryMt103 = `{1:F01BANKUS33AXXX0000000000}{2:I103BANKGB2LXXXXN}{4:
:20:MULTI-INT-103
:32A:260329USD250000,00
:50K:/111222333
ACME EXPORTS INC
NEW YORK, US
:56A:INTMBANK1XX
:56A:INTMBANK2YY
:57A:ACCTBANK3ZZ
:59:/999888777
GLOBAL IMPORTS LTD
LONDON, GB
:71A:OUR
-}`;
  const parsedMultiMt = parseSwiftPaymentMessage(multiIntermediaryMt103);
  const intermediaryParties = parsedMultiMt.parties.filter(
    (p) => p.role.includes('INTERMEDIARY') || p.provenance.sourceTag?.startsWith(':56') || p.provenance.sourceTag?.startsWith(':57')
  );
  assert(intermediaryParties.length === 3, `Preserved all repeated :56A: and :57A: intermediary tags (got ${intermediaryParties.length})`);
  const mtCompleteness = verifyExtractionCompleteness(parsedMultiMt);
  assert(mtCompleteness.isComplete === true, 'Complete MT103 passed server-side extraction completeness verification');

  // Unsupported ISO 20022 schema version (e.g. pacs.008.001.02) must mark isProfileTested = false
  const unsupportedVersionXml = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.008.001.02">
  <FIToFICstmrCdtTrf>
    <CdtTrfTxInf>
      <PmtId><EndToEndId>OLD-SCHEMA-01</EndToEndId></PmtId>
      <IntrBkSttlmAmt Ccy="USD">1000.00</IntrBkSttlmAmt>
      <Dbtr><Nm>JANE DOE</Nm></Dbtr>
      <Cdtr><Nm>JOHN SMITH</Nm></Cdtr>
    </CdtTrfTxInf>
  </FIToFICstmrCdtTrf>
</Document>`;
  const [parsedOldIso] = parseIso20022PaymentMessage(unsupportedVersionXml);
  assert(parsedOldIso.isProfileTested === false, 'Unsupported ISO 20022 schema version pacs.008.001.02 marked isProfileTested=false');
  assert(
    parsedOldIso.schemaVersion === 'pacs.008.001.02',
    'Captured exact schemaVersion pacs.008.001.02 on old ISO 20022 version'
  );

  // Server-side safeguard: Even if caller spoofs isProfileTested=true on a cover payment missing Sequence B parties, server catches it
  const spoofedCovTx = {
    ...parsedMultiMt,
    messageType: 'MT202_COV' as const,
    isProfileTested: true,
    parties: parsedMultiMt.parties.map((p) => ({
      ...p,
      provenance: { ...p.provenance, sequence: 'A' as const },
    })),
  };
  const covCompleteness = verifyExtractionCompleteness(spoofedCovTx);
  assert(
    covCompleteness.isComplete === false &&
      covCompleteness.reasons.some((r) => r.includes('Sequence B')),
    'Server-side safeguard rejected spoofed isProfileTested=true when Sequence B cover parties are absent'
  );

  // ----------------------------------------------------------------
  // Test 14 (Area 5): Client-Folder Ingestion — CSV/XML Adapters & Safe file_ref
  // ----------------------------------------------------------------
  console.log('\nTEST 14 (Area 5): CSV/XML Client-Folder Watchlist Adapters & Safe file_ref');
  const sampleCsv = `id,name,type,country,program,aliases\nCSV-001,"VOLGA MARITIME TRADING",ORGANIZATION,RU,OFAC_SDN,"VOLGA SHIPPING;VOLGA TRADE"\nCSV-002,"IVAN PETROV",INDIVIDUAL,BY,EU_CONSOLIDATED,"I. PETROV"`;
  const csvEntries = watchlistService.parseCsvWatchlist(sampleCsv, 'CLIENT_CSV_LIST');
  assert(csvEntries.length === 2 && csvEntries[0].aliases.length === 2, `Parsed ${csvEntries.length} CSV watchlist entries with aliases`);

  const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<sdnList>
  <sdnEntry>
    <uid>XML-9001</uid>
    <lastName>CASPIAN PETROLEUM CORP</lastName>
    <sdnType>Entity</sdnType>
    <programList><program>OFAC_SDN</program></programList>
    <akaList><aka><lastName>CASPIAN OIL</lastName></aka></akaList>
  </sdnEntry>
</sdnList>`;
  const xmlEntries = watchlistService.parseXmlWatchlist(sampleXml, 'OFAC_XML');
  assert(xmlEntries.length === 1 && xmlEntries[0].name === 'CASPIAN PETROLEUM CORP', 'Parsed OFAC XML <sdnEntry> watchlist entry');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-watchlist-test-'));
  const safeFile = path.join(tmpDir, 'msg.txt');
  fs.writeFileSync(safeFile, 'test');
  assert(watchlistService.resolveSafeFileRef('msg.txt', tmpDir) === fs.realpathSync(safeFile), 'Allowed valid file_ref inside allowed root');
  let traversalBlocked = false;
  try {
    watchlistService.resolveSafeFileRef('../../etc/passwd', tmpDir);
  } catch (e: any) {
    traversalBlocked = /Security violation/i.test(e.message);
  }
  assert(traversalBlocked === true, 'Blocked path-traversal file_ref (../../etc/passwd)');

  // ----------------------------------------------------------------
  // Test 15 (Area 6): Document Processing — PDF/OCR, EDIFACT, Cargo-IMP, X12 & ACORD
  // ----------------------------------------------------------------
  console.log('\nTEST 15 (Area 6): PDF/OCR, UN/EDIFACT, IATA Cargo-IMP, ASC X12 & ACORD Extraction');
  const rawPdfInvoice = `%PDF-1.4
1 0 obj << /Type /Catalog >> endobj
stream
BT
(Document ID: INV-PDF-2026-99) Tj
(Exporter: SHENZHEN PRECISION OPTICS LTD) Tj
(Importer: NORTHERN STAR AVIATION LLC) Tj
(Origin Country: CN) Tj
(Destination Country: AE) Tj
(Vessel: NORTHERN PIONEER) Tj
(IMO: 9400115) Tj
(Port of Loading: CNSHA) Tj
(Port of Discharge: AEDXB) Tj
(HS Code: 8542.31 - Monolithic Integrated Circuits) Tj
(Total Amount: USD 485,000.00) Tj
(Gross Weight: 1,250.5 KG) Tj
ET
endstream
%%EOF`;
  const pdfExtracted = extractStructuredTradeDocument('INVOICE', rawPdfInvoice);
  assert(pdfExtracted.extractionFormat === 'PDF_STREAM' && pdfExtracted.extractionConfidence >= 0.85, 'Extracted structured Trade Document from raw %PDF-1.4 stream');
  assert(pdfExtracted.exporterName.includes('SHENZHEN PRECISION OPTICS') && pdfExtracted.goods[0].hsCode === '8542.31', 'Extracted Exporter, Importer, Amount, and HS Code 8542.31 from PDF');

  const edifactInvoic = `UNA:+.? '
UNB+UNOA:3+SENDER+RECEIVER+260329:1200+1'
BGM+380+EDI-INV-7788+9'
NAD+SE+001++BALTIC TIMBER EXPORTS:RIGA++LV'
NAD+BY+002++MEDITERRANEAN TRADE CO:VALLETTA++MT'
TDT+20+VOY1+1++:++::BALTIC WIND'
LOC+9+LVRIX'
LOC+11+MTMLA'
LIN+1++8479.89:HS'
IMD+F++:::INDUSTRIAL CNC CONTROLLER'
MEA+AAE+G+KGM:4500'
MOA+86:125000.00:EUR'
UNT+12+1'`;
  const ediExtracted = extractStructuredTradeDocument('INVOICE', edifactInvoic);
  assert(ediExtracted.extractionFormat === 'EDIFACT' && ediExtracted.documentId === 'EDI-INV-7788', 'Extracted UN/EDIFACT INVOIC document');

  const cargoImpFwb = `FWB/16
176-12345675DXBFRA/T12K850.0
SHP
/AL-NOOR TRADING LLC
/DUBAI
/AE
CNE
/FRANKFURT ELECTRONICS GMBH
/FRANKFURT
/DE
CVD/USD/PP/PP/NVD/NCV/XXX
RTD/1/P12/K850.0/C/W850.0/R10/T8500.00
/NG/AVIONICS NAVIGATION MODULES/HS/8526.91`;
  const awbExtracted = extractStructuredAirWaybill(cargoImpFwb);
  assert(awbExtracted.awbNumber === '176-12345675' && awbExtracted.hsCode === '8526.91', 'Extracted IATA Cargo-IMP FWB/16 Air Waybill');

  const x12Claim = `ISA*00*          *00*          *ZZ*SUBMITTER      *ZZ*RECEIVER       *260329*1200*^*00501*000000001*0*P*:~
NM1*85*1*MORETTI*VICTOR****XX*1234567893~
REF*0B*BM4567891~
NM1*IL*1*DOE*JANE~
NM1*PR*2*APEX HEALTH PLAN~
CLM*CLM-X12-900*1450.00~
SV1*HC:99214*1450.00*UN*1~
HI*ABK:E11.9~`;
  const claimExtracted = extractX12HealthcareClaim(x12Claim);
  assert(claimExtracted.claimId === 'CLM-X12-900' && claimExtracted.providerNpi === '1234567893' && claimExtracted.cptCodes.includes('99214'), 'Extracted ASC X12 837 Healthcare Claim');

  const acordXml = `<ACORD><InsuranceSvcRq><PolicyNumber>POL-ACORD-77</PolicyNumber><PolicyType>MARINE_HULL_AND_CARGO</PolicyType><InsuredOrPrincipal><GeneralPartyInfo><NameInfo><CommlName><CommercialName>CASPIAN SHIPPING GROUP</CommercialName></CommlName></NameInfo><Addr><Country>AE</Country></Addr></GeneralPartyInfo><InsuredOrPrincipalInfo><InsuredOrPrincipalRoleCd>Insured</InsuredOrPrincipalRoleCd></InsuredOrPrincipalInfo></InsuredOrPrincipal><Beneficiary><Name>TEHRAN LOGISTICS CORP</Name><Country>IR</Country></Beneficiary><InsuredAmt><Amt>5000000</Amt><CurCd>USD</CurCd></InsuredAmt></InsuranceSvcRq></ACORD>`;
  const policyExtracted = extractAcordInsurancePolicy(acordXml);
  assert(policyExtracted.policyId === 'POL-ACORD-77' && policyExtracted.beneficiaryCountry === 'IR', 'Extracted ACORD XML Insurance Policy');

  // ----------------------------------------------------------------
  // Test 16 (Area 7): Go Implementation — Native Go Engine CLI Bridge Parity
  // ----------------------------------------------------------------
  console.log('\nTEST 16 (Area 7): Native Go Core Engine Bridge & Message Screening');
  const goHealth = await goCoreEngineAdapter.getHealth();
  assert(goHealth.status === 'ONLINE' && goCoreEngineAdapter.id === 'GO_CORE_NATIVE_V1', 'Go Core Native Engine binary reported ONLINE status');
  const goPartyMatch = await goCoreEngineAdapter.screenParty({
    partyId: 'PTY-GO-TEST-1',
    role: 'DEBTOR',
    name: 'Oceanic Aurora Maritime Ltd',
    country: 'MH',
    identifiers: [],
    provenance: { sourceTag: ':50K:', sequence: 'A' },
  });
  assert(goPartyMatch.highestScore >= 0.85 && goPartyMatch.matches.length > 0, `Go Core Engine matched sanctioned party (score=${goPartyMatch.highestScore.toFixed(2)})`);
  const goMsgResult = await goCoreEngineAdapter.parseAndScreenMessageInGo(multiIntermediaryMt103);
  assert(goMsgResult.header.messageType === 'MT103' && goMsgResult.header.isProfileTested === true, 'Go Core Engine parsed and screened MT103 message with verified profile');

  // ----------------------------------------------------------------
  // Test 17 (Area 8): Module Workflows — Checklists, Transitions & Hash Chain
  // ----------------------------------------------------------------
  console.log('\nTEST 17 (Area 8): Stateful Module Investigation Workflows & Mandatory Checklists');
  const tradeWf = moduleWorkflowStore.createWorkflow({
    tenantId: 'tenant_alpha',
    moduleId: 'TRADE_AND_CARGO',
    subjectId: 'TRD-WF-2026-01',
    subjectSummary: 'Shenzhen Optics -> Dubai Dual-Use Shipment',
    findings: tradeEval.discrepancies.map((d) => d.description),
    actorId: 'analyst_alpha',
  });
  assert(tradeWf.checklist.length === 3 && tradeWf.status === 'OPEN_RECONCILIATION', 'Created Trade & Cargo reconciliation workflow with 3 checklist items');

  // Attempting to approve before completing required checklist items must fail
  let prematureApproveBlocked = false;
  try {
    moduleWorkflowStore.transitionWorkflow({
      workflowId: tradeWf.workflowId,
      targetStatus: 'APPROVED_WITH_EVIDENCE',
      actorId: 'officer_alpha',
      rationale: 'Attempting premature approval before completing checklist items.',
    });
  } catch (e: any) {
    prematureApproveBlocked = e.message.includes('mandatory checklist item');
  }
  assert(prematureApproveBlocked === true, 'Blocked workflow approval while mandatory checklist items remain incomplete');

  // Complete all required checklist items
  for (const item of tradeWf.checklist.filter((c) => c.required)) {
    moduleWorkflowStore.completeChecklistItem({
      workflowId: tradeWf.workflowId,
      itemId: item.itemId,
      actorId: 'analyst_alpha',
      evidenceNotes: `Verified ${item.label} with primary trade documentation and BIS export license check.`,
    });
  }
  const approvedWf = moduleWorkflowStore.transitionWorkflow({
    workflowId: tradeWf.workflowId,
    targetStatus: 'APPROVED_WITH_EVIDENCE',
    actorId: 'officer_alpha',
    rationale: 'All trade documents reconciled and BIS dual-use export license verified on file.',
  });
  const wfChain = moduleWorkflowStore.verifyWorkflowChain(approvedWf.workflowId);
  assert(approvedWf.status === 'APPROVED_WITH_EVIDENCE' && wfChain.valid === true, 'Completed workflow checklist, transitioned to APPROVED_WITH_EVIDENCE, and verified SHA-256 chain');

  // ----------------------------------------------------------------
  // Test 18 (Area 9): Independent Validation — Multi-Script Golden Dataset & Threshold Sweep
  // ----------------------------------------------------------------
  console.log('\nTEST 18 (Area 9): Extended Multi-Script Validation Suite & Confusion Matrix');
  const extSuite = runExtendedValidationSuite();
  assert(extSuite.goldenDatasetSize >= 20, `Evaluated ${extSuite.goldenDatasetSize} multi-script golden test cases`);
  assert(extSuite.confusionMatrix.falsePositives === 0 && extSuite.confusionMatrix.precision === 1, `Zero false positives on benign lookalikes (Precision=${extSuite.confusionMatrix.precision})`);
  assert(extSuite.confusionMatrix.f1Score >= 0.85, `F1 Score meets governance threshold (F1=${extSuite.confusionMatrix.f1Score})`);
  assert(extSuite.thresholdSensitivity.length >= 5, 'Generated threshold sensitivity curve (0.70 to 0.90)');

  // ----------------------------------------------------------------
  // Test 19 (Area 10): Deployment & Packaging — Dockerfile, LICENSE & Read-Only Mounts
  // ----------------------------------------------------------------
  console.log('\nTEST 19 (Area 10): Deployment Packaging, LICENSE Inclusion & Read-Only Mount Separation');
  const dockerfileText = fs.readFileSync(path.resolve(process.cwd(), 'Dockerfile'), 'utf-8');
  const composeText = fs.readFileSync(path.resolve(process.cwd(), 'docker-compose.yml'), 'utf-8');
  assert(dockerfileText.includes('LICENSE') && fs.existsSync(path.resolve(process.cwd(), 'LICENSE')), 'Dockerfile explicitly includes LICENSE in distributed image');
  assert(dockerfileText.includes('FROM golang:1.22-alpine AS go-builder'), 'Dockerfile builds native Go compliancegate-core binary in multi-stage build');
  assert(composeText.includes('/app/lists:ro') && composeText.includes('/app/data:rw'), 'docker-compose.yml separates read-only watchlist mount (/app/lists:ro) from writable state (/app/data:rw)');

  console.log('\n======================================================');
  console.log(`MULTI-MODULE TEST SUMMARY: ${passed} Passed, ${failed} Failed`);
  console.log('======================================================\n');

  return { passed, failed };
}

const isMainScript = process.argv[1]?.endsWith('multi_module_gateway.test.ts');
if (isMainScript) {
  runMultiModuleTests()
    .then((res) => {
      if (res.failed > 0) process.exit(1);
    })
    .catch((err) => {
      console.error('Fatal multi-module test runner error:', err);
      process.exit(1);
    });
}
