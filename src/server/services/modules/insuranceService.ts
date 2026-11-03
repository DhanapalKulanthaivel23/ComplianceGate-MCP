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
import { createHash } from 'node:crypto';

export interface EvaluateInsuranceRequest {
  policyNumber: string;
  lineOfBusiness: InsuranceEvaluation['lineOfBusiness'];
  sumInsured: number;
  currency: string;
  screeningStage: InsuranceEvaluation['screeningStage'];
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
      country: string;
    }[];
  };
}

export function evaluateInsurancePolicy(req: EvaluateInsuranceRequest): InsuranceEvaluation {
  let highestScore = 0;
  let findingSeverity: FindingSeverity = 'NO_MATCH_FOUND';

  // 1. Screen Policy Parties
  const screenedParties: InsurancePolicyholder[] = req.policyParties.map((p) => {
    const canonicalP: CanonicalParty = {
      partyId: `ins_party_${Math.random().toString(36).slice(2, 8)}`,
      role: p.role === 'PRIMARY_BENEFICIARY' ? 'CREDITOR' : 'DEBTOR',
      name: p.name,
      country: p.country,
      identifiers: [],
      provenance: { sourceTag: p.role, rawSnippet: `${p.role}: ${p.name}` },
    };
    const outcome = embeddedSyntheticEngine.screenPartySync(canonicalP);
    if (outcome.highestScore > highestScore) highestScore = outcome.highestScore;
    if (outcome.findingSeverity === 'EXACT_IDENTIFIER_MATCH') findingSeverity = 'EXACT_IDENTIFIER_MATCH';
    else if (outcome.findingSeverity === 'FUZZY_NAME_CANDIDATE' && findingSeverity !== 'EXACT_IDENTIFIER_MATCH') {
      findingSeverity = 'FUZZY_NAME_CANDIDATE';
    }

    return {
      role: p.role,
      name: p.name,
      entityType: p.entityType,
      country: p.country,
      matches: outcome.matches,
    };
  });

  // 2. UBO & OFAC 50% Rule Evaluation
  let aggregateSanctionedOwnership = 0;
  const screenedOwners: BeneficialOwnerShare[] = [];

  if (req.corporateEntityUbo && req.corporateEntityUbo.beneficialOwners.length > 0) {
    for (const owner of req.corporateEntityUbo.beneficialOwners) {
      const ownerParty: CanonicalParty = {
        partyId: `owner_${Math.random().toString(36).slice(2, 8)}`,
        role: 'DEBTOR',
        name: owner.name,
        country: owner.country,
        identifiers: [],
        provenance: { sourceTag: 'UBO_SHAREHOLDER', rawSnippet: `UBO: ${owner.name} (${owner.ownershipPercentage}%)` },
      };
      const outcome = embeddedSyntheticEngine.screenPartySync(ownerParty);
      const isSanctioned = outcome.matches.length > 0;
      if (isSanctioned) {
        aggregateSanctionedOwnership += owner.ownershipPercentage;
        if (outcome.highestScore > highestScore) highestScore = outcome.highestScore;
        if (outcome.findingSeverity === 'EXACT_IDENTIFIER_MATCH') findingSeverity = 'EXACT_IDENTIFIER_MATCH';
        else if (outcome.findingSeverity === 'FUZZY_NAME_CANDIDATE' && findingSeverity !== 'EXACT_IDENTIFIER_MATCH') {
          findingSeverity = 'FUZZY_NAME_CANDIDATE';
        }
      }

      screenedOwners.push({
        name: owner.name,
        ownershipPercentage: owner.ownershipPercentage,
        isSanctioned,
        country: owner.country,
        matches: outcome.matches,
      });
    }
  }

  const violates50PercentRule = aggregateSanctionedOwnership >= 50.0;

  // 3. Underwriting Decision Routing
  let underwritingDecision: InsuranceEvaluation['underwritingDecision'] = 'APPROVED';
  if (violates50PercentRule || findingSeverity === 'EXACT_IDENTIFIER_MATCH') {
    underwritingDecision = 'BLOCK_AND_HOLD';
  } else if (findingSeverity === 'FUZZY_NAME_CANDIDATE' || aggregateSanctionedOwnership >= 25.0) {
    underwritingDecision = 'REFER_TO_SENIOR_COUNSEL';
  }

  const evidenceDigest = createHash('sha256')
    .update(JSON.stringify({
      policyNumber: req.policyNumber,
      sumInsured: req.sumInsured,
      aggregateSanctionedOwnership,
      violates50PercentRule,
      underwritingDecision,
      timestamp: new Date().toISOString(),
    }))
    .digest('hex');

  return {
    id: `ins_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    policyNumber: req.policyNumber,
    lineOfBusiness: req.lineOfBusiness,
    sumInsured: req.sumInsured,
    currency: req.currency,
    screeningStage: req.screeningStage,
    policyParties: screenedParties,
    uboAnalysis: {
      targetEntityName: req.corporateEntityUbo?.entityName || req.policyParties[0]?.name || 'N/A',
      beneficialOwners: screenedOwners,
      aggregateSanctionedOwnershipPercentage: aggregateSanctionedOwnership,
      violatesOfac50PercentRule: violates50PercentRule,
    },
    findingSeverity,
    highestScore,
    underwritingDecision,
    evidenceDigest,
  };
}
