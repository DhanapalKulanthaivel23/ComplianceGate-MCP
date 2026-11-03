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
import { createHash } from 'node:crypto';

export interface EvaluateAirCargoRequest {
  awbNumber: string; // e.g., "176-12345675" or "17612345675"
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
 * Rule: Serial % 7 === checkDigit
 */
export function validateIataAwbChecksum(awb: string): { isValid: boolean; prefix: string; serial: string; checkDigit: number } {
  const clean = awb.replace(/[^0-9]/g, '');
  if (clean.length !== 11) {
    return { isValid: false, prefix: '', serial: '', checkDigit: -1 };
  }
  const prefix = clean.slice(0, 3);
  const serial = clean.slice(3, 10);
  const checkDigit = parseInt(clean.slice(10, 11), 10);
  const serialNum = parseInt(serial, 10);
  const expectedCheck = serialNum % 7;
  return {
    isValid: expectedCheck === checkDigit,
    prefix,
    serial,
    checkDigit,
  };
}

// Known IATA Airline Prefixes
const AIRLINE_PREFIX_MAP: Record<string, string> = {
  '176': 'Emirates SkyCargo',
  '020': 'Lufthansa Cargo',
  '074': 'KLM Cargo',
  '016': 'United Cargo',
  '618': 'Singapore Airlines Cargo',
  '125': 'British Airways World Cargo',
  '217': 'Mahan Air (Designated Entity / Iran)',
  '555': 'Aeroflot Cargo',
  '507': 'Aeroflot International',
};

// High-Risk Transit / Sanctioned Gateway Airports
const HIGH_RISK_AIRPORTS: Record<string, { city: string; reason: string }> = {
  'THR': { city: 'Tehran, Iran', reason: 'High-risk aerospace & dual-use transshipment corridor' },
  'DAM': { city: 'Damascus, Syria', reason: 'Comprehensive embargoed airport zone' },
  'FNJ': { city: 'Pyongyang, North Korea', reason: 'UN Sanctioned aviation hub' },
  'MSQ': { city: 'Minsk, Belarus', reason: 'Aviation sanctions & military cargo staging hub' },
  'SVO': { city: 'Moscow Sheremetyevo, Russia', reason: 'Export control surveillance on avionics & high-tech goods' },
};

export function evaluateAirCargo(req: EvaluateAirCargoRequest): AirCargoEvaluation {
  const awbCheck = validateIataAwbChecksum(req.awbNumber);
  const airlineName = AIRLINE_PREFIX_MAP[awbCheck.prefix] || `Airline Operator (Prefix ${awbCheck.prefix})`;

  // 1. High-risk transshipment check
  const allAirports = [req.originAirport, ...(req.transitAirports || []), req.destinationAirport].map((a) => a.toUpperCase().trim());
  const highRiskHits = allAirports.filter((code) => HIGH_RISK_AIRPORTS[code]);
  const hasHighRiskTransshipment = highRiskHits.length > 0;
  const highRiskTransitDetails = hasHighRiskTransshipment
    ? highRiskHits.map((code) => `${code} (${HIGH_RISK_AIRPORTS[code].city}): ${HIGH_RISK_AIRPORTS[code].reason}`).join('; ')
    : undefined;

  // 2. Dual-use & hazardous goods checks
  const descLower = req.cargo.description.toLowerCase();
  const isDualUseRisk =
    descLower.includes('transceiver') ||
    descLower.includes('avionics') ||
    descLower.includes('gyroscope') ||
    descLower.includes('microchip') ||
    descLower.includes('drone') ||
    descLower.includes('titanium alloy') ||
    descLower.includes('infrared sensor') ||
    (req.cargo.declaredHsCode?.startsWith('8542') ?? false);

  let securityStatus: AirCargoEvaluation['cargoDetails']['securityScreeningStatus'] = 'CLEARED';
  if (isDualUseRisk || hasHighRiskTransshipment) {
    securityStatus = 'FLAGGED';
  } else if (req.cargo.isHazardous) {
    securityStatus = 'SUSPICIOUS_CONTENT';
  }

  // 3. Screen AWB Parties
  const partiesToScreen: { role: AirWaybillParty['role']; name: string; address?: string; country?: string }[] = [
    { role: 'SHIPPER', name: req.shipper.name, address: req.shipper.address, country: req.shipper.country },
    { role: 'CONSIGNEE', name: req.consignee.name, address: req.consignee.address, country: req.consignee.country },
  ];
  if (req.notifyParty) {
    partiesToScreen.push({ role: 'NOTIFY_PARTY', name: req.notifyParty.name, address: req.notifyParty.address, country: req.notifyParty.country });
  }
  if (req.carrierAgent) {
    partiesToScreen.push({ role: 'CARRIER_AGENT', name: req.carrierAgent.name, address: req.carrierAgent.address, country: req.carrierAgent.country });
  }

  let highestScore = 0;
  let findingSeverity: FindingSeverity = 'NO_MATCH_FOUND';
  const screenedParties: AirWaybillParty[] = [];

  for (const p of partiesToScreen) {
    const canonicalP: CanonicalParty = {
      partyId: `awb_party_${Math.random().toString(36).slice(2, 8)}`,
      role: 'CREDITOR',
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

    screenedParties.push({
      role: p.role,
      name: p.name,
      address: p.address,
      country: p.country,
      matches: outcome.matches,
    });
  }

  const evidenceDigest = createHash('sha256')
    .update(JSON.stringify({ req, awbCheck, findingSeverity, highRiskHits, securityStatus, timestamp: new Date().toISOString() }))
    .digest('hex');

  return {
    id: `air_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    awbNumber: req.awbNumber,
    isAwbChecksumValid: awbCheck.isValid,
    airlinePrefix: awbCheck.prefix,
    airlineName,
    flightNumber: req.flightNumber,
    routing: {
      originAirport: req.originAirport.toUpperCase(),
      destinationAirport: req.destinationAirport.toUpperCase(),
      transitAirports: (req.transitAirports || []).map((a) => a.toUpperCase()),
      hasHighRiskTransshipment,
      highRiskTransitDetails,
    },
    parties: screenedParties,
    cargoDetails: {
      declaredDescription: req.cargo.description,
      grossWeightKg: req.cargo.grossWeightKg,
      piecesCount: req.cargo.piecesCount,
      isHazardousMaterial: req.cargo.isHazardous,
      isDualUseRisk,
      securityScreeningStatus: securityStatus,
    },
    findingSeverity,
    highestScore,
    evidenceDigest,
  };
}
