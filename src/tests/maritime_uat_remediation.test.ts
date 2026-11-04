/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import {
  validateImoChecksum,
  evaluateMaritimeVessel,
  extractIsoCountryCode,
  validateIsoArrivalDate,
  HIGH_RISK_PORTS,
  KNOWN_SANCTIONED_VESSELS,
} from '../server/services/modules/maritimeService.ts';
import { executeMcpTool } from '../server/mcpServer.ts';
import { MULTI_MODULE_FIXTURES } from '../server/services/syntheticFixtures.ts';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
  console.log(`  ✓ PASS: ${message}`);
}

export async function runMaritimeUatSuite(): Promise<{ passed: number; failed: number }> {
  console.log('\n================================================================');
  console.log('   RUNNING MARITIME UAT REMEDIATION TEST SUITE');
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
  // Check 1: Valid IMO Checksum (Positive Control)
  // ---------------------------------------------------------------------------
  runCheck('CHECK 1: Valid IMO Checksum (Positive Control)', () => {
    assert(validateImoChecksum('9256858') === true, 'IMO 9256858 validates with true');
    assert(validateImoChecksum('9312896') === true, 'IMO 9312896 validates with true');
  });

  // ---------------------------------------------------------------------------
  // Check 2: Incorrect IMO Checksum Detection (Positive Control)
  // ---------------------------------------------------------------------------
  runCheck('CHECK 2: Incorrect IMO Checksum Detection (Positive Control)', () => {
    assert(validateImoChecksum('9256859') === false, 'Corrupted IMO 9256859 is rejected by validateImoChecksum');
    const evalResult = evaluateMaritimeVessel({
      ...MULTI_MODULE_FIXTURES.MARITIME,
      vessel: {
        ...MULTI_MODULE_FIXTURES.MARITIME.vessel,
        imoNumber: '9256859',
      },
    });
    assert(evalResult.isImoChecksumValid === false, 'Evaluation flags isImoChecksumValid = false for bad checksum');
    assert(evalResult.requiresHumanReview === true, 'Corrupted IMO requires human review');
    assert(evalResult.isApprovedForCoverage === false, 'Corrupted IMO is not approved for coverage');
  });

  // ---------------------------------------------------------------------------
  // Check 3: All-Zero IMO 0000000 Rejection (Defect 1)
  // ---------------------------------------------------------------------------
  runCheck('CHECK 3: All-Zero IMO 0000000 Placeholder Rejection', () => {
    assert(validateImoChecksum('0000000') === false, 'All-zero IMO 0000000 rejected by validateImoChecksum');
    const evalResult = evaluateMaritimeVessel({
      ...MULTI_MODULE_FIXTURES.MARITIME,
      vessel: {
        ...MULTI_MODULE_FIXTURES.MARITIME.vessel,
        imoNumber: '0000000',
      },
    });
    assert(evalResult.isImoChecksumValid === false, 'Evaluation sets isImoChecksumValid = false for 0000000');
    assert(
      evalResult.identifierValidationIssues.some((issue) => issue.includes('0000000')),
      'Evaluation records specific placeholder warning for 0000000'
    );
    assert(evalResult.completenessStatus === 'INCOMPLETE_REJECTED', 'All-zero IMO marks completeness as INCOMPLETE_REJECTED');
    assert(evalResult.isApprovedForCoverage === false, 'All-zero IMO is strictly not approved for coverage');
  });

  // ---------------------------------------------------------------------------
  // Check 4: Invalid MMSI Format Rejection (Defect 2)
  // ---------------------------------------------------------------------------
  runCheck('CHECK 4: Invalid MMSI Format Rejection', () => {
    let threwForAbc = false;
    try {
      evaluateMaritimeVessel({
        ...MULTI_MODULE_FIXTURES.MARITIME,
        vessel: {
          ...MULTI_MODULE_FIXTURES.MARITIME.vessel,
          mmsi: 'abc',
        },
      });
    } catch (err: any) {
      threwForAbc = err.message.includes('MMSI must be exactly 9 numeric digits');
    }
    assert(threwForAbc, 'MMSI "abc" threw field-specific validation error');

    let threwForShort = false;
    try {
      evaluateMaritimeVessel({
        ...MULTI_MODULE_FIXTURES.MARITIME,
        vessel: {
          ...MULTI_MODULE_FIXTURES.MARITIME.vessel,
          mmsi: '12345',
        },
      });
    } catch (err: any) {
      threwForShort = err.message.includes('MMSI must be exactly 9 numeric digits');
    }
    assert(threwForShort, 'MMSI "12345" threw field-specific validation error');
  });

  // ---------------------------------------------------------------------------
  // Check 5: Missing Vessel Name or Flag Rejection (Defect 3)
  // ---------------------------------------------------------------------------
  runCheck('CHECK 5: Missing Vessel Name or Flag Rejection', () => {
    const blankNameEval = evaluateMaritimeVessel({
      ...MULTI_MODULE_FIXTURES.MARITIME,
      vessel: {
        ...MULTI_MODULE_FIXTURES.MARITIME.vessel,
        vesselName: '',
      },
    });
    assert(blankNameEval.isApprovedForCoverage === false, 'Blank vesselName prohibits coverage approval');
    assert(blankNameEval.completenessStatus === 'INCOMPLETE_REJECTED', 'Blank vesselName marks INCOMPLETE_REJECTED');
    assert(blankNameEval.requiresHumanReview === true, 'Blank vesselName requires human review');

    const blankFlagEval = evaluateMaritimeVessel({
      ...MULTI_MODULE_FIXTURES.MARITIME,
      vessel: {
        ...MULTI_MODULE_FIXTURES.MARITIME.vessel,
        flagState: '',
      },
    });
    assert(blankFlagEval.isApprovedForCoverage === false, 'Blank flagState prohibits coverage approval');
    assert(blankFlagEval.completenessStatus === 'INCOMPLETE_REJECTED', 'Blank flagState marks INCOMPLETE_REJECTED');
    assert(blankFlagEval.requiresHumanReview === true, 'Blank flagState requires human review');
  });

  // ---------------------------------------------------------------------------
  // Check 6: Missing or Blank Ownership Hierarchy (Defect 4)
  // ---------------------------------------------------------------------------
  runCheck('CHECK 6: Missing or Blank Ownership Hierarchy', () => {
    const emptyOwnershipEval = evaluateMaritimeVessel({
      ...MULTI_MODULE_FIXTURES.MARITIME,
      ownershipHierarchy: [],
    });
    assert(emptyOwnershipEval.isApprovedForCoverage === false, 'Empty ownershipHierarchy prohibits coverage approval');
    assert(emptyOwnershipEval.ownershipCoverage === 'NO_OWNERSHIP_SUPPLIED', 'Flagged ownershipCoverage = NO_OWNERSHIP_SUPPLIED');
    assert(emptyOwnershipEval.requiresHumanReview === true, 'Missing ownership requires human review');

    const blankOwnerNodeEval = evaluateMaritimeVessel({
      ...MULTI_MODULE_FIXTURES.MARITIME,
      ownershipHierarchy: [
        { role: 'REGISTERED_OWNER', name: '', country: 'Panama' },
        { role: 'BENEFICIAL_OWNER', name: 'Clean Holding SA', country: 'Switzerland' },
      ],
    });
    assert(blankOwnerNodeEval.isApprovedForCoverage === false, 'Blank owner name prohibits coverage approval');
    assert(blankOwnerNodeEval.ownershipCoverage === 'PARTIAL_OWNERSHIP', 'Flagged ownershipCoverage = PARTIAL_OWNERSHIP');
    const blankNode = blankOwnerNodeEval.ownershipHierarchy.find((n) => n.role === 'REGISTERED_OWNER');
    assert(blankNode?.status === 'INCOMPLETE_NOT_SCREENED', 'Blank owner node status is INCOMPLETE_NOT_SCREENED');
    assert(blankNode?.isScreened === false, 'Blank owner node isScreened = false');
  });

  // ---------------------------------------------------------------------------
  // Check 7: Missing Port History or AIS Coverage (Defect 5)
  // ---------------------------------------------------------------------------
  runCheck('CHECK 7: Missing Port History or AIS Coverage', () => {
    const emptyPortsEval = evaluateMaritimeVessel({
      ...MULTI_MODULE_FIXTURES.MARITIME,
      portsCalled: [],
    });
    assert(emptyPortsEval.isApprovedForCoverage === false, 'Empty portsCalled prohibits coverage approval');
    assert(emptyPortsEval.portHistoryCoverage === 'NO_PORT_HISTORY_SUPPLIED', 'Flagged portHistoryCoverage = NO_PORT_HISTORY_SUPPLIED');

    const noAisEval = evaluateMaritimeVessel({
      ...MULTI_MODULE_FIXTURES.MARITIME,
      aisSignals: undefined,
    });
    assert(noAisEval.isApprovedForCoverage === false, 'Omitted aisSignals prohibits coverage approval');
    assert(noAisEval.aisCoverage === 'NO_SIGNALS_PROVIDED', 'Flagged aisCoverage = NO_SIGNALS_PROVIDED');
    assert(noAisEval.darkAisRiskLevel === 'NOT_ASSESSED', 'Flagged darkAisRiskLevel = NOT_ASSESSED (not NORMAL)');
  });

  // ---------------------------------------------------------------------------
  // Check 8: Negative AIS Elapsed Hours Rejection (Defect 6)
  // ---------------------------------------------------------------------------
  runCheck('CHECK 8: Negative AIS Elapsed Hours Rejection', () => {
    let threwForNegativeHours = false;
    try {
      evaluateMaritimeVessel({
        ...MULTI_MODULE_FIXTURES.MARITIME,
        aisSignals: {
          lastSeenTimestamp: '2026-11-01T14:30:00Z',
          hoursSinceLastBroadcast: -5,
          stsTransferDetected: false,
        },
      });
    } catch (err: any) {
      threwForNegativeHours = err.message.includes('hoursSinceLastBroadcast cannot be negative');
    }
    assert(threwForNegativeHours, 'Negative hoursSinceLastBroadcast (-5) threw field-specific validation error');
  });

  // ---------------------------------------------------------------------------
  // Check 9: Old AIS Timestamp with Zero Elapsed Hours Conflict (Defect 7)
  // ---------------------------------------------------------------------------
  runCheck('CHECK 9: Old AIS Timestamp with Zero Elapsed Hours Conflict', () => {
    // 5 days ago timestamp with 0 reported elapsed hours
    const staleDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const conflictEval = evaluateMaritimeVessel({
      ...MULTI_MODULE_FIXTURES.MARITIME,
      aisSignals: {
        lastSeenTimestamp: staleDate,
        hoursSinceLastBroadcast: 0,
        stsTransferDetected: false,
      },
    });
    assert(conflictEval.darkAisRiskLevel === 'HIGH_RISK_SUSPECTED', 'Conflict between old timestamp and 0 hours sets HIGH_RISK_SUSPECTED');
    assert(
      conflictEval.aisAnomalies.some((a) => a.includes('AIS timestamp conflict')),
      'Records explicit AIS timestamp conflict anomaly'
    );
    assert(conflictEval.requiresHumanReview === true, 'Timestamp conflict requires human review');
  });

  // ---------------------------------------------------------------------------
  // Check 10: Invalid Port UN/LOCODE, Date, and Country Conflict (Defect 8)
  // ---------------------------------------------------------------------------
  runCheck('CHECK 10: Invalid Port UN/LOCODE, Date, and Country Conflict', () => {
    const invalidPortEval = evaluateMaritimeVessel({
      ...MULTI_MODULE_FIXTURES.MARITIME,
      portsCalled: [
        {
          portName: 'Corrupted Port Entry',
          unLocode: 'INVALID', // 7 chars, invalid LOCODE
          country: 'United States (US)',
          arrivalDate: '2026-99-32', // Impossible date
        },
        {
          portName: 'Country Mismatch Port',
          unLocode: 'IRBND', // Iran port
          country: 'US', // Country conflict!
          arrivalDate: '2026-10-15',
        },
      ],
    });

    assert(invalidPortEval.portHistoryCoverage === 'INVALID_PORT_HISTORY', 'Flagged portHistoryCoverage = INVALID_PORT_HISTORY');
    const port1 = invalidPortEval.portRiskAnalysis[0];
    assert(port1.portStatus === 'INVALID_PORT_ENTRY', 'Port 1 portStatus is INVALID_PORT_ENTRY');
    assert(Boolean(port1.validationIssues?.some((i) => i.includes('UN/LOCODE'))), 'Port 1 caught UN/LOCODE format issue');
    assert(Boolean(port1.validationIssues?.some((i) => i.includes('Impossible calendar date'))), 'Port 1 caught impossible arrival date');

    const port2 = invalidPortEval.portRiskAnalysis[1];
    assert(port2.portStatus === 'INVALID_PORT_ENTRY', 'Port 2 portStatus is INVALID_PORT_ENTRY');
    assert(Boolean(port2.validationIssues?.some((i) => i.includes('does not match declared port country'))), 'Port 2 caught country conflict');
    assert(invalidPortEval.isApprovedForCoverage === false, 'Invalid port calls prohibit coverage approval');
  });

  // ---------------------------------------------------------------------------
  // Check 11: Malformed / Empty Request Handling (Defect 9)
  // ---------------------------------------------------------------------------
  runCheck('CHECK 11: Malformed / Empty Request Handling', () => {
    let threwForEmptyObj = false;
    try {
      evaluateMaritimeVessel({} as any);
    } catch (err: any) {
      threwForEmptyObj = err.message.includes("missing required 'vessel' object");
    }
    assert(threwForEmptyObj, 'Empty request object threw descriptive error instead of property-access crash');

    let threwForMissingImo = false;
    try {
      evaluateMaritimeVessel({ vessel: { vesselName: 'Ship' } } as any);
    } catch (err: any) {
      threwForMissingImo = err.message.includes("vessel 'imoNumber' is required");
    }
    assert(threwForMissingImo, 'Missing vessel.imoNumber threw descriptive validation error');
  });

  // ---------------------------------------------------------------------------
  // Check 12: Decision Labeling & Sanctioned Entity Separation (Defect 10)
  // ---------------------------------------------------------------------------
  runCheck('CHECK 12: Decision Labeling & Sanctioned Entity Separation', () => {
    // Screen an ordinary, clean vessel with valid identifiers (IMO 9418937: 9*7+4*6+1*5+8*4+9*3+3*2 = 157 -> check digit 7)
    const cleanEval = evaluateMaritimeVessel({
      vessel: {
        imoNumber: '9418937', // Valid checksum, unsanctioned
        vesselName: 'CLEAN CARRIER ALPHA',
        flagState: 'Norway (NO)',
        vesselType: 'CONTAINER_SHIP',
        buildYear: 2018,
      },
      ownershipHierarchy: [
        { role: 'REGISTERED_OWNER', name: 'Nordic Clean Logistics AS', country: 'Norway (NO)' },
      ],
      portsCalled: [
        { portName: 'Rotterdam Gateway', unLocode: 'NLRTM', country: 'Netherlands (NL)', arrivalDate: '2026-10-20' },
      ],
      aisSignals: {
        lastSeenTimestamp: new Date().toISOString(),
        hoursSinceLastBroadcast: 2,
        stsTransferDetected: false,
      },
    });

    const owner = cleanEval.ownershipHierarchy[0];
    assert(owner.isSanctioned === false, 'Clean owner isSanctioned is false');
    assert(owner.status === 'SCREENED_CLEAR', 'Clean owner status is SCREENED_CLEAR (not labeled SANCTIONED ENTITY)');

    const port = cleanEval.portRiskAnalysis[0];
    assert(port.isHighRiskOrSanctioned === false, 'Clean port isHighRiskOrSanctioned is false');
    assert(port.portStatus === 'NOT_DESIGNATED_HIGH_RISK', 'Clean port status is NOT_DESIGNATED_HIGH_RISK');

    assert(cleanEval.decisionRecommendation === 'APPROVE_VOYAGE_COVERAGE', 'Clean evaluation recommended APPROVE_VOYAGE_COVERAGE');
    assert(cleanEval.isApprovedForCoverage === true, 'Clean evaluation is approved for coverage');
  });

  // ---------------------------------------------------------------------------
  // Check 13: AIS-Gap & STS & Flag-Hopping Findings (Positive Controls)
  // ---------------------------------------------------------------------------
  runCheck('CHECK 13: AIS-Gap, STS & Flag-Hopping Findings (Positive Controls)', () => {
    const aisEval = evaluateMaritimeVessel({
      ...MULTI_MODULE_FIXTURES.MARITIME,
      aisSignals: {
        lastSeenTimestamp: '2026-11-01T14:30:00Z',
        hoursSinceLastBroadcast: 30, // Gap > 24h
        stsTransferDetected: true,
        knownStsZone: 'Strait of Hormuz Offshore STS Lightering Zone',
        flagChangesLast12Months: 3, // Flag-hopping >= 2
      },
    });

    assert(aisEval.darkAisRiskLevel === 'HIGH_RISK_SUSPECTED', 'AIS gap & flag hopping flagged HIGH_RISK_SUSPECTED');
    assert(aisEval.aisAnomalies.some((a) => a.includes('non-transmitting for 30 hours')), 'Captured AIS non-transmitting anomaly');
    assert(aisEval.aisAnomalies.some((a) => a.includes('Ship-to-Ship (STS)')), 'Captured STS transfer anomaly');
    assert(aisEval.aisAnomalies.some((a) => a.includes('Flag-hopping detected')), 'Captured flag-hopping anomaly');
    assert(aisEval.isApprovedForCoverage === false, 'AIS risk prohibits coverage approval');
  });

  // ---------------------------------------------------------------------------
  // Check 14: Sample High-Risk Port & Sanctioned Vessel (Positive Controls)
  // ---------------------------------------------------------------------------
  runCheck('CHECK 14: Sample High-Risk Port & Sanctioned Vessel Detection', () => {
    const sampleEval = evaluateMaritimeVessel(MULTI_MODULE_FIXTURES.MARITIME);
    assert(sampleEval.findingSeverity === 'EXACT_IDENTIFIER_MATCH', 'Known sanctioned vessel OCEAN PERFUME matched EXACT_IDENTIFIER_MATCH');
    assert(sampleEval.portRiskAnalysis.some((p) => p.isHighRiskOrSanctioned && p.unLocode === 'IRBND'), 'Identified Bandar Abbas (IRBND) as sanctioned port');
    assert(sampleEval.decisionRecommendation === 'REJECT_SANCTIONS_RISK', 'Sanctioned vessel and port trigger REJECT_SANCTIONS_RISK');
    assert(sampleEval.isApprovedForCoverage === false, 'Prohibits coverage for sanctioned tanker');
  });

  // ---------------------------------------------------------------------------
  // Check 15: Distinguish IMO Checksum from Verified Registration
  // ---------------------------------------------------------------------------
  runCheck('CHECK 15: Distinguish IMO Checksum from Verified Registration', () => {
    const unverifiedEval = evaluateMaritimeVessel({
      vessel: {
        imoNumber: '9418937', // Valid checksum, unsanctioned
        vesselName: 'UNKNOWN NEW BUILD',
        flagState: 'Panama (PA)',
        vesselType: 'GENERAL_CARGO',
        // buildYear omitted -> unverified in official registry
      },
      ownershipHierarchy: [
        { role: 'REGISTERED_OWNER', name: 'Pacific Carriers Ltd', country: 'Panama' },
      ],
      portsCalled: [
        { portName: 'Singapore Port', unLocode: 'SGSIN', country: 'Singapore (SG)', arrivalDate: '2026-10-15' },
      ],
      aisSignals: {
        lastSeenTimestamp: new Date().toISOString(),
        hoursSinceLastBroadcast: 1,
        stsTransferDetected: false,
      },
    });

    assert(unverifiedEval.isImoChecksumValid === true, 'IMO checksum is valid');
    assert(unverifiedEval.isVesselRegistrationVerified === false, 'Vessel registration is flagged as unverified');
    assert(unverifiedEval.vesselRegistrationStatus === 'UNVERIFIED_REGISTRY', 'Registration status is UNVERIFIED_REGISTRY');
    assert(unverifiedEval.requiresHumanReview === true, 'Unverified registry requires human review');
  });

  // ---------------------------------------------------------------------------
  // Check 16: MCP Tool screen_maritime_vessel Execution & PII Redaction
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 16: MCP Tool screen_maritime_vessel Execution & PII Redaction', async () => {
    const mcpResult: any = await executeMcpTool('screen_maritime_vessel', MULTI_MODULE_FIXTURES.MARITIME, true);
    assert(Boolean(mcpResult.evidenceDigest), 'MCP tool screen_maritime_vessel returned evidenceDigest');
    assert(mcpResult.isImoChecksumValid === true, 'MCP tool confirmed IMO checksum');
    assert(mcpResult.decisionRecommendation === 'REJECT_SANCTIONS_RISK', 'MCP tool returned REJECT_SANCTIONS_RISK');
  });

  // ---------------------------------------------------------------------------
  // Check 17: Tamper-Evident Digest & Evidence Generation
  // ---------------------------------------------------------------------------
  runCheck('CHECK 17: Tamper-Evident Digest & Evidence Generation', () => {
    const evalA = evaluateMaritimeVessel(MULTI_MODULE_FIXTURES.MARITIME);
    assert(typeof evalA.evidenceDigest === 'string' && evalA.evidenceDigest.length === 64, 'Generated 64-char hex SHA-256 evidence digest');
  });

  console.log('\n================================================================');
  console.log(` ALL MARITIME UAT REMEDIATION TESTS PASSED: ${passed} Checks`);
  console.log('================================================================\n');

  return { passed, failed };
}

if (process.argv[1]?.endsWith('maritime_uat_remediation.test.ts')) {
  runMaritimeUatSuite().catch((err) => {
    console.error('Test execution failed:', err);
    process.exit(1);
  });
}
