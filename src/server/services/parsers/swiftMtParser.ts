/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import {
  CanonicalParty,
  CanonicalPaymentTransaction,
  Identifier,
  PaymentMessageType,
} from '../../../shared/types.ts';
import { auditPaymentMissingData } from '../missingDataEngine.ts';

/**
 * Extracts SWIFT block 4 text or strips block headers if present.
 * Uses strict termination boundary without premature truncation.
 */
export function extractBlock4Text(raw: string): string {
  // If wrapped in standard FIN blocks {4:\n...-}
  const block4Match = raw.match(/\{4:\s*([\s\S]*?)(?:-\s*\}|(?=\{5:)|\}\s*$|$)/);
  if (block4Match && block4Match[1]) {
    return block4Match[1].trim();
  }
  return raw.trim();
}

/**
 * Parses SWIFT field tags (:20:, :32A:, :50K:, etc.) into a tag array preserving order.
 */
export interface SwiftTagRecord {
  tag: string;
  value: string;
  rawText: string;
  lineNumber: number;
}

export function parseTags(text: string): SwiftTagRecord[] {
  const lines = text.split(/\r?\n/);
  const records: SwiftTagRecord[] = [];
  let currentTag: string | null = null;
  let currentValueLines: string[] = [];
  let startLine = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const tagMatch = line.match(/^:([0-9]{2}[A-Z]?):(.*)$/);

    if (tagMatch) {
      if (currentTag) {
        records.push({
          tag: currentTag,
          value: currentValueLines.join('\n').trim(),
          rawText: `:${currentTag}:${currentValueLines.join('\n')}`,
          lineNumber: startLine,
        });
      }
      currentTag = tagMatch[1];
      currentValueLines = [tagMatch[2]];
      startLine = i + 1;
    } else if (currentTag) {
      // Continuation line or end marker
      if (line.trim() === '-' || line.trim() === '-}') {
        continue;
      }
      currentValueLines.push(line);
    }
  }

  if (currentTag) {
    records.push({
      tag: currentTag,
      value: currentValueLines.join('\n').trim(),
      rawText: `:${currentTag}:${currentValueLines.join('\n')}`,
      lineNumber: startLine,
    });
  }

  return records;
}

/**
 * Strict calendar date validator enforcing months (1..12), day boundaries per month,
 * leap-year February rules, and rejecting impossible calendar dates.
 */
export function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (isNaN(year) || isNaN(month) || isNaN(day)) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;

  const daysInMonths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
  const maxDays = month === 2 && isLeapYear ? 29 : daysInMonths[month - 1];

  return day <= maxDays;
}

/**
 * Parses Field :32A: (Date, Currency, Amount).
 * Throws explicit error if missing or invalid — NEVER fabricates defaults.
 */
export function parseField32A(value: string | undefined): { date: string; currency: string; amount: number } {
  if (!value || typeof value !== 'string') {
    throw new Error('Mandatory Field :32A: (Value Date, Currency, Amount) is missing from SWIFT payment message.');
  }

  const match = value.trim().match(/^(\d{6})([A-Z]{3})([0-9]+(?:[.,][0-9]{1,2})?)$/);
  if (!match) {
    throw new Error(
      `Malformed Field :32A: format [${value}]. Expected 6-digit date (YYMMDD), 3-letter currency code, and numeric amount.`
    );
  }

  const yymmdd = match[1];
  const yy = parseInt(yymmdd.slice(0, 2), 10);
  const yearNum = yy >= 50 ? 1900 + yy : 2000 + yy;
  const year = String(yearNum);
  const mm = parseInt(yymmdd.slice(2, 4), 10);
  const dd = parseInt(yymmdd.slice(4, 6), 10);
  const month = yymmdd.slice(2, 4);
  const day = yymmdd.slice(4, 6);

  if (!isValidCalendarDate(yearNum, mm, dd)) {
    throw new Error(
      `Invalid settlement date: impossible calendar date [${year}-${month}-${day}] in Field :32A: (month ${month}, day ${day} not valid for year ${year}).`
    );
  }

  const date = `${year}-${month}-${day}`;

  const currency = match[2];
  const amountStr = match[3].replace(',', '.');
  const amount = parseFloat(amountStr);

  if (isNaN(amount) || amount <= 0) {
    throw new Error(`Invalid settlement amount [${amountStr}] in Field :32A:. Must be greater than zero.`);
  }

  return { date, currency, amount };
}

/**
 * Parses party text preserving all address lines.
 */
export function parsePartyField(
  tag: string,
  value: string,
  defaultRole: CanonicalParty['role'],
  sequence: 'A' | 'B' | 'ROOT' = 'ROOT',
  lineNumber = 1
): CanonicalParty {
  const lines = value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let accountNumber: string | undefined;
  let nameLines: string[] = [];
  const identifiers: Identifier[] = [];

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (i === 0 && l.startsWith('/')) {
      // Account line
      accountNumber = l.replace(/^\/[A-Z0-9]*\/?/, '').trim() || l.replace(/^\//, '').trim();
    } else {
      nameLines.push(l);
    }
  }

  // If Tag ends with A (e.g. :50A:, :52A:, :59A:), the first line is usually a BIC
  if (tag.endsWith('A') && nameLines.length > 0) {
    const candidateBic = nameLines[0].replace(/[^A-Z0-9]/g, '');
    if (candidateBic.length === 8 || candidateBic.length === 11) {
      identifiers.push({
        type: 'BIC',
        value: candidateBic,
        country: candidateBic.slice(4, 6),
      });
    }
  }

  const primaryName = nameLines.length > 0 ? nameLines[0] : (accountNumber || `Unknown ${defaultRole}`);
  const addressLines = nameLines.length > 1 ? nameLines.slice(1) : [];

  return {
    partyId: `pty_${tag}_${Math.random().toString(36).slice(2, 9)}`,
    role: defaultRole,
    name: primaryName,
    originalName: primaryName,
    accountNumber,
    identifiers,
    address: addressLines.length > 0 ? { rawLines: addressLines } : undefined,
    provenance: {
      sourceTag: `:${tag}:`,
      fieldPath: `block4/${tag}`,
      rawSnippet: value,
      sequence,
      lineNumber,
    },
  };
}

/**
 * Parses SWIFT MT103 (Single Customer Credit Transfer).
 */
export function parseSwiftMT103(rawText: string): CanonicalPaymentTransaction {
  const block4 = extractBlock4Text(rawText);
  const tags = parseTags(block4);

  if (tags.length === 0) {
    throw new Error('Invalid SWIFT MT payload: no recognizable tags found in message body.');
  }

  const getTag = (t: string) => tags.find((r) => r.tag === t || r.tag.startsWith(t));

  const tag20 = getTag('20');
  if (!tag20) {
    throw new Error('Mandatory Field :20: (Sender Reference) missing in MT103 message.');
  }

  const tag32A = getTag('32A') || getTag('32');
  if (!tag32A) {
    throw new Error('Mandatory Field :32A: (Value Date, Currency, Amount) missing in MT103 message.');
  }

  const financial = parseField32A(tag32A.value);
  const rem70 = getTag('70')?.value || getTag('77T')?.value;

  const parties: CanonicalParty[] = [];
  let expectedPartyMarkersInRaw = 0;

  for (const item of tags) {
    if (item.tag.startsWith('50')) {
      expectedPartyMarkersInRaw++;
      parties.push(parsePartyField(item.tag, item.value, 'DEBTOR', 'ROOT', item.lineNumber));
    } else if (item.tag.startsWith('51') || item.tag.startsWith('52')) {
      expectedPartyMarkersInRaw++;
      parties.push(parsePartyField(item.tag, item.value, 'ORDERING_INSTITUTION', 'ROOT', item.lineNumber));
    } else if (item.tag.startsWith('53')) {
      expectedPartyMarkersInRaw++;
      parties.push(parsePartyField(item.tag, item.value, 'INSTRUCTING_AGENT', 'ROOT', item.lineNumber));
    } else if (item.tag.startsWith('54') || item.tag.startsWith('55') || item.tag.startsWith('56')) {
      expectedPartyMarkersInRaw++;
      parties.push(parsePartyField(item.tag, item.value, 'INTERMEDIARY_AGENT', 'ROOT', item.lineNumber));
    } else if (item.tag.startsWith('57')) {
      expectedPartyMarkersInRaw++;
      parties.push(parsePartyField(item.tag, item.value, 'CREDITOR_AGENT', 'ROOT', item.lineNumber));
    } else if (item.tag.startsWith('59')) {
      expectedPartyMarkersInRaw++;
      parties.push(parsePartyField(item.tag, item.value, 'CREDITOR', 'ROOT', item.lineNumber));
    }
  }

  const tx: CanonicalPaymentTransaction = {
    transactionId: tag20.value,
    uetr: tag20.value,
    endToEndId: tag20.value,
    messageFamily: 'SWIFT_MT',
    messageType: 'MT103',
    isProfileTested: true,
    settlementDate: financial.date,
    currency: financial.currency,
    amount: financial.amount,
    remittanceInformation: rem70,
    parties,
    missingDataIssues: [],
    rawMessageSnippet: rawText.slice(0, 500),
    provenanceSummary: {
      totalPartiesExtracted: parties.length,
      expectedPartyMarkersInRaw,
      parsedSequences: ['ROOT'],
      parserProfile: 'SWIFT MT103 (Single Customer Credit Transfer)',
    },
  };

  tx.missingDataIssues = auditPaymentMissingData(tx);
  return tx;
}

/**
 * Parses SWIFT MT202 COV (Cover Payment).
 * Distinguishes Sequence A (Interbank) from Sequence B (Cover Commercial Details).
 */
export function parseSwiftMT202COV(rawText: string): CanonicalPaymentTransaction {
  const block4 = extractBlock4Text(rawText);
  const tags = parseTags(block4);

  if (tags.length === 0) {
    throw new Error('Invalid SWIFT MT payload: no recognizable tags found in message body.');
  }

  const tag20 = tags.find((r) => r.tag === '20');
  if (!tag20) {
    throw new Error('Mandatory Field :20: (Transaction Reference) missing in MT202 COV message.');
  }

  const tag32A = tags.find((r) => r.tag === '32A') || tags.find((r) => r.tag.startsWith('32'));
  if (!tag32A) {
    throw new Error('Mandatory Field :32A: (Value Date, Currency, Amount) missing in MT202 COV message.');
  }

  const financial = parseField32A(tag32A.value);
  const parties: CanonicalParty[] = [];

  let inSequenceB = false;

  for (let i = 0; i < tags.length; i++) {
    const item = tags[i];

    // Sequence B detection: occurrence of :50a: in MT202 indicates Sequence B (underlying ordering customer)
    if (item.tag.startsWith('50')) {
      inSequenceB = true;
    }

    if (!inSequenceB) {
      // Sequence A (Interbank settlement)
      if (item.tag.startsWith('52')) {
        parties.push(parsePartyField(item.tag, item.value, 'ORDERING_INSTITUTION', 'A', item.lineNumber));
      } else if (item.tag.startsWith('56')) {
        parties.push(parsePartyField(item.tag, item.value, 'INTERMEDIARY_AGENT', 'A', item.lineNumber));
      } else if (item.tag.startsWith('57')) {
        parties.push(parsePartyField(item.tag, item.value, 'CREDITOR_AGENT', 'A', item.lineNumber));
      } else if (item.tag.startsWith('58')) {
        parties.push(parsePartyField(item.tag, item.value, 'CREDITOR', 'A', item.lineNumber));
      }
    } else {
      // Sequence B (Cover commercial details)
      if (item.tag.startsWith('50')) {
        parties.push(parsePartyField(item.tag, item.value, 'DEBTOR', 'B', item.lineNumber));
      } else if (item.tag.startsWith('52')) {
        parties.push(parsePartyField(item.tag, item.value, 'ORDERING_INSTITUTION', 'B', item.lineNumber));
      } else if (item.tag.startsWith('56')) {
        parties.push(parsePartyField(item.tag, item.value, 'INTERMEDIARY_AGENT', 'B', item.lineNumber));
      } else if (item.tag.startsWith('57')) {
        parties.push(parsePartyField(item.tag, item.value, 'CREDITOR_AGENT', 'B', item.lineNumber));
      } else if (item.tag.startsWith('59')) {
        parties.push(parsePartyField(item.tag, item.value, 'CREDITOR', 'B', item.lineNumber));
      }
    }
  }

  const tx: CanonicalPaymentTransaction = {
    transactionId: tag20.value,
    uetr: tag20.value,
    endToEndId: tag20.value,
    messageFamily: 'SWIFT_MT',
    messageType: 'MT202_COV',
    isProfileTested: true,
    settlementDate: financial.date,
    currency: financial.currency,
    amount: financial.amount,
    parties,
    missingDataIssues: [],
    rawMessageSnippet: rawText.slice(0, 500),
    provenanceSummary: {
      totalPartiesExtracted: parties.length,
      parsedSequences: ['Sequence A (Interbank)', 'Sequence B (Cover Underlying)'],
      parserProfile: 'SWIFT MT202 COV (Cover Payment Dual Sequence)',
    },
  };

  tx.missingDataIssues = auditPaymentMissingData(tx);
  return tx;
}

/**
 * Parses flexible amount/currency/date fields across all MT categories (:32A:, :32B:, :33B:, :34A:, :19A:, :60F:, :62F:).
 */
export function parseFlexibleMtFinancials(tags: SwiftTagRecord[]): { date: string; currency: string; amount: number } {
  const defaultDate = new Date().toISOString().slice(0, 10);

  // 1. Try standard :32A: or :32K: / :60F: / :62F: with YYMMDD + Currency + Amount
  const tag32A = tags.find((r) => r.tag === '32A');
  if (tag32A) {
    return parseField32A(tag32A.value);
  }

  for (const r of tags) {
    if (/^(32[A-Z]?|33[A-Z]?|34[A-Z]?|60[FM]|62[FM]|64|19A)$/.test(r.tag)) {
      const val = r.value.trim();

      // Pattern A: Optional C/D + YYMMDD + CCY + Amount (e.g., 261102USD50000,00 or C261102EUR100000,00)
      const dateCcyAmt = val.match(/^[CD]?(\d{6})([A-Z]{3})([0-9]+(?:[.,][0-9]+)?)/);
      if (dateCcyAmt) {
        const yymmdd = dateCcyAmt[1];
        const yy = parseInt(yymmdd.slice(0, 2), 10);
        const yearNum = yy >= 50 ? 1900 + yy : 2000 + yy;
        const mm = parseInt(yymmdd.slice(2, 4), 10);
        const dd = parseInt(yymmdd.slice(4, 6), 10);
        if (!isValidCalendarDate(yearNum, mm, dd)) {
          throw new Error(
            `Invalid settlement date: impossible calendar date [${yearNum}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}] in Field :${r.tag}:.`
          );
        }
        const date = `${yearNum}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`;
        const currency = dateCcyAmt[2];
        const amount = parseFloat(dateCcyAmt[3].replace(',', '.')) || 0;
        return { date, currency, amount };
      }

      // Pattern B: Securities :19A::SETT//USD125000,00
      const secAmt = val.match(/:[A-Z0-9]{4}\/\/[CD]?([A-Z]{3})([0-9]+(?:[.,][0-9]+)?)/);
      if (secAmt) {
        return {
          date: defaultDate,
          currency: secAmt[1],
          amount: parseFloat(secAmt[2].replace(',', '.')) || 0,
        };
      }

      // Pattern C: Currency + Amount without date (e.g., :32B:USD50000,00 in MT101, MT700, MT300, MT400)
      const ccyAmt = val.match(/^([A-Z]{3})([0-9]+(?:[.,][0-9]+)?)/);
      if (ccyAmt) {
        return {
          date: defaultDate,
          currency: ccyAmt[1],
          amount: parseFloat(ccyAmt[2].replace(',', '.')) || 0,
        };
      }
    }
  }

  return { date: defaultDate, currency: 'USD', amount: 0 };
}

/**
 * Extracts Sender and Receiver BICs from SWIFT Block 1 and Block 2 headers if present.
 */
export function extractHeaderBics(rawText: string): { senderBic?: string; receiverBic?: string } {
  const b1Match = rawText.match(/\{1:[FAl]\d{2}([A-Z]{4}[A-Z]{2}[A-Z0-9]{2})(?:[A-Z0-9])?([A-Z0-9]{3})?/i);
  const senderBic = b1Match ? `${b1Match[1]}${b1Match[2] || 'XXX'}`.toUpperCase() : undefined;

  let receiverBic: string | undefined;
  const b2InputMatch = rawText.match(/\{2:I\d{3}([A-Z]{4}[A-Z]{2}[A-Z0-9]{2})(?:[A-Z0-9])?([A-Z0-9]{3})?/i);
  if (b2InputMatch) {
    receiverBic = `${b2InputMatch[1]}${b2InputMatch[2] || 'XXX'}`.toUpperCase();
  } else {
    const b2OutputMatch = rawText.match(/\{2:O\d{3}\d{4}\d{6}([A-Z]{4}[A-Z]{2}[A-Z0-9]{2})(?:[A-Z0-9])?([A-Z0-9]{3})?/i);
    if (b2OutputMatch) {
      receiverBic = `${b2OutputMatch[1]}${b2OutputMatch[2] || 'XXX'}`.toUpperCase();
    }
  }

  return { senderBic, receiverBic };
}

/**
 * Generic SWIFT MT envelope parser for any MT message across Categories 1-9 (MT101..MT999).
 */
export function parseGenericSwiftMT(rawText: string, messageType: PaymentMessageType = 'GENERIC_SWIFT_MT'): CanonicalPaymentTransaction {
  const block4 = extractBlock4Text(rawText);
  const tags = parseTags(block4);
  const { senderBic, receiverBic } = extractHeaderBics(rawText);

  if (tags.length === 0) {
    throw new Error(`Invalid generic SWIFT FIN payload: no tags found in body for ${messageType}.`);
  }

  const ref20 =
    tags.find((r) => r.tag === '20' || r.tag === '20C' || r.tag === '21')?.value?.replace(/^:[A-Z0-9]+\/\//, '') ||
    `MT-GEN-${Date.now()}`;
  const financial = parseFlexibleMtFinancials(tags);
  const rem70 = tags.find((r) => r.tag === '70' || r.tag === '79' || r.tag === '72')?.value;

  const parties: CanonicalParty[] = [];

  for (const item of tags) {
    if (item.tag.startsWith('50') || item.tag.startsWith('42') || item.tag.startsWith('82')) {
      parties.push(parsePartyField(item.tag, item.value, 'DEBTOR', 'ROOT', item.lineNumber));
    } else if (item.tag.startsWith('51') || item.tag.startsWith('52')) {
      parties.push(parsePartyField(item.tag, item.value, 'ORDERING_INSTITUTION', 'ROOT', item.lineNumber));
    } else if (item.tag.startsWith('53')) {
      parties.push(parsePartyField(item.tag, item.value, 'INSTRUCTING_AGENT', 'ROOT', item.lineNumber));
    } else if (item.tag.startsWith('54') || item.tag.startsWith('55') || item.tag.startsWith('56')) {
      parties.push(parsePartyField(item.tag, item.value, 'INTERMEDIARY_AGENT', 'ROOT', item.lineNumber));
    } else if (item.tag.startsWith('57') || item.tag.startsWith('41')) {
      parties.push(parsePartyField(item.tag, item.value, 'CREDITOR_AGENT', 'ROOT', item.lineNumber));
    } else if (item.tag.startsWith('58') || item.tag.startsWith('59') || item.tag.startsWith('87')) {
      parties.push(parsePartyField(item.tag, item.value, 'CREDITOR', 'ROOT', item.lineNumber));
    } else if (item.tag.startsWith('83')) {
      parties.push(parsePartyField(item.tag, item.value, 'ULTIMATE_DEBTOR', 'ROOT', item.lineNumber));
    } else if (item.tag.startsWith('95')) {
      const role: CanonicalParty['role'] = /SELL|DEAG|RECU/i.test(item.value) ? 'DEBTOR' : 'CREDITOR';
      const cleanedVal = item.value.replace(/^:[A-Z0-9]{4}\/[A-Z0-9]*\//, '');
      parties.push(parsePartyField(item.tag, cleanedVal, role, 'ROOT', item.lineNumber));
    }
  }

  // Fallback: if message has Block 1/2 BICs and no body party tags (e.g., MT199, MT299, MT799, MT940, MT950, MT999)
  if (parties.length === 0) {
    if (senderBic) {
      parties.push({
        partyId: `pty_b1_${senderBic}`,
        role: 'SENDER',
        name: `Financial Institution ${senderBic}`,
        originalName: senderBic,
        identifiers: [{ type: 'BIC', value: senderBic, country: senderBic.slice(4, 6) }],
        provenance: { sourceTag: 'Block1', fieldPath: 'block1/senderBic', rawSnippet: senderBic, sequence: 'ROOT', lineNumber: 1 },
      });
    }
    if (receiverBic) {
      parties.push({
        partyId: `pty_b2_${receiverBic}`,
        role: 'RECEIVER',
        name: `Financial Institution ${receiverBic}`,
        originalName: receiverBic,
        identifiers: [{ type: 'BIC', value: receiverBic, country: receiverBic.slice(4, 6) }],
        provenance: { sourceTag: 'Block2', fieldPath: 'block2/receiverBic', rawSnippet: receiverBic, sequence: 'ROOT', lineNumber: 1 },
      });
    }
  }

  const tx: CanonicalPaymentTransaction = {
    transactionId: ref20,
    uetr: ref20,
    endToEndId: ref20,
    messageFamily: 'SWIFT_MT',
    messageType,
    isProfileTested: false,
    settlementDate: financial.date,
    currency: financial.currency,
    amount: financial.amount,
    remittanceInformation: rem70,
    parties,
    missingDataIssues: [],
    rawMessageSnippet: rawText.slice(0, 500),
    provenanceSummary: {
      totalPartiesExtracted: parties.length,
      parsedSequences: ['UNPROFILED_ENVELOPE'],
      parserProfile: `Generic SWIFT FIN (${messageType}) - Universal MT Envelope`,
    },
  };

  tx.missingDataIssues = auditPaymentMissingData(tx);
  return tx;
}

/**
 * Universal SWIFT MT entry point with robust detector priority:
 * 1. Checks Header {2:I202...} / {2:O202...} or {2:I205...} / {2:O205...} first.
 *    If 202/205 has Sequence B (:50a:), routes to MT202_COV / MT205_COV even without literal 'COV' text!
 * 2. Checks Header {2:I103...} or {2:O103...} (including Block 3 {119:STP} / {119:REMIT}).
 * 3. Checks any 3-digit MT type in Block 2 ({2:Ixxx...} / {2:Oxxx...}) or explicit MTxxx declaration across MT100-MT999.
 * 4. Tag-based detection.
 * 5. Fails explicitly on unknown gibberish — NEVER defaults to MT103.
 */
export function parseSwiftPaymentMessage(rawText: string): CanonicalPaymentTransaction {
  if (!rawText || typeof rawText !== 'string' || rawText.trim().length === 0) {
    throw new Error('Empty payment payload provided.');
  }

  const clean = rawText.trim();

  // Validate that it looks like a SWIFT FIN message (must contain standard FIN blocks AND recognized field tags, or >=2 field tags)
  const hasBlocks = /\{1:[A-Z0-9]+\}/.test(clean) || /\{2:[IO]\d{3}[A-Z0-9]*\}/i.test(clean);
  const tagMatches = clean.match(/:[0-9]{2}[A-Z]?:/g);
  if (!tagMatches || tagMatches.length === 0 || (!hasBlocks && tagMatches.length < 2)) {
    throw new Error(
      'Unrecognized or malformed SWIFT MT message: payload lacks standard SWIFT FIN blocks or recognized field tags.'
    );
  }

  // Detect declared message type from Block 2 ({2:I202...} or {2:O202...}) or explicit MT header
  const typeMatch = clean.match(/\{2:[IO](\d{3})/i) || clean.match(/^\s*MT\s*(\d{3})\b/i);
  const detectedType = typeMatch ? typeMatch[1] : null;
  const block3VarMatch = clean.match(/\{119:([A-Z0-9]+)\}/i);
  const block3Variant = block3VarMatch ? block3VarMatch[1].toUpperCase() : null;

  // PRIORITY 1: MT202 / MT205 Detection (including COV)
  if (detectedType === '202' || detectedType === '205') {
    const hasSequenceB =
      block3Variant === 'COV' ||
      (/:50[A-Z]?:/i.test(clean) && (/:59[A-Z]?:/i.test(clean) || /:58[A-Z]?:/i.test(clean) || /COV/i.test(clean)));
    if (hasSequenceB) {
      const covTx = parseSwiftMT202COV(clean);
      if (detectedType === '205') {
        covTx.messageType = 'MT205_COV';
        const hasSeqA = covTx.parties.some((p) => p.provenance.sequence === 'A');
        const hasSeqB = covTx.parties.some((p) => p.provenance.sequence === 'B');
        covTx.isProfileTested = hasSeqA && hasSeqB;
        covTx.provenanceSummary.parserProfile =
          'SWIFT FIN MT205 COV (Sequence A + Sequence B Domestic Cover Profile)';
        covTx.missingDataIssues = auditPaymentMissingData(covTx);
      }
      return covTx;
    }
    return parseGenericSwiftMT(clean, `MT${detectedType}` as PaymentMessageType);
  }

  // PRIORITY 2: MT103 Detection (Standard, STP, REMIT)
  if (detectedType === '103') {
    const tx = parseSwiftMT103(clean);
    if (block3Variant === 'STP') {
      tx.messageType = 'MT103_STP';
      // SWIFT MT103 STP network validation rules:
      // 1) Agent fields 52, 54, 55, 56, 57 may only use Option A (BIC), never B/C/D
      // 2) Field 23E may only contain CORT, INTC, SDVA, REPA
      const hasNonStpAgentOption = /:(52[BCD]|53D|54[BD]|55[BD]|56[CD]|57[BCD]):/i.test(clean);
      const hasProhibited23E = /:23E:(CHQB|HOLD|PHON|TELE|PHOB|TELB|PHOI|TELI)/i.test(clean);
      tx.isProfileTested = !hasNonStpAgentOption && !hasProhibited23E;
      tx.provenanceSummary.parserProfile = tx.isProfileTested
        ? 'SWIFT FIN MT103 STP (Validated Option-A BIC Straight-Through Profile)'
        : 'SWIFT FIN MT103 STP (STP Rule Violation - Fallback Unverified)';
      tx.missingDataIssues = auditPaymentMissingData(tx);
    } else if (block3Variant === 'REMIT') {
      tx.messageType = 'MT103_REMIT';
      // SWIFT MT103 REMIT network validation rules:
      // Requires Field :77T: (Envelope Contents) and prohibits Field :70:
      const tag77TMatch = clean.match(/:77T:([\s\S]*?)(?=\r?\n:[0-9]{2}[A-Z]?:|\r?\n-\}|\s*$)/i);
      const hasField70 = /:70:/i.test(clean);
      if (tag77TMatch && !hasField70) {
        tx.remittanceInformation = tag77TMatch[1].trim();
        tx.isProfileTested = true;
        tx.provenanceSummary.parserProfile =
          'SWIFT FIN MT103 REMIT (Validated Field 77T Extended Remittance Profile)';
      } else {
        tx.isProfileTested = false;
        tx.provenanceSummary.parserProfile =
          'SWIFT FIN MT103 REMIT (Missing :77T: or Conflicting :70: - Fallback Unverified)';
      }
      tx.missingDataIssues = auditPaymentMissingData(tx);
    }
    return tx;
  }

  // PRIORITY 3: Any other declared MT type in Block 2 (MT101..MT999)
  if (detectedType) {
    const suffix = block3Variant && (block3Variant === 'STP' || block3Variant === 'COV' || block3Variant === 'REMIT')
      ? `_${block3Variant}`
      : '';
    const customType = `MT${detectedType}${suffix}` as PaymentMessageType;
    return parseGenericSwiftMT(clean, customType);
  }

  // PRIORITY 4: Tag-based heuristics when Block 2 header is omitted
  const hasCovTags = /:50[A-Z]?:/i.test(clean) && /:59[A-Z]?:/i.test(clean) && (/:21:/i.test(clean) || /COV/i.test(clean));
  if (hasCovTags && /:58[A-Z]?:/i.test(clean)) {
    return parseSwiftMT202COV(clean);
  }

  if (/:23B:/i.test(clean) || (/:50[A-Z]?:/i.test(clean) && /:59[A-Z]?:/i.test(clean) && /:32A:/i.test(clean))) {
    return parseSwiftMT103(clean);
  }

  return parseGenericSwiftMT(clean, 'GENERIC_SWIFT_MT');
}
