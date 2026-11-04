/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import {
  InsuranceEvaluation,
  InsurancePolicyholder,
  BeneficialOwnerShare,
  FindingSeverity,
  CanonicalParty,
} from '../../../shared/types.ts';
import { embeddedSyntheticEngine } from '../engineAdapter.ts';
import { extractIsoCountryCode } from './maritimeService.ts';
import { createHash } from 'node:crypto';

export interface EvaluateInsuranceRequest {
  policyNumber: string;
  lineOfBusiness: InsuranceEvaluation['lineOfBusiness'];
  sumInsured: number;
  currency: string;
  screeningStage: InsuranceEvaluation['screeningStage'];
  tenantId?: string;
  policyParties: {
    role: InsurancePolicyholder['role'];
    name: string;
    entityType: 'INDIVIDUAL' | 'ORGANIZATION';
    country: string;
  }[];
  corporateEntityUbo?: {
    entityName: string;
    beneficialOwners: {
      name: string;
      ownershipPercentage: number;
      ownershipType?: 'DIRECT' | 'INDIRECT';
      country: string;
    }[];
  };
}

export function evaluateInsurancePolicy(req: EvaluateInsuranceRequest): InsuranceEvaluation {
  // ---------------------------------------------------------------------------
  // 0. Defensive Request & Policy Details Validation
  // ---------------------------------------------------------------------------
  if (!req || typeof req !== 'object') {
    throw new Error('Invalid insurance evaluation request: request body must be a non-empty JSON object.');
  }

  // 1. Validate Policy Number
  if (!req.policyNumber || typeof req.policyNumber !== 'string' || req.policyNumber.trim() === '') {
    throw new Error("Invalid insurance evaluation request: 'policyNumber' is required.");
  }

  // 2. Validate Sum Insured
  if (
    req.sumInsured === undefined ||
    req.sumInsured === null ||
    typeof req.sumInsured !== 'number' ||
    !Number.isFinite(req.sumInsured) ||
    req.sumInsured <= 0
  ) {
    throw new Error(`Invalid insurance sumInsured: ${req.sumInsured}. Sum insured must be a positive finite number.`);
  }

  // 3. Validate Currency
  if (!req.currency || typeof req.currency !== 'string' || !/^[A-Z]{3}$/.test(req.currency.trim().toUpperCase())) {
    throw new Error(`Invalid insurance currency: '${req.currency}'. Currency must be a valid 3-letter ISO currency code.`);
  }

  // 4. Validate Screening Stage
  const validStages = ['PRE_BIND_UNDERWRITING', 'CLAIMS_PAYMENT_CLEARANCE', 'POLICY_RENEWAL', 'MIDTERM_ENDORSEMENT'];
  if (!req.screeningStage || !validStages.includes(req.screeningStage)) {
    throw new Error(
      `Invalid screeningStage: '${req.screeningStage}'. Supported stages: PRE_BIND_UNDERWRITING, CLAIMS_PAYMENT_CLEARANCE, POLICY_RENEWAL, MIDTERM_ENDORSEMENT.`
    );
  }

  // 5. Validate Line of Business
  const validLines = ['MARINE_HULL_AND_CARGO', 'DIRECTORS_AND_OFFICERS', 'COMMERCIAL_PROPERTY', 'AVIATION', 'TRADE_CREDIT'];
  if (!req.lineOfBusiness || !validLines.includes(req.lineOfBusiness)) {
    throw new Error(
      `Invalid lineOfBusiness: '${req.lineOfBusiness}'. Supported lines: MARINE_HULL_AND_CARGO, DIRECTORS_AND_OFFICERS, COMMERCIAL_PROPERTY, AVIATION, TRADE_CREDIT.`
    );
  }

  // 6. Validate Policy Parties Array Presence
  if (!req.policyParties || !Array.isArray(req.policyParties) || req.policyParties.length === 0) {
    throw new Error('Invalid insurance evaluation request: policyParties must be a non-empty array containing at least one insured entity.');
  }

  const reviewReasons: string[] = [];
  const ownershipDiscrepancies: string[] = [];
  let requiresHumanReview = false;
  let completenessStatus: InsuranceEvaluation['completenessStatus'] = 'FULL_POLICY_DATA';

  // ---------------------------------------------------------------------------
  // 1. Validate Required Policy Parties (Insured, Countries & Stage Requirements)
  // ---------------------------------------------------------------------------
  const insuredParty = req.policyParties.find((p) => p.role === 'PRIMARY_INSURED' || p.role === 'CO_INSURED');
  if (!insuredParty) {
    reviewReasons.push('Policy must declare at least one PRIMARY_INSURED or CO_INSURED entity.');
    completenessStatus = 'INCOMPLETE_REJECTED';
    requiresHumanReview = true;
  } else if (!insuredParty.name || insuredParty.name.trim() === '') {
    reviewReasons.push('Primary insured entity name is missing or blank. Risk cannot be screened.');
    completenessStatus = 'INCOMPLETE_REJECTED';
    requiresHumanReview = true;
  }

  // Stage-specific check: CLAIMS_PAYMENT_CLEARANCE requires a beneficiary or loss payee
  if (req.screeningStage === 'CLAIMS_PAYMENT_CLEARANCE') {
    const claimPayee = req.policyParties.find(
      (p) => p.role === 'PRIMARY_BENEFICIARY' || p.role === 'CONTINGENT_BENEFICIARY' || p.role === 'LOSS_PAYEE'
    );
    if (!claimPayee || !claimPayee.name || claimPayee.name.trim() === '') {
      reviewReasons.push('Claims settlement screening stage requires at least one declared claim beneficiary or loss payee.');
      completenessStatus = 'INCOMPLETE_REJECTED';
      requiresHumanReview = true;
    }
  }

  let highestScore = 0;
  let findingSeverity: FindingSeverity = 'NO_MATCH_FOUND';
  let hasSanctionedParty = false;

  // Screen Policy Parties
  const screenedParties: InsurancePolicyholder[] = req.policyParties.map((p) => {
    const isNameBlank = !p.name || p.name.trim() === '';
    const isoCountry = extractIsoCountryCode(p.country);
    const isCountryInvalid = !isoCountry;

    if (isNameBlank) {
      reviewReasons.push(`Policy party with role '${p.role}' has missing or blank name.`);
      completenessStatus = 'INCOMPLETE_REJECTED';
      requiresHumanReview = true;
      return {
        role: p.role,
        name: '',
        entityType: p.entityType,
        country: p.country || '',
        matches: [],
        status: 'INCOMPLETE_NOT_SCREENED',
        isScreened: false,
      };
    }

    if (isCountryInvalid) {
      reviewReasons.push(`Invalid or unestablished country jurisdiction for party '${p.name}' (${p.role}): '${p.country || 'EMPTY'}'.`);
      completenessStatus = 'INCOMPLETE_REJECTED';
      requiresHumanReview = true;
    }

    const canonicalP: CanonicalParty = {
      partyId: `ins_party_${Math.random().toString(36).slice(2, 8)}`,
      role: p.role === 'PRIMARY_BENEFICIARY' || p.role === 'LOSS_PAYEE' ? 'CREDITOR' : 'DEBTOR',
      name: p.name,
      country: p.country,
      identifiers: [],
      provenance: { sourceTag: p.role, rawSnippet: `${p.role}: ${p.name}` },
    };

    const outcome = embeddedSyntheticEngine.screenPartySync(canonicalP, req.tenantId || 'default');
    if (outcome.highestScore > highestScore) highestScore = outcome.highestScore;
    if (outcome.findingSeverity === 'EXACT_IDENTIFIER_MATCH') findingSeverity = 'EXACT_IDENTIFIER_MATCH';
    else if (outcome.findingSeverity === 'FUZZY_NAME_CANDIDATE' && findingSeverity !== 'EXACT_IDENTIFIER_MATCH') {
      findingSeverity = 'FUZZY_NAME_CANDIDATE';
    }

    const isMatch = outcome.matches.length > 0;
    if (isMatch) {
      hasSanctionedParty = true;
      reviewReasons.push(`Sanctions match candidate identified for policy party ${p.role}: '${p.name}'.`);
      requiresHumanReview = true;
    }

    return {
      role: p.role,
      name: p.name,
      entityType: p.entityType,
      country: p.country,
      matches: outcome.matches,
      status: isMatch ? 'MATCH_CANDIDATE' : 'SCREENED_CLEAR',
      isScreened: true,
    };
  });

  // ---------------------------------------------------------------------------
  // 2. Corporate UBO Validation & Entity Linkage Check
  // ---------------------------------------------------------------------------
  let ownershipCoverage: InsuranceEvaluation['ownershipCoverage'] = 'FULL_OWNERSHIP_DECLARED';
  let isEntityLinked = false;
  let totalDeclaredDirectOwnership = 0;
  const screenedOwners: BeneficialOwnerShare[] = [];
  let aggregateSanctionedOwnership = 0;
  let aggregateCandidateOwnership = 0;

  // Find corporate insured entities requiring UBO disclosure
  const corporateInsured = req.policyParties.find(
    (p) => (p.role === 'PRIMARY_INSURED' || p.role === 'CO_INSURED') && p.entityType === 'ORGANIZATION'
  );

  if (corporateInsured) {
    if (!req.corporateEntityUbo || !req.corporateEntityUbo.beneficialOwners || req.corporateEntityUbo.beneficialOwners.length === 0) {
      ownershipCoverage = 'NO_UBO_SUPPLIED';
      ownershipDiscrepancies.push(`Missing corporate UBO declaration for organizational insured '${corporateInsured.name}'.`);
      reviewReasons.push(`Corporate policyholder '${corporateInsured.name}' is missing beneficial ownership (UBO) declaration. OFAC 50% Rule cannot be cleared without ownership hierarchy.`);
      if (completenessStatus !== 'INCOMPLETE_REJECTED') completenessStatus = 'PARTIAL_POLICY_DATA';
      requiresHumanReview = true;
    } else {
      // Check Entity Linkage: does corporateEntityUbo.entityName match an insured entity in policyParties?
      const targetName = req.corporateEntityUbo.entityName?.trim().toLowerCase() || '';
      const matchedParty = req.policyParties.find((p) => p.name.trim().toLowerCase() === targetName);

      if (!matchedParty) {
        isEntityLinked = false;
        ownershipDiscrepancies.push(
          `Corporate UBO target entity '${req.corporateEntityUbo.entityName}' does not match any declared insured entity in policyParties.`
        );
        reviewReasons.push(`Ownership data belongs to an unrelated entity ('${req.corporateEntityUbo.entityName}'), not the declared insured party.`);
        completenessStatus = 'INCOMPLETE_REJECTED';
        requiresHumanReview = true;
      } else {
        isEntityLinked = true;
      }

      // 1. Check Individual Beneficial Owner Percentages
      for (const owner of req.corporateEntityUbo.beneficialOwners) {
        if (!Number.isFinite(owner.ownershipPercentage)) {
          throw new Error(`Invalid ownership percentage: ${owner.ownershipPercentage}. Must be a finite number.`);
        }
        if (owner.ownershipPercentage < 0) {
          throw new Error(`Invalid ownership percentage: ${owner.ownershipPercentage}%. Percentage cannot be negative.`);
        }
        if (owner.ownershipPercentage > 100) {
          throw new Error(`Invalid ownership percentage: ${owner.ownershipPercentage}%. Individual ownership share cannot exceed 100%.`);
        }
      }

      // 2. Check Ownership Percentages & Totals
      const directOwners = req.corporateEntityUbo.beneficialOwners.filter(
        (o) => !o.ownershipType || o.ownershipType === 'DIRECT'
      );
      totalDeclaredDirectOwnership = directOwners.reduce((acc, o) => acc + (o.ownershipPercentage || 0), 0);

      // Check for impossible same-level total > 100%
      if (totalDeclaredDirectOwnership > 100.01) {
        throw new Error(
          `Impossible ownership declaration: total direct ownership shares sum to ${totalDeclaredDirectOwnership}% (exceeds 100%).`
        );
      }

      // Check for partial coverage (< 100%)
      if (totalDeclaredDirectOwnership < 100.0) {
        ownershipCoverage = 'PARTIAL_OWNERSHIP';
        const unassigned = (100.0 - totalDeclaredDirectOwnership).toFixed(1);
        ownershipDiscrepancies.push(`Declared direct UBO shares total ${totalDeclaredDirectOwnership}%, leaving ${unassigned}% undisclosed equity ownership.`);
        reviewReasons.push(`Incomplete corporate ownership: ${unassigned}% equity unaccounted for.`);
        requiresHumanReview = true;
        if (completenessStatus !== 'INCOMPLETE_REJECTED') completenessStatus = 'PARTIAL_POLICY_DATA';
      }

      // Check for duplicate owners
      const seenNames = new Set<string>();
      for (const o of req.corporateEntityUbo.beneficialOwners) {
        const cleanName = (o.name || '').trim().toLowerCase();
        if (cleanName && seenNames.has(cleanName)) {
          ownershipDiscrepancies.push(`Duplicate beneficial owner declared at same tier: '${o.name}'.`);
          reviewReasons.push(`Duplicate beneficial owner '${o.name}' in ownership declaration.`);
          requiresHumanReview = true;
        }
        if (cleanName) seenNames.add(cleanName);
      }

      // Screen Each Beneficial Owner
      for (const owner of req.corporateEntityUbo.beneficialOwners) {
        const isOwnerNameBlank = !owner.name || owner.name.trim() === '';
        const isoOwnerCountry = extractIsoCountryCode(owner.country);

        if (isOwnerNameBlank) {
          ownershipDiscrepancies.push('Beneficial owner entry has blank or missing name.');
          completenessStatus = 'INCOMPLETE_REJECTED';
          requiresHumanReview = true;
          screenedOwners.push({
            name: '',
            ownershipPercentage: owner.ownershipPercentage,
            ownershipType: owner.ownershipType,
            isSanctioned: false,
            isMatchCandidate: false,
            country: owner.country || '',
            matches: [],
            status: 'INCOMPLETE_NOT_SCREENED',
            isScreened: false,
          });
          continue;
        }

        if (!isoOwnerCountry) {
          ownershipDiscrepancies.push(`Beneficial owner '${owner.name}' has invalid country: '${owner.country || 'EMPTY'}'.`);
          reviewReasons.push(`Beneficial owner '${owner.name}' country is invalid.`);
          requiresHumanReview = true;
        }

        const ownerParty: CanonicalParty = {
          partyId: `owner_${Math.random().toString(36).slice(2, 8)}`,
          role: 'DEBTOR',
          name: owner.name,
          country: owner.country,
          identifiers: [],
          provenance: { sourceTag: 'UBO_SHAREHOLDER', rawSnippet: `UBO: ${owner.name} (${owner.ownershipPercentage}%)` },
        };

        const outcome = embeddedSyntheticEngine.screenPartySync(ownerParty, req.tenantId || 'default');
        const isExactMatch = outcome.matches.some((m) => m.isExactIdentifier || m.similarityScore >= 1.0);
        const isMatch = outcome.matches.length > 0;

        if (isMatch) {
          aggregateSanctionedOwnership += owner.ownershipPercentage;
          aggregateCandidateOwnership += owner.ownershipPercentage;
          if (outcome.highestScore > highestScore) highestScore = outcome.highestScore;
          if (outcome.findingSeverity === 'EXACT_IDENTIFIER_MATCH') findingSeverity = 'EXACT_IDENTIFIER_MATCH';
          else if (outcome.findingSeverity === 'FUZZY_NAME_CANDIDATE' && findingSeverity !== 'EXACT_IDENTIFIER_MATCH') {
            findingSeverity = 'FUZZY_NAME_CANDIDATE';
          }
          reviewReasons.push(`Beneficial owner '${owner.name}' (${owner.ownershipPercentage}%) matched sanctions candidate.`);
          requiresHumanReview = true;
        }

        screenedOwners.push({
          name: owner.name,
          ownershipPercentage: owner.ownershipPercentage,
          ownershipType: owner.ownershipType,
          isSanctioned: isMatch,
          isMatchCandidate: isMatch,
          country: owner.country,
          matches: outcome.matches,
          status: isMatch ? 'MATCH_CANDIDATE' : 'SCREENED_CLEAR',
          isScreened: true,
        });
      }
    }
  } else {
    ownershipCoverage = 'NOT_APPLICABLE_INDIVIDUAL';
  }

  // ---------------------------------------------------------------------------
  // 3. OFAC 50% Rule & Disposition Calculation
  // ---------------------------------------------------------------------------
  const violatesOfac50PercentRule = aggregateSanctionedOwnership >= 50.0;
  let ofacRuleDisposition: InsuranceEvaluation['uboAnalysis']['ofacRuleDisposition'] = 'BELOW_THRESHOLD_COMPLIANT';
  if (violatesOfac50PercentRule) {
    ofacRuleDisposition =
      findingSeverity === 'EXACT_IDENTIFIER_MATCH'
        ? 'CONFIRMED_OFAC_50_VIOLATION'
        : 'CANDIDATE_OFAC_50_EXPOSURE';
  }

  // ---------------------------------------------------------------------------
  // 4. Underwriting Decision & Recommendation Routing
  // ---------------------------------------------------------------------------
  let underwritingDecision: InsuranceEvaluation['underwritingDecision'] = 'APPROVED';
  let decisionRecommendation: InsuranceEvaluation['decisionRecommendation'] = 'APPROVE_POLICY_BINDING';

  if (violatesOfac50PercentRule || findingSeverity === 'EXACT_IDENTIFIER_MATCH') {
    underwritingDecision = 'BLOCK_AND_HOLD';
    decisionRecommendation = 'REJECT_SANCTIONS_RISK';
    requiresHumanReview = true;
  } else if (
    findingSeverity === 'FUZZY_NAME_CANDIDATE' ||
    aggregateSanctionedOwnership >= 25.0 ||
    requiresHumanReview ||
    completenessStatus !== 'FULL_POLICY_DATA'
  ) {
    underwritingDecision = 'REFER_TO_SENIOR_COUNSEL';
    decisionRecommendation = 'HOLD_FOR_HUMAN_REVIEW';
    requiresHumanReview = true;
  } else {
    underwritingDecision = 'APPROVED';
    decisionRecommendation = 'APPROVE_POLICY_BINDING';
  }

  const timestamp = new Date().toISOString();
  const evidenceDigest = createHash('sha256')
    .update(
      JSON.stringify({
        policyNumber: req.policyNumber,
        sumInsured: req.sumInsured,
        currency: req.currency,
        aggregateSanctionedOwnership,
        violatesOfac50PercentRule,
        completenessStatus,
        underwritingDecision,
        decisionRecommendation,
        timestamp,
      })
    )
    .digest('hex');

  return {
    id: `ins_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    policyNumber: req.policyNumber,
    lineOfBusiness: req.lineOfBusiness,
    sumInsured: req.sumInsured,
    currency: req.currency,
    screeningStage: req.screeningStage,
    policyParties: screenedParties,
    ownershipCoverage,
    uboAnalysis: {
      targetEntityName: req.corporateEntityUbo?.entityName || req.policyParties[0]?.name || 'N/A',
      isEntityLinked,
      totalDeclaredDirectOwnershipPercentage: totalDeclaredDirectOwnership,
      beneficialOwners: screenedOwners,
      aggregateSanctionedOwnershipPercentage: aggregateSanctionedOwnership,
      aggregateCandidateOwnershipPercentage: aggregateCandidateOwnership,
      violatesOfac50PercentRule,
      ofacRuleDisposition,
      ownershipDiscrepancies,
    },
    completenessStatus,
    decisionRecommendation,
    requiresHumanReview,
    reviewReasons,
    findingSeverity,
    highestScore,
    underwritingDecision,
    evidenceDigest,
    timestamp,
  };
}
