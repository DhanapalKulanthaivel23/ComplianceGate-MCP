/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import {
  HealthcareEvaluation,
  HealthcarePractitioner,
  HealthcareSupplier,
  FindingSeverity,
  CanonicalParty,
} from '../../../shared/types.ts';
import { embeddedSyntheticEngine } from '../engineAdapter.ts';
import { createHash } from 'node:crypto';

export interface EvaluateHealthcareRequest {
  claimId: string;
  serviceDate: string;
  billedAmount: number;
  practitioner?: {
    name: string;
    npi: string; // 10 digits
    deaNumber?: string; // 2 alpha + 7 digits
    specialty: string;
    stateLicense?: string;
  };
  supplier?: {
    companyName: string;
    taxId?: string;
    fdaRegistrationNumber?: string;
    country: string;
  };
}

/**
 * Validates 10-digit NPI using the official CMS Luhn Mod-10 algorithm
 * with the constant 24 added for the standard '80840' prefix.
 */
export function validateNpiLuhn(npiStr: string): boolean {
  const clean = npiStr.replace(/[^0-9]/g, '');
  if (clean.length !== 10) return false;
  let sum = 24; // CMS constant for prefix '80840'
  for (let i = 0; i < 9; i++) {
    let digit = parseInt(clean.charAt(i), 10);
    // Double alternating digits starting with index 0 (even indices 0, 2, 4, 6, 8)
    if (i % 2 === 0) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  const checkDigit = (10 - (sum % 10)) % 10;
  return checkDigit === parseInt(clean.charAt(9), 10);
}

/**
 * Validates 9-character DEA registration number:
 * Format: 2 alpha characters followed by 7 digits.
 * Check: (d1 + d3 + d5) + 2 * (d2 + d4 + d6) mod 10 === d7
 */
export function validateDeaNumber(dea: string): boolean {
  const clean = dea.trim().toUpperCase();
  if (!/^[A-Z]{2}[0-9]{7}$/.test(clean)) return false;
  const digits = clean.slice(2).split('').map(Number);
  const oddSum = digits[0] + digits[2] + digits[4];
  const evenSum = digits[1] + digits[3] + digits[5];
  const checkCalc = (oddSum + 2 * evenSum) % 10;
  return checkCalc === digits[6];
}

// Known Excluded Healthcare Providers (OIG-LEIE / SAM.gov synthetic dataset)
const KNOWN_EXCLUDED_PROVIDERS: Record<string, { source: HealthcareEvaluation['exclusionHits'][0]['source']; reason: string }> = {
  '1982736450': { source: 'OIG_LEIE', reason: 'Mandatory Exclusion: Conviction relating to healthcare fraud (1128(a)(1))' },
  '1205839201': { source: 'OIG_LEIE', reason: 'Controlled substance felony conviction (1128(a)(4))' },
  '1847291054': { source: 'SAM_GOV', reason: 'Debarred from Federal Procurement and Nonprocurement Programs' },
};

export function evaluateHealthcareClaim(req: EvaluateHealthcareRequest): HealthcareEvaluation {
  let highestScore = 0;
  let findingSeverity: FindingSeverity = 'NO_MATCH_FOUND';
  const exclusionHits: HealthcareEvaluation['exclusionHits'] = [];

  // 1. Evaluate Practitioner
  let practitionerResult: HealthcarePractitioner | undefined;
  if (req.practitioner) {
    const isNpiValid = validateNpiLuhn(req.practitioner.npi);
    const isDeaValid = req.practitioner.deaNumber ? validateDeaNumber(req.practitioner.deaNumber) : undefined;

    // Check OIG-LEIE / SAM.gov exclusions
    const cleanNpi = req.practitioner.npi.replace(/[^0-9]/g, '');
    const exclusion = KNOWN_EXCLUDED_PROVIDERS[cleanNpi];
    const isOigLeieExcluded = exclusion?.source === 'OIG_LEIE';
    const isSamGovExcluded = exclusion?.source === 'SAM_GOV';

    if (exclusion) {
      findingSeverity = 'EXACT_IDENTIFIER_MATCH';
      highestScore = 1.0;
      exclusionHits.push({
        source: exclusion.source,
        entityName: req.practitioner.name,
        exclusionReason: exclusion.reason,
        waiverExists: false,
      });
    }

    // Screen practitioner name
    const practitionerParty: CanonicalParty = {
      partyId: `dr_${cleanNpi}`,
      role: 'CREDITOR',
      name: req.practitioner.name,
      country: 'US',
      identifiers: [{ type: 'NATIONAL_ID', value: req.practitioner.npi }],
      provenance: { sourceTag: 'HEALTHCARE_PRACTITIONER', rawSnippet: `NPI: ${req.practitioner.npi}` },
    };
    const outcome = embeddedSyntheticEngine.screenPartySync(practitionerParty);
    if (outcome.highestScore > highestScore) highestScore = outcome.highestScore;
    if (outcome.findingSeverity === 'EXACT_IDENTIFIER_MATCH') findingSeverity = 'EXACT_IDENTIFIER_MATCH';
    else if (outcome.findingSeverity === 'FUZZY_NAME_CANDIDATE' && findingSeverity !== 'EXACT_IDENTIFIER_MATCH') {
      findingSeverity = 'FUZZY_NAME_CANDIDATE';
    }

    practitionerResult = {
      npi: req.practitioner.npi,
      isNpiValid,
      deaNumber: req.practitioner.deaNumber,
      isDeaValid,
      name: req.practitioner.name,
      specialty: req.practitioner.specialty,
      stateLicense: req.practitioner.stateLicense,
      isOigLeieExcluded,
      isSamGovExcluded,
      matches: outcome.matches,
    };
  }

  // 2. Evaluate Supplier
  let supplierResult: HealthcareSupplier | undefined;
  if (req.supplier) {
    const supplierParty: CanonicalParty = {
      partyId: `supp_${Math.random().toString(36).slice(2, 8)}`,
      role: 'CREDITOR',
      name: req.supplier.companyName,
      country: req.supplier.country,
      identifiers: req.supplier.taxId ? [{ type: 'TAX_ID', value: req.supplier.taxId }] : [],
      provenance: { sourceTag: 'HEALTHCARE_SUPPLIER', rawSnippet: `Supplier: ${req.supplier.companyName}` },
    };
    const outcome = embeddedSyntheticEngine.screenPartySync(supplierParty);
    if (outcome.highestScore > highestScore) highestScore = outcome.highestScore;
    if (outcome.findingSeverity === 'EXACT_IDENTIFIER_MATCH') findingSeverity = 'EXACT_IDENTIFIER_MATCH';
    else if (outcome.findingSeverity === 'FUZZY_NAME_CANDIDATE' && findingSeverity !== 'EXACT_IDENTIFIER_MATCH') {
      findingSeverity = 'FUZZY_NAME_CANDIDATE';
    }

    if (outcome.matches.length > 0) {
      exclusionHits.push({
        source: 'SDN_HEALTHCARE',
        entityName: req.supplier.companyName,
        exclusionReason: 'Designated entity in global pharmaceutical / medical sanctions list',
        waiverExists: false,
      });
    }

    supplierResult = {
      companyName: req.supplier.companyName,
      taxId: req.supplier.taxId,
      fdaRegistrationNumber: req.supplier.fdaRegistrationNumber,
      country: req.supplier.country,
      matches: outcome.matches,
    };
  }

  // 3. Status Decision
  let claimIntegrityStatus: HealthcareEvaluation['claimIntegrityStatus'] = 'PAYMENT_APPROVED';
  if (exclusionHits.some((e) => e.source === 'SDN_HEALTHCARE')) {
    claimIntegrityStatus = 'SANCTIONED_ENTITY_BLOCKED';
  } else if (exclusionHits.length > 0 || (practitionerResult && !practitionerResult.isNpiValid)) {
    claimIntegrityStatus = 'CLAIM_HELD_FOR_FRAUD_EXCLUSION';
  }

  const evidenceDigest = createHash('sha256')
    .update(JSON.stringify({ req, practitionerResult, supplierResult, exclusionHits, claimIntegrityStatus, timestamp: new Date().toISOString() }))
    .digest('hex');

  return {
    id: `health_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    claimId: req.claimId,
    serviceDate: req.serviceDate,
    billedAmount: req.billedAmount,
    practitioner: practitionerResult,
    supplier: supplierResult,
    exclusionHits,
    findingSeverity,
    claimIntegrityStatus,
    evidenceDigest,
  };
}
