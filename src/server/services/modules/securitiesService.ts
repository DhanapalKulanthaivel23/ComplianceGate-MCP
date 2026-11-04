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
  tenantId?: string;
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
  if (!isinStr || typeof isinStr !== 'string') return false;
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
export const SECTORAL_SANCTIONED_ISINS: Record<string, { issuer: string; country: string; directive: string }> = {
  'RU0009029540': { issuer: 'Sberbank of Russia (PJSC)', country: 'RU', directive: 'Directive 1 (New Debt & Equity Prohibitions)' },
  'RU000A0JX0J2': { issuer: 'Gazprom Neft PJSC', country: 'RU', directive: 'Directive 2 (Long-term Debt Prohibitions)' },
  'RU000A0JWSQ7': { issuer: 'VTB Bank PJSC', country: 'RU', directive: 'Directive 1 (New Debt/Capital Restrictions)' },
  'XS0805570354': { issuer: 'Russian Federation Sovereign Eurobond', country: 'RU', directive: 'Direct Sovereign Debt Sanctions (EO 14024)' },
};

export const FIX_TAG_NAMES: Record<number, string> = {
  8: 'BeginString',
  9: 'BodyLength',
  35: 'MsgType',
  49: 'SenderCompID',
  56: 'TargetCompID',
  115: 'OnBehalfOfCompID',
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
  453: 'NoPartyIDs',
  448: 'PartyID',
  447: 'PartyIDSource',
  452: 'PartyRole',
};

export interface ParsedFixResult {
  fixVersion: string;
  msgType: SecuritiesEvaluation['msgType'];
  rawMsgType?: string;
  tags: FixTagValue[];
  extractedFields: Record<number, string>;
  repeatingParties: { partyId: string; roleCode: string; sourceCode?: string }[];
  framingValidation: {
    isValid: boolean;
    beginString?: string;
    bodyLengthValid?: boolean;
    checksumValid?: boolean;
    delimiterUsed: 'SOH' | 'PIPE' | 'SEMICOLON' | 'NONE';
    detectedErrors: string[];
  };
}

export function buildCanonicalFixMessage(tags: [number, string][], delimiter: '\x01' | '|' | ';' = '|'): string {
  const bodyTags = tags.filter(([t]) => t !== 8 && t !== 9 && t !== 10);
  const version = tags.find(([t]) => t === 8)?.[1] || 'FIX.4.2';
  const bodyString = bodyTags.map(([t, v]) => `${t}=${v}`).join(delimiter) + delimiter;
  const bodyLength = bodyString.length;
  const preChecksum = `8=${version}${delimiter}9=${bodyLength}${delimiter}${bodyString}`;
  let sum = 0;
  for (let i = 0; i < preChecksum.length; i++) {
    sum += preChecksum.charCodeAt(i);
  }
  const checksum = String(sum % 256).padStart(3, '0');
  return `${preChecksum}10=${checksum}`;
}

export function parseFixMessage(raw: string): ParsedFixResult {
  const errors: string[] = [];

  if (!raw || typeof raw !== 'string' || !raw.trim()) {
    return {
      fixVersion: 'UNKNOWN',
      msgType: 'UNKNOWN',
      tags: [],
      extractedFields: {},
      repeatingParties: [],
      framingValidation: {
        isValid: false,
        delimiterUsed: 'NONE',
        detectedErrors: ['Empty or missing FIX message payload.'],
      },
    };
  }

  const trimmed = raw.trim();

  // Basic check for tag=value structure
  if (!trimmed.includes('=')) {
    return {
      fixVersion: 'UNKNOWN',
      msgType: 'UNKNOWN',
      tags: [],
      extractedFields: {},
      repeatingParties: [],
      framingValidation: {
        isValid: false,
        delimiterUsed: 'NONE',
        detectedErrors: ['Gibberish or non-FIX input: no tag-value delimiters found.'],
      },
    };
  }

  // Detect delimiter
  let delimiterUsed: 'SOH' | 'PIPE' | 'SEMICOLON' | 'NONE' = 'NONE';
  let splitRegex = /[\x01|;]/;
  if (trimmed.includes('\x01')) {
    delimiterUsed = 'SOH';
    splitRegex = /\x01/;
  } else if (trimmed.includes('|')) {
    delimiterUsed = 'PIPE';
    splitRegex = /\|/;
  } else if (trimmed.includes(';')) {
    delimiterUsed = 'SEMICOLON';
    splitRegex = /;/;
  } else {
    // Single tag without trailing delimiter?
    delimiterUsed = 'NONE';
  }

  const rawParts = trimmed.split(splitRegex).map((p) => p.trim()).filter(Boolean);
  if (rawParts.length === 0) {
    return {
      fixVersion: 'UNKNOWN',
      msgType: 'UNKNOWN',
      tags: [],
      extractedFields: {},
      repeatingParties: [],
      framingValidation: {
        isValid: false,
        delimiterUsed,
        detectedErrors: ['No valid FIX fields found in input string.'],
      },
    };
  }

  const tags: FixTagValue[] = [];
  const extractedFields: Record<number, string> = {};
  const seenTagCounts: Record<number, string[]> = {};
  const repeatingParties: { partyId: string; roleCode: string; sourceCode?: string }[] = [];

  let currentParty: { partyId?: string; roleCode?: string; sourceCode?: string } | null = null;

  for (let idx = 0; idx < rawParts.length; idx++) {
    const part = rawParts[idx];
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) {
      errors.push(`Malformed tag-value pair at position ${idx + 1}: "${part}"`);
      continue;
    }
    const tagNum = parseInt(part.slice(0, eqIdx).trim(), 10);
    const val = part.slice(eqIdx + 1).trim();

    if (isNaN(tagNum)) {
      errors.push(`Invalid non-numeric tag identifier at position ${idx + 1}: "${part}"`);
      continue;
    }

    // Duplicate check for scalar fields (448, 447, 452 can repeat inside party groups)
    const isPartyGroupTag = tagNum === 448 || tagNum === 447 || tagNum === 452;
    if (!seenTagCounts[tagNum]) {
      seenTagCounts[tagNum] = [val];
      extractedFields[tagNum] = val;
    } else {
      seenTagCounts[tagNum].push(val);
      if (!isPartyGroupTag) {
        if (seenTagCounts[tagNum][0] !== val) {
          errors.push(`Conflicting duplicate tag ${tagNum} (${FIX_TAG_NAMES[tagNum] || 'Unknown'}): initial value "${seenTagCounts[tagNum][0]}", conflicting new value "${val}"`);
        }
      }
    }

    // Track repeating party fields
    if (tagNum === 448) {
      if (currentParty && currentParty.partyId) {
        repeatingParties.push({
          partyId: currentParty.partyId,
          roleCode: currentParty.roleCode || '3',
          sourceCode: currentParty.sourceCode,
        });
      }
      currentParty = { partyId: val };
    } else if (tagNum === 452 && currentParty) {
      currentParty.roleCode = val;
    } else if (tagNum === 447 && currentParty) {
      currentParty.sourceCode = val;
    }

    tags.push({
      tag: tagNum,
      name: FIX_TAG_NAMES[tagNum] || `Tag${tagNum}`,
      value: val,
    });
  }

  if (currentParty && currentParty.partyId) {
    repeatingParties.push({
      partyId: currentParty.partyId,
      roleCode: currentParty.roleCode || '3',
      sourceCode: currentParty.sourceCode,
    });
  }

  // Framing checks: Tag 8 must be first, Tag 9 must be second, Tag 10 must be last
  let beginString: string | undefined = undefined;
  if (tags.length > 0) {
    if (tags[0].tag !== 8) {
      errors.push(`Framing violation: First tag must be Tag 8 (BeginString), received Tag ${tags[0].tag}`);
    } else {
      beginString = tags[0].value;
      if (!/^FIX(T)?\.\d+\.\d+(\.SP\d+)?$/i.test(beginString)) {
        errors.push(`Invalid BeginString format: "${beginString}"`);
      }
    }
  }

  let bodyLengthValid: boolean | undefined = undefined;
  if (tags.length > 1) {
    if (tags[1].tag !== 9) {
      errors.push(`Framing violation: Second tag must be Tag 9 (BodyLength), received Tag ${tags[1].tag}`);
    } else {
      const declaredLen = parseInt(tags[1].value, 10);
      if (isNaN(declaredLen) || declaredLen < 0) {
        errors.push(`Tag 9 (BodyLength) must be a non-negative integer, received "${tags[1].value}"`);
        bodyLengthValid = false;
      } else {
        // Calculate body length between end of Tag 9 delimiter and start of Tag 10
        // Find position of Tag 9 in trimmed string
        const tag9Prefix = `9=${tags[1].value}`;
        const tag9Pos = trimmed.indexOf(tag9Prefix);
        const tag10Pos = trimmed.lastIndexOf('10=');

        if (tag9Pos !== -1 && tag10Pos !== -1 && tag10Pos > tag9Pos) {
          const bodyStart = tag9Pos + tag9Prefix.length + 1; // +1 for delimiter
          const bodyString = trimmed.slice(bodyStart, tag10Pos);
          const computedBodyLength = bodyString.length;
          // In standard FIX, body length counts characters between Tag 9 delimiter and Tag 10
          // If declared matches computed, or if pipe/semicolon normalization is within range
          if (computedBodyLength === declaredLen) {
            bodyLengthValid = true;
          } else {
            // Note discrepancy if strict wire check fails
            errors.push(`Tag 9 (BodyLength) mismatch: declared ${declaredLen}, computed ${computedBodyLength} characters`);
            bodyLengthValid = false;
          }
        }
      }
    }
  }

  let checksumValid: boolean | undefined = undefined;
  if (tags.length > 0) {
    const lastTag = tags[tags.length - 1];
    if (lastTag.tag !== 10) {
      errors.push(`Framing violation: Last tag must be Tag 10 (CheckSum), received Tag ${lastTag.tag}`);
    } else {
      const declaredChecksum = lastTag.value;
      if (!/^\d{3}$/.test(declaredChecksum)) {
        errors.push(`Tag 10 (CheckSum) must be exactly 3 digits, received "${declaredChecksum}"`);
        checksumValid = false;
      } else {
        // Compute checksum from byte 0 to start of Tag 10 (or up to delimiter before Tag 10)
        const tag10Pos = trimmed.lastIndexOf('10=');
        if (tag10Pos !== -1) {
          const checkSumPayload = trimmed.slice(0, tag10Pos);
          let sum = 0;
          for (let i = 0; i < checkSumPayload.length; i++) {
            sum += checkSumPayload.charCodeAt(i);
          }
          const computedChecksum = String(sum % 256).padStart(3, '0');
          if (computedChecksum === declaredChecksum) {
            checksumValid = true;
          } else {
            errors.push(`Tag 10 (CheckSum) mismatch: declared ${declaredChecksum}, computed ${computedChecksum}`);
            checksumValid = false;
          }
        }
      }
    }
  }

  const fixVersion = beginString || extractedFields[8] || 'UNKNOWN';
  let msgType: SecuritiesEvaluation['msgType'] = 'UNKNOWN';
  const rawMsgType = extractedFields[35];

  if (rawMsgType === 'D') msgType = 'NEW_ORDER_SINGLE';
  else if (rawMsgType === '8') msgType = 'EXECUTION_REPORT';
  else if (rawMsgType === 'G') msgType = 'ORDER_CANCEL_REPLACE';
  else if (rawMsgType) {
    msgType = 'UNKNOWN';
  } else {
    msgType = 'UNKNOWN';
    errors.push('Missing mandatory Tag 35 (MsgType).');
  }

  const isValidFraming = errors.length === 0;

  return {
    fixVersion,
    msgType,
    rawMsgType,
    tags,
    extractedFields,
    repeatingParties,
    framingValidation: {
      isValid: isValidFraming,
      beginString,
      bodyLengthValid,
      checksumValid,
      delimiterUsed,
      detectedErrors: errors,
    },
  };
}

export function evaluateSecuritiesOrder(req: EvaluateSecuritiesRequest): SecuritiesEvaluation {
  const parsed = parseFixMessage(req.rawFixMessage || '');
  const { fixVersion, msgType, tags, extractedFields, repeatingParties, framingValidation } = parsed;

  const reviewReasons: string[] = [];
  const surveillanceAlerts: string[] = [];

  // Framing error collection
  if (!framingValidation.isValid) {
    reviewReasons.push(...framingValidation.detectedErrors);
  }

  // Extract order parameters
  const clOrdId = extractedFields[11];
  const symbol = extractedFields[55] || '';
  const securityId = extractedFields[48] || '';
  const securityIdSource = extractedFields[22] || '';
  const rawSide = extractedFields[54];
  const rawQty = extractedFields[38];
  const rawPrice = extractedFields[44];
  const rawOrdType = extractedFields[40];

  // Map SecurityIDSource
  let securityIdSourceDesc = 'Symbol';
  if (securityIdSource === '4') securityIdSourceDesc = 'ISIN';
  else if (securityIdSource === '1') securityIdSourceDesc = 'CUSIP';
  else if (securityIdSource === '2') securityIdSourceDesc = 'SEDOL';
  else if (securityIdSource === '8') securityIdSourceDesc = 'Exchange Symbol';
  else if (securityIdSource) securityIdSourceDesc = `Source-${securityIdSource}`;

  // Validate instrument identifier
  let isin: string | undefined = undefined;
  let cusip: string | undefined = undefined;
  let isIsinChecksumValid: boolean | undefined = undefined;

  if (securityIdSource === '4' || (!securityIdSource && /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/i.test(securityId))) {
    isin = securityId.toUpperCase();
    isIsinChecksumValid = validateIsinChecksum(isin);
    if (!isIsinChecksumValid) {
      reviewReasons.push(`Invalid ISIN checksum on SecurityID: "${securityId}" (Mod-10 double-add-double failed).`);
    }
  } else if (securityIdSource === '1') {
    cusip = securityId.toUpperCase();
  } else if (symbol && /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/i.test(symbol) && !isin) {
    isin = symbol.toUpperCase();
    isIsinChecksumValid = validateIsinChecksum(isin);
    if (!isIsinChecksumValid) {
      reviewReasons.push(`Invalid ISIN checksum on Symbol: "${symbol}".`);
    }
  }

  if (!symbol && !securityId) {
    reviewReasons.push('Missing mandatory instrument identifier: neither Tag 55 (Symbol) nor Tag 48 (SecurityID) provided.');
  }

  // Sectoral Sanctions Check
  const cleanIsin = isin ? isin.toUpperCase().trim() : '';
  const sectoralHit = cleanIsin ? SECTORAL_SANCTIONED_ISINS[cleanIsin] : undefined;
  const isSectoral = !!sectoralHit;

  if (isSectoral) {
    surveillanceAlerts.push(`Prohibited Sectoral Security: ${cleanIsin} issued by ${sectoralHit?.issuer} under ${sectoralHit?.directive}`);
    reviewReasons.push(`Security ${cleanIsin} is blocked under Sectoral Sanctions (${sectoralHit?.directive}).`);
  }

  // Validate Side (Tag 54)
  let orderSide: 'BUY' | 'SELL' | 'INVALID_SIDE' = 'INVALID_SIDE';
  if (rawSide === '1') {
    orderSide = 'BUY';
  } else if (rawSide === '2') {
    orderSide = 'SELL';
  } else {
    reviewReasons.push(`Invalid or missing Side (Tag 54): "${rawSide || 'EMPTY'}". Must be 1 (BUY) or 2 (SELL).`);
  }

  // Validate OrderQty (Tag 38)
  let orderQty = 0;
  let isQtyValid = false;
  if (rawQty !== undefined && rawQty !== '') {
    const parsedQty = parseFloat(rawQty);
    if (!isNaN(parsedQty) && isFinite(parsedQty) && parsedQty > 0) {
      orderQty = parsedQty;
      isQtyValid = true;
    } else {
      reviewReasons.push(`Invalid OrderQty (Tag 38): "${rawQty}". Must be a positive finite number.`);
    }
  } else {
    reviewReasons.push('Missing mandatory Tag 38 (OrderQty).');
  }

  // Validate Price (Tag 44) & OrdType (Tag 40)
  let orderPrice: number | undefined = undefined;
  if (rawPrice !== undefined && rawPrice !== '') {
    const parsedPrice = parseFloat(rawPrice);
    if (!isNaN(parsedPrice) && isFinite(parsedPrice) && parsedPrice > 0) {
      orderPrice = parsedPrice;
    } else {
      reviewReasons.push(`Invalid Price (Tag 44): "${rawPrice}". Must be a positive finite number.`);
    }
  }

  if (rawOrdType === '2' && orderPrice === undefined) {
    reviewReasons.push('Limit order (Tag 40 OrdType=2) requires a positive Price (Tag 44).');
  }

  if (!clOrdId) {
    reviewReasons.push('Missing mandatory Tag 11 (ClOrdID).');
  }

  // Volume & Notional alerts
  const orderQtyVolume = orderQty;
  const notionalValueUsd = orderPrice && isQtyValid ? orderQty * orderPrice : undefined;

  if (orderQtyVolume > 1_000_000) {
    surveillanceAlerts.push(`High Share Volume Order: ${orderQtyVolume.toLocaleString()} units triggers pre-trade market surveillance review.`);
  }
  if (notionalValueUsd && notionalValueUsd > 5_000_000) {
    surveillanceAlerts.push(`High Notional Value Order: $${notionalValueUsd.toLocaleString()} exceeds pre-trade desk threshold.`);
  }

  // Extract Parties
  let rawParties: {
    role: SecuritiesEvaluation['parties'][0]['role'];
    name: string;
    idValue: string;
  }[] = [];

  if (req.parties && req.parties.length > 0) {
    rawParties = req.parties;
  } else {
    // Check repeating party groups
    if (repeatingParties.length > 0) {
      rawParties = repeatingParties.map((p) => {
        let role: SecuritiesEvaluation['parties'][0]['role'] = 'COUNTERPARTY';
        if (p.roleCode === '1') role = 'EXECUTING_BROKER';
        else if (p.roleCode === '3') role = 'CLIENT_ACCOUNT';
        else if (p.roleCode === '17') role = 'COUNTERPARTY';
        else if (p.roleCode === '38') role = 'BENEFICIAL_OWNER';
        return {
          role,
          name: p.partyId,
          idValue: p.partyId,
        };
      });
    } else {
      // Check standard header/body tags
      if (extractedFields[49]) {
        rawParties.push({ role: 'EXECUTING_BROKER', name: extractedFields[49], idValue: extractedFields[49] });
      }
      if (extractedFields[1]) {
        rawParties.push({ role: 'CLIENT_ACCOUNT', name: extractedFields[1], idValue: extractedFields[1] });
      }
      if (extractedFields[56]) {
        rawParties.push({ role: 'COUNTERPARTY', name: extractedFields[56], idValue: extractedFields[56] });
      }
      if (extractedFields[115]) {
        rawParties.push({ role: 'BENEFICIAL_OWNER', name: extractedFields[115], idValue: extractedFields[115] });
      }
    }
  }

  // Coverage and Party Screening
  const hasPartyCoverage = rawParties.length > 0;
  if (!hasPartyCoverage) {
    reviewReasons.push('Missing party details: no executing broker, client account, or counterparty provided for sanctions screening.');
  }

  let highestScore = 0;
  let findingSeverity: FindingSeverity = 'NO_MATCH_FOUND';

  const screenedParties: SecuritiesEvaluation['parties'] = [];
  for (const p of rawParties) {
    const canonicalP: CanonicalParty = {
      partyId: `sec_${Math.random().toString(36).slice(2, 8)}`,
      role: 'DEBTOR',
      name: p.name,
      identifiers: [],
      provenance: { sourceTag: p.role, rawSnippet: `${p.role}: ${p.name}` },
    };
    const outcome = embeddedSyntheticEngine.screenPartySync(canonicalP, req.tenantId || 'default');
    if (outcome.highestScore > highestScore) highestScore = outcome.highestScore;
    if (outcome.findingSeverity === 'EXACT_IDENTIFIER_MATCH') {
      findingSeverity = 'EXACT_IDENTIFIER_MATCH';
    } else if (outcome.findingSeverity === 'FUZZY_NAME_CANDIDATE' && findingSeverity !== 'EXACT_IDENTIFIER_MATCH') {
      findingSeverity = 'FUZZY_NAME_CANDIDATE';
    }
    screenedParties.push({ ...p, matches: outcome.matches });
  }

  if (isSectoral && findingSeverity === 'NO_MATCH_FOUND') {
    findingSeverity = 'EXACT_IDENTIFIER_MATCH';
    highestScore = 1.0;
  }

  // Determine Status & Recommendations
  let orderStatus: SecuritiesEvaluation['orderStatus'] = 'ROUTING_ALLOWED';
  let decisionRecommendation: SecuritiesEvaluation['decisionRecommendation'] = 'APPROVE_ORDER_ROUTING';
  let requiresHumanReview = false;

  if (!framingValidation.isValid) {
    orderStatus = 'INVALID_FIX_FRAMING';
    decisionRecommendation = 'REJECT_INVALID_ORDER';
    requiresHumanReview = true;
  } else if (msgType === 'UNKNOWN') {
    orderStatus = 'UNSUPPORTED_MESSAGE_TYPE';
    decisionRecommendation = 'HOLD_FOR_HUMAN_REVIEW';
    requiresHumanReview = true;
  } else if (!isQtyValid || orderSide === 'INVALID_SIDE' || !clOrdId || (rawOrdType === '2' && orderPrice === undefined) || (!symbol && !securityId)) {
    orderStatus = 'MISSING_MANDATORY_TAGS';
    decisionRecommendation = 'REJECT_INVALID_ORDER';
    requiresHumanReview = true;
  } else if (isSectoral) {
    orderStatus = 'RESTRICTED_SECURITY_HALT';
    decisionRecommendation = 'HALT_RESTRICTED_SECURITY';
    requiresHumanReview = true;
  } else if (findingSeverity === 'EXACT_IDENTIFIER_MATCH') {
    orderStatus = 'SANCTIONED_COUNTERPARTY_BLOCKED';
    decisionRecommendation = 'REJECT_SANCTIONS_RISK';
    requiresHumanReview = true;
  } else if (findingSeverity === 'FUZZY_NAME_CANDIDATE') {
    orderStatus = 'HOLD_FOR_SANCTIONS_REVIEW';
    decisionRecommendation = 'HOLD_FOR_HUMAN_REVIEW';
    requiresHumanReview = true;
    reviewReasons.push('Potential counterparty or client name candidate requires compliance analyst adjudication.');
  } else if (!hasPartyCoverage) {
    orderStatus = 'HOLD_FOR_SANCTIONS_REVIEW';
    decisionRecommendation = 'HOLD_FOR_HUMAN_REVIEW';
    requiresHumanReview = true;
  } else if (isIsinChecksumValid === false) {
    orderStatus = 'INVALID_FIX_FRAMING';
    decisionRecommendation = 'REJECT_INVALID_ORDER';
    requiresHumanReview = true;
  }

  // If there are any review reasons and requiresHumanReview is false, enforce review
  if (reviewReasons.length > 0 && orderStatus === 'ROUTING_ALLOWED') {
    orderStatus = 'HOLD_FOR_SANCTIONS_REVIEW';
    decisionRecommendation = 'HOLD_FOR_HUMAN_REVIEW';
    requiresHumanReview = true;
  }

  const coverageStatus = hasPartyCoverage && framingValidation.isValid && isQtyValid && orderSide !== 'INVALID_SIDE'
    ? 'FULL_COVERAGE'
    : 'INSUFFICIENT';

  const evidenceDigest = createHash('sha256')
    .update(JSON.stringify({
      req,
      fixVersion,
      msgType,
      isin,
      securityId,
      securityIdSource,
      isSectoral,
      orderStatus,
      decisionRecommendation,
      requiresHumanReview,
      reviewReasons,
      timestamp: new Date().toISOString(),
    }))
    .digest('hex');

  const securityDisplayName = sectoralHit?.issuer || (symbol ? `Instrument: ${symbol}` : `Security ID: ${securityId}`);

  return {
    id: `sec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    rawFixMessage: req.rawFixMessage,
    fixVersion,
    msgType,
    orderId: clOrdId,
    instrument: {
      symbol: symbol || 'UNKNOWN',
      securityId: securityId || undefined,
      securityIdSource: securityIdSource || undefined,
      securityIdSourceDesc,
      isin,
      isIsinChecksumValid,
      cusip,
      securityName: securityDisplayName,
      issuerCountry: sectoralHit?.country || 'GLOBAL',
      isSectoralSanctionedDebtOrEquity: isSectoral,
    },
    orderSide,
    orderQty,
    orderPrice,
    orderQtyVolume,
    notionalValueUsd,
    parties: screenedParties,
    surveillanceAlerts,
    findingSeverity,
    highestScore,
    orderStatus,
    decisionRecommendation,
    requiresHumanReview,
    reviewReasons,
    framingValidation,
    screeningCoverage: {
      checksPerformed: [
        'FIX_FRAMING_TAG8_TAG9_TAG10',
        'TAG35_MSG_TYPE_VALIDATION',
        'MANDATORY_TAGS_VALIDATION',
        'SECURITY_IDENTIFIER_LUMN_VALIDATION',
        'SECTORAL_SANCTIONS_ISIN_LOOKUP',
        'COUNTERPARTY_SANCTIONS_SCREENING',
        'PRE_TRADE_SURVEILLANCE_THRESHOLDS',
      ],
      partiesScreenedCount: screenedParties.length,
      coverageStatus,
    },
    evidenceDigest,
    timestamp: new Date().toISOString(),
  };
}
