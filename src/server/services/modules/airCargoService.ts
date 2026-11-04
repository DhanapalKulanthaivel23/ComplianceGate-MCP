/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import {
  AirCargoEvaluation,
  AirWaybillParty,
  FindingSeverity,
  CanonicalParty,
} from '../../../shared/types.ts';
import { embeddedSyntheticEngine } from '../engineAdapter.ts';
import { extractIsoCountryCode } from './maritimeService.ts';
import { createHash } from 'node:crypto';

export interface EvaluateAirCargoRequest {
  tenantId?: string;
  awbNumber: string; // e.g., "176-12345675" or "17612345675"
  carrierName?: string;
  flightNumber?: string;
  originAirport: string; // 3-letter IATA code, e.g. "DXB"
  destinationAirport: string; // e.g. "FRA"
  transitAirports?: string[]; // e.g. ["THR", "IST"]
  shipper: { name: string; address?: string; country: string };
  consignee: { name: string; address?: string; country: string };
  notifyParty?: { name: string; address?: string; country: string };
  carrierAgent?: { name: string; address?: string; country: string };
  cargo: {
    description: string;
    grossWeightKg: number;
    piecesCount: number;
    declaredHsCode?: string;
    isHazardous: boolean;
  };
}

/**
 * Validates IATA Air Waybill check digit:
 * 11 digits: 3 prefix + 7 serial + 1 check digit.
 * Rule: Serial % 7 === checkDigit.
 * Rejects placeholder 000-00000000 and alphabetic contamination.
 */
export function validateIataAwbChecksum(awb: string): {
  isValid: boolean;
  prefix: string;
  serial: string;
  checkDigit: number;
  reason?: string;
} {
  if (!awb || typeof awb !== 'string' || awb.trim() === '') {
    return { isValid: false, prefix: '', serial: '', checkDigit: -1, reason: 'AWB number is missing or empty' };
  }

  const trimmed = awb.trim();

  // Reject alphabetic contamination
  if (/[a-zA-Z]/.test(trimmed)) {
    return {
      isValid: false,
      prefix: '',
      serial: '',
      checkDigit: -1,
      reason: `AWB '${awb}' contains illegal alphabetic characters (format must be 11 numeric digits: PPP-SSSSSSSC)`,
    };
  }

  const clean = trimmed.replace(/[^0-9]/g, '');
  if (clean.length !== 11) {
    return {
      isValid: false,
      prefix: clean.slice(0, 3),
      serial: '',
      checkDigit: -1,
      reason: `AWB must be exactly 11 digits (got ${clean.length})`,
    };
  }

  // Reject placeholder all-zero AWB or 000-prefix
  if (clean === '00000000000' || clean.startsWith('000')) {
    return {
      isValid: false,
      prefix: '000',
      serial: clean.slice(3, 10),
      checkDigit: parseInt(clean.slice(10, 11), 10),
      reason: 'All-zero or 000-prefix AWB is an invalid placeholder identifier',
    };
  }

  const prefix = clean.slice(0, 3);
  const serial = clean.slice(3, 10);
  const checkDigit = parseInt(clean.slice(10, 11), 10);
  const serialNum = parseInt(serial, 10);
  const expectedCheck = serialNum % 7;
  const isValid = expectedCheck === checkDigit;

  return {
    isValid,
    prefix,
    serial,
    checkDigit,
    reason: isValid ? undefined : `IATA Mod-7 check digit mismatch: expected ${expectedCheck}, got ${checkDigit}`,
  };
}

// Known IATA Airline Prefixes with country and operating entity
export const AIRLINE_PREFIX_MAP: Record<string, { airlineName: string; country: string; icao?: string }> = {
  '176': { airlineName: 'Emirates SkyCargo', country: 'AE', icao: 'UAE' },
  '020': { airlineName: 'Lufthansa Cargo', country: 'DE', icao: 'GEC' },
  '074': { airlineName: 'KLM Cargo', country: 'NL', icao: 'KLM' },
  '016': { airlineName: 'United Cargo', country: 'US', icao: 'UAL' },
  '618': { airlineName: 'Singapore Airlines Cargo', country: 'SG', icao: 'SQC' },
  '125': { airlineName: 'British Airways World Cargo', country: 'GB', icao: 'BAW' },
  '217': { airlineName: 'Mahan Air', country: 'IR', icao: 'IRM' }, // Designated Entity / Iran
  '555': { airlineName: 'Aeroflot Cargo', country: 'RU', icao: 'AFL' },
  '507': { airlineName: 'Aeroflot International', country: 'RU', icao: 'RUE' },
};

// High-Risk Transit / Sanctioned Gateway Airports
export const HIGH_RISK_AIRPORTS: Record<string, { city: string; reason: string }> = {
  'THR': { city: 'Tehran, Iran', reason: 'High-risk aerospace & dual-use transshipment corridor' },
  'DAM': { city: 'Damascus, Syria', reason: 'Comprehensive embargoed airport zone' },
  'FNJ': { city: 'Pyongyang, North Korea', reason: 'UN Sanctioned aviation hub' },
  'MSQ': { city: 'Minsk, Belarus', reason: 'Aviation sanctions & military cargo staging hub' },
  'SVO': { city: 'Moscow Sheremetyevo, Russia', reason: 'Export control surveillance on avionics & high-tech goods' },
};

export function isValidIataAirportCode(code?: string): boolean {
  if (!code || typeof code !== 'string') return false;
  return /^[A-Z]{3}$/.test(code.trim().toUpperCase());
}

export function evaluateAirCargo(req: EvaluateAirCargoRequest): AirCargoEvaluation {
  // ---------------------------------------------------------------------------
  // 0. Defensive Request Structure Validation
  // ---------------------------------------------------------------------------
  if (!req || typeof req !== 'object') {
    throw new Error('Invalid air cargo evaluation request: request body must be a non-empty JSON object.');
  }
  if (!req.awbNumber || typeof req.awbNumber !== 'string' || req.awbNumber.trim() === '') {
    throw new Error("Invalid air cargo evaluation request: missing mandatory 'awbNumber'.");
  }
  if (!req.cargo || typeof req.cargo !== 'object') {
    throw new Error("Invalid air cargo evaluation request: missing mandatory 'cargo' object.");
  }

  // Numerical & Piece Count Validation
  if (req.cargo.grossWeightKg !== undefined && req.cargo.grossWeightKg !== null) {
    if (req.cargo.grossWeightKg < 0 || !Number.isFinite(req.cargo.grossWeightKg)) {
      throw new Error(`Invalid cargo grossWeightKg: ${req.cargo.grossWeightKg}. Weight cannot be negative or infinite.`);
    }
  }
  if (req.cargo.piecesCount !== undefined && req.cargo.piecesCount !== null) {
    if (req.cargo.piecesCount < 0 || !Number.isInteger(req.cargo.piecesCount)) {
      throw new Error(`Invalid cargo piecesCount: ${req.cargo.piecesCount}. Piece count must be a positive non-fractional integer.`);
    }
  }

  const reviewReasons: string[] = [];
  const identifierValidationIssues: string[] = [];
  const cargoValidationIssues: string[] = [];
  const routingIssues: string[] = [];
  let requiresHumanReview = false;
  let completenessStatus: AirCargoEvaluation['completenessStatus'] = 'FULL_MANIFEST';

  // ---------------------------------------------------------------------------
  // 1. AWB Validation & Carrier Resolution
  // ---------------------------------------------------------------------------
  const awbCheck = validateIataAwbChecksum(req.awbNumber);
  if (!awbCheck.isValid) {
    identifierValidationIssues.push(awbCheck.reason || 'IATA AWB check digit validation failed.');
    reviewReasons.push(`Invalid AWB: ${awbCheck.reason || 'Checksum mismatch'}.`);
    requiresHumanReview = true;
    completenessStatus = 'INCOMPLETE_REJECTED';
  }

  const airlineRecord = AIRLINE_PREFIX_MAP[awbCheck.prefix];
  const isAwbRegistrationVerified = awbCheck.isValid && Boolean(airlineRecord);
  const awbVerificationStatus: AirCargoEvaluation['awbVerificationStatus'] = !awbCheck.isValid
    ? 'INVALID_AWB'
    : isAwbRegistrationVerified
    ? 'VERIFIED_ACTIVE'
    : 'UNVERIFIED_CARRIER';

  const airlineName = airlineRecord?.airlineName || req.carrierName || `Airline Operator (Prefix ${awbCheck.prefix || 'UNKNOWN'})`;
  const carrierVerificationStatus: AirCargoEvaluation['carrierVerificationStatus'] = airlineRecord
    ? 'VERIFIED_AIRLINE'
    : 'UNRESOLVED_CARRIER';

  if (!airlineRecord && awbCheck.isValid) {
    identifierValidationIssues.push(`Prefix '${awbCheck.prefix}' is not in the recognized IATA carrier registry.`);
    reviewReasons.push(`Unresolved airline prefix '${awbCheck.prefix}'. Manual carrier confirmation required.`);
    requiresHumanReview = true;
  }

  // ---------------------------------------------------------------------------
  // 2. Airport Routing Validation
  // ---------------------------------------------------------------------------
  const originValid = isValidIataAirportCode(req.originAirport);
  if (!originValid) {
    routingIssues.push(`Invalid or missing origin airport code: '${req.originAirport || 'EMPTY'}'. Must be a 3-letter IATA code.`);
    reviewReasons.push(`Invalid origin airport '${req.originAirport || 'EMPTY'}'.`);
    requiresHumanReview = true;
  }

  const destValid = isValidIataAirportCode(req.destinationAirport);
  if (!destValid) {
    routingIssues.push(`Invalid or missing destination airport code: '${req.destinationAirport || 'EMPTY'}'. Must be a 3-letter IATA code.`);
    reviewReasons.push(`Invalid destination airport '${req.destinationAirport || 'EMPTY'}'.`);
    requiresHumanReview = true;
  }

  const transitAirports = req.transitAirports || [];
  for (const t of transitAirports) {
    if (!isValidIataAirportCode(t)) {
      routingIssues.push(`Invalid transit airport code: '${t}'. Must be a 3-letter IATA code.`);
      reviewReasons.push(`Invalid transit airport '${t}'.`);
      requiresHumanReview = true;
    }
  }

  // Detect High-Risk Transit Corridors
  const allAirports = [req.originAirport, ...transitAirports, req.destinationAirport]
    .filter(Boolean)
    .map((a) => a.toUpperCase().trim());
  const highRiskHits = allAirports.filter((code) => HIGH_RISK_AIRPORTS[code]);
  const hasHighRiskTransshipment = highRiskHits.length > 0;
  const highRiskTransitDetails = hasHighRiskTransshipment
    ? highRiskHits.map((code) => `${code} (${HIGH_RISK_AIRPORTS[code].city}): ${HIGH_RISK_AIRPORTS[code].reason}`).join('; ')
    : undefined;

  if (hasHighRiskTransshipment) {
    reviewReasons.push(`High-risk airport corridor detected: ${highRiskTransitDetails}`);
    requiresHumanReview = true;
  }

  let routingStatus: AirCargoEvaluation['routing']['routingStatus'] = 'SAFE_ROUTING_CORRIDOR';
  if (routingIssues.length > 0) {
    routingStatus = 'INVALID_ROUTING';
  } else if (hasHighRiskTransshipment) {
    routingStatus = 'HIGH_RISK_TRANSIT_DETECTED';
  }

  // ---------------------------------------------------------------------------
  // 3. Cargo Declaration & Proliferation Assessment
  // ---------------------------------------------------------------------------
  const rawDesc = (req.cargo.description || '').trim();
  if (rawDesc === '') {
    cargoValidationIssues.push('Cargo description is empty or missing. Commodity cannot be screened.');
    reviewReasons.push('Missing cargo commodity description.');
    completenessStatus = 'INCOMPLETE_REJECTED';
    requiresHumanReview = true;
  }

  if (req.cargo.grossWeightKg === 0 || req.cargo.piecesCount === 0) {
    cargoValidationIssues.push(
      `Commercial air cargo cannot declare zero quantity: grossWeightKg=${req.cargo.grossWeightKg}, piecesCount=${req.cargo.piecesCount}.`
    );
    reviewReasons.push('Commercial cargo manifest declares zero weight or zero pieces.');
    completenessStatus = 'INCOMPLETE_REJECTED';
    requiresHumanReview = true;
  }

  const descLower = rawDesc.toLowerCase();
  const isDualUseRisk =
    descLower.includes('transceiver') ||
    descLower.includes('avionics') ||
    descLower.includes('gyroscope') ||
    descLower.includes('microchip') ||
    descLower.includes('drone') ||
    descLower.includes('titanium alloy') ||
    descLower.includes('infrared sensor') ||
    (req.cargo.declaredHsCode?.startsWith('8542') ?? false);

  if (isDualUseRisk) {
    reviewReasons.push(`Potential dual-use / military aerospace commodity detected: '${rawDesc}'`);
    requiresHumanReview = true;
  }
  if (req.cargo.isHazardous) {
    reviewReasons.push('Hazardous material / dangerous goods declaration attached.');
    requiresHumanReview = true;
  }

  let securityStatus: AirCargoEvaluation['cargoDetails']['securityScreeningStatus'] = 'CLEARED';
  if (cargoValidationIssues.length > 0) {
    securityStatus = 'INCOMPLETE_DATA';
  } else if (isDualUseRisk || hasHighRiskTransshipment) {
    securityStatus = 'FLAGGED';
  } else if (req.cargo.isHazardous) {
    securityStatus = 'SUSPICIOUS_CONTENT';
  }

  // ---------------------------------------------------------------------------
  // 4. Screening: Parties (Shipper, Consignee, Notify, Carrier Agent, Carrier)
  // ---------------------------------------------------------------------------
  const partiesToScreen: { role: AirWaybillParty['role']; name?: string; address?: string; country?: string }[] = [];

  // Shipper validation
  const shipperName = req.shipper?.name?.trim();
  const shipperCountryIso = extractIsoCountryCode(req.shipper?.country);
  if (!shipperName) {
    reviewReasons.push('Shipper/Consignor name is missing or blank.');
    completenessStatus = 'INCOMPLETE_REJECTED';
    requiresHumanReview = true;
  }
  if (!shipperCountryIso) {
    reviewReasons.push(`Shipper country jurisdiction '${req.shipper?.country || 'MISSING'}' is invalid or unestablished.`);
    completenessStatus = 'INCOMPLETE_REJECTED';
    requiresHumanReview = true;
  }
  partiesToScreen.push({ role: 'SHIPPER', name: shipperName, address: req.shipper?.address, country: req.shipper?.country });

  // Consignee validation
  const consigneeName = req.consignee?.name?.trim();
  const consigneeCountryIso = extractIsoCountryCode(req.consignee?.country);
  if (!consigneeName) {
    reviewReasons.push('Consignee name is missing or blank.');
    completenessStatus = 'INCOMPLETE_REJECTED';
    requiresHumanReview = true;
  }
  if (!consigneeCountryIso) {
    reviewReasons.push(`Consignee country jurisdiction '${req.consignee?.country || 'MISSING'}' is invalid or unestablished.`);
    completenessStatus = 'INCOMPLETE_REJECTED';
    requiresHumanReview = true;
  }
  partiesToScreen.push({ role: 'CONSIGNEE', name: consigneeName, address: req.consignee?.address, country: req.consignee?.country });

  if (req.notifyParty) {
    partiesToScreen.push({ role: 'NOTIFY_PARTY', name: req.notifyParty.name, address: req.notifyParty.address, country: req.notifyParty.country });
  }
  if (req.carrierAgent) {
    partiesToScreen.push({ role: 'CARRIER_AGENT', name: req.carrierAgent.name, address: req.carrierAgent.address, country: req.carrierAgent.country });
  }

  // Carrier Screening
  partiesToScreen.push({
    role: 'CARRIER',
    name: airlineName,
    country: airlineRecord?.country,
  });

  let highestScore = 0;
  let findingSeverity: FindingSeverity = 'NO_MATCH_FOUND';
  const screenedParties: AirWaybillParty[] = [];
  let hasSanctionedParty = false;

  for (const p of partiesToScreen) {
    const isBlank = !p.name || p.name.trim() === '';
    if (isBlank) {
      screenedParties.push({
        role: p.role,
        name: '',
        address: p.address,
        country: p.country,
        matches: [],
        status: 'INCOMPLETE_NOT_SCREENED',
        isScreened: false,
      });
      continue;
    }

    const canonicalP: CanonicalParty = {
      partyId: `awb_party_${Math.random().toString(36).slice(2, 8)}`,
      role: 'CREDITOR',
      name: p.name!,
      country: p.country,
      identifiers: p.role === 'CARRIER' ? [{ type: 'IATA_PREFIX', value: awbCheck.prefix }] : [],
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
      reviewReasons.push(`Sanctions match candidate identified for ${p.role}: '${p.name}'.`);
      requiresHumanReview = true;
    }

    screenedParties.push({
      role: p.role,
      name: p.name!,
      address: p.address,
      country: p.country,
      matches: outcome.matches,
      status: isMatch ? 'MATCH_CANDIDATE' : 'SCREENED_CLEAR',
      isScreened: true,
    });
  }

  // ---------------------------------------------------------------------------
  // 5. Decision Recommendation & Clearance Status
  // ---------------------------------------------------------------------------
  let decisionRecommendation: AirCargoEvaluation['decisionRecommendation'] = 'APPROVE_AIR_RELEASE';

  if (hasSanctionedParty || findingSeverity === 'EXACT_IDENTIFIER_MATCH') {
    decisionRecommendation = 'REJECT_AIR_SANCTIONS_RISK';
    requiresHumanReview = true;
  } else if (
    requiresHumanReview ||
    !awbCheck.isValid ||
    completenessStatus !== 'FULL_MANIFEST' ||
    routingStatus === 'INVALID_ROUTING' ||
    routingStatus === 'HIGH_RISK_TRANSIT_DETECTED' ||
    securityStatus !== 'CLEARED'
  ) {
    decisionRecommendation = 'HOLD_FOR_HUMAN_REVIEW';
    requiresHumanReview = true;
  }

  const timestamp = new Date().toISOString();
  const evidenceDigest = createHash('sha256')
    .update(
      JSON.stringify({
        awbNumber: req.awbNumber,
        awbCheck,
        routingStatus,
        securityStatus,
        completenessStatus,
        decisionRecommendation,
        screenedParties,
        timestamp,
      })
    )
    .digest('hex');

  return {
    id: `air_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    awbNumber: req.awbNumber,
    isAwbChecksumValid: awbCheck.isValid,
    isAwbRegistrationVerified,
    awbVerificationStatus,
    identifierValidationIssues,
    airlinePrefix: awbCheck.prefix,
    airlineName,
    carrierVerificationStatus,
    flightNumber: req.flightNumber,
    routing: {
      originAirport: (req.originAirport || '').toUpperCase(),
      destinationAirport: (req.destinationAirport || '').toUpperCase(),
      transitAirports: (req.transitAirports || []).map((a) => a.toUpperCase()),
      hasHighRiskTransshipment,
      highRiskTransitDetails,
      routingStatus,
      routingIssues: routingIssues.length > 0 ? routingIssues : undefined,
    },
    parties: screenedParties,
    cargoDetails: {
      declaredDescription: req.cargo.description,
      grossWeightKg: req.cargo.grossWeightKg,
      piecesCount: req.cargo.piecesCount,
      declaredHsCode: req.cargo.declaredHsCode,
      isHazardousMaterial: req.cargo.isHazardous,
      isDualUseRisk,
      securityScreeningStatus: securityStatus,
      cargoValidationIssues: cargoValidationIssues.length > 0 ? cargoValidationIssues : undefined,
    },
    completenessStatus,
    decisionRecommendation,
    requiresHumanReview,
    reviewReasons,
    findingSeverity,
    highestScore,
    evidenceDigest,
    timestamp,
  };
}
