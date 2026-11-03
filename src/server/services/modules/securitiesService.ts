/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import {
  SecuritiesEvaluation,
  FixTagValue,
  FindingSeverity,
  CanonicalParty,
} from '../../../shared/types.ts';
import { embeddedSyntheticEngine } from '../engineAdapter.ts';
import { createHash } from 'node:crypto';

export interface EvaluateSecuritiesRequest {
  rawFixMessage: string;
  parties?: {
    role: SecuritiesEvaluation['parties'][0]['role'];
    name: string;
    idValue: string;
  }[];
}

/**
 * Validates 12-character International Securities Identification Number (ISIN)
 * using the official Luhn double-add-double check digit calculation.
 */
export function validateIsinChecksum(isinStr: string): boolean {
  const clean = isinStr.trim().toUpperCase();
  if (!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(clean)) return false;

  // Convert letters to numbers (A=10, B=11, ..., Z=35)
  let numericString = '';
  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];
    const code = char.charCodeAt(0);
    if (code >= 65 && code <= 90) {
      numericString += (code - 55).toString();
    } else {
      numericString += char;
    }
  }

  // Luhn algorithm from right to left
  let sum = 0;
  let alternate = false;
  for (let i = numericString.length - 1; i >= 0; i--) {
    let digit = parseInt(numericString.charAt(i), 10);
    if (alternate) {
      digit *= 2;
      if (digit > 9) digit = Math.floor(digit / 10) + (digit % 10);
    }
    sum += digit;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

// Known Sectoral Sanctions ISINs (EU Reg 833/2014 & US EO 13662 Directives 1-4 debt/equity)
const SECTORAL_SANCTIONED_ISINS: Record<string, { issuer: string; country: string; directive: string }> = {
  'RU0009029540': { issuer: 'Sberbank of Russia (PJSC)', country: 'RU', directive: 'Directive 1 (New Debt & Equity Prohibitions)' },
  'RU000A0JX0J2': { issuer: 'Gazprom Neft PJSC', country: 'RU', directive: 'Directive 2 (Long-term Debt Prohibitions)' },
  'RU000A0JWSQ7': { issuer: 'VTB Bank PJSC', country: 'RU', directive: 'Directive 1 (New Debt/Capital Restrictions)' },
  'XS0805570354': { issuer: 'Russian Federation Sovereign Eurobond', country: 'RU', directive: 'Direct Sovereign Debt Sanctions (EO 14024)' },
};

export function parseFixMessage(raw: string): { fixVersion: string; msgType: SecuritiesEvaluation['msgType']; tags: FixTagValue[]; extractedFields: Record<number, string> } {
  // Support both standard SOH delimiter (\x01) and printable pipe (|) or semicolon (;)
  const delimiters = /[\x01|;]/;
  const parts = raw.split(delimiters).map((p) => p.trim()).filter(Boolean);

  const tags: FixTagValue[] = [];
  const extractedFields: Record<number, string> = {};

  const TAG_NAMES: Record<number, string> = {
    8: 'BeginString',
    9: 'BodyLength',
    35: 'MsgType',
    49: 'SenderCompID',
    56: 'TargetCompID',
    34: 'MsgSeqNum',
    52: 'SendingTime',
    11: 'ClOrdID',
    1: 'Account',
    55: 'Symbol',
    48: 'SecurityID',
    22: 'SecurityIDSource',
    54: 'Side',
    38: 'OrderQty',
    44: 'Price',
    40: 'OrdType',
    59: 'TimeInForce',
    10: 'CheckSum',
  };

  for (const part of parts) {
    const eqIdx = part.indexOf('=');
    if (eqIdx !== -1) {
      const tagNum = parseInt(part.slice(0, eqIdx), 10);
      const val = part.slice(eqIdx + 1);
      if (!isNaN(tagNum)) {
        extractedFields[tagNum] = val;
        tags.push({ tag: tagNum, name: TAG_NAMES[tagNum] || `Tag${tagNum}`, value: val });
      }
    }
  }

  const fixVersion = extractedFields[8] || 'FIX.4.2';
  let msgType: SecuritiesEvaluation['msgType'] = 'UNKNOWN';
  const rawType = extractedFields[35];
  if (rawType === 'D') msgType = 'NEW_ORDER_SINGLE';
  else if (rawType === '8') msgType = 'EXECUTION_REPORT';
  else if (rawType === 'G') msgType = 'ORDER_CANCEL_REPLACE';

  return { fixVersion, msgType, tags, extractedFields };
}

export function evaluateSecuritiesOrder(req: EvaluateSecuritiesRequest): SecuritiesEvaluation {
  const { fixVersion, msgType, tags, extractedFields } = parseFixMessage(req.rawFixMessage);

  const symbol = extractedFields[55] || 'UNKNOWN';
  const isin = extractedFields[48] || (symbol.length === 12 ? symbol : undefined);
  const isIsinChecksumValid = isin ? validateIsinChecksum(isin) : undefined;

  // Check sectoral sanctions on security ISIN
  const cleanIsin = isin ? isin.toUpperCase().trim() : '';
  const sectoralHit = cleanIsin ? SECTORAL_SANCTIONED_ISINS[cleanIsin] : undefined;
  const isSectoral = !!sectoralHit;

  const orderSide = extractedFields[54] === '2' ? 'SELL' : 'BUY';
  const orderQty = parseFloat(extractedFields[38] || '0');
  const orderPrice = extractedFields[44] ? parseFloat(extractedFields[44]) : undefined;

  const surveillanceAlerts: string[] = [];
  if (isSectoral) {
    surveillanceAlerts.push(`Prohibited Sectoral Security: ${cleanIsin} issued by ${sectoralHit?.issuer} under ${sectoralHit?.directive}`);
  }
  if (orderQty > 1000000) {
    surveillanceAlerts.push(`High Notional Value Order: ${orderQty.toLocaleString()} units triggers market surveillance pre-trade review`);
  }

  // Screen parties
  const rawParties: {
    role: 'EXECUTING_BROKER' | 'CLIENT_ACCOUNT' | 'COUNTERPARTY' | 'BENEFICIAL_OWNER';
    name: string;
    idValue: string;
  }[] = req.parties || [
    {
      role: 'EXECUTING_BROKER',
      name: extractedFields[49] || 'BROKER_DESK',
      idValue: extractedFields[49] || 'N/A',
    },
    {
      role: 'CLIENT_ACCOUNT',
      name: extractedFields[1] || 'ACCOUNT_01',
      idValue: extractedFields[1] || 'N/A',
    },
  ];

  let highestScore = 0;
  let findingSeverity: FindingSeverity = 'NO_MATCH_FOUND';

  const screenedParties: SecuritiesEvaluation['parties'] = rawParties.map((p) => {
    const canonicalP: CanonicalParty = {
      partyId: `sec_${Math.random().toString(36).slice(2, 8)}`,
      role: 'DEBTOR',
      name: p.name,
      identifiers: [],
      provenance: { sourceTag: p.role, rawSnippet: `${p.role}: ${p.name}` },
    };
    const outcome = embeddedSyntheticEngine.screenPartySync(canonicalP);
    if (outcome.highestScore > highestScore) highestScore = outcome.highestScore;
    if (outcome.findingSeverity === 'EXACT_IDENTIFIER_MATCH') findingSeverity = 'EXACT_IDENTIFIER_MATCH';
    else if (outcome.findingSeverity === 'FUZZY_NAME_CANDIDATE' && findingSeverity !== 'EXACT_IDENTIFIER_MATCH') {
      findingSeverity = 'FUZZY_NAME_CANDIDATE';
    }
    return { ...p, matches: outcome.matches };
  });

  if (isSectoral && findingSeverity === 'NO_MATCH_FOUND') {
    findingSeverity = 'EXACT_IDENTIFIER_MATCH';
    highestScore = 1.0;
  }

  let orderStatus: SecuritiesEvaluation['orderStatus'] = 'ROUTING_ALLOWED';
  if (isSectoral) {
    orderStatus = 'RESTRICTED_SECURITY_HALT';
  } else if (findingSeverity === 'EXACT_IDENTIFIER_MATCH') {
    orderStatus = 'SANCTIONED_COUNTERPARTY_BLOCKED';
  }

  const evidenceDigest = createHash('sha256')
    .update(JSON.stringify({ req, fixVersion, msgType, isin, isSectoral, orderStatus, timestamp: new Date().toISOString() }))
    .digest('hex');

  return {
    id: `sec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    rawFixMessage: req.rawFixMessage,
    fixVersion,
    msgType,
    orderId: extractedFields[11],
    instrument: {
      symbol,
      isin,
      isIsinChecksumValid,
      securityName: sectoralHit?.issuer || `Equity/Bond: ${symbol}`,
      issuerCountry: sectoralHit?.country || 'GLOBAL',
      isSectoralSanctionedDebtOrEquity: isSectoral,
    },
    orderSide,
    orderQty,
    orderPrice,
    parties: screenedParties,
    surveillanceAlerts,
    findingSeverity,
    highestScore,
    orderStatus,
    evidenceDigest,
  };
}
