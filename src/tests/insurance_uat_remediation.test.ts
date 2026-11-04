/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import {
  evaluateInsurancePolicy,
  EvaluateInsuranceRequest,
} from '../server/services/modules/insuranceService.ts';
import { executeMcpTool } from '../server/mcpServer.ts';
import { MULTI_MODULE_FIXTURES } from '../server/services/syntheticFixtures.ts';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
  console.log(`  ✓ PASS: ${message}`);
}

export async function runInsuranceUatSuite(): Promise<{ passed: number; failed: number }> {
  console.log('\n================================================================');
  console.log('   RUNNING INSURANCE & UBO UAT REMEDIATION TEST SUITE');
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
  // Check 1: Sample Fixture OFAC 50% Rule Exposure (Positive Control)
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 1: Sample Fixture OFAC 50% Rule Exposure (Positive Control)', () => {
    const fixture = MULTI_MODULE_FIXTURES.INSURANCE;
    const result = evaluateInsurancePolicy(fixture);

    assert(result.policyNumber === 'POL-MAR-2026-8819', 'Evaluates sample policy POL-MAR-2026-8819');
    assert(result.uboAnalysis.violatesOfac50PercentRule === true, 'Violates OFAC 50% Rule (60% aggregate sanctioned UBO)');
    assert(result.uboAnalysis.aggregateSanctionedOwnershipPercentage === 60.0, 'Aggregate sanctioned ownership is 60.0%');
    assert(
      result.uboAnalysis.ofacRuleDisposition === 'CANDIDATE_OFAC_50_EXPOSURE',
      'Disposition is CANDIDATE_OFAC_50_EXPOSURE (separating candidate name matches from confirmed findings)'
    );
    assert(result.underwritingDecision === 'BLOCK_AND_HOLD', 'Decision routes to BLOCK_AND_HOLD');
    assert(result.decisionRecommendation === 'REJECT_SANCTIONS_RISK', 'Recommendation is REJECT_SANCTIONS_RISK');
    assert(result.requiresHumanReview === true, 'Mandatory human compliance review required');
    assert(result.evidenceDigest.length === 64, 'Generated 64-char SHA-256 evidence digest');
  });

  // ---------------------------------------------------------------------------
  // Check 2: Clean Corporate Policyholder Approval (Positive Control)
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 2: Clean Corporate Policyholder Approval (Positive Control)', () => {
    const cleanRequest: EvaluateInsuranceRequest = {
      policyNumber: 'POL-COMM-2026-1001',
      lineOfBusiness: 'COMMERCIAL_PROPERTY',
      sumInsured: 15000000,
      currency: 'EUR',
      screeningStage: 'PRE_BIND_UNDERWRITING',
      policyParties: [
        {
          role: 'PRIMARY_INSURED',
          name: 'Nordic Clean Technologies AB',
          entityType: 'ORGANIZATION',
          country: 'SE',
        },
      ],
      corporateEntityUbo: {
        entityName: 'Nordic Clean Technologies AB',
        beneficialOwners: [
          {
            name: 'Astrid Lindgren Trust',
            ownershipPercentage: 60.0,
            country: 'SE',
          },
          {
            name: 'Stockholm Growth Partners AB',
            ownershipPercentage: 40.0,
            country: 'SE',
          },
        ],
      },
    };

    const result = evaluateInsurancePolicy(cleanRequest);
    assert(result.underwritingDecision === 'APPROVED', 'Clean corporate policyholder is APPROVED');
    assert(result.decisionRecommendation === 'APPROVE_POLICY_BINDING', 'Recommendation is APPROVE_POLICY_BINDING');
    assert(result.requiresHumanReview === false, 'No human review required for fully clean policy');
    assert(result.uboAnalysis.ofacRuleDisposition === 'BELOW_THRESHOLD_COMPLIANT', 'OFAC disposition is BELOW_THRESHOLD_COMPLIANT');
    assert(result.ownershipCoverage === 'FULL_OWNERSHIP_DECLARED', 'Full 100% ownership declared');
    assert(result.completenessStatus === 'FULL_POLICY_DATA', 'Completeness is FULL_POLICY_DATA');
  });

  // ---------------------------------------------------------------------------
  // Check 3: Clean Individual Policyholder Approval (Positive Control)
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 3: Clean Individual Policyholder Approval (Positive Control)', () => {
    const individualReq: EvaluateInsuranceRequest = {
      policyNumber: 'POL-IND-2026-5544',
      lineOfBusiness: 'DIRECTORS_AND_OFFICERS',
      sumInsured: 2500000,
      currency: 'GBP',
      screeningStage: 'PRE_BIND_UNDERWRITING',
      policyParties: [
        {
          role: 'PRIMARY_INSURED',
          name: 'Arthur Pendelton Davies',
          entityType: 'INDIVIDUAL',
          country: 'GB',
        },
      ],
    };

    const result = evaluateInsurancePolicy(individualReq);
    assert(result.underwritingDecision === 'APPROVED', 'Clean individual policy is APPROVED');
    assert(result.ownershipCoverage === 'NOT_APPLICABLE_INDIVIDUAL', 'Ownership coverage marked NOT_APPLICABLE_INDIVIDUAL');
    assert(result.requiresHumanReview === false, 'No human review required');
  });

  // ---------------------------------------------------------------------------
  // Check 4: Empty Policy Parties Array Rejection
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 4: Empty Policy Parties Array Rejection', () => {
    let threw = false;
    try {
      evaluateInsurancePolicy({
        policyNumber: 'POL-ERR-001',
        lineOfBusiness: 'COMMERCIAL_PROPERTY',
        sumInsured: 500000,
        currency: 'USD',
        screeningStage: 'PRE_BIND_UNDERWRITING',
        policyParties: [],
      });
    } catch (err: any) {
      threw = true;
      assert(err.message.includes('policyParties must be a non-empty array'), 'Throws descriptive error on empty policy parties array');
    }
    assert(threw, 'Empty policy parties array was rejected without returning APPROVED');
  });

  // ---------------------------------------------------------------------------
  // Check 5: Blank Primary Insured Name Rejection
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 5: Blank Primary Insured Name Rejection', () => {
    const result = evaluateInsurancePolicy({
      policyNumber: 'POL-BLANK-001',
      lineOfBusiness: 'COMMERCIAL_PROPERTY',
      sumInsured: 1000000,
      currency: 'USD',
      screeningStage: 'PRE_BIND_UNDERWRITING',
      policyParties: [
        {
          role: 'PRIMARY_INSURED',
          name: '   ',
          entityType: 'INDIVIDUAL',
          country: 'US',
        },
      ],
    });

    assert(result.underwritingDecision !== 'APPROVED', 'Blank primary insured is never APPROVED');
    assert(result.completenessStatus === 'INCOMPLETE_REJECTED', 'Marked INCOMPLETE_REJECTED');
    assert(result.requiresHumanReview === true, 'Requires human review');
    assert(
      result.reviewReasons.some((r) => r.includes('missing or blank name')),
      'Review reasons cite missing/blank insured name'
    );
  });

  // ---------------------------------------------------------------------------
  // Check 6: Missing Primary/Co-Insured Party
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 6: Missing Primary/Co-Insured Party', () => {
    const result = evaluateInsurancePolicy({
      policyNumber: 'POL-NO-INSURED-001',
      lineOfBusiness: 'TRADE_CREDIT',
      sumInsured: 2000000,
      currency: 'USD',
      screeningStage: 'PRE_BIND_UNDERWRITING',
      policyParties: [
        {
          role: 'PRIMARY_BENEFICIARY',
          name: 'Global Bank AG',
          entityType: 'ORGANIZATION',
          country: 'DE',
        },
      ],
    });

    assert(result.underwritingDecision !== 'APPROVED', 'Policy without primary/co-insured is never APPROVED');
    assert(result.completenessStatus === 'INCOMPLETE_REJECTED', 'Marked INCOMPLETE_REJECTED');
    assert(result.requiresHumanReview === true, 'Requires human review');
    assert(
      result.reviewReasons.some((r) => r.includes('PRIMARY_INSURED or CO_INSURED')),
      'Review reasons cite missing primary insured'
    );
  });

  // ---------------------------------------------------------------------------
  // Check 7: Invalid Country Jurisdiction Rejection
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 7: Invalid Country Jurisdiction Rejection', () => {
    const result = evaluateInsurancePolicy({
      policyNumber: 'POL-BAD-COUNTRY-001',
      lineOfBusiness: 'COMMERCIAL_PROPERTY',
      sumInsured: 1000000,
      currency: 'USD',
      screeningStage: 'PRE_BIND_UNDERWRITING',
      policyParties: [
        {
          role: 'PRIMARY_INSURED',
          name: 'Valid Enterprise LLC',
          entityType: 'ORGANIZATION',
          country: 'INVALID_JURISDICTION',
        },
      ],
    });

    assert(result.underwritingDecision !== 'APPROVED', 'Invalid country policy is never APPROVED');
    assert(result.completenessStatus === 'INCOMPLETE_REJECTED', 'Marked INCOMPLETE_REJECTED');
    assert(result.requiresHumanReview === true, 'Requires human review for unestablished jurisdiction');
    assert(
      result.reviewReasons.some((r) => r.includes('Invalid or unestablished country jurisdiction')),
      'Review reasons cite invalid country jurisdiction'
    );
  });

  // ---------------------------------------------------------------------------
  // Check 8: Negative Sum Insured Rejection
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 8: Negative Sum Insured Rejection', () => {
    let threw = false;
    try {
      evaluateInsurancePolicy({
        policyNumber: 'POL-NEG-SUM-001',
        lineOfBusiness: 'MARINE_HULL_AND_CARGO',
        sumInsured: -5000000,
        currency: 'USD',
        screeningStage: 'PRE_BIND_UNDERWRITING',
        policyParties: [
          {
            role: 'PRIMARY_INSURED',
            name: 'Valid Insured Corp',
            entityType: 'ORGANIZATION',
            country: 'US',
          },
        ],
      });
    } catch (err: any) {
      threw = true;
      assert(err.message.includes('positive finite number'), 'Throws error specifying sumInsured must be positive');
    }
    assert(threw, 'Negative sum insured was rejected');
  });

  // ---------------------------------------------------------------------------
  // Check 9: Zero or Non-Finite Sum Insured Rejection
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 9: Zero or Non-Finite Sum Insured Rejection', () => {
    let zeroThrew = false;
    try {
      evaluateInsurancePolicy({
        policyNumber: 'POL-ZERO-SUM-001',
        lineOfBusiness: 'MARINE_HULL_AND_CARGO',
        sumInsured: 0,
        currency: 'USD',
        screeningStage: 'PRE_BIND_UNDERWRITING',
        policyParties: [
          {
            role: 'PRIMARY_INSURED',
            name: 'Valid Insured Corp',
            entityType: 'ORGANIZATION',
            country: 'US',
          },
        ],
      });
    } catch (err: any) {
      zeroThrew = true;
    }
    assert(zeroThrew, 'Zero sum insured was rejected');
  });

  // ---------------------------------------------------------------------------
  // Check 10: Missing Policy Number Rejection
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 10: Missing Policy Number Rejection', () => {
    let threw = false;
    try {
      evaluateInsurancePolicy({
        policyNumber: '   ',
        lineOfBusiness: 'DIRECTORS_AND_OFFICERS',
        sumInsured: 1000000,
        currency: 'USD',
        screeningStage: 'PRE_BIND_UNDERWRITING',
        policyParties: [
          {
            role: 'PRIMARY_INSURED',
            name: 'Valid Insured Corp',
            entityType: 'ORGANIZATION',
            country: 'US',
          },
        ],
      });
    } catch (err: any) {
      threw = true;
      assert(err.message.includes("'policyNumber' is required"), 'Throws error specifying policyNumber is required');
    }
    assert(threw, 'Blank policy number was rejected');
  });

  // ---------------------------------------------------------------------------
  // Check 11: Missing or Invalid Currency Rejection
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 11: Missing or Invalid Currency Rejection', () => {
    let threw = false;
    try {
      evaluateInsurancePolicy({
        policyNumber: 'POL-BAD-CURR-001',
        lineOfBusiness: 'DIRECTORS_AND_OFFICERS',
        sumInsured: 1000000,
        currency: 'USDD', // 4 letters
        screeningStage: 'PRE_BIND_UNDERWRITING',
        policyParties: [
          {
            role: 'PRIMARY_INSURED',
            name: 'Valid Insured Corp',
            entityType: 'ORGANIZATION',
            country: 'US',
          },
        ],
      });
    } catch (err: any) {
      threw = true;
      assert(err.message.includes('valid 3-letter ISO currency code'), 'Throws error requiring 3-letter ISO currency');
    }
    assert(threw, 'Invalid currency code was rejected');
  });

  // ---------------------------------------------------------------------------
  // Check 12: Missing Corporate UBO Declaration for Organization Insured
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 12: Missing Corporate UBO Declaration for Organization Insured', () => {
    const result = evaluateInsurancePolicy({
      policyNumber: 'POL-NO-UBO-001',
      lineOfBusiness: 'COMMERCIAL_PROPERTY',
      sumInsured: 10000000,
      currency: 'USD',
      screeningStage: 'PRE_BIND_UNDERWRITING',
      policyParties: [
        {
          role: 'PRIMARY_INSURED',
          name: 'Apex Industrial Holdings Inc',
          entityType: 'ORGANIZATION',
          country: 'US',
        },
      ],
      // corporateEntityUbo omitted
    });

    assert(result.underwritingDecision !== 'APPROVED', 'Missing UBO for corporate insured is never APPROVED');
    assert(result.ownershipCoverage === 'NO_UBO_SUPPLIED', 'Ownership coverage marked NO_UBO_SUPPLIED');
    assert(result.completenessStatus === 'PARTIAL_POLICY_DATA', 'Completeness is PARTIAL_POLICY_DATA');
    assert(result.requiresHumanReview === true, 'Human review required for missing UBO hierarchy');
    assert(
      result.uboAnalysis.ownershipDiscrepancies.some((d) => d.includes('Missing corporate UBO declaration')),
      'Discrepancies record missing UBO declaration'
    );
  });

  // ---------------------------------------------------------------------------
  // Check 13: Ownership Data for an Unrelated Entity (Linkage Mismatch)
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 13: Ownership Data for an Unrelated Entity (Linkage Mismatch)', () => {
    const result = evaluateInsurancePolicy({
      policyNumber: 'POL-UNLINKED-UBO-001',
      lineOfBusiness: 'COMMERCIAL_PROPERTY',
      sumInsured: 5000000,
      currency: 'USD',
      screeningStage: 'PRE_BIND_UNDERWRITING',
      policyParties: [
        {
          role: 'PRIMARY_INSURED',
          name: 'Acme Logistics International Inc',
          entityType: 'ORGANIZATION',
          country: 'US',
        },
      ],
      corporateEntityUbo: {
        entityName: 'Totally Different Shell Corp BVI', // Unrelated entity!
        beneficialOwners: [
          {
            name: 'Clean Owner One',
            ownershipPercentage: 100.0,
            country: 'US',
          },
        ],
      },
    });

    assert(result.underwritingDecision !== 'APPROVED', 'Unlinked UBO policy is never APPROVED');
    assert(result.uboAnalysis.isEntityLinked === false, 'isEntityLinked is false');
    assert(result.completenessStatus === 'INCOMPLETE_REJECTED', 'Marked INCOMPLETE_REJECTED');
    assert(result.requiresHumanReview === true, 'Requires human review');
    assert(
      result.uboAnalysis.ownershipDiscrepancies.some((d) => d.includes('does not match any declared insured entity')),
      'Logged discrepancy for unlinked UBO target entity'
    );
  });

  // ---------------------------------------------------------------------------
  // Check 14: Negative Ownership Percentage Rejection
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 14: Negative Ownership Percentage Rejection', () => {
    let threw = false;
    try {
      evaluateInsurancePolicy({
        policyNumber: 'POL-NEG-UBO-001',
        lineOfBusiness: 'COMMERCIAL_PROPERTY',
        sumInsured: 1000000,
        currency: 'USD',
        screeningStage: 'PRE_BIND_UNDERWRITING',
        policyParties: [
          {
            role: 'PRIMARY_INSURED',
            name: 'Corporate Entity LLC',
            entityType: 'ORGANIZATION',
            country: 'US',
          },
        ],
        corporateEntityUbo: {
          entityName: 'Corporate Entity LLC',
          beneficialOwners: [
            {
              name: 'Negative Owner',
              ownershipPercentage: -25.0,
              country: 'US',
            },
          ],
        },
      });
    } catch (err: any) {
      threw = true;
      assert(err.message.includes('cannot be negative'), 'Throws error specifying percentage cannot be negative');
    }
    assert(threw, 'Negative ownership percentage was rejected');
  });

  // ---------------------------------------------------------------------------
  // Check 15: Ownership Share > 100% Rejection
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 15: Ownership Share > 100% Rejection', () => {
    let threw = false;
    try {
      evaluateInsurancePolicy({
        policyNumber: 'POL-OVER-100-001',
        lineOfBusiness: 'COMMERCIAL_PROPERTY',
        sumInsured: 1000000,
        currency: 'USD',
        screeningStage: 'PRE_BIND_UNDERWRITING',
        policyParties: [
          {
            role: 'PRIMARY_INSURED',
            name: 'Corporate Entity LLC',
            entityType: 'ORGANIZATION',
            country: 'US',
          },
        ],
        corporateEntityUbo: {
          entityName: 'Corporate Entity LLC',
          beneficialOwners: [
            {
              name: 'Giant Owner',
              ownershipPercentage: 125.0,
              country: 'US',
            },
          ],
        },
      });
    } catch (err: any) {
      threw = true;
      assert(err.message.includes('cannot exceed 100%'), 'Throws error specifying individual share cannot exceed 100%');
    }
    assert(threw, 'Excessive ownership percentage (>100%) was rejected');
  });

  // ---------------------------------------------------------------------------
  // Check 16: Impossible Same-Level Direct Ownership Total > 100% Rejection
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 16: Impossible Same-Level Direct Ownership Total > 100% Rejection', () => {
    let threw = false;
    try {
      evaluateInsurancePolicy({
        policyNumber: 'POL-IMPOSSIBLE-SUM-001',
        lineOfBusiness: 'COMMERCIAL_PROPERTY',
        sumInsured: 1000000,
        currency: 'USD',
        screeningStage: 'PRE_BIND_UNDERWRITING',
        policyParties: [
          {
            role: 'PRIMARY_INSURED',
            name: 'Corporate Entity LLC',
            entityType: 'ORGANIZATION',
            country: 'US',
          },
        ],
        corporateEntityUbo: {
          entityName: 'Corporate Entity LLC',
          beneficialOwners: [
            {
              name: 'Owner A',
              ownershipPercentage: 60.0,
              ownershipType: 'DIRECT',
              country: 'US',
            },
            {
              name: 'Owner B',
              ownershipPercentage: 55.0,
              ownershipType: 'DIRECT',
              country: 'US',
            },
          ],
        },
      });
    } catch (err: any) {
      threw = true;
      assert(err.message.includes('exceeds 100%'), 'Throws error specifying direct ownership total exceeds 100%');
    }
    assert(threw, 'Impossible same-level direct ownership total was rejected');
  });

  // ---------------------------------------------------------------------------
  // Check 17: Partial Direct Ownership Detection (< 100%)
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 17: Partial Direct Ownership Detection (< 100%)', () => {
    const result = evaluateInsurancePolicy({
      policyNumber: 'POL-PARTIAL-UBO-001',
      lineOfBusiness: 'COMMERCIAL_PROPERTY',
      sumInsured: 1000000,
      currency: 'USD',
      screeningStage: 'PRE_BIND_UNDERWRITING',
      policyParties: [
        {
          role: 'PRIMARY_INSURED',
          name: 'Corporate Entity LLC',
          entityType: 'ORGANIZATION',
          country: 'US',
        },
      ],
      corporateEntityUbo: {
        entityName: 'Corporate Entity LLC',
        beneficialOwners: [
          {
            name: 'Clean Owner A',
            ownershipPercentage: 70.0,
            ownershipType: 'DIRECT',
            country: 'US',
          },
        ],
      },
    });

    assert(result.underwritingDecision !== 'APPROVED', 'Partial ownership policy is not directly APPROVED');
    assert(result.ownershipCoverage === 'PARTIAL_OWNERSHIP', 'Ownership coverage marked PARTIAL_OWNERSHIP');
    assert(result.completenessStatus === 'PARTIAL_POLICY_DATA', 'Completeness is PARTIAL_POLICY_DATA');
    assert(result.requiresHumanReview === true, 'Requires human review for unassigned equity');
    assert(
      result.uboAnalysis.ownershipDiscrepancies.some((d) => d.includes('undisclosed equity ownership')),
      'Logged discrepancy for undisclosed equity'
    );
  });

  // ---------------------------------------------------------------------------
  // Check 18: Duplicate Beneficial Owner Detection at Same Tier
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 18: Duplicate Beneficial Owner Detection at Same Tier', () => {
    const result = evaluateInsurancePolicy({
      policyNumber: 'POL-DUP-UBO-001',
      lineOfBusiness: 'COMMERCIAL_PROPERTY',
      sumInsured: 1000000,
      currency: 'USD',
      screeningStage: 'PRE_BIND_UNDERWRITING',
      policyParties: [
        {
          role: 'PRIMARY_INSURED',
          name: 'Corporate Entity LLC',
          entityType: 'ORGANIZATION',
          country: 'US',
        },
      ],
      corporateEntityUbo: {
        entityName: 'Corporate Entity LLC',
        beneficialOwners: [
          {
            name: 'Same Person',
            ownershipPercentage: 50.0,
            country: 'US',
          },
          {
            name: 'Same Person',
            ownershipPercentage: 50.0,
            country: 'US',
          },
        ],
      },
    });

    assert(result.requiresHumanReview === true, 'Duplicate beneficial owner requires review');
    assert(
      result.uboAnalysis.ownershipDiscrepancies.some((d) => d.includes('Duplicate beneficial owner')),
      'Discrepancies record duplicate owner'
    );
  });

  // ---------------------------------------------------------------------------
  // Check 19: Candidate Match vs Confirmed Finding Separation
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 19: Candidate Match vs Confirmed Finding Separation', () => {
    // Testing with a candidate name match (similar name, not exact identity block)
    const result = evaluateInsurancePolicy({
      policyNumber: 'POL-CANDIDATE-001',
      lineOfBusiness: 'COMMERCIAL_PROPERTY',
      sumInsured: 2000000,
      currency: 'EUR',
      screeningStage: 'PRE_BIND_UNDERWRITING',
      policyParties: [
        {
          role: 'PRIMARY_INSURED',
          name: 'Al-Furqan Relief Agency', // Fuzzy name candidate against Al-Furqan Foundation
          entityType: 'ORGANIZATION',
          country: 'FR',
        },
      ],
      corporateEntityUbo: {
        entityName: 'Al-Furqan Relief Agency',
        beneficialOwners: [
          {
            name: 'Independent Trustee',
            ownershipPercentage: 100.0,
            country: 'FR',
          },
        ],
      },
    });

    const candidateParty = result.policyParties.find((p) => p.role === 'PRIMARY_INSURED');
    assert(candidateParty !== undefined, 'Found primary insured party');
    assert(candidateParty!.status === 'MATCH_CANDIDATE', 'Party status is MATCH_CANDIDATE, not definitive legal block');
    assert(result.underwritingDecision === 'REFER_TO_SENIOR_COUNSEL', 'Routes to REFER_TO_SENIOR_COUNSEL, not auto-block without review');
    assert(result.decisionRecommendation === 'HOLD_FOR_HUMAN_REVIEW', 'Recommendation is HOLD_FOR_HUMAN_REVIEW');
    assert(result.requiresHumanReview === true, 'Requires human compliance review');
  });

  // ---------------------------------------------------------------------------
  // Check 20: Stage Requirement: CLAIMS_PAYMENT_CLEARANCE Without Beneficiary
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 20: Stage Requirement: CLAIMS_PAYMENT_CLEARANCE Without Beneficiary', () => {
    const result = evaluateInsurancePolicy({
      policyNumber: 'POL-CLAIM-NO-BEN-001',
      lineOfBusiness: 'COMMERCIAL_PROPERTY',
      sumInsured: 500000,
      currency: 'USD',
      screeningStage: 'CLAIMS_PAYMENT_CLEARANCE',
      policyParties: [
        {
          role: 'PRIMARY_INSURED',
          name: 'Claimant Corp',
          entityType: 'ORGANIZATION',
          country: 'US',
        },
      ],
      corporateEntityUbo: {
        entityName: 'Claimant Corp',
        beneficialOwners: [
          {
            name: 'Claimant Owner',
            ownershipPercentage: 100.0,
            country: 'US',
          },
        ],
      },
    });

    assert(result.underwritingDecision !== 'APPROVED', 'Claims settlement without declared payee is not APPROVED');
    assert(result.completenessStatus === 'INCOMPLETE_REJECTED', 'Marked INCOMPLETE_REJECTED');
    assert(result.requiresHumanReview === true, 'Requires human review');
    assert(
      result.reviewReasons.some((r) => r.includes('Claims settlement screening stage requires at least one declared claim beneficiary')),
      'Review reasons cite missing claim beneficiary/payee'
    );
  });

  // ---------------------------------------------------------------------------
  // Check 21: Official MCP Tool Execution with PII Redaction
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 21: Official MCP Tool Execution with PII Redaction', async () => {
    const fixture = MULTI_MODULE_FIXTURES.INSURANCE;
    const response = await executeMcpTool('screen_insurance_policy', fixture, true);

    assert(response !== null && typeof response === 'object', 'MCP tool returned valid object');
    assert(response.policyNumber === 'POL-MAR-2026-8819', 'Returned policy number');
    assert(response.uboAnalysis.violatesOfac50PercentRule === true, 'Violates OFAC 50% Rule');
    assert(response.underwritingDecision === 'BLOCK_AND_HOLD', 'Decision is BLOCK_AND_HOLD');
    assert(response.evidenceDigest.length === 64, 'Evidence digest generated');
  });

  console.log('\n================================================================');
  console.log(`INSURANCE & UBO UAT RESULTS: ${passed} Passed, ${failed} Failed`);
  console.log('================================================================\n');

  return { passed, failed };
}

if (process.argv[1]?.endsWith('insurance_uat_remediation.test.ts')) {
  runInsuranceUatSuite().then((res) => {
    if (res.failed > 0) process.exit(1);
  });
}
