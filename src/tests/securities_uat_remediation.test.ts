/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import {
  evaluateSecuritiesOrder,
  parseFixMessage,
  validateIsinChecksum,
  buildCanonicalFixMessage,
  EvaluateSecuritiesRequest,
} from '../server/services/modules/securitiesService.ts';
import { executeMcpTool } from '../server/mcpServer.ts';
import { MULTI_MODULE_FIXTURES } from '../server/services/syntheticFixtures.ts';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
  console.log(`  ✓ PASS: ${message}`);
}

export async function runSecuritiesUatSuite(): Promise<{ passed: number; failed: number }> {
  console.log('\n================================================================');
  console.log('   RUNNING SECURITIES & FIX UAT REMEDIATION TEST SUITE');
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
  // Check 1: Sample Fixture Sectoral Sanctions Halt (Positive Control)
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 1: Sample Fixture Sectoral Sanctions Halt (Positive Control)', () => {
    const fixture = MULTI_MODULE_FIXTURES.SECURITIES;
    const result = evaluateSecuritiesOrder(fixture);

    assert(result.orderStatus === 'RESTRICTED_SECURITY_HALT', 'Sectoral sanctioned debt halts order routing');
    assert(result.decisionRecommendation === 'HALT_RESTRICTED_SECURITY', 'Recommendation is HALT_RESTRICTED_SECURITY');
    assert(result.requiresHumanReview === true, 'Human review is required for halted order');
    assert(result.instrument.isSectoralSanctionedDebtOrEquity === true, 'Detected sectoral debt/equity sanction');
    assert(result.instrument.isin === 'XS0805570354', 'Parsed Russian Federation sovereign Eurobond ISIN');
    assert(result.framingValidation?.isValid === true, 'Sample FIX framing is valid');
  });

  // ---------------------------------------------------------------------------
  // Check 2: Clean Valid Equity Order (Positive Control)
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 2: Clean Valid Equity Order (Positive Control)', () => {
    const validFix = buildCanonicalFixMessage([
      [8, 'FIX.4.2'],
      [35, 'D'],
      [49, 'EXEC_BROKER_CLEAN'],
      [56, 'EXCHANGE_DESK'],
      [11, 'ORD-2026-CLEAN-001'],
      [55, 'AAPL'],
      [48, 'US0378331005'],
      [22, '4'], // ISIN
      [54, '1'], // BUY
      [38, '500'],
      [44, '185.50'],
      [40, '2'], // Limit
      [59, '0'],
      [1, 'CLIENT_CLEAN_ACC'],
    ]);

    const req: EvaluateSecuritiesRequest = {
      rawFixMessage: validFix,
      parties: [
        { role: 'EXECUTING_BROKER', name: 'Clean Execution Broker Inc', idValue: 'BROKER_001' },
        { role: 'CLIENT_ACCOUNT', name: 'Verified Retail Client Corp', idValue: 'ACC_001' },
      ],
    };

    const result = evaluateSecuritiesOrder(req);

    assert(result.orderStatus === 'ROUTING_ALLOWED', 'Clean order receives ROUTING_ALLOWED');
    assert(result.decisionRecommendation === 'APPROVE_ORDER_ROUTING', 'Recommendation is APPROVE_ORDER_ROUTING');
    assert(result.requiresHumanReview === false, 'No human review needed for clean order');
    assert(result.instrument.isIsinChecksumValid === true, 'Valid Apple ISIN US0378331005 checksum confirmed');
    assert(result.orderSide === 'BUY', 'Parsed BUY side');
    assert(result.orderQty === 500, 'Parsed 500 share volume');
    assert(result.orderPrice === 185.50, 'Parsed limit price');
    assert(result.screeningCoverage?.coverageStatus === 'FULL_COVERAGE', 'Full screening coverage achieved');
  });

  // ---------------------------------------------------------------------------
  // Check 3: Empty Text and Gibberish Input Rejection
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 3: Empty Text and Gibberish Input Rejection', () => {
    const emptyResult = evaluateSecuritiesOrder({ rawFixMessage: '' });
    assert(emptyResult.orderStatus === 'INVALID_FIX_FRAMING', 'Empty FIX message rejected with INVALID_FIX_FRAMING');
    assert(emptyResult.requiresHumanReview === true, 'Empty FIX message requires human review');
    assert(emptyResult.decisionRecommendation === 'REJECT_INVALID_ORDER', 'Recommendation is REJECT_INVALID_ORDER');

    const whitespaceResult = evaluateSecuritiesOrder({ rawFixMessage: '   \n  \t  ' });
    assert(whitespaceResult.orderStatus === 'INVALID_FIX_FRAMING', 'Whitespace-only input rejected with INVALID_FIX_FRAMING');

    const gibberishResult = evaluateSecuritiesOrder({ rawFixMessage: 'THIS IS JUST RANDOM TEXT NOT FIX AT ALL' });
    assert(gibberishResult.orderStatus === 'INVALID_FIX_FRAMING', 'Gibberish input rejected with INVALID_FIX_FRAMING');
    assert(gibberishResult.framingValidation?.isValid === false, 'Gibberish framing flagged invalid');
  });

  // ---------------------------------------------------------------------------
  // Check 4: Invalid FIX Checksum Rejection
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 4: Invalid FIX Checksum Rejection', () => {
    // Checksum deliberately tampered to 000
    const tamperedCheckSum = '8=FIX.4.2|9=45|35=D|49=BRK|56=XCH|11=ORD1|55=AAPL|54=1|38=100|40=1|10=000';
    const result = evaluateSecuritiesOrder({ rawFixMessage: tamperedCheckSum });

    assert(result.orderStatus === 'INVALID_FIX_FRAMING', 'Tampered checksum rejected with INVALID_FIX_FRAMING');
    assert(result.framingValidation?.checksumValid === false, 'Checksum explicitly flagged as invalid');
    assert(result.requiresHumanReview === true, 'Requires human review');
  });

  // ---------------------------------------------------------------------------
  // Check 5: Invalid BodyLength Rejection
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 5: Invalid BodyLength Rejection', () => {
    // BodyLength declared as 999 which is wrong
    const badBodyLength = '8=FIX.4.2|9=999|35=D|49=BRK|56=XCH|11=ORD1|55=AAPL|54=1|38=100|40=1|10=123';
    const result = evaluateSecuritiesOrder({ rawFixMessage: badBodyLength });

    assert(result.orderStatus === 'INVALID_FIX_FRAMING', 'Invalid body length rejected with INVALID_FIX_FRAMING');
    assert(result.framingValidation?.bodyLengthValid === false, 'Body length explicitly marked invalid');
  });

  // ---------------------------------------------------------------------------
  // Check 6: Framing Order Violations (Tag 8 not first or Tag 10 not last)
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 6: Framing Order Violations', () => {
    // Tag 35 appears before Tag 8
    const badFirstTag = '35=D|8=FIX.4.2|9=30|49=BRK|11=O1|55=MSFT|54=1|38=50|40=1|10=100';
    const result1 = evaluateSecuritiesOrder({ rawFixMessage: badFirstTag });
    assert(result1.orderStatus === 'INVALID_FIX_FRAMING', 'Tag 8 not first rejected');
    assert(result1.framingValidation?.detectedErrors.some(e => e.includes('First tag must be Tag 8')) === true, 'Detected Tag 8 position error');

    // Tag 10 appears before end
    const badLastTag = '8=FIX.4.2|9=40|10=100|35=D|49=BRK|11=O1|55=MSFT|54=1|38=50|40=1';
    const result2 = evaluateSecuritiesOrder({ rawFixMessage: badLastTag });
    assert(result2.orderStatus === 'INVALID_FIX_FRAMING', 'Tag 10 not last rejected');
  });

  // ---------------------------------------------------------------------------
  // Check 7: Missing Mandatory Order Fields
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 7: Missing Mandatory Order Fields', () => {
    // Missing ClOrdID (Tag 11)
    const missingClOrdId = buildCanonicalFixMessage([
      [8, 'FIX.4.2'],
      [35, 'D'],
      [49, 'BRK'],
      [56, 'XCH'],
      [55, 'AAPL'],
      [54, '1'],
      [38, '100'],
      [40, '1'],
    ]);
    const res1 = evaluateSecuritiesOrder({ rawFixMessage: missingClOrdId });
    assert(res1.orderStatus === 'MISSING_MANDATORY_TAGS', 'Missing ClOrdID results in MISSING_MANDATORY_TAGS');

    // Missing Instrument (no Tag 55 and no Tag 48)
    const missingInstrument = buildCanonicalFixMessage([
      [8, 'FIX.4.2'],
      [35, 'D'],
      [49, 'BRK'],
      [56, 'XCH'],
      [11, 'ORD-NO-INST'],
      [54, '1'],
      [38, '100'],
      [40, '1'],
    ]);
    const res2 = evaluateSecuritiesOrder({ rawFixMessage: missingInstrument });
    assert(res2.orderStatus === 'MISSING_MANDATORY_TAGS', 'Missing instrument results in MISSING_MANDATORY_TAGS');
    assert(res2.requiresHumanReview === true, 'Requires human review');
  });

  // ---------------------------------------------------------------------------
  // Check 8: Limit Order Missing Price
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 8: Limit Order Missing Price', () => {
    // OrdType=2 (Limit) but Tag 44 (Price) omitted
    const limitNoPrice = buildCanonicalFixMessage([
      [8, 'FIX.4.2'],
      [35, 'D'],
      [49, 'BRK'],
      [56, 'XCH'],
      [11, 'ORD-LMT-NO-PRICE'],
      [55, 'TSLA'],
      [54, '1'],
      [38, '200'],
      [40, '2'], // Limit
    ]);
    const result = evaluateSecuritiesOrder({ rawFixMessage: limitNoPrice });
    assert(result.orderStatus === 'MISSING_MANDATORY_TAGS', 'Limit order without price rejected with MISSING_MANDATORY_TAGS');
    assert(result.reviewReasons?.some(r => r.includes('requires a positive Price')) === true, 'Review reasons note missing limit price');
  });

  // ---------------------------------------------------------------------------
  // Check 9: Negative or Zero Quantity Rejection
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 9: Negative or Zero Quantity Rejection', () => {
    const zeroQty = buildCanonicalFixMessage([
      [8, 'FIX.4.2'],
      [35, 'D'],
      [49, 'BRK'],
      [56, 'XCH'],
      [11, 'ORD-ZERO-QTY'],
      [55, 'MSFT'],
      [54, '1'],
      [38, '0'],
      [40, '1'],
    ]);
    const resZero = evaluateSecuritiesOrder({ rawFixMessage: zeroQty });
    assert(resZero.orderStatus === 'MISSING_MANDATORY_TAGS', 'Zero quantity rejected');

    const negQty = buildCanonicalFixMessage([
      [8, 'FIX.4.2'],
      [35, 'D'],
      [49, 'BRK'],
      [56, 'XCH'],
      [11, 'ORD-NEG-QTY'],
      [55, 'MSFT'],
      [54, '1'],
      [38, '-250'],
      [40, '1'],
    ]);
    const resNeg = evaluateSecuritiesOrder({ rawFixMessage: negQty });
    assert(resNeg.orderStatus === 'MISSING_MANDATORY_TAGS', 'Negative quantity rejected');
  });

  // ---------------------------------------------------------------------------
  // Check 10: Invalid Side Does Not Default to BUY
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 10: Invalid Side Does Not Default to BUY', () => {
    const invalidSideMsg = buildCanonicalFixMessage([
      [8, 'FIX.4.2'],
      [35, 'D'],
      [49, 'BRK'],
      [56, 'XCH'],
      [11, 'ORD-BAD-SIDE'],
      [55, 'GOOG'],
      [54, '99'], // Invalid Side
      [38, '100'],
      [40, '1'],
    ]);
    const result = evaluateSecuritiesOrder({ rawFixMessage: invalidSideMsg });
    assert(result.orderSide === 'INVALID_SIDE', 'Side not defaulted to BUY, set to INVALID_SIDE');
    assert(result.orderStatus === 'MISSING_MANDATORY_TAGS', 'Invalid side results in MISSING_MANDATORY_TAGS');
    assert(result.requiresHumanReview === true, 'Requires human review');
  });

  // ---------------------------------------------------------------------------
  // Check 11: Unsupported Message Type
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 11: Unsupported Message Type', () => {
    const logonMsg = buildCanonicalFixMessage([
      [8, 'FIX.4.2'],
      [35, 'A'], // Logon
      [49, 'CLIENT_APP'],
      [56, 'BROKER_GATEWAY'],
      [34, '1'],
      [52, '20261103-12:00:00'],
      [98, '0'],
      [108, '30'],
    ]);
    const result = evaluateSecuritiesOrder({ rawFixMessage: logonMsg });
    assert(result.orderStatus === 'UNSUPPORTED_MESSAGE_TYPE', 'Logon (Tag 35=A) marked UNSUPPORTED_MESSAGE_TYPE');
    assert(result.decisionRecommendation === 'HOLD_FOR_HUMAN_REVIEW', 'Recommendation is HOLD_FOR_HUMAN_REVIEW');
    assert(result.requiresHumanReview === true, 'Requires human review');
  });

  // ---------------------------------------------------------------------------
  // Check 12: Conflicting Duplicate Scalar Tags
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 12: Conflicting Duplicate Scalar Tags', () => {
    // Message with conflicting Tag 54 (Side 1 and Side 2)
    const conflictingSide = '8=FIX.4.2|9=52|35=D|49=BRK|56=XCH|11=O1|55=AAPL|54=1|54=2|38=100|40=1|10=180';
    const parsed = parseFixMessage(conflictingSide);

    assert(parsed.framingValidation.isValid === false, 'Conflicting duplicate tags mark framing invalid');
    assert(parsed.framingValidation.detectedErrors.some(e => e.includes('Conflicting duplicate tag 54')) === true, 'Detected conflicting Tag 54');
  });

  // ---------------------------------------------------------------------------
  // Check 13: SecurityIDSource Respect (CUSIP / SEDOL vs ISIN)
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 13: SecurityIDSource Respect (CUSIP / SEDOL vs ISIN)', () => {
    // CUSIP test: Tag 22=1, Tag 48=037833100 (Apple CUSIP)
    const cusipFix = buildCanonicalFixMessage([
      [8, 'FIX.4.2'],
      [35, 'D'],
      [49, 'BRK'],
      [56, 'XCH'],
      [11, 'ORD-CUSIP-1'],
      [55, 'AAPL'],
      [48, '037833100'],
      [22, '1'], // CUSIP
      [54, '1'],
      [38, '100'],
      [40, '1'],
    ]);
    const cusipRes = evaluateSecuritiesOrder({
      rawFixMessage: cusipFix,
      parties: [{ role: 'EXECUTING_BROKER', name: 'Desk', idValue: 'D1' }],
    });
    assert(cusipRes.instrument.securityIdSourceDesc === 'CUSIP', 'Source mapped to CUSIP');
    assert(cusipRes.instrument.cusip === '037833100', 'Extracted CUSIP');
    assert(cusipRes.instrument.isIsinChecksumValid === undefined, 'Did not erroneously run ISIN Luhn on CUSIP');

    // Corrupted ISIN checksum: US0378331009 instead of 5
    const corruptedIsin = buildCanonicalFixMessage([
      [8, 'FIX.4.2'],
      [35, 'D'],
      [49, 'BRK'],
      [56, 'XCH'],
      [11, 'ORD-BAD-ISIN'],
      [55, 'AAPL'],
      [48, 'US0378331009'],
      [22, '4'], // ISIN
      [54, '1'],
      [38, '100'],
      [40, '1'],
    ]);
    const badIsinRes = evaluateSecuritiesOrder({ rawFixMessage: corruptedIsin });
    assert(badIsinRes.instrument.isIsinChecksumValid === false, 'Detected invalid ISIN checksum');
    assert(badIsinRes.orderStatus === 'INVALID_FIX_FRAMING', 'Corrupted ISIN order rejected');
  });

  // ---------------------------------------------------------------------------
  // Check 14: Incomplete Party Information Flags Insufficient Coverage
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 14: Incomplete Party Information Flags Insufficient Coverage', () => {
    // Order with no header party tags and empty parties array
    const noPartyFix = buildCanonicalFixMessage([
      [8, 'FIX.4.2'],
      [35, 'D'],
      [11, 'ORD-NO-PARTIES'],
      [55, 'MSFT'],
      [54, '1'],
      [38, '100'],
      [40, '1'],
    ]);
    const result = evaluateSecuritiesOrder({ rawFixMessage: noPartyFix, parties: [] });

    assert(result.screeningCoverage?.coverageStatus === 'INSUFFICIENT', 'Flagged INSUFFICIENT coverage');
    assert(result.requiresHumanReview === true, 'Requires human review when parties missing');
    assert(result.orderStatus !== 'ROUTING_ALLOWED', 'Never allows automatic routing without parties');
  });

  // ---------------------------------------------------------------------------
  // Check 15: Party Sanctions Candidate Match Enforces Review Hold
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 15: Party Sanctions Candidate Match Enforces Review Hold', () => {
    const validFix = buildCanonicalFixMessage([
      [8, 'FIX.4.2'],
      [35, 'D'],
      [49, 'BRK'],
      [56, 'XCH'],
      [11, 'ORD-SANCTION-PARTY'],
      [55, 'IBM'],
      [54, '1'],
      [38, '100'],
      [40, '1'],
    ]);

    // Party matching known sanctions entity Al-Huda
    const req: EvaluateSecuritiesRequest = {
      rawFixMessage: validFix,
      parties: [
        { role: 'EXECUTING_BROKER', name: 'Standard Broker Desk', idValue: 'BRK_01' },
        { role: 'CLIENT_ACCOUNT', name: 'Al-Huda International Trading LLC', idValue: 'SANCTIONED_ACC' },
      ],
    };

    const result = evaluateSecuritiesOrder(req);
    assert(
      result.orderStatus === 'SANCTIONED_COUNTERPARTY_BLOCKED' || result.orderStatus === 'HOLD_FOR_SANCTIONS_REVIEW',
      'Sanctions candidate blocked or held for compliance review'
    );
    assert(result.requiresHumanReview === true, 'Enforces human compliance review');
    assert(result.findingSeverity !== 'NO_MATCH_FOUND', 'Match candidate detected');
  });

  // ---------------------------------------------------------------------------
  // Check 16: Delimiter Support: Wire SOH (\x01) and Pipe (|)
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 16: Delimiter Support: Wire SOH (\\x01) and Pipe (|)', () => {
    const tags: [number, string][] = [
      [8, 'FIX.4.2'],
      [35, 'D'],
      [49, 'SOH_BROKER'],
      [56, 'XCH'],
      [11, 'ORD-SOH-001'],
      [55, 'AAPL'],
      [54, '1'],
      [38, '100'],
      [40, '1'],
      [1, 'CLIENT_ACC'],
    ];

    const sohMessage = buildCanonicalFixMessage(tags, '\x01');
    const parsedSoh = parseFixMessage(sohMessage);

    assert(parsedSoh.framingValidation.delimiterUsed === 'SOH', 'Detected SOH delimiter');
    assert(parsedSoh.framingValidation.isValid === true, 'Wire SOH message framing is valid');
    assert(parsedSoh.framingValidation.checksumValid === true, 'Wire SOH checksum calculated and matched');
    assert(parsedSoh.extractedFields[11] === 'ORD-SOH-001', 'Extracted ClOrdID from SOH message');
  });

  // ---------------------------------------------------------------------------
  // Check 17: Official MCP Tool screen_securities_fix Execution
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 17: Official MCP Tool screen_securities_fix Execution', async () => {
    const fixture = MULTI_MODULE_FIXTURES.SECURITIES;
    const mcpResult = await executeMcpTool('screen_securities_fix', fixture, true);

    assert(typeof mcpResult === 'object', 'MCP tool returned evaluation object');
    assert(mcpResult.orderStatus === 'RESTRICTED_SECURITY_HALT', 'MCP tool correctly halts sectoral security');
    assert(typeof mcpResult.evidenceDigest === 'string' && mcpResult.evidenceDigest.length === 64, 'Generated 64-char SHA-256 evidence digest');
  });

  console.log('\n================================================================');
  console.log(`SECURITIES & FIX TEST SUITE COMPLETE: ${passed} passed, ${failed} failed`);
  console.log('================================================================\n');

  return { passed, failed };
}

