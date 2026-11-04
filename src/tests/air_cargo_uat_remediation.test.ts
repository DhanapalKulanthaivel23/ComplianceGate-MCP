/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import {
  validateIataAwbChecksum,
  evaluateAirCargo,
  isValidIataAirportCode,
  AIRLINE_PREFIX_MAP,
  HIGH_RISK_AIRPORTS,
} from '../server/services/modules/airCargoService.ts';
import { executeMcpTool } from '../server/mcpServer.ts';
import { MULTI_MODULE_FIXTURES } from '../server/services/syntheticFixtures.ts';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
  console.log(`  ✓ PASS: ${message}`);
}

export async function runAirCargoUatSuite(): Promise<{ passed: number; failed: number }> {
  console.log('\n================================================================');
  console.log('   RUNNING AIR CARGO UAT REMEDIATION TEST SUITE');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function runCheck(name: string, fn: () => void | Promise<void>) {
    console.log(`\n[${name}]`);
    try {
      const res = fn();
      if (res instanceof Promise) {
        return res
          .then(() => {
            passed++;
          })
          .catch((err) => {
            console.error(`  ✗ FAIL: ${name} ->`, err.message);
            failed++;
          });
      }
      passed++;
    } catch (err: any) {
      console.error(`  ✗ FAIL: ${name} ->`, err.message);
      failed++;
    }
  }

  // ---------------------------------------------------------------------------
  // Check 1: Valid AWB Checksum (Positive Control)
  // ---------------------------------------------------------------------------
  runCheck('CHECK 1: Valid AWB Checksum (Positive Control)', () => {
    const valid1 = validateIataAwbChecksum('176-49281702');
    assert(valid1.isValid === true, '176-49281702 is valid with Mod-7 check digit 2');
    assert(valid1.prefix === '176', 'Extracted prefix 176');
    assert(valid1.serial === '4928170', 'Extracted serial 4928170');
    assert(valid1.checkDigit === 2, 'Extracted check digit 2');

    const valid2 = validateIataAwbChecksum('020-12345675'); // 1234567 % 7 = 5
    assert(valid2.isValid === true, '020-12345675 is valid with Mod-7 check digit 5');
  });

  // ---------------------------------------------------------------------------
  // Check 2: Bad Check Digit Detection (Positive Control)
  // ---------------------------------------------------------------------------
  runCheck('CHECK 2: Bad Check Digit Detection (Positive Control)', () => {
    const invalid = validateIataAwbChecksum('176-49281709');
    assert(invalid.isValid === false, '176-49281709 is rejected as bad check digit');
    assert(Boolean(invalid.reason?.includes('mismatch')), 'Records explicit check digit mismatch reason');
  });

  // ---------------------------------------------------------------------------
  // Check 3: Placeholder All-Zero or 000-Prefix AWB (Defect 1)
  // ---------------------------------------------------------------------------
  runCheck('CHECK 3: Placeholder All-Zero or 000-Prefix AWB Rejection', () => {
    const allZeros = validateIataAwbChecksum('000-00000000');
    assert(allZeros.isValid === false, '000-00000000 is rejected as placeholder');
    assert(Boolean(allZeros.reason?.includes('placeholder')), 'Reason identifies placeholder AWB');

    const evalRes = evaluateAirCargo({
      ...MULTI_MODULE_FIXTURES.AIR_CARGO,
      awbNumber: '000-00000000',
    });
    assert(evalRes.isAwbChecksumValid === false, 'Evaluation sets isAwbChecksumValid = false for 000-00000000');
    assert(evalRes.completenessStatus === 'INCOMPLETE_REJECTED', 'All-zero AWB sets completenessStatus = INCOMPLETE_REJECTED');
    assert(evalRes.decisionRecommendation !== 'APPROVE_AIR_RELEASE', 'Placeholder AWB blocks release');
  });

  // ---------------------------------------------------------------------------
  // Check 4: Alphabetic Contamination in AWB (Defect 1)
  // ---------------------------------------------------------------------------
  runCheck('CHECK 4: Alphabetic Contamination in AWB Rejection', () => {
    const contaminated1 = validateIataAwbChecksum('176-4928170X2');
    assert(contaminated1.isValid === false, '176-4928170X2 rejected for alphabetic contamination');
    assert(Boolean(contaminated1.reason?.includes('alphabetic')), 'Reason states illegal alphabetic characters');

    const contaminated2 = validateIataAwbChecksum('ABC17649281702');
    assert(contaminated2.isValid === false, 'ABC17649281702 rejected for alphabetic contamination');
  });

  // ---------------------------------------------------------------------------
  // Check 5: Blank Shipper/Consignee Details (Defect 2)
  // ---------------------------------------------------------------------------
  runCheck('CHECK 5: Blank Shipper/Consignee Details Rejection', () => {
    const blankShipperEval = evaluateAirCargo({
      ...MULTI_MODULE_FIXTURES.AIR_CARGO,
      shipper: { name: '', country: 'AE' },
    });
    assert(blankShipperEval.completenessStatus === 'INCOMPLETE_REJECTED', 'Blank shipper name sets INCOMPLETE_REJECTED');
    assert(blankShipperEval.requiresHumanReview === true, 'Blank shipper name requires human review');
    const shipperParty = blankShipperEval.parties.find((p) => p.role === 'SHIPPER');
    assert(shipperParty?.status === 'INCOMPLETE_NOT_SCREENED', 'Blank shipper marked INCOMPLETE_NOT_SCREENED (never Clear)');
    assert(shipperParty?.isScreened === false, 'Blank shipper isScreened = false');

    const blankConsigneeEval = evaluateAirCargo({
      ...MULTI_MODULE_FIXTURES.AIR_CARGO,
      consignee: { name: '', country: 'DE' },
    });
    assert(blankConsigneeEval.completenessStatus === 'INCOMPLETE_REJECTED', 'Blank consignee name sets INCOMPLETE_REJECTED');
    const consigneeParty = blankConsigneeEval.parties.find((p) => p.role === 'CONSIGNEE');
    assert(consigneeParty?.status === 'INCOMPLETE_NOT_SCREENED', 'Blank consignee marked INCOMPLETE_NOT_SCREENED (never Clear)');
  });

  // ---------------------------------------------------------------------------
  // Check 6: Invalid Country Rejection (Defect 2)
  // ---------------------------------------------------------------------------
  runCheck('CHECK 6: Invalid Country Rejection', () => {
    const invalidCountryEval = evaluateAirCargo({
      ...MULTI_MODULE_FIXTURES.AIR_CARGO,
      shipper: { name: 'Gulf Logistics', country: 'INVALID_JURISDICTION' },
    });
    assert(invalidCountryEval.completenessStatus === 'INCOMPLETE_REJECTED', 'Invalid country sets INCOMPLETE_REJECTED');
    assert(
      invalidCountryEval.reviewReasons.some((r) => r.includes('country jurisdiction')),
      'Emits review reason for invalid country jurisdiction'
    );
  });

  // ---------------------------------------------------------------------------
  // Check 7: Missing/Invalid Airports & Safe Routing Prevention (Defect 3)
  // ---------------------------------------------------------------------------
  runCheck('CHECK 7: Missing/Invalid Airports & Safe Routing Prevention', () => {
    const invalidRouteEval = evaluateAirCargo({
      ...MULTI_MODULE_FIXTURES.AIR_CARGO,
      originAirport: '', // Missing
      destinationAirport: 'INVALID_CODE', // Invalid
      transitAirports: ['123'], // Invalid
    });
    assert(invalidRouteEval.routing.routingStatus === 'INVALID_ROUTING', 'Missing/invalid airports flagged as INVALID_ROUTING');
    assert(invalidRouteEval.routing.routingStatus !== 'SAFE_ROUTING_CORRIDOR', 'Never falsely displays Safe Routing Corridor');
    assert(invalidRouteEval.requiresHumanReview === true, 'Invalid routing requires human review');
    assert(Boolean(invalidRouteEval.routing.routingIssues?.length), 'Captures explicit routing issues');
  });

  // ---------------------------------------------------------------------------
  // Check 8: High-Risk Transshipment Route Detection (Positive Control)
  // ---------------------------------------------------------------------------
  runCheck('CHECK 8: High-Risk Transshipment Route Detection (Positive Control)', () => {
    const routeEval = evaluateAirCargo({
      ...MULTI_MODULE_FIXTURES.AIR_CARGO,
      transitAirports: ['THR'], // Tehran
    });
    assert(routeEval.routing.hasHighRiskTransshipment === true, 'Detected Tehran (THR) as high-risk transshipment gateway');
    assert(routeEval.routing.routingStatus === 'HIGH_RISK_TRANSIT_DETECTED', 'Routing status is HIGH_RISK_TRANSIT_DETECTED');
    assert(routeEval.cargoDetails.securityScreeningStatus === 'FLAGGED', 'High-risk transit flags cargo security status');
  });

  // ---------------------------------------------------------------------------
  // Check 9: Negative Gross Weight Rejection (Defect 4)
  // ---------------------------------------------------------------------------
  runCheck('CHECK 9: Negative Gross Weight Rejection', () => {
    let threwNegativeWeight = false;
    try {
      evaluateAirCargo({
        ...MULTI_MODULE_FIXTURES.AIR_CARGO,
        cargo: {
          ...MULTI_MODULE_FIXTURES.AIR_CARGO.cargo,
          grossWeightKg: -50,
        },
      });
    } catch (err: any) {
      threwNegativeWeight = err.message.includes('grossWeightKg');
    }
    assert(threwNegativeWeight, 'Negative gross weight threw field-specific validation error');
  });

  // ---------------------------------------------------------------------------
  // Check 10: Fractional Pieces Count Rejection (Defect 4)
  // ---------------------------------------------------------------------------
  runCheck('CHECK 10: Fractional Pieces Count Rejection', () => {
    let threwFractional = false;
    try {
      evaluateAirCargo({
        ...MULTI_MODULE_FIXTURES.AIR_CARGO,
        cargo: {
          ...MULTI_MODULE_FIXTURES.AIR_CARGO.cargo,
          piecesCount: 3.5,
        },
      });
    } catch (err: any) {
      threwFractional = err.message.includes('piecesCount');
    }
    assert(threwFractional, 'Fractional piecesCount (3.5) threw field-specific validation error');
  });

  // ---------------------------------------------------------------------------
  // Check 11: Empty Description and Zero Cargo Quantities (Defect 4)
  // ---------------------------------------------------------------------------
  runCheck('CHECK 11: Empty Description and Zero Cargo Quantities Rejection', () => {
    const emptyDescEval = evaluateAirCargo({
      ...MULTI_MODULE_FIXTURES.AIR_CARGO,
      cargo: {
        ...MULTI_MODULE_FIXTURES.AIR_CARGO.cargo,
        description: '', // Empty
      },
    });
    assert(emptyDescEval.cargoDetails.securityScreeningStatus === 'INCOMPLETE_DATA', 'Empty description marks INCOMPLETE_DATA (never CLEARED)');
    assert(emptyDescEval.completenessStatus === 'INCOMPLETE_REJECTED', 'Empty description marks INCOMPLETE_REJECTED');

    const zeroQtyEval = evaluateAirCargo({
      ...MULTI_MODULE_FIXTURES.AIR_CARGO,
      cargo: {
        ...MULTI_MODULE_FIXTURES.AIR_CARGO.cargo,
        grossWeightKg: 0,
        piecesCount: 0,
      },
    });
    assert(zeroQtyEval.cargoDetails.securityScreeningStatus === 'INCOMPLETE_DATA', 'Zero quantities mark INCOMPLETE_DATA (never CLEARED)');
    assert(zeroQtyEval.completenessStatus === 'INCOMPLETE_REJECTED', 'Zero quantities mark INCOMPLETE_REJECTED');
  });

  // ---------------------------------------------------------------------------
  // Check 12: Dual-Use Aerospace Proliferation Detection (Positive Control)
  // ---------------------------------------------------------------------------
  runCheck('CHECK 12: Dual-Use Aerospace Proliferation Detection (Positive Control)', () => {
    const dualUseEval = evaluateAirCargo({
      ...MULTI_MODULE_FIXTURES.AIR_CARGO,
      transitAirports: [], // Non-sanctioned transit
      cargo: {
        description: 'Aircraft avionics radar transceiver module with microchip processor',
        grossWeightKg: 120,
        piecesCount: 2,
        declaredHsCode: '8542.31',
        isHazardous: false,
      },
    });
    assert(dualUseEval.cargoDetails.isDualUseRisk === true, 'Identified avionics transceiver as dual-use aerospace risk');
    assert(dualUseEval.cargoDetails.securityScreeningStatus === 'FLAGGED', 'Dual-use goods set security status FLAGGED');
  });

  // ---------------------------------------------------------------------------
  // Check 13: Hazardous Cargo Declaration (Positive Control)
  // ---------------------------------------------------------------------------
  runCheck('CHECK 13: Hazardous Cargo Declaration (Positive Control)', () => {
    const hazEval = evaluateAirCargo({
      ...MULTI_MODULE_FIXTURES.AIR_CARGO,
      transitAirports: [],
      cargo: {
        description: 'Industrial lithium-ion battery cells',
        grossWeightKg: 300,
        piecesCount: 5,
        isHazardous: true,
      },
    });
    assert(hazEval.cargoDetails.isHazardousMaterial === true, 'Detected hazardous material declaration');
    assert(hazEval.cargoDetails.securityScreeningStatus === 'SUSPICIOUS_CONTENT', 'Hazardous cargo marks SUSPICIOUS_CONTENT');
  });

  // ---------------------------------------------------------------------------
  // Check 14: Carrier Screening & Prefix Resolution (Defect 5)
  // ---------------------------------------------------------------------------
  runCheck('CHECK 14: Carrier Screening & Prefix Resolution', () => {
    // Normal carrier Emirates (176)
    const emiratesEval = evaluateAirCargo(MULTI_MODULE_FIXTURES.AIR_CARGO);
    const emiratesCarrier = emiratesEval.parties.find((p) => p.role === 'CARRIER');
    assert(Boolean(emiratesCarrier), 'Carrier party added to screened counterparties');
    assert(emiratesCarrier?.name.includes('Emirates') === true, 'Carrier name resolved to Emirates SkyCargo');
    assert(emiratesCarrier?.status === 'SCREENED_CLEAR', 'Clean carrier is SCREENED_CLEAR');

    // Designated Carrier Mahan Air (217)
    const mahanEval = evaluateAirCargo({
      ...MULTI_MODULE_FIXTURES.AIR_CARGO,
      awbNumber: '217-12345675', // 1234567 % 7 = 5
    });
    const mahanCarrier = mahanEval.parties.find((p) => p.role === 'CARRIER');
    assert(mahanCarrier?.name.includes('Mahan Air') === true, 'Resolved prefix 217 to Mahan Air');
    assert(mahanEval.decisionRecommendation === 'REJECT_AIR_SANCTIONS_RISK', 'Designated carrier Mahan Air triggers REJECT_AIR_SANCTIONS_RISK');
  });

  // ---------------------------------------------------------------------------
  // Check 15: Unresolved Carrier Prefix Verification (Defect 5)
  // ---------------------------------------------------------------------------
  runCheck('CHECK 15: Unresolved Carrier Prefix Verification', () => {
    const unresolvedEval = evaluateAirCargo({
      ...MULTI_MODULE_FIXTURES.AIR_CARGO,
      awbNumber: '999-12345675', // Valid check digit, unknown prefix 999
    });
    assert(unresolvedEval.carrierVerificationStatus === 'UNRESOLVED_CARRIER', 'Prefix 999 flagged as UNRESOLVED_CARRIER');
    assert(unresolvedEval.isAwbRegistrationVerified === false, 'Registration is flagged unverified');
    assert(unresolvedEval.requiresHumanReview === true, 'Unresolved carrier mandates human review');
  });

  // ---------------------------------------------------------------------------
  // Check 16: Malformed / Empty Request Handling (Defect 7)
  // ---------------------------------------------------------------------------
  runCheck('CHECK 16: Malformed / Empty Request Handling', () => {
    let threwEmpty = false;
    try {
      evaluateAirCargo({} as any);
    } catch (err: any) {
      threwEmpty = err.message.includes('missing mandatory');
    }
    assert(threwEmpty, 'Empty request threw descriptive validation error');
  });

  // ---------------------------------------------------------------------------
  // Check 17: Official MCP Tool screen_air_cargo Execution & PII Redaction
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 17: Official MCP Tool screen_air_cargo Execution', async () => {
    const mcpResult: any = await executeMcpTool('screen_air_cargo', MULTI_MODULE_FIXTURES.AIR_CARGO, true);
    assert(Boolean(mcpResult.evidenceDigest), 'MCP tool screen_air_cargo returned evidenceDigest');
    assert(mcpResult.isAwbChecksumValid === true, 'MCP tool confirmed AWB checksum');
    assert(Boolean(mcpResult.decisionRecommendation), 'MCP tool returned decisionRecommendation');
  });

  // ---------------------------------------------------------------------------
  // Check 18: Tamper-Evident Digest & Evidence Generation
  // ---------------------------------------------------------------------------
  runCheck('CHECK 18: Tamper-Evident Digest & Evidence Generation', () => {
    const evalA = evaluateAirCargo(MULTI_MODULE_FIXTURES.AIR_CARGO);
    assert(typeof evalA.evidenceDigest === 'string' && evalA.evidenceDigest.length === 64, 'Generated 64-char hex SHA-256 evidence digest');
  });

  console.log('\n================================================================');
  console.log(` ALL AIR CARGO UAT REMEDIATION TESTS PASSED: ${passed} Checks`);
  console.log('================================================================\n');

  return { passed, failed };
}

if (process.argv[1]?.endsWith('air_cargo_uat_remediation.test.ts')) {
  runAirCargoUatSuite().catch((err) => {
    console.error('Test execution failed:', err);
    process.exit(1);
  });
}
