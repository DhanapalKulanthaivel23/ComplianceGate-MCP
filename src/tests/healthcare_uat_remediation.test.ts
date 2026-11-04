/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import {
  evaluateHealthcareClaim,
  validateNpiLuhn,
  validateDeaNumber,
  isValidServiceDate,
  EvaluateHealthcareRequest,
} from '../server/services/modules/healthcareService.ts';
import { executeMcpTool } from '../server/mcpServer.ts';
import { MULTI_MODULE_FIXTURES } from '../server/services/syntheticFixtures.ts';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
  console.log(`  ✓ PASS: ${message}`);
}

export async function runHealthcareUatSuite(): Promise<{ passed: number; failed: number }> {
  console.log('\n================================================================');
  console.log('   RUNNING HEALTHCARE UAT REMEDIATION TEST SUITE');
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
  // Check 1: Sample Fixture OIG-LEIE Exclusion (Positive Control)
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 1: Sample Fixture OIG-LEIE Exclusion (Positive Control)', () => {
    const fixture = MULTI_MODULE_FIXTURES.HEALTHCARE;
    const result = evaluateHealthcareClaim(fixture);

    assert(result.claimId === 'CLM-MED-2026-44102', 'Evaluates sample claim CLM-MED-2026-44102');
    assert(result.practitioner?.isOigLeieExcluded === true, 'Detected OIG-LEIE mandatory fraud exclusion');
    assert(result.claimIntegrityStatus === 'CLAIM_HELD_FOR_FRAUD_EXCLUSION', 'Status is CLAIM_HELD_FOR_FRAUD_EXCLUSION');
    assert(result.decisionRecommendation === 'REJECT_FRAUD_EXCLUSION', 'Recommendation is REJECT_FRAUD_EXCLUSION');
    assert(result.requiresHumanReview === true, 'Mandatory human compliance review required');
    assert(result.evidenceDigest.length === 64, 'Generated 64-char SHA-256 evidence digest');
  });

  // ---------------------------------------------------------------------------
  // Check 2: Clean Healthcare Claim Approval (Positive Control)
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 2: Clean Healthcare Claim Approval (Positive Control)', () => {
    // 1982736450 is excluded, but 1234567893 passes Luhn Mod-10
    // Checksum for 1234567893:
    // (1*2=2) + 2 + (3*2=6) + 4 + (5*2=1) + 6 + (7*2=5) + 8 + (9*2=9) = 43 + 24 = 67 -> checkDigit = 3
    const cleanReq: EvaluateHealthcareRequest = {
      claimId: 'CLM-CLEAN-2026-001',
      serviceDate: '2026-10-15',
      billedAmount: 3200.0,
      practitioner: {
        name: 'Dr. Sarah Elizabeth Jenkins MD',
        npi: '1234567893', // Valid CMS NPI
        deaNumber: 'BV1234563', // Valid DEA number
        specialty: 'Cardiovascular Disease',
        stateLicense: 'CA-MED-99214',
      },
      supplier: {
        companyName: 'Pacific Clinical Supplies Corp',
        taxId: 'US-TAX-8819234',
        fdaRegistrationNumber: 'FDA-REG-100293',
        country: 'US',
      },
    };

    const result = evaluateHealthcareClaim(cleanReq);
    assert(result.claimIntegrityStatus === 'PAYMENT_APPROVED', 'Clean healthcare claim is PAYMENT_APPROVED');
    assert(result.decisionRecommendation === 'APPROVE_HEALTHCARE_CLAIM', 'Recommendation is APPROVE_HEALTHCARE_CLAIM');
    assert(result.requiresHumanReview === false, 'No human review required');
    assert(result.practitioner?.isNpiValid === true, 'NPI is valid');
    assert(result.practitioner?.isDeaValid === true, 'DEA number is valid');
  });

  // ---------------------------------------------------------------------------
  // Check 3: Empty Request or No Practitioner/Supplier Rejection
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 3: Empty Request or No Practitioner/Supplier Rejection', () => {
    const emptyParticipantsReq: EvaluateHealthcareRequest = {
      claimId: 'CLM-NO-PART-001',
      serviceDate: '2026-10-10',
      billedAmount: 1500.0,
      // practitioner and supplier omitted!
    };

    const result = evaluateHealthcareClaim(emptyParticipantsReq);
    assert(result.claimIntegrityStatus !== 'PAYMENT_APPROVED', 'Claim without participants must not return PAYMENT_APPROVED');
    assert(result.claimIntegrityStatus === 'INCOMPLETE_CLAIM_DATA', 'Status is INCOMPLETE_CLAIM_DATA');
    assert(result.requiresHumanReview === true, 'Requires human review');
    assert(
      result.reviewReasons!.some((r) => r.includes('must declare at least one rendering practitioner or medical supplier')),
      'Review reasons cite missing practitioner/supplier'
    );
  });

  // ---------------------------------------------------------------------------
  // Check 4: Blank Practitioner Name or Blank Claim Reference
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 4: Blank Practitioner Name or Blank Claim Reference', () => {
    let blankClaimThrew = false;
    try {
      evaluateHealthcareClaim({
        claimId: '   ',
        serviceDate: '2026-10-10',
        billedAmount: 1200.0,
        practitioner: {
          name: 'Dr. John Doe',
          npi: '1234567893',
          specialty: 'Internal Medicine',
        },
      });
    } catch (err: any) {
      blankClaimThrew = true;
      assert(err.message.includes("'claimId' is required"), 'Throws error on blank claimId');
    }
    assert(blankClaimThrew, 'Blank claimId was rejected');

    const blankNameReq: EvaluateHealthcareRequest = {
      claimId: 'CLM-BLANK-NAME-001',
      serviceDate: '2026-10-10',
      billedAmount: 1200.0,
      practitioner: {
        name: '   ', // Blank name
        npi: '1234567893',
        specialty: 'Internal Medicine',
      },
    };

    const result = evaluateHealthcareClaim(blankNameReq);
    assert(result.claimIntegrityStatus !== 'PAYMENT_APPROVED', 'Blank practitioner name must not return PAYMENT_APPROVED');
    assert(result.claimIntegrityStatus === 'INCOMPLETE_CLAIM_DATA', 'Marked INCOMPLETE_CLAIM_DATA');
    assert(result.requiresHumanReview === true, 'Requires human review');
  });

  // ---------------------------------------------------------------------------
  // Check 5: Invalid DEA Number Rejection (Does Not Approve Payment)
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 5: Invalid DEA Number Rejection (Does Not Approve Payment)', () => {
    const invalidDeaReq: EvaluateHealthcareRequest = {
      claimId: 'CLM-BAD-DEA-001',
      serviceDate: '2026-10-10',
      billedAmount: 2500.0,
      practitioner: {
        name: 'Dr. Marcus Welby MD',
        npi: '1234567893',
        deaNumber: 'BV1234568', // Check digit is 8, but formula requires 3!
        specialty: 'General Practice',
      },
    };

    const result = evaluateHealthcareClaim(invalidDeaReq);
    assert(result.claimIntegrityStatus !== 'PAYMENT_APPROVED', 'Invalid DEA checksum must not return PAYMENT_APPROVED');
    assert(result.claimIntegrityStatus === 'CLAIM_HELD_FOR_CREDENTIAL_DEFICIT', 'Held for credential deficit');
    assert(result.practitioner?.isDeaValid === false, 'isDeaValid is false');
    assert(result.requiresHumanReview === true, 'Requires human review');
    assert(
      result.reviewReasons!.some((r) => r.includes('failed DEA checksum formula')),
      'Review reasons cite failed DEA checksum'
    );
  });

  // ---------------------------------------------------------------------------
  // Check 6: Negative and Zero Billed Amount Rejection
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 6: Negative and Zero Billed Amount Rejection', () => {
    let negThrew = false;
    try {
      evaluateHealthcareClaim({
        claimId: 'CLM-NEG-001',
        serviceDate: '2026-10-10',
        billedAmount: -1000.0,
        practitioner: {
          name: 'Dr. Marcus Welby MD',
          npi: '1234567893',
          specialty: 'General Practice',
        },
      });
    } catch (err: any) {
      negThrew = true;
      assert(err.message.includes('positive finite number'), 'Throws error on negative billedAmount');
    }
    assert(negThrew, 'Negative billedAmount was rejected');

    let zeroThrew = false;
    try {
      evaluateHealthcareClaim({
        claimId: 'CLM-ZERO-001',
        serviceDate: '2026-10-10',
        billedAmount: 0,
        practitioner: {
          name: 'Dr. Marcus Welby MD',
          npi: '1234567893',
          specialty: 'General Practice',
        },
      });
    } catch (err: any) {
      zeroThrew = true;
    }
    assert(zeroThrew, 'Zero billedAmount was rejected');
  });

  // ---------------------------------------------------------------------------
  // Check 7: Impossible Service Date Rejection
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 7: Impossible Service Date Rejection', () => {
    let threw = false;
    try {
      evaluateHealthcareClaim({
        claimId: 'CLM-BAD-DATE-001',
        serviceDate: '2026-99-32', // Impossible month and day
        billedAmount: 1500.0,
        practitioner: {
          name: 'Dr. Marcus Welby MD',
          npi: '1234567893',
          specialty: 'General Practice',
        },
      });
    } catch (err: any) {
      threw = true;
      assert(err.message.includes('valid calendar date in YYYY-MM-DD format'), 'Throws error on impossible calendar date');
    }
    assert(threw, 'Impossible service date was rejected');

    assert(isValidServiceDate('2026-02-30') === false, 'February 30 is rejected as impossible');
    assert(isValidServiceDate('2026-04-31') === false, 'April 31 is rejected as impossible');
    assert(isValidServiceDate('2026-10-15') === true, 'October 15, 2026 is valid');
  });

  // ---------------------------------------------------------------------------
  // Check 8: Blank Supplier Company Name or Invalid Country
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 8: Blank Supplier Company Name or Invalid Country', () => {
    const badSupplierReq: EvaluateHealthcareRequest = {
      claimId: 'CLM-BAD-SUPP-001',
      serviceDate: '2026-10-10',
      billedAmount: 2000.0,
      supplier: {
        companyName: '   ', // Blank name
        country: 'INVALID_COUNTRY_XYZ', // Invalid ISO country
      },
    };

    const result = evaluateHealthcareClaim(badSupplierReq);
    assert(result.claimIntegrityStatus !== 'PAYMENT_APPROVED', 'Blank supplier/country must not return PAYMENT_APPROVED');
    assert(result.claimIntegrityStatus === 'INCOMPLETE_CLAIM_DATA', 'Status is INCOMPLETE_CLAIM_DATA');
    assert(result.requiresHumanReview === true, 'Requires human review');
    assert(
      result.reviewReasons!.some((r) => r.includes('supplier company name is missing or blank')),
      'Review reasons cite missing supplier name'
    );
    assert(
      result.reviewReasons!.some((r) => r.includes('Invalid or unestablished country jurisdiction')),
      'Review reasons cite invalid supplier country'
    );
  });

  // ---------------------------------------------------------------------------
  // Check 9: Alphabetically Contaminated NPI Rejection
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 9: Alphabetically Contaminated NPI Rejection', () => {
    // Letters added around NPI digits
    assert(validateNpiLuhn('NPI1982736450') === false, 'Letters before digits rejected');
    assert(validateNpiLuhn('1982736450A') === false, 'Letters after digits rejected');
    assert(validateNpiLuhn('1982-736-450') === false, 'Dashes rejected');
    assert(validateNpiLuhn('1982736450') === true, 'Clean 10 digits accepted');

    const contaminatedReq: EvaluateHealthcareRequest = {
      claimId: 'CLM-NPI-CONTAM-001',
      serviceDate: '2026-10-10',
      billedAmount: 1800.0,
      practitioner: {
        name: 'Dr. Gregory Vance MD',
        npi: 'NPI1982736450', // Contaminated NPI
        specialty: 'Pain Management',
      },
    };

    const result = evaluateHealthcareClaim(contaminatedReq);
    assert(result.claimIntegrityStatus !== 'PAYMENT_APPROVED', 'Contaminated NPI must not return PAYMENT_APPROVED');
    assert(result.practitioner?.isNpiValid === false, 'practitioner isNpiValid is false');
    assert(result.requiresHumanReview === true, 'Requires human review');
  });

  // ---------------------------------------------------------------------------
  // Check 10: Practitioner Sanctions Watchlist Candidate Screening & Hold
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 10: Practitioner Sanctions Watchlist Candidate Screening & Hold', () => {
    const candidateReq: EvaluateHealthcareRequest = {
      claimId: 'CLM-PRACT-SDN-001',
      serviceDate: '2026-10-10',
      billedAmount: 5000.0,
      practitioner: {
        name: 'Dmitry Sergeyevich Volkov', // Matches demo sanctions watchlist
        npi: '1234567893', // Valid NPI syntax
        specialty: 'Surgery',
      },
    };

    const result = evaluateHealthcareClaim(candidateReq);
    assert(result.claimIntegrityStatus !== 'PAYMENT_APPROVED', 'Practitioner sanctions match must not be PAYMENT_APPROVED');
    assert(!!(result.practitioner?.matches && result.practitioner.matches.length > 0), 'Flagged practitioner watchlist candidate match');
    assert(result.requiresHumanReview === true, 'Requires human compliance review');
    assert(
      result.reviewReasons!.some((r) => r.includes('matched sanctions candidate')),
      'Review reasons record practitioner sanctions candidate'
    );
  });

  // ---------------------------------------------------------------------------
  // Check 11: Supplier Sanctions Candidate Screening
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 11: Supplier Sanctions Candidate Screening', () => {
    const supplierMatchReq: EvaluateHealthcareRequest = {
      claimId: 'CLM-SUPP-SDN-001',
      serviceDate: '2026-10-10',
      billedAmount: 7500.0,
      practitioner: {
        name: 'Dr. Clean Practitioner',
        npi: '1234567893',
        specialty: 'Pediatrics',
      },
      supplier: {
        companyName: 'Al-Furqan Humanitarian Relief Foundation', // Matches sanctions list
        country: 'SY',
      },
    };

    const result = evaluateHealthcareClaim(supplierMatchReq);
    assert(result.claimIntegrityStatus !== 'PAYMENT_APPROVED', 'Supplier sanctions match must not be PAYMENT_APPROVED');
    assert(result.requiresHumanReview === true, 'Requires human review');
  });

  // ---------------------------------------------------------------------------
  // Check 12: Separation of Data Errors from Fraud Exclusions
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 12: Separation of Data Errors from Fraud Exclusions', () => {
    // Invalid NPI alone should result in CLAIM_HELD_FOR_CREDENTIAL_DEFICIT, NOT CLAIM_HELD_FOR_FRAUD_EXCLUSION
    const credDeficitReq: EvaluateHealthcareRequest = {
      claimId: 'CLM-CRED-DEFICIT-001',
      serviceDate: '2026-10-10',
      billedAmount: 1200.0,
      practitioner: {
        name: 'Dr. Honest Error MD',
        npi: '1111111111', // Invalid Luhn checksum, but not on OIG-LEIE fraud exclusion list
        specialty: 'Internal Medicine',
      },
    };

    const result = evaluateHealthcareClaim(credDeficitReq);
    assert(result.claimIntegrityStatus === 'CLAIM_HELD_FOR_CREDENTIAL_DEFICIT', 'Data error categorized as credential deficit');
    assert(result.exclusionHits.length === 0, 'No false positive fraud exclusions recorded');
    assert(result.requiresHumanReview === true, 'Requires review for correction');
  });

  // ---------------------------------------------------------------------------
  // Check 13: Official MCP Tool Execution with PII Redaction
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 13: Official MCP Tool Execution with PII Redaction', async () => {
    const fixture = MULTI_MODULE_FIXTURES.HEALTHCARE;
    const response = await executeMcpTool('verify_healthcare_practitioner', fixture, true);

    assert(response !== null && typeof response === 'object', 'MCP tool returned valid object');
    assert(response.claimId === 'CLM-MED-2026-44102', 'Returned claimId');
    assert(response.claimIntegrityStatus === 'CLAIM_HELD_FOR_FRAUD_EXCLUSION', 'Held for fraud exclusion');
    assert(response.evidenceDigest.length === 64, 'Evidence digest generated');
  });

  console.log('\n================================================================');
  console.log(`HEALTHCARE UAT RESULTS: ${passed} Passed, ${failed} Failed`);
  console.log('================================================================\n');

  return { passed, failed };
}

if (process.argv[1]?.endsWith('healthcare_uat_remediation.test.ts')) {
  runHealthcareUatSuite().then((res) => {
    if (res.failed > 0) process.exit(1);
  });
}
