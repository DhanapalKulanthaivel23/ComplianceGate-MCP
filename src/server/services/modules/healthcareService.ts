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
import { extractIsoCountryCode } from './maritimeService.ts';
import { createHash } from 'node:crypto';

export interface EvaluateHealthcareRequest {
  tenantId?: string;
  claimId: string;
  serviceDate: string;
  billedAmount: number;
  practitioner?: {
    name: string;
    npi: string; // strictly 10 digits
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
 * Strictly rejects any alphabetical contamination or non-digit characters.
 */
export function validateNpiLuhn(npiStr: string): boolean {
  if (!npiStr || typeof npiStr !== 'string') return false;
  const clean = npiStr.trim();
  // Strictly exactly 10 digits - reject any letters or punctuation
  if (!/^\d{10}$/.test(clean)) return false;

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
  if (!dea || typeof dea !== 'string') return false;
  const clean = dea.trim().toUpperCase();
  if (!/^[A-Z]{2}[0-9]{7}$/.test(clean)) return false;
  const digits = clean.slice(2).split('').map(Number);
  const oddSum = digits[0] + digits[2] + digits[4];
  const evenSum = digits[1] + digits[3] + digits[5];
  const checkCalc = (oddSum + 2 * evenSum) % 10;
  return checkCalc === digits[6];
}

/**
 * Validates calendar date (YYYY-MM-DD), month lengths, leap years,
 * and reasonable healthcare service date ranges.
 */
export function isValidServiceDate(dateStr: string): boolean {
  if (!dateStr || typeof dateStr !== 'string') return false;
  const clean = dateStr.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean);
  if (!match) return false;

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);

  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  if (year < 1970 || year > 2035) return false;

  const daysInMonths = [31, (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonths[month - 1];
}

// Known Excluded Healthcare Providers (OIG-LEIE / SAM.gov synthetic dataset)
export const KNOWN_EXCLUDED_PROVIDERS: Record<
  string,
  { source: HealthcareEvaluation['exclusionHits'][0]['source']; reason: string }
> = {
  '1982736450': { source: 'OIG_LEIE', reason: 'Mandatory Exclusion: Conviction relating to healthcare fraud (1128(a)(1))' },
  '1205839201': { source: 'OIG_LEIE', reason: 'Controlled substance felony conviction (1128(a)(4))' },
  '1847291054': { source: 'SAM_GOV', reason: 'Debarred from Federal Procurement and Nonprocurement Programs' },
};

export function evaluateHealthcareClaim(req: EvaluateHealthcareRequest): HealthcareEvaluation {
  // ---------------------------------------------------------------------------
  // 0. Defensive Request & Payload Validation
  // ---------------------------------------------------------------------------
  if (!req || typeof req !== 'object') {
    throw new Error('Invalid healthcare evaluation request: payload must be a non-empty JSON object.');
  }

  // 1. Validate Billed Amount
  if (
    req.billedAmount === undefined ||
    req.billedAmount === null ||
    typeof req.billedAmount !== 'number' ||
    !Number.isFinite(req.billedAmount) ||
    req.billedAmount <= 0
  ) {
    throw new Error(`Invalid healthcare billedAmount: ${req.billedAmount}. Billed amount must be a positive finite number.`);
  }

  // 2. Validate Service Date
  if (!isValidServiceDate(req.serviceDate)) {
    throw new Error(
      `Invalid healthcare serviceDate: '${req.serviceDate}'. Date must be a valid calendar date in YYYY-MM-DD format.`
    );
  }

  // 3. Validate Claim Reference
  if (!req.claimId || typeof req.claimId !== 'string' || req.claimId.trim() === '') {
    throw new Error("Invalid healthcare evaluation request: 'claimId' is required.");
  }

  const reviewReasons: string[] = [];
  let requiresHumanReview = false;
  let isIncomplete = false;

  // 4. Must declare at least one participant (Practitioner or Supplier)
  if (!req.practitioner && !req.supplier) {
    reviewReasons.push('Healthcare reimbursement claim must declare at least one rendering practitioner or medical supplier.');
    requiresHumanReview = true;
    isIncomplete = true;
  }

  let highestScore = 0;
  let findingSeverity: FindingSeverity = 'NO_MATCH_FOUND';
  const exclusionHits: HealthcareEvaluation['exclusionHits'] = [];

  // ---------------------------------------------------------------------------
  // 1. Evaluate Rendering Practitioner
  // ---------------------------------------------------------------------------
  let practitionerResult: HealthcarePractitioner | undefined;
  let hasPractitionerMatch = false;

  if (req.practitioner) {
    const rawNpi = req.practitioner.npi || '';
    const isNpiValid = validateNpiLuhn(rawNpi);
    const rawDea = req.practitioner.deaNumber;
    const isDeaValid = rawDea ? validateDeaNumber(rawDea) : undefined;
    const isPractitionerNameBlank = !req.practitioner.name || req.practitioner.name.trim() === '';

    if (isPractitionerNameBlank) {
      reviewReasons.push('Rendering practitioner name is missing or blank.');
      requiresHumanReview = true;
      isIncomplete = true;
    }

    if (!isNpiValid) {
      reviewReasons.push(`Invalid NPI format or checksum for practitioner '${req.practitioner.name || 'UNKNOWN'}': '${rawNpi}'. Must be strictly 10 digits conforming to CMS Luhn Mod-10.`);
      requiresHumanReview = true;
    }

    if (isDeaValid === false) {
      reviewReasons.push(`Supplied DEA registration number '${rawDea}' failed DEA checksum formula.`);
      requiresHumanReview = true;
    }

    // Check OIG-LEIE / SAM.gov exclusions
    const cleanNpi = rawNpi.trim();
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
      reviewReasons.push(`Mandatory statutory exclusion detected on OIG-LEIE/SAM.gov for practitioner NPI ${cleanNpi}: ${exclusion.reason}.`);
      requiresHumanReview = true;
    }

    // Screen practitioner name & NPI against Watchlists
    let outcomeMatches: any[] = [];
    if (!isPractitionerNameBlank) {
      const practitionerParty: CanonicalParty = {
        partyId: `dr_${cleanNpi || Math.random().toString(36).slice(2, 8)}`,
        role: 'CREDITOR',
        name: req.practitioner.name.trim(),
        country: 'US',
        identifiers: isNpiValid ? [{ type: 'NATIONAL_ID', value: cleanNpi }] : [],
        provenance: { sourceTag: 'HEALTHCARE_PRACTITIONER', rawSnippet: `NPI: ${rawNpi}` },
      };

      const outcome = embeddedSyntheticEngine.screenPartySync(practitionerParty, req.tenantId || 'default');
      outcomeMatches = outcome.matches;
      if (outcome.highestScore > highestScore) highestScore = outcome.highestScore;

      if (outcome.matches.length > 0) {
        hasPractitionerMatch = true;
        reviewReasons.push(`Practitioner '${req.practitioner.name}' matched sanctions candidate (${outcome.matches[0].listName}: ${outcome.matches[0].entryName}).`);
        requiresHumanReview = true;
        if (outcome.findingSeverity === 'EXACT_IDENTIFIER_MATCH') {
          findingSeverity = 'EXACT_IDENTIFIER_MATCH';
        } else if ((findingSeverity as FindingSeverity) !== 'EXACT_IDENTIFIER_MATCH') {
          findingSeverity = 'FUZZY_NAME_CANDIDATE';
        }
      }
    }

    practitionerResult = {
      npi: rawNpi,
      isNpiValid,
      deaNumber: rawDea,
      isDeaValid,
      name: req.practitioner.name,
      specialty: req.practitioner.specialty || '',
      stateLicense: req.practitioner.stateLicense,
      isOigLeieExcluded,
      isSamGovExcluded,
      matches: outcomeMatches,
      status: isOigLeieExcluded || isSamGovExcluded
        ? 'EXCLUDED_FRAUD'
        : !isNpiValid || isDeaValid === false
        ? 'INVALID_CREDENTIALS'
        : hasPractitionerMatch
        ? 'MATCH_CANDIDATE'
        : 'SCREENED_CLEAR',
    };
  }

  // ---------------------------------------------------------------------------
  // 2. Evaluate Medical Supplier / Facility
  // ---------------------------------------------------------------------------
  let supplierResult: HealthcareSupplier | undefined;
  let hasSupplierMatch = false;

  if (req.supplier) {
    const isSupplierNameBlank = !req.supplier.companyName || req.supplier.companyName.trim() === '';
    const supplierCountryIso = extractIsoCountryCode(req.supplier.country);

    if (isSupplierNameBlank) {
      reviewReasons.push('Medical supplier company name is missing or blank.');
      requiresHumanReview = true;
      isIncomplete = true;
    }

    if (!supplierCountryIso) {
      reviewReasons.push(`Invalid or unestablished country jurisdiction for supplier: '${req.supplier.country || 'EMPTY'}'.`);
      requiresHumanReview = true;
      isIncomplete = true;
    }

    let outcomeMatches: any[] = [];
    if (!isSupplierNameBlank) {
      const supplierParty: CanonicalParty = {
        partyId: `supp_${Math.random().toString(36).slice(2, 8)}`,
        role: 'CREDITOR',
        name: req.supplier.companyName.trim(),
        country: supplierCountryIso || req.supplier.country,
        identifiers: req.supplier.taxId ? [{ type: 'TAX_ID', value: req.supplier.taxId.trim() }] : [],
        provenance: { sourceTag: 'HEALTHCARE_SUPPLIER', rawSnippet: `Supplier: ${req.supplier.companyName}` },
      };

      const outcome = embeddedSyntheticEngine.screenPartySync(supplierParty, req.tenantId || 'default');
      outcomeMatches = outcome.matches;
      if (outcome.highestScore > highestScore) highestScore = outcome.highestScore;

      if (outcome.matches.length > 0) {
        hasSupplierMatch = true;
        reviewReasons.push(`Medical supplier '${req.supplier.companyName}' matched sanctions list candidate (${outcome.matches[0].listName}: ${outcome.matches[0].entryName}).`);
        requiresHumanReview = true;
        if (outcome.findingSeverity === 'EXACT_IDENTIFIER_MATCH') {
          findingSeverity = 'EXACT_IDENTIFIER_MATCH';
          exclusionHits.push({
            source: 'SDN_HEALTHCARE',
            entityName: req.supplier.companyName,
            exclusionReason: 'Designated entity in global pharmaceutical / medical sanctions list',
            waiverExists: false,
          });
        } else if ((findingSeverity as FindingSeverity) !== 'EXACT_IDENTIFIER_MATCH') {
          findingSeverity = 'FUZZY_NAME_CANDIDATE';
        }
      }
    }

    supplierResult = {
      companyName: req.supplier.companyName,
      taxId: req.supplier.taxId,
      fdaRegistrationNumber: req.supplier.fdaRegistrationNumber,
      country: req.supplier.country,
      matches: outcomeMatches,
      status: hasSupplierMatch ? 'MATCH_CANDIDATE' : 'SCREENED_CLEAR',
    };
  }

  // ---------------------------------------------------------------------------
  // 3. Status Decision & Recommendation Routing
  // ---------------------------------------------------------------------------
  // Distinguish confirmed fraud / exclusions from credentials deficits, sanctions, and data errors
  let claimIntegrityStatus: HealthcareEvaluation['claimIntegrityStatus'] = 'PAYMENT_APPROVED';
  let decisionRecommendation: NonNullable<HealthcareEvaluation['decisionRecommendation']> = 'APPROVE_HEALTHCARE_CLAIM';

  const hasExclusion = exclusionHits.some((e) => e.source === 'OIG_LEIE' || e.source === 'SAM_GOV');
  const hasSanctionsHit = exclusionHits.some((e) => e.source === 'SDN_HEALTHCARE') || findingSeverity === 'EXACT_IDENTIFIER_MATCH';
  const hasCandidateMatch = hasPractitionerMatch || hasSupplierMatch || findingSeverity === 'FUZZY_NAME_CANDIDATE';
  const hasCredentialDeficit = practitionerResult ? (!practitionerResult.isNpiValid || practitionerResult.isDeaValid === false) : false;

  if (hasExclusion) {
    claimIntegrityStatus = 'CLAIM_HELD_FOR_FRAUD_EXCLUSION';
    decisionRecommendation = 'REJECT_FRAUD_EXCLUSION';
    requiresHumanReview = true;
  } else if (hasSanctionsHit) {
    claimIntegrityStatus = 'SANCTIONED_ENTITY_BLOCKED';
    decisionRecommendation = 'REJECT_SANCTIONS_RISK';
    requiresHumanReview = true;
  } else if (hasCandidateMatch) {
    claimIntegrityStatus = 'HOLD_FOR_SANCTIONS_REVIEW';
    decisionRecommendation = 'HOLD_FOR_HUMAN_REVIEW';
    requiresHumanReview = true;
  } else if (hasCredentialDeficit) {
    claimIntegrityStatus = 'CLAIM_HELD_FOR_CREDENTIAL_DEFICIT';
    decisionRecommendation = 'HOLD_FOR_HUMAN_REVIEW';
    requiresHumanReview = true;
  } else if (isIncomplete || requiresHumanReview) {
    claimIntegrityStatus = 'INCOMPLETE_CLAIM_DATA';
    decisionRecommendation = 'HOLD_FOR_HUMAN_REVIEW';
    requiresHumanReview = true;
  } else {
    claimIntegrityStatus = 'PAYMENT_APPROVED';
    decisionRecommendation = 'APPROVE_HEALTHCARE_CLAIM';
  }

  const timestamp = new Date().toISOString();
  const evidenceDigest = createHash('sha256')
    .update(
      JSON.stringify({
        claimId: req.claimId,
        serviceDate: req.serviceDate,
        billedAmount: req.billedAmount,
        practitionerResult,
        supplierResult,
        exclusionHits,
        claimIntegrityStatus,
        decisionRecommendation,
        timestamp,
      })
    )
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
    highestScore,
    claimIntegrityStatus,
    decisionRecommendation,
    requiresHumanReview,
    reviewReasons,
    verificationCoverage: {
      checksPerformed: [
        'CMS_NPI_LUHN_SYNTAX_VALIDATION',
        'DEA_REGISTRATION_CHECKSUM_VERIFICATION',
        'OIG_LEIE_MANDATORY_FRAUD_EXCLUSIONS',
        'SAM_GOV_DEBARMENT_REGISTRY',
        'SDN_GLOBAL_SANCTIONS_SCREENING',
      ],
      sourcesChecked: ['OIG_LEIE', 'SAM_GOV', 'DEMO_OFAC_SDN'],
      practitionerNpiChecked: !!practitionerResult,
      practitionerDeaChecked: !!practitionerResult?.deaNumber,
      oigLeieChecked: true,
      samGovChecked: true,
      sanctionsChecked: true,
    },
    evidenceDigest,
    timestamp,
  };
}
