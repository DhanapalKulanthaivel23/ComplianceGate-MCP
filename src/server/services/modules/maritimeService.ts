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
import { createHash } from 'node:crypto';

export interface EvaluateMaritimeRequest {
  vessel: MaritimeVesselInfo;
  ownershipHierarchy: {
    role: VesselOwnershipNode['role'];
    name: string;
    country: string;
  }[];
  portsCalled: {
    portName: string;
    unLocode: string;
    country: string;
    arrivalDate?: string;
  }[];
  aisSignals?: {
    lastSeenTimestamp: string;
    hoursSinceLastBroadcast: number;
    stsTransferDetected: boolean;
    knownStsZone?: string;
    flagChangesLast12Months?: number;
  };
}

/**
 * Validates IMO number 7-digit checksum:
 * Sum(d[i] * (7 - i)) for i=0..5, mod 10 === d[6]
 */
export function validateImoChecksum(imoStr: string): boolean {
  const clean = imoStr.replace(/[^0-9]/g, '');
  if (clean.length !== 7) return false;
  const digits = clean.split('').map(Number);
  const weights = [7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((acc, w, idx) => acc + w * digits[idx], 0);
  const checkDigit = sum % 10;
  return checkDigit === digits[6];
}

// Known sanctioned or high-risk maritime ports / STS zones
const HIGH_RISK_PORTS: Record<string, { riskReason: string; country: string }> = {
  'UASEV': { riskReason: 'Crimea / Sevastopol Sanctioned Port (EU Reg 692/2014 & US EO 13685)', country: 'UA' },
  'UAFEO': { riskReason: 'Feodosia Commercial Port under territorial sanctions', country: 'UA' },
  'IRBND': { riskReason: 'Bandar Abbas (Tidewater Middle East Co. Sanctions / IRISL hub)', country: 'IR' },
  'IRBKM': { riskReason: 'Bandar Imam Khomeini Port (OFAC SDN designated maritime entity)', country: 'IR' },
  'SYTTU': { riskReason: 'Tartus Port / Syrian General Directorate of Ports (US Syria Sanctions)', country: 'SY' },
  'KPNAM': { riskReason: 'Nampo Port (UNSCR 2397 prohibited petroleum transfer hub)', country: 'KP' },
  'RUVVO': { riskReason: 'Vladivostok (Export control surveillance / petroleum price cap monitoring)', country: 'RU' },
};

// Known sanctioned shadow fleet vessels for deterministic evaluation
const KNOWN_SANCTIONED_VESSELS = [
  { imo: '9256858', name: 'OCEAN PERFUME', list: 'OFAC_SDN', program: 'IRAN-EO13902' },
  { imo: '9312896', name: 'LADY M', list: 'EU_FSF', program: 'UKRAINE-TERRITORIAL' },
  { imo: '9185530', name: 'ARCTIC METEOR', list: 'OFAC_SDN', program: 'RUSSIA-EO14024' },
];

export function evaluateMaritimeVessel(req: EvaluateMaritimeRequest): MaritimeEvaluation {
  const isImoValid = validateImoChecksum(req.vessel.imoNumber);
  const aisAnomalies: string[] = [];

  // 1. AIS Dark & Flag-hopping check
  let darkAisRiskLevel: MaritimeEvaluation['darkAisRiskLevel'] = 'NORMAL';
  if (req.aisSignals) {
    if (req.aisSignals.hoursSinceLastBroadcast > 24) {
      aisAnomalies.push(`AIS transponder non-transmitting for ${req.aisSignals.hoursSinceLastBroadcast} hours (potential dark activity)`);
      darkAisRiskLevel = 'HIGH_RISK_SUSPECTED';
    }
    if (req.aisSignals.stsTransferDetected) {
      aisAnomalies.push(`Ship-to-Ship (STS) transfer detected in zone: ${req.aisSignals.knownStsZone || 'Offshore corridor'}`);
      if (darkAisRiskLevel !== 'HIGH_RISK_SUSPECTED') darkAisRiskLevel = 'ELEVATED';
    }
    if (req.aisSignals.flagChangesLast12Months && req.aisSignals.flagChangesLast12Months >= 2) {
      aisAnomalies.push(`Flag-hopping detected: ${req.aisSignals.flagChangesLast12Months} flag changes in last 12 months (Common evasion typology)`);
      darkAisRiskLevel = 'HIGH_RISK_SUSPECTED';
    }
  }

  // 2. Port Risk Evaluation
  const portRiskAnalysis: PortRiskAssessment[] = req.portsCalled.map((p) => {
    const locodeKey = p.unLocode.toUpperCase().replace(/\s+/g, '');
    const hit = HIGH_RISK_PORTS[locodeKey];
    return {
      portName: p.portName,
      unLocode: p.unLocode,
      country: p.country,
      isHighRiskOrSanctioned: !!hit,
      riskReason: hit?.riskReason,
    };
  });

  // 3. Screen vessel name and ownership chain
  let highestScore = 0;
  let findingSeverity: FindingSeverity = 'NO_MATCH_FOUND';

  // Check vessel name itself
  const vesselParty: CanonicalParty = {
    partyId: `vessel_${req.vessel.imoNumber}`,
    role: 'CHARGES_PARTY',
    name: req.vessel.vesselName,
    identifiers: [{ type: 'IMO', value: req.vessel.imoNumber }],
    provenance: { sourceTag: 'VESSEL_PROFILE', rawSnippet: `Vessel: ${req.vessel.vesselName} (IMO: ${req.vessel.imoNumber})` },
  };
  const vesselOutcome = embeddedSyntheticEngine.screenPartySync(vesselParty);
  if (vesselOutcome.highestScore > highestScore) highestScore = vesselOutcome.highestScore;
  if (vesselOutcome.findingSeverity === 'EXACT_IDENTIFIER_MATCH') findingSeverity = 'EXACT_IDENTIFIER_MATCH';
  else if (vesselOutcome.findingSeverity === 'FUZZY_NAME_CANDIDATE') findingSeverity = 'FUZZY_NAME_CANDIDATE';

  // Check known vessel list
  const cleanImo = req.vessel.imoNumber.replace(/[^0-9]/g, '');
  const vesselHit = KNOWN_SANCTIONED_VESSELS.find((v) => v.imo === cleanImo);
  if (vesselHit) {
    findingSeverity = 'EXACT_IDENTIFIER_MATCH';
    highestScore = 1.0;
    vesselOutcome.matches.push({
      listId: vesselHit.list,
      listName: `${vesselHit.list} Maritime Sanctions`,
      entryId: `IMO-${vesselHit.imo}`,
      entryName: vesselHit.name,
      entryType: 'VESSEL',
      matchType: 'EXACT_IDENTIFIER',
      matchedField: 'imoNumber',
      queryValue: req.vessel.imoNumber,
      listValue: vesselHit.imo,
      similarityScore: 1.0,
      isExactIdentifier: true,
      programs: [vesselHit.program],
      notes: `Vessel designated under ${vesselHit.program} shadow fleet enforcement.`,
    });
  }

  // Screen owners and managers
  const ownershipHierarchy: VesselOwnershipNode[] = req.ownershipHierarchy.map((node) => {
    const ownerParty: CanonicalParty = {
      partyId: `owner_${Math.random().toString(36).slice(2, 8)}`,
      role: 'DEBTOR',
      name: node.name,
      country: node.country,
      identifiers: [],
      provenance: { sourceTag: node.role, rawSnippet: `${node.role}: ${node.name}` },
    };
    const outcome = embeddedSyntheticEngine.screenPartySync(ownerParty);
    if (outcome.highestScore > highestScore) highestScore = outcome.highestScore;
    if (outcome.findingSeverity === 'EXACT_IDENTIFIER_MATCH') findingSeverity = 'EXACT_IDENTIFIER_MATCH';
    else if (outcome.findingSeverity === 'FUZZY_NAME_CANDIDATE' && findingSeverity !== 'EXACT_IDENTIFIER_MATCH') {
      findingSeverity = 'FUZZY_NAME_CANDIDATE';
    }

    return {
      role: node.role,
      name: node.name,
      country: node.country,
      isSanctioned: outcome.matches.length > 0,
      matches: outcome.matches,
    };
  });

  const hasSanctionedPort = portRiskAnalysis.some((p) => p.isHighRiskOrSanctioned);
  const isApprovedForCoverage =
    isImoValid &&
    findingSeverity === 'NO_MATCH_FOUND' &&
    !hasSanctionedPort &&
    darkAisRiskLevel !== 'HIGH_RISK_SUSPECTED';

  const evidenceDigest = createHash('sha256')
    .update(JSON.stringify({ req, isImoValid, findingSeverity, darkAisRiskLevel, timestamp: new Date().toISOString() }))
    .digest('hex');

  return {
    id: `maritime_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    vessel: req.vessel,
    isImoChecksumValid: isImoValid,
    ownershipHierarchy,
    portRiskAnalysis,
    aisAnomalies,
    darkAisRiskLevel,
    findingSeverity,
    highestScore,
    isApprovedForCoverage,
    evidenceDigest,
  };
}
