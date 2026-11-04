/**
 * @license
 * SPDX-License-Identifier: MIT
 *
 * Trade and Cargo UAT Independent Test Verification & Regression Suite
 *
 * Verifies all 14 targeted acceptance checks from the independent review:
 * 1. Sample identifies port and weight discrepancy plus goods candidate (PASS)
 * 2. Consistent ordinary-goods presentation passes (PASS)
 * 3. Payment amount mismatch prevents verification (PASS)
 * 4. Payment currency mismatch prevents verification (FAIL -> FIXED)
 * 5. Buyer-consignee mismatch reported (FAIL -> FIXED)
 * 6. Different payment parties reported and screened (FAIL -> FIXED)
 * 7. Blank seller and shipper prevent verification (FAIL -> FIXED)
 * 8. Negative amounts and quantities rejected (FAIL -> FIXED)
 * 9. Line totals inconsistent with invoice reported (FAIL -> FIXED)
 * 10. Missing comparison documents marked incomplete (FAIL -> FIXED)
 * 11. Empty request rejected with client error (PASS)
 * 12. Missing countries prevent verification (FAIL -> FIXED)
 * 13. Transport cargo description checked for controlled-goods candidates (FAIL -> FIXED)
 * 14. MCP trade tool accepts complete presentation & returns structured evaluation (PASS)
 */

import { evaluateTradeAndCargo, EvaluateTradeRequest } from '../server/services/modules/tradeAndCargoService.ts';
import { executeMcpTool } from '../server/mcpServer.ts';
import { MULTI_MODULE_FIXTURES } from '../server/services/syntheticFixtures.ts';

let passCount = 0;
let failCount = 0;

function assert(condition: boolean, msg: string): void {
  if (!condition) {
    failCount++;
    throw new Error(`[ASSERTION FAILED] ${msg}`);
  }
  passCount++;
}

// Helper to clone clean fixture
function getCleanTradeFixture(): EvaluateTradeRequest {
  return {
    invoice: {
      invoiceNumber: 'INV-CLEAN-2026-001',
      date: '2026-11-02',
      sellerName: 'Nordic Clean Engineering AS',
      sellerCountry: 'NO',
      buyerName: 'Global Clean Logistics Ltd',
      buyerCountry: 'GB',
      totalAmount: 100000.0,
      currency: 'USD',
      portOfLoading: 'Oslo Commercial Harbour',
      portOfDischarge: 'Port of Felixstowe',
      lineItems: [
        {
          description: 'Standard civil industrial pump bearings',
          hsCode: '8482.10',
          quantity: 100,
          unitPrice: 500.0,
          amount: 50000.0,
        },
        {
          description: 'Hydraulic conveyor replacement parts',
          hsCode: '8431.39',
          quantity: 100,
          unitPrice: 500.0,
          amount: 50000.0,
        },
      ],
    },
    billOfLading: {
      blNumber: 'BL-CLEAN-998877',
      blType: 'OCEAN_BILL_OF_LADING',
      carrierName: 'Maersk Line A/S',
      shipperName: 'Nordic Clean Engineering AS',
      consigneeName: 'Global Clean Logistics Ltd',
      portOfLoading: 'Oslo Commercial Harbour',
      portOfDischarge: 'Port of Felixstowe',
      vesselName: 'M/V CLEAN TRADER',
      grossWeightKg: 12500,
      cargoDescription: 'Standard civil industrial machinery parts',
    },
    packingList: {
      packingListNumber: 'PKL-CLEAN-001',
      totalGrossWeightKg: 12500,
      totalNetWeightKg: 11800,
      packageCount: 20,
    },
    paymentInstruction: {
      paymentRef: 'PMT-CLEAN-001',
      amount: 100000.0,
      currency: 'USD',
      remitterName: 'Global Clean Logistics Ltd',
      beneficiaryName: 'Nordic Clean Engineering AS',
    },
  };
}

export async function runTradeCargoUatSuite(): Promise<{ passed: number; failed: number }> {
  passCount = 0;
  failCount = 0;
  console.log('================================================================');
  console.log(' RUNNING TRADE AND CARGO UAT REMEDIATION TEST SUITE');
  console.log('================================================================');

  // ---------------------------------------------------------------------------
  // Check 1: Sample identifies port and weight discrepancy plus goods candidate
  // ---------------------------------------------------------------------------
  console.log('\n[CHECK 1] Sample Fixture Discrepancy & Dual-Use Candidate Identification');
  const sampleRes = evaluateTradeAndCargo(MULTI_MODULE_FIXTURES.TRADE_AND_CARGO as any);
  assert(sampleRes.discrepancies.some((d) => d.category === 'PORT_INCONSISTENCY'), 'Identified port inconsistency (Jebel Ali vs Bandar Abbas)');
  assert(sampleRes.discrepancies.some((d) => d.category === 'WEIGHT_DISCREPANCY'), 'Identified gross weight discrepancy (B/L 14200kg vs PKL 16800kg)');
  assert(sampleRes.dualUseGoods.some((g) => g.proliferationCategory === 'NUCLEAR'), 'Identified dual-use nuclear centrifuge rotor component');
  assert(sampleRes.passedVerification === false, 'Sample with discrepancies correctly fails automated verification');

  // ---------------------------------------------------------------------------
  // Check 2: Consistent ordinary-goods presentation passes
  // ---------------------------------------------------------------------------
  console.log('\n[CHECK 2] Consistent Ordinary-Goods Presentation (Positive Control)');
  const cleanReq = getCleanTradeFixture();
  const cleanRes = evaluateTradeAndCargo(cleanReq);
  assert(cleanRes.discrepancies.length === 0, `Clean presentation has 0 discrepancies (got ${cleanRes.discrepancies.length})`);
  assert(cleanRes.dualUseGoods.length === 0, 'Clean presentation has 0 dual-use hits');
  assert(cleanRes.findingSeverity === 'NO_MATCH_FOUND', 'Clean presentation has NO_MATCH_FOUND on sanctions');
  assert(cleanRes.completenessStatus === 'FULL_PRESENTATION', 'Clean presentation has completenessStatus=FULL_PRESENTATION');
  assert(cleanRes.passedVerification === true, 'Clean ordinary goods presentation successfully passes verification');
  assert(cleanRes.decisionRecommendation === 'APPROVE_FINANCING', 'Clean presentation recommendation is APPROVE_FINANCING');

  // ---------------------------------------------------------------------------
  // Check 3: Payment amount mismatch prevents verification
  // ---------------------------------------------------------------------------
  console.log('\n[CHECK 3] Payment Amount Mismatch');
  const amtMismatchReq = getCleanTradeFixture();
  amtMismatchReq.paymentInstruction!.amount = 90000.0; // Invoice is 100000.0
  const amtMismatchRes = evaluateTradeAndCargo(amtMismatchReq);
  assert(amtMismatchRes.discrepancies.some((d) => d.category === 'PRICE_OR_VALUE' && d.severity === 'CRITICAL' && d.description.includes('Amount mismatch')), 'Reported critical amount mismatch');
  assert(amtMismatchRes.passedVerification === false, 'Amount mismatch strictly prevents verification');

  // ---------------------------------------------------------------------------
  // Check 4: Payment currency mismatch prevents verification (FIXED)
  // ---------------------------------------------------------------------------
  console.log('\n[CHECK 4] Payment Currency Mismatch (USD 100 vs EUR 100)');
  const ccyMismatchReq = getCleanTradeFixture();
  ccyMismatchReq.invoice.totalAmount = 100.0;
  ccyMismatchReq.invoice.currency = 'USD';
  ccyMismatchReq.invoice.lineItems = [{ description: 'Civil goods', quantity: 1, unitPrice: 100.0, amount: 100.0 }];
  ccyMismatchReq.paymentInstruction!.amount = 100.0; // Same number 100
  ccyMismatchReq.paymentInstruction!.currency = 'EUR'; // Different currency EUR
  const ccyMismatchRes = evaluateTradeAndCargo(ccyMismatchReq);
  assert(
    ccyMismatchRes.discrepancies.some((d) => d.category === 'PRICE_OR_VALUE' && d.severity === 'CRITICAL' && d.description.includes('Currency mismatch')),
    'Reported critical currency mismatch between USD and EUR'
  );
  assert(ccyMismatchRes.passedVerification === false, 'Currency mismatch strictly prevents verification (amounts cannot be silently equated)');

  // ---------------------------------------------------------------------------
  // Check 5: Buyer-consignee mismatch reported (FIXED)
  // ---------------------------------------------------------------------------
  console.log('\n[CHECK 5] Buyer vs Consignee Reconciliation');
  const buyerMismatchReq = getCleanTradeFixture();
  buyerMismatchReq.invoice.buyerName = 'DEMO CLEAN BUYER XQ';
  // B/L consignee remains Global Clean Logistics Ltd
  const buyerMismatchRes = evaluateTradeAndCargo(buyerMismatchReq);
  assert(
    buyerMismatchRes.discrepancies.some((d) => d.category === 'PARTY_MISMATCH' && d.description.includes('Consignee on Bill of Lading') && d.description.includes('does not match Buyer')),
    'Reported B/L Consignee vs Invoice Buyer party mismatch'
  );

  // ---------------------------------------------------------------------------
  // Check 6: Different payment parties reported and screened (FIXED)
  // ---------------------------------------------------------------------------
  console.log('\n[CHECK 6] Payment Counterparties Reconciliation & Screening');
  const pmtPartyMismatchReq = getCleanTradeFixture();
  pmtPartyMismatchReq.paymentInstruction!.remitterName = 'Third Party Unknown Remitter Corp';
  pmtPartyMismatchReq.paymentInstruction!.beneficiaryName = 'Offshore Intermediary Payee Ltd';
  const pmtPartyRes = evaluateTradeAndCargo(pmtPartyMismatchReq);

  // Reconciled mismatches
  assert(
    pmtPartyRes.discrepancies.some((d) => d.category === 'PARTY_MISMATCH' && d.description.includes('Payment Instruction Remitter') && d.description.includes('Third-Party Settlement Risk')),
    'Reported Payment Remitter vs Invoice Buyer mismatch'
  );
  assert(
    pmtPartyRes.discrepancies.some((d) => d.category === 'PARTY_MISMATCH' && d.description.includes('Payment Instruction Beneficiary') && d.description.includes('Third-Party Payee Risk')),
    'Reported Payment Beneficiary vs Invoice Seller mismatch'
  );

  // Screened payment counterparties
  assert(pmtPartyRes.parties.some((p) => p.role === 'PAYMENT_REMITTER' && p.name === 'Third Party Unknown Remitter Corp' && p.isScreened), 'Screened PAYMENT_REMITTER party against sanctions engine');
  assert(pmtPartyRes.parties.some((p) => p.role === 'PAYMENT_BENEFICIARY' && p.name === 'Offshore Intermediary Payee Ltd' && p.isScreened), 'Screened PAYMENT_BENEFICIARY party against sanctions engine');

  // ---------------------------------------------------------------------------
  // Check 7: Blank seller and shipper prevent verification & marked INCOMPLETE (FIXED)
  // ---------------------------------------------------------------------------
  console.log('\n[CHECK 7] Blank Seller and Shipper Validation & INCOMPLETE Status');
  const blankSellerReq = getCleanTradeFixture();
  blankSellerReq.invoice.sellerName = '';
  blankSellerReq.billOfLading.shipperName = '   ';
  const blankSellerRes = evaluateTradeAndCargo(blankSellerReq);
  assert(
    blankSellerRes.discrepancies.some((d) => d.severity === 'CRITICAL' && d.description.includes('Seller/Exporter name is missing or blank')),
    'Critical discrepancy for blank invoice seller'
  );
  assert(
    blankSellerRes.discrepancies.some((d) => d.severity === 'CRITICAL' && d.description.includes('Shipper name is missing or blank')),
    'Critical discrepancy for blank B/L shipper'
  );
  assert(blankSellerRes.passedVerification === false, 'Blank seller/shipper strictly prevents verification');
  const blankSellerParty = blankSellerRes.parties.find((p) => p.role === 'EXPORTER_SELLER');
  assert(
    blankSellerParty !== undefined && blankSellerParty.status === 'INCOMPLETE_NOT_SCREENED' && blankSellerParty.isScreened === false,
    'Blank seller is explicitly marked INCOMPLETE_NOT_SCREENED (never falsely marked CLEAR)'
  );

  // ---------------------------------------------------------------------------
  // Check 8: Negative amounts and quantities rejected (FIXED)
  // ---------------------------------------------------------------------------
  console.log('\n[CHECK 8] Negative Amounts and Quantities Rejection');
  const negativeReq = getCleanTradeFixture();
  negativeReq.invoice.totalAmount = -100.0;
  negativeReq.paymentInstruction!.amount = -100.0;
  negativeReq.invoice.lineItems[0].quantity = -5;
  const negativeRes = evaluateTradeAndCargo(negativeReq);
  assert(
    negativeRes.discrepancies.some((d) => d.severity === 'CRITICAL' && d.description.includes('total amount must be a positive finite number')),
    'Rejected negative invoice total amount'
  );
  assert(
    negativeRes.discrepancies.some((d) => d.severity === 'CRITICAL' && d.description.includes('Payment instruction amount must be a positive')),
    'Rejected negative payment instruction amount'
  );
  assert(
    negativeRes.discrepancies.some((d) => d.severity === 'CRITICAL' && d.description.includes('invalid quantity (-5)')),
    'Rejected negative line item quantity'
  );
  assert(negativeRes.passedVerification === false, 'Negative values strictly prevent verification');

  // ---------------------------------------------------------------------------
  // Check 9: Line totals inconsistent with invoice reported (FIXED)
  // ---------------------------------------------------------------------------
  console.log('\n[CHECK 9] Line Totals Arithmetic Inconsistency (999 line vs 100 invoice)');
  const lineInconsistentReq = getCleanTradeFixture();
  lineInconsistentReq.invoice.totalAmount = 100.0;
  lineInconsistentReq.invoice.lineItems = [
    { description: 'Inconsistent Item', quantity: 1, unitPrice: 999.0, amount: 999.0 },
  ];
  lineInconsistentReq.paymentInstruction!.amount = 100.0;
  const lineInconsistentRes = evaluateTradeAndCargo(lineInconsistentReq);
  assert(
    lineInconsistentRes.discrepancies.some((d) => d.severity === 'CRITICAL' && d.description.includes('line item sum (999.00)') && d.description.includes('does not match invoice total amount (100.00)')),
    'Critical discrepancy for line items sum (999) vs invoice total (100)'
  );
  assert(lineInconsistentRes.passedVerification === false, 'Arithmetic inconsistency strictly prevents verification');

  // Check line unit price * quantity mismatch
  const lineMultMismatchReq = getCleanTradeFixture();
  lineMultMismatchReq.invoice.lineItems[0] = {
    description: 'Bad Math Item',
    quantity: 10,
    unitPrice: 50.0, // 10 * 50 = 500
    amount: 1200.0, // Fabricated amount 1200
  };
  lineMultMismatchReq.invoice.totalAmount = 1250.0;
  const lineMultRes = evaluateTradeAndCargo(lineMultMismatchReq);
  assert(
    lineMultRes.discrepancies.some((d) => d.severity === 'CRITICAL' && d.description.includes('Line item arithmetic discrepancy')),
    'Identified quantity × unit price arithmetic discrepancy'
  );

  // ---------------------------------------------------------------------------
  // Check 10: Missing comparison documents marked incomplete (FIXED)
  // ---------------------------------------------------------------------------
  console.log('\n[CHECK 10] Missing Comparison Documents (Partial Presentation)');
  const partialReq: EvaluateTradeRequest = {
    invoice: cleanReq.invoice,
    billOfLading: cleanReq.billOfLading,
    // packingList omitted
    // paymentInstruction omitted
  };
  const partialRes = evaluateTradeAndCargo(partialReq);
  assert(partialRes.completenessStatus === 'PARTIAL_PRESENTATION', 'Completeness status is PARTIAL_PRESENTATION');
  assert(partialRes.comparisonsPerformed.transportVsPackingList === false, 'transportVsPackingList is false');
  assert(partialRes.comparisonsPerformed.invoiceVsPayment === false, 'invoiceVsPayment is false');
  assert(partialRes.comparisonsPerformed.omittedComparisons.length === 2, 'Records 2 omitted comparisons');
  assert(
    partialRes.discrepancies.some((d) => d.category === 'MISSING_MANDATORY_DOC' && d.description.includes('Packing list omitted')),
    'Discrepancy for omitted packing list'
  );
  assert(
    partialRes.discrepancies.some((d) => d.category === 'MISSING_MANDATORY_DOC' && d.description.includes('Payment instruction omitted')),
    'Discrepancy for omitted payment instruction'
  );
  assert(partialRes.passedVerification === false, 'Partial presentation strictly fails verification (missing comparison documents cannot silently pass)');
  assert(partialRes.requiresHumanReview === true, 'Partial presentation requires human review');

  // ---------------------------------------------------------------------------
  // Check 11: Empty request rejected with client error
  // ---------------------------------------------------------------------------
  console.log('\n[CHECK 11] Malformed Empty Request Client Error');
  let emptyReqRejected = false;
  try {
    evaluateTradeAndCargo(null as any);
  } catch (err: any) {
    emptyReqRejected = err.message.includes('Invalid trade evaluation request');
  }
  assert(emptyReqRejected, 'Rejected null request with clear client error');

  let missingInvoiceRejected = false;
  try {
    evaluateTradeAndCargo({ billOfLading: cleanReq.billOfLading } as any);
  } catch (err: any) {
    missingInvoiceRejected = err.message.includes('missing mandatory "invoice"');
  }
  assert(missingInvoiceRejected, 'Rejected missing invoice with clear client error');

  // ---------------------------------------------------------------------------
  // Check 12: Missing countries prevent verification (FIXED)
  // ---------------------------------------------------------------------------
  console.log('\n[CHECK 12] Missing Country Validation');
  const missingCountryReq = getCleanTradeFixture();
  missingCountryReq.invoice.sellerCountry = '';
  missingCountryReq.invoice.buyerCountry = 'UNKNOWN';
  const missingCountryRes = evaluateTradeAndCargo(missingCountryReq);
  assert(
    missingCountryRes.discrepancies.some((d) => d.severity === 'CRITICAL' && d.description.includes('Seller/Exporter country could not be established')),
    'Critical discrepancy for missing seller country'
  );
  assert(
    missingCountryRes.discrepancies.some((d) => d.severity === 'CRITICAL' && d.description.includes('Buyer/Importer country could not be established')),
    'Critical discrepancy for UNKNOWN buyer country'
  );
  assert(missingCountryRes.passedVerification === false, 'Missing countries strictly prevent verification');

  // ---------------------------------------------------------------------------
  // Check 13: Transport cargo description checked for controlled-goods candidates (FIXED)
  // ---------------------------------------------------------------------------
  console.log('\n[CHECK 13] Transport Cargo Description Dual-Use Goods Check');
  const blControlledReq = getCleanTradeFixture();
  // Line items are completely benign/clean
  blControlledReq.invoice.lineItems = [
    { description: 'Standard industrial steel pipes', hsCode: '7304.19', quantity: 50, unitPrice: 2000.0, amount: 100000.0 },
  ];
  // Controlled good placed ONLY in B/L cargoDescription
  blControlledReq.billOfLading.cargoDescription = 'Consolidated container containing centrifuge rotor components and industrial parts';
  const blControlledRes = evaluateTradeAndCargo(blControlledReq);
  assert(blControlledRes.dualUseGoods.length >= 1, 'Detected dual-use trigger in transport cargo description');
  const blHit = blControlledRes.dualUseGoods.find((g) => g.sourceDocument === 'Bill of Lading');
  assert(blHit !== undefined, 'Dual-use hit explicitly records sourceDocument: "Bill of Lading"');
  assert(blHit!.proliferationCategory === 'NUCLEAR', 'Hit classified as NUCLEAR');
  assert(blHit!.assessmentCandidateNote.includes('keyword "centrifuge" in Bill of Lading'), 'Assessment candidate note describes source keyword and document');
  assert(blControlledRes.passedVerification === false, 'B/L cargo description controlled-goods hit prevents automated verification');

  // ---------------------------------------------------------------------------
  // Check 14: MCP trade tool accepts complete presentation & returns structured evaluation
  // ---------------------------------------------------------------------------
  console.log('\n[CHECK 14] MCP Tool screen_trade_and_cargo Execution');
  const mcpRes = await executeMcpTool('screen_trade_and_cargo', cleanReq, false);
  assert(mcpRes.id !== undefined && mcpRes.referenceId !== undefined, 'MCP tool returned structured evaluation with ID');
  assert(mcpRes.passedVerification === true, 'MCP tool confirmed clean presentation passedVerification=true');
  assert(mcpRes.completenessStatus === 'FULL_PRESENTATION', 'MCP tool returned completenessStatus=FULL_PRESENTATION');
  assert(typeof mcpRes.evidenceDigest === 'string' && mcpRes.evidenceDigest.length === 64, 'MCP tool generated 64-char SHA-256 evidenceDigest');

  console.log('\n================================================================');
  console.log(` ALL TRADE AND CARGO UAT REMEDIATION TESTS PASSED: ${passCount} Assertions`);
  console.log('================================================================');
  return { passed: passCount, failed: failCount };
}

// Auto-run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runTradeCargoUatSuite().catch((err) => {
    console.error('\n❌ TEST SUITE FAILED:', err);
    process.exit(1);
  });
}

