/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import {
  MaritimeEvaluation,
  MaritimeVesselInfo,
  VesselOwnershipNode,
  PortRiskAssessment,
  FindingSeverity,
  CanonicalParty,
} from '../../../shared/types.ts';
import { embeddedSyntheticEngine } from '../engineAdapter.ts';
import { isValidCalendarDate } from '../parsers/swiftMtParser.ts';
import { createHash } from 'node:crypto';

export interface EvaluateMaritimeRequest {
  vessel: MaritimeVesselInfo;
  tenantId?: string;
  ownershipHierarchy?: {
    role: VesselOwnershipNode['role'];
    name: string;
    country: string;
  }[];
  portsCalled?: {
    portName: string;
    unLocode: string;
    country: string;
    arrivalDate?: string;
  }[];
  aisSignals?: {
    lastSeenTimestamp?: string;
    hoursSinceLastBroadcast?: number;
    stsTransferDetected?: boolean;
    knownStsZone?: string;
    flagChangesLast12Months?: number;
  };
}

/**
 * Validates IMO number 7-digit checksum:
 * Sum(d[i] * (7 - i)) for i=0..5, mod 10 === d[6]
 * Rejects placeholder all-zero IMO 0000000 and invalid leading zeroes.
 */
export function validateImoChecksum(imoStr: string): boolean {
  if (!imoStr || typeof imoStr !== 'string') return false;
  const clean = imoStr.replace(/[^0-9]/g, '');
  if (clean.length !== 7) return false;
  // Placeholder check: reject 0000000 or zero-prefixed invalid IMO numbers
  if (clean === '0000000' || clean.startsWith('0')) return false;
  const digits = clean.split('').map(Number);
  const weights = [7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((acc, w, idx) => acc + w * digits[idx], 0);
  const checkDigit = sum % 10;
  return checkDigit === digits[6];
}

/**
 * Extracts 2-letter ISO country code from string like "Iran (IR)", "US", "Panama (PA)"
 */
export function extractIsoCountryCode(countryStr?: string): string {
  if (!countryStr || typeof countryStr !== 'string') return '';
  const trimmed = countryStr.trim();
  const upper = trimmed.toUpperCase();
  if (upper === 'UNKNOWN' || upper === 'INVALID' || upper.startsWith('INVALID')) {
    return '';
  }
  const parenMatch = trimmed.match(/\(([A-Za-z]{2})\)/);
  if (parenMatch) return parenMatch[1].toUpperCase();
  if (/^[A-Za-z]{2}$/.test(trimmed)) return trimmed.toUpperCase();
  return '';
}

/**
 * Validates ISO arrival date (YYYY-MM-DD) against real calendar limits
 */
export function validateIsoArrivalDate(dateStr?: string): { isValid: boolean; error?: string } {
  if (!dateStr || typeof dateStr !== 'string' || dateStr.trim() === '') {
    return { isValid: true };
  }
  const trimmed = dateStr.trim();
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return { isValid: false, error: `Invalid date format: '${dateStr}'. Date must follow YYYY-MM-DD format.` };
  }
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  if (!isValidCalendarDate(year, month, day)) {
    return { isValid: false, error: `Impossible calendar date: '${dateStr}'. Month or day is invalid for the specified year.` };
  }
  return { isValid: true };
}

// Known sanctioned or high-risk maritime ports / STS zones
export const HIGH_RISK_PORTS: Record<string, { riskReason: string; country: string }> = {
  'UASEV': { riskReason: 'Crimea / Sevastopol Sanctioned Port (EU Reg 692/2014 & US EO 13685)', country: 'UA' },
  'UAFEO': { riskReason: 'Feodosia Commercial Port under territorial sanctions', country: 'UA' },
  'IRBND': { riskReason: 'Bandar Abbas (Tidewater Middle East Co. Sanctions / IRISL hub)', country: 'IR' },
  'IRBKM': { riskReason: 'Bandar Imam Khomeini Port (OFAC SDN designated maritime entity)', country: 'IR' },
  'SYTTU': { riskReason: 'Tartus Port / Syrian General Directorate of Ports (US Syria Sanctions)', country: 'SY' },
  'KPNAM': { riskReason: 'Nampo Port (UNSCR 2397 prohibited petroleum transfer hub)', country: 'KP' },
  'RUVVO': { riskReason: 'Vladivostok (Export control surveillance / petroleum price cap monitoring)', country: 'RU' },
};

// Known sanctioned shadow fleet vessels for deterministic evaluation
export const KNOWN_SANCTIONED_VESSELS = [
  { imo: '9256858', name: 'OCEAN PERFUME', list: 'OFAC_SDN', program: 'IRAN-EO13902' },
  { imo: '9312896', name: 'LADY M', list: 'EU_FSF', program: 'UKRAINE-TERRITORIAL' },
  { imo: '9185530', name: 'ARCTIC METEOR', list: 'OFAC_SDN', program: 'RUSSIA-EO14024' },
];

export function evaluateMaritimeVessel(req: EvaluateMaritimeRequest): MaritimeEvaluation {
  // ---------------------------------------------------------------------------
  // 0. Defensive Request & Identifier Validation
  // ---------------------------------------------------------------------------
  if (!req || typeof req !== 'object') {
    throw new Error('Invalid maritime evaluation request: request body must be a non-empty JSON object.');
  }
  if (!req.vessel || typeof req.vessel !== 'object') {
    throw new Error("Invalid maritime evaluation request: missing required 'vessel' object.");
  }
  if (!req.vessel.imoNumber || typeof req.vessel.imoNumber !== 'string' || req.vessel.imoNumber.trim() === '') {
    throw new Error("Invalid maritime evaluation request: vessel 'imoNumber' is required.");
  }

  // MMSI validation: if provided, must be exactly 9 numeric digits
  if (req.vessel.mmsi !== undefined && req.vessel.mmsi !== null && String(req.vessel.mmsi).trim() !== '') {
    const cleanMmsi = String(req.vessel.mmsi).trim();
    if (!/^\d{9}$/.test(cleanMmsi) || cleanMmsi === '000000000') {
      throw new Error(`Invalid MMSI format: '${req.vessel.mmsi}'. MMSI must be exactly 9 numeric digits.`);
    }
  }

  // AIS elapsed hours validation: must not be negative
  if (req.aisSignals && req.aisSignals.hoursSinceLastBroadcast !== undefined && req.aisSignals.hoursSinceLastBroadcast !== null) {
    if (req.aisSignals.hoursSinceLastBroadcast < 0) {
      throw new Error(`Invalid AIS broadcast interval: hoursSinceLastBroadcast cannot be negative (${req.aisSignals.hoursSinceLastBroadcast}).`);
    }
  }

  const reviewReasons: string[] = [];
  const identifierValidationIssues: string[] = [];
  const aisAnomalies: string[] = [];
  let requiresHumanReview = false;
  let completenessStatus: MaritimeEvaluation['completenessStatus'] = 'FULL_DOSSIER';

  // ---------------------------------------------------------------------------
  // 1. IMO Identifier & Vessel Registration Check
  // ---------------------------------------------------------------------------
  const rawImo = req.vessel.imoNumber.trim();
  const cleanImo = rawImo.replace(/[^0-9]/g, '');
  const isImoValid = validateImoChecksum(rawImo);

  if (cleanImo === '0000000') {
    identifierValidationIssues.push('All-zero IMO 0000000 is an invalid placeholder identifier.');
    reviewReasons.push('Placeholder IMO 0000000 is invalid and rejected.');
    requiresHumanReview = true;
    completenessStatus = 'INCOMPLETE_REJECTED';
  } else if (!isImoValid) {
    identifierValidationIssues.push(`IMO ${rawImo} failed 7-digit checksum formula verification.`);
    reviewReasons.push(`IMO ${rawImo} failed 7-digit check digit validation.`);
    requiresHumanReview = true;
  }

  // Mandatory Vessel Name and Flag State
  if (!req.vessel.vesselName || req.vessel.vesselName.trim() === '') {
    reviewReasons.push('Vessel name is missing or blank. Vessel cannot be screened against watchlists.');
    completenessStatus = 'INCOMPLETE_REJECTED';
    requiresHumanReview = true;
  }
  if (!req.vessel.flagState || req.vessel.flagState.trim() === '') {
    reviewReasons.push('Vessel flag state is missing. Flag jurisdiction risk cannot be assessed.');
    completenessStatus = 'INCOMPLETE_REJECTED';
    requiresHumanReview = true;
  }

  // Distinguish valid checksum from verified registration
  const knownSanctionedHit = KNOWN_SANCTIONED_VESSELS.find((v) => v.imo === cleanImo);
  const isVesselRegistrationVerified = isImoValid && cleanImo !== '0000000' && (Boolean(knownSanctionedHit) || req.vessel.buildYear !== undefined);
  let vesselRegistrationStatus: MaritimeEvaluation['vesselRegistrationStatus'] = 'INVALID_IDENTIFIER';
  if (isImoValid && cleanImo !== '0000000') {
    vesselRegistrationStatus = isVesselRegistrationVerified ? 'VERIFIED_ACTIVE' : 'UNVERIFIED_REGISTRY';
    if (!isVesselRegistrationVerified) {
      identifierValidationIssues.push(`IMO ${rawImo} checksum is mathematically valid but vessel registration is unverified in official registry.`);
      reviewReasons.push(`Unverified vessel registry for IMO ${rawImo}. Manual registry confirmation required.`);
      requiresHumanReview = true;
    }
  }

  // ---------------------------------------------------------------------------
  // 2. AIS Telemetry & Dark Fleet Anomaly Detection
  // ---------------------------------------------------------------------------
  let darkAisRiskLevel: MaritimeEvaluation['darkAisRiskLevel'] = 'NORMAL';
  let aisCoverage: MaritimeEvaluation['aisCoverage'] = 'TELEMETRY_EVALUATED';

  if (!req.aisSignals || Object.keys(req.aisSignals).length === 0) {
    darkAisRiskLevel = 'NOT_ASSESSED';
    aisCoverage = 'NO_SIGNALS_PROVIDED';
    reviewReasons.push('AIS satellite telemetry not supplied. Dark activity and STS lightering cannot be assessed.');
    requiresHumanReview = true;
    if (completenessStatus !== 'INCOMPLETE_REJECTED') completenessStatus = 'PARTIAL_DOSSIER';
  } else {
    const { lastSeenTimestamp, hoursSinceLastBroadcast, stsTransferDetected, knownStsZone, flagChangesLast12Months } = req.aisSignals;

    // Check broadcast interval
    if (hoursSinceLastBroadcast !== undefined && hoursSinceLastBroadcast > 24) {
      aisAnomalies.push(`AIS transponder non-transmitting for ${hoursSinceLastBroadcast} hours (potential dark activity)`);
      darkAisRiskLevel = 'HIGH_RISK_SUSPECTED';
      reviewReasons.push(`AIS dark transponder gap: ${hoursSinceLastBroadcast} hours non-transmitting.`);
      requiresHumanReview = true;
    }

    // Check STS transfer
    if (stsTransferDetected) {
      aisAnomalies.push(`Ship-to-Ship (STS) transfer detected in zone: ${knownStsZone || 'Offshore corridor'}`);
      if (darkAisRiskLevel !== 'HIGH_RISK_SUSPECTED') darkAisRiskLevel = 'ELEVATED';
      reviewReasons.push(`Offshore Ship-to-Ship (STS) transfer detected in ${knownStsZone || 'unregulated zone'}.`);
      requiresHumanReview = true;
    }

    // Check flag-hopping
    if (flagChangesLast12Months && flagChangesLast12Months >= 2) {
      aisAnomalies.push(`Flag-hopping detected: ${flagChangesLast12Months} flag changes in last 12 months (Common evasion typology)`);
      darkAisRiskLevel = 'HIGH_RISK_SUSPECTED';
      reviewReasons.push(`Flag-hopping evasion typology: ${flagChangesLast12Months} flag changes in last 12 months.`);
      requiresHumanReview = true;
    }

    // Check timestamp consistency vs reported hours
    if (lastSeenTimestamp) {
      const parsedTime = Date.parse(lastSeenTimestamp);
      if (isNaN(parsedTime)) {
        aisAnomalies.push(`Invalid AIS lastSeenTimestamp format: '${lastSeenTimestamp}'.`);
        if (darkAisRiskLevel === 'NORMAL') darkAisRiskLevel = 'ELEVATED';
        reviewReasons.push(`Invalid AIS timestamp format: '${lastSeenTimestamp}'.`);
        requiresHumanReview = true;
      } else {
        const now = Date.now();
        const ageHours = (now - parsedTime) / (1000 * 60 * 60);

        // Conflict: old timestamp with 0 reported elapsed hours
        if (ageHours > 24 && hoursSinceLastBroadcast === 0) {
          aisAnomalies.push(
            `AIS timestamp conflict: lastSeenTimestamp indicates broadcast occurred ${Math.round(ageHours)} hours ago, but hoursSinceLastBroadcast is reported as 0.`
          );
          darkAisRiskLevel = 'HIGH_RISK_SUSPECTED';
          reviewReasons.push('AIS telemetry conflict: stale timestamp reported with zero broadcast latency.');
          requiresHumanReview = true;
        }

        // Anomaly: future timestamp
        if (parsedTime > now + 60000) {
          aisAnomalies.push(`AIS telemetry anomaly: lastSeenTimestamp '${lastSeenTimestamp}' is set in the future.`);
          if (darkAisRiskLevel === 'NORMAL') darkAisRiskLevel = 'ELEVATED';
          reviewReasons.push('AIS telemetry timestamp indicates future broadcast.');
          requiresHumanReview = true;
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 3. Port Call History & Route Risk Evaluation
  // ---------------------------------------------------------------------------
  let portHistoryCoverage: MaritimeEvaluation['portHistoryCoverage'] = 'HISTORY_EVALUATED';
  const portRiskAnalysis: PortRiskAssessment[] = [];
  let hasSanctionedPort = false;
  let hasInvalidPort = false;

  if (!req.portsCalled || !Array.isArray(req.portsCalled) || req.portsCalled.length === 0) {
    portHistoryCoverage = 'NO_PORT_HISTORY_SUPPLIED';
    reviewReasons.push('No port history or voyage calls supplied. Route sanctions risk cannot be verified.');
    requiresHumanReview = true;
    if (completenessStatus !== 'INCOMPLETE_REJECTED') completenessStatus = 'PARTIAL_DOSSIER';
  } else {
    for (const p of req.portsCalled) {
      const validationIssues: string[] = [];
      const cleanLocode = (p.unLocode || '').toUpperCase().replace(/\s+/g, '');

      // 1. Validate UN/LOCODE format (2-letter ISO country + 3-char location code)
      if (!/^[A-Z]{2}[A-Z2-9]{3}$/.test(cleanLocode)) {
        validationIssues.push(
          `Invalid UN/LOCODE format: '${p.unLocode}'. Must be 5 alphanumeric characters (2-letter country + 3-character location code).`
        );
      }

      // 2. Validate country vs UN/LOCODE country prefix
      const declaredCountryCode = extractIsoCountryCode(p.country);
      const locodePrefix = cleanLocode.slice(0, 2);
      if (declaredCountryCode && locodePrefix && declaredCountryCode !== locodePrefix) {
        validationIssues.push(
          `UN/LOCODE country prefix '${locodePrefix}' does not match declared port country '${p.country}' (${declaredCountryCode}).`
        );
      }

      // 3. Validate arrival date calendar validity
      const dateCheck = validateIsoArrivalDate(p.arrivalDate);
      if (!dateCheck.isValid) {
        validationIssues.push(dateCheck.error || `Invalid arrival date: '${p.arrivalDate}'.`);
      }

      // 4. Sanctions & high-risk check
      const hit = HIGH_RISK_PORTS[cleanLocode];
      const isSanctionedOrHighRisk = Boolean(hit);

      let portStatus: PortRiskAssessment['portStatus'] = 'NOT_DESIGNATED_HIGH_RISK';
      if (validationIssues.length > 0) {
        portStatus = 'INVALID_PORT_ENTRY';
        hasInvalidPort = true;
        reviewReasons.push(`Invalid port call entry for '${p.portName}': ${validationIssues.join('; ')}`);
        requiresHumanReview = true;
      } else if (isSanctionedOrHighRisk) {
        portStatus = 'SANCTIONED_DESIGNATED_PORT';
        hasSanctionedPort = true;
        reviewReasons.push(`Voyage call at sanctioned port: ${p.portName} (${cleanLocode}) - ${hit?.riskReason}`);
        requiresHumanReview = true;
      }

      portRiskAnalysis.push({
        portName: p.portName,
        unLocode: p.unLocode,
        country: p.country,
        arrivalDate: p.arrivalDate,
        isHighRiskOrSanctioned: isSanctionedOrHighRisk,
        riskReason: hit?.riskReason,
        portStatus,
        validationIssues: validationIssues.length > 0 ? validationIssues : undefined,
      });
    }

    if (hasInvalidPort) {
      portHistoryCoverage = 'INVALID_PORT_HISTORY';
    }
  }

  // ---------------------------------------------------------------------------
  // 4. Screening: Vessel & Ownership Hierarchy
  // ---------------------------------------------------------------------------
  let highestScore = 0;
  let findingSeverity: FindingSeverity = 'NO_MATCH_FOUND';

  // Screen vessel name if provided
  if (req.vessel.vesselName && req.vessel.vesselName.trim() !== '') {
    const vesselParty: CanonicalParty = {
      partyId: `vessel_${rawImo}`,
      role: 'CHARGES_PARTY',
      name: req.vessel.vesselName,
      identifiers: [{ type: 'IMO', value: rawImo }],
      provenance: { sourceTag: 'VESSEL_PROFILE', rawSnippet: `Vessel: ${req.vessel.vesselName} (IMO: ${rawImo})` },
    };
    const vesselOutcome = embeddedSyntheticEngine.screenPartySync(vesselParty, req.tenantId || 'default');
    if (vesselOutcome.highestScore > highestScore) highestScore = vesselOutcome.highestScore;
    if (vesselOutcome.findingSeverity === 'EXACT_IDENTIFIER_MATCH') findingSeverity = 'EXACT_IDENTIFIER_MATCH';
    else if (vesselOutcome.findingSeverity === 'FUZZY_NAME_CANDIDATE') findingSeverity = 'FUZZY_NAME_CANDIDATE';
  }

  // Check known vessel list
  if (knownSanctionedHit) {
    findingSeverity = 'EXACT_IDENTIFIER_MATCH';
    highestScore = 1.0;
    reviewReasons.push(`Vessel is designated under ${knownSanctionedHit.program} shadow fleet sanctions.`);
    requiresHumanReview = true;
  }

  // Screen owners and managers
  let ownershipCoverage: MaritimeEvaluation['ownershipCoverage'] = 'COMPLETE_OWNERSHIP';
  const ownershipHierarchy: VesselOwnershipNode[] = [];
  let hasSanctionedOwner = false;

  if (!req.ownershipHierarchy || !Array.isArray(req.ownershipHierarchy) || req.ownershipHierarchy.length === 0) {
    ownershipCoverage = 'NO_OWNERSHIP_SUPPLIED';
    reviewReasons.push('No vessel ownership or management hierarchy supplied. Beneficial ownership screening required.');
    requiresHumanReview = true;
    if (completenessStatus !== 'INCOMPLETE_REJECTED') completenessStatus = 'PARTIAL_DOSSIER';
  } else {
    for (const node of req.ownershipHierarchy) {
      const isNodeNameBlank = !node.name || node.name.trim() === '';
      const isNodeCountryBlank = !node.country || node.country.trim() === '';

      if (isNodeNameBlank) {
        reviewReasons.push(`Ownership node (${node.role}) has blank or missing entity name.`);
        requiresHumanReview = true;
        ownershipCoverage = 'PARTIAL_OWNERSHIP';
        ownershipHierarchy.push({
          role: node.role,
          name: '',
          country: node.country || '',
          isSanctioned: false,
          matches: [],
          status: 'INCOMPLETE_NOT_SCREENED',
          isScreened: false,
        });
        continue;
      }

      if (isNodeCountryBlank) {
        reviewReasons.push(`Ownership node (${node.role}: ${node.name}) is missing country jurisdiction.`);
        requiresHumanReview = true;
        ownershipCoverage = 'PARTIAL_OWNERSHIP';
      }

      const ownerParty: CanonicalParty = {
        partyId: `owner_${Math.random().toString(36).slice(2, 8)}`,
        role: 'DEBTOR',
        name: node.name,
        country: node.country,
        identifiers: [],
        provenance: { sourceTag: node.role, rawSnippet: `${node.role}: ${node.name}` },
      };
      const outcome = embeddedSyntheticEngine.screenPartySync(ownerParty, req.tenantId || 'default');
      if (outcome.highestScore > highestScore) highestScore = outcome.highestScore;
      if (outcome.findingSeverity === 'EXACT_IDENTIFIER_MATCH') findingSeverity = 'EXACT_IDENTIFIER_MATCH';
      else if (outcome.findingSeverity === 'FUZZY_NAME_CANDIDATE' && findingSeverity !== 'EXACT_IDENTIFIER_MATCH') {
        findingSeverity = 'FUZZY_NAME_CANDIDATE';
      }

      const isSanctioned = outcome.matches.length > 0;
      if (isSanctioned) {
        hasSanctionedOwner = true;
        reviewReasons.push(`Sanctions candidate match identified in ownership hierarchy (${node.role}: ${node.name}).`);
        requiresHumanReview = true;
      }

      ownershipHierarchy.push({
        role: node.role,
        name: node.name,
        country: node.country,
        isSanctioned,
        matches: outcome.matches,
        status: isSanctioned ? 'MATCH_CANDIDATE' : 'SCREENED_CLEAR',
        isScreened: true,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // 5. Decision Recommendation & Clearance Status
  // ---------------------------------------------------------------------------
  let decisionRecommendation: MaritimeEvaluation['decisionRecommendation'] = 'APPROVE_VOYAGE_COVERAGE';

  if (Boolean(knownSanctionedHit) || findingSeverity === 'EXACT_IDENTIFIER_MATCH' || hasSanctionedPort || hasSanctionedOwner) {
    decisionRecommendation = 'REJECT_SANCTIONS_RISK';
    requiresHumanReview = true;
  } else if (
    requiresHumanReview ||
    !isImoValid ||
    cleanImo === '0000000' ||
    completenessStatus !== 'FULL_DOSSIER' ||
    darkAisRiskLevel !== 'NORMAL' ||
    ownershipCoverage !== 'COMPLETE_OWNERSHIP' ||
    portHistoryCoverage !== 'HISTORY_EVALUATED' ||
    aisCoverage !== 'TELEMETRY_EVALUATED' ||
    hasInvalidPort
  ) {
    decisionRecommendation = 'HOLD_FOR_HUMAN_REVIEW';
    requiresHumanReview = true;
  }

  const isApprovedForCoverage =
    decisionRecommendation === 'APPROVE_VOYAGE_COVERAGE' &&
    isImoValid &&
    cleanImo !== '0000000' &&
    !requiresHumanReview &&
    completenessStatus === 'FULL_DOSSIER' &&
    darkAisRiskLevel === 'NORMAL';

  const timestamp = new Date().toISOString();
  const evidenceDigest = createHash('sha256')
    .update(
      JSON.stringify({
        vessel: req.vessel,
        isImoValid,
        findingSeverity,
        darkAisRiskLevel,
        portRiskAnalysis,
        ownershipHierarchy,
        completenessStatus,
        decisionRecommendation,
        timestamp,
      })
    )
    .digest('hex');

  return {
    id: `maritime_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    vessel: req.vessel,
    isImoChecksumValid: isImoValid,
    isVesselRegistrationVerified,
    vesselRegistrationStatus,
    identifierValidationIssues,
    ownershipHierarchy,
    ownershipCoverage,
    portRiskAnalysis,
    portHistoryCoverage,
    aisAnomalies,
    aisCoverage,
    darkAisRiskLevel,
    findingSeverity,
    highestScore,
    completenessStatus,
    decisionRecommendation,
    requiresHumanReview,
    reviewReasons,
    isApprovedForCoverage,
    evidenceDigest,
    timestamp,
  };
}
