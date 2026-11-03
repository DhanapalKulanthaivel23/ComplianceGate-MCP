/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import {
  CanonicalParty,
  CanonicalPaymentTransaction,
  Identifier,
  PartyAddress,
  PaymentMessageType,
} from '../../../shared/types.ts';
import { auditPaymentMissingData } from '../missingDataEngine.ts';

/**
 * Unescapes standard XML entities.
 */
export function unescapeXmlEntities(text: string): string {
  if (!text) return '';
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/**
 * Validates XML well-formedness and checks against XXE vulnerabilities.
 */
export function validateAndSanitizeXml(xml: string, maxSizeBytes = 1024 * 1024): string {
  if (!xml || typeof xml !== 'string' || xml.trim().length === 0) {
    throw new Error('Empty XML payload provided.');
  }

  if (Buffer.byteLength(xml, 'utf8') > maxSizeBytes) {
    throw new Error(`XML payload exceeds maximum safe boundary (${maxSizeBytes} bytes).`);
  }

  // Security check: XXE / DTD expansion prohibition
  if (/<!DOCTYPE/i.test(xml) || /<!ENTITY/i.test(xml)) {
    throw new Error('XML parsing rejected: DOCTYPE and ENTITY expansions are strictly prohibited.');
  }

  const clean = xml.trim();

  // Basic well-formedness check: must contain root tags and balanced elements
  if (!clean.startsWith('<') || !clean.endsWith('>')) {
    throw new Error('Malformed XML: payload does not start and end with standard XML tags.');
  }

  // Strip optional <?xml ...?> prolog to verify root element closure
  const bodyWithoutProlog = clean.replace(/^<\?xml[^?]*\?>\s*/i, '');
  const rootOpenMatch = bodyWithoutProlog.match(/^<([a-zA-Z0-9_.:-]+)(?:\s[^>]*)?>/);
  if (!rootOpenMatch) {
    throw new Error('Malformed XML: unable to identify root XML element.');
  }
  const rootTagName = rootOpenMatch[1];
  const escapedRootTag = rootTagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rootCloseRegex = new RegExp(`</${escapedRootTag}>\\s*$`, 'i');
  if (!rootCloseRegex.test(bodyWithoutProlog)) {
    throw new Error(`Malformed XML: root element <${rootTagName}> is not properly closed.`);
  }

  return clean;
}

/**
 * Helper to extract tag text or null (ignoring any namespace prefix, unescaping entities).
 * Supports nested paths like 'PmtId/EndToEndId' or 'RtrRsnInf/Rsn/Cd'.
 * Supports single quotes or double quotes in attributes.
 */
export function getTagText(xmlBlock: string, path: string): string | null {
  if (!xmlBlock) return null;
  const parts = path.split('/');
  let currentBlock: string | null = xmlBlock;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    // Regex matches <[prefix:]part [attrs]>content</[prefix:]part> with support for any attributes
    const regex = new RegExp(`<(?:[a-zA-Z0-9_.-]+:)?${part}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_.-]+:)?${part}>`, 'i');
    const match: RegExpMatchArray | null = currentBlock ? currentBlock.match(regex) : null;
    if (!match) return null;
    currentBlock = match[1].trim();
  }

  return currentBlock ? unescapeXmlEntities(currentBlock) : null;
}

/**
 * Helper to extract all matching tag blocks (e.g. all <CdtTrfTxInf> elements).
 * Ignores any namespace prefix.
 */
export function getAllTagBlocks(xmlBlock: string, tagName: string): string[] {
  const regex = new RegExp(`<(?:[a-zA-Z0-9_.-]+:)?${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_.-]+:)?${tagName}>`, 'gi');
  const matches: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = regex.exec(xmlBlock)) !== null) {
    matches.push(m[1]);
  }
  return matches;
}

/**
 * Extracts amount and currency from an XML tag supporting any namespace prefix
 * and either double quotes ("EUR") or single quotes ('EUR').
 */
export function extractAmountAndCurrency(
  xmlBlock: string,
  preferredTag: 'IntrBkSttlmAmt' | 'InstdAmt' | 'RtrdIntrBkSttlmAmt'
): { currency: string; amount: number } {
  // Regex matches <[prefix:]preferredTag Ccy=['"]([A-Z]{3})['"]>([0-9.]+)</...>
  const regex = new RegExp(
    `<(?:[a-zA-Z0-9_.-]+:)?${preferredTag}\\s+[^>]*?Ccy=['"]([A-Z]{3})['"][^>]*?>([0-9.]+)<\/(?:[a-zA-Z0-9_.-]+:)?${preferredTag}>`,
    'i'
  );
  const match = xmlBlock.match(regex);
  if (!match) {
    // Fallback: look for amount inside tag and attribute elsewhere
    const fallbackRegex = new RegExp(
      `<(?:[a-zA-Z0-9_.-]+:)?(?:IntrBkSttlmAmt|InstdAmt|RtrdIntrBkSttlmAmt|Amt)\\s+[^>]*?Ccy=['"]([A-Z]{3})['"][^>]*?>([0-9.]+)`,
      'i'
    );
    const fbMatch = xmlBlock.match(fallbackRegex);
    if (!fbMatch) {
      throw new Error(`Mandatory payment amount or currency missing in <${preferredTag}> element.`);
    }
    return { currency: fbMatch[1], amount: parseFloat(fbMatch[2]) };
  }
  return { currency: match[1], amount: parseFloat(match[2]) };
}

/**
 * Extracts structured postal address from a party XML block.
 */
function extractPostalAddress(partyBlock: string): PartyAddress | undefined {
  const adrBlock = getTagText(partyBlock, 'PstlAdr');
  if (!adrBlock) return undefined;

  const street = getTagText(adrBlock, 'StrtNm') || undefined;
  const buildingNumber = getTagText(adrBlock, 'BldgNb') || undefined;
  const postalCode = getTagText(adrBlock, 'PstCd') || undefined;
  const town = getTagText(adrBlock, 'TwnNm') || undefined;
  const country = getTagText(adrBlock, 'Ctry') || undefined;
  const countrySubDivision = getTagText(adrBlock, 'CtrySubDvsn') || undefined;

  const rawLines = getAllTagBlocks(adrBlock, 'AdrLine').map(unescapeXmlEntities);

  if (!street && !buildingNumber && !postalCode && !town && !country && rawLines.length === 0) {
    return undefined;
  }

  return {
    street,
    buildingNumber,
    postalCode,
    town,
    country,
    countrySubDivision,
    rawLines: rawLines.length > 0 ? rawLines : undefined,
  };
}

/**
 * Extracts a party (e.g. Dbtr, Cdtr, DbtrAgt) from an XML block.
 */
function extractParty(
  parentBlock: string,
  partyTagName: string,
  role: CanonicalParty['role'],
  sourcePath: string
): CanonicalParty | null {
  const partyBlock = getTagText(parentBlock, partyTagName);
  if (!partyBlock) return null;

  // Name
  const rawName = getTagText(partyBlock, 'Nm') || getTagText(partyBlock, 'Pty/Nm');
  const name = rawName ? unescapeXmlEntities(rawName) : `Unknown ${role}`;

  // Account / IBAN
  const acctBlock = getTagText(parentBlock, `${partyTagName}Acct`);
  let accountNumber: string | undefined;
  let accountType: CanonicalParty['accountType'] = undefined;

  if (acctBlock) {
    const iban = getTagText(acctBlock, 'IBAN');
    if (iban) {
      accountNumber = iban.replace(/\s+/g, '');
      accountType = 'IBAN';
    } else {
      const othrId = getTagText(acctBlock, 'Othr/Id') || getTagText(acctBlock, 'Id');
      if (othrId) {
        accountNumber = othrId.trim();
        accountType = 'PROPRIETARY';
      }
    }
  }

  // Identifiers: BIC, LEI, TaxId, Passport
  const identifiers: Identifier[] = [];

  const bic = getTagText(partyBlock, 'BICFI') || getTagText(partyBlock, 'BIC') || getTagText(partyBlock, 'FinInstnId/BICFI');
  if (bic) {
    const cleanBic = bic.replace(/\s+/g, '');
    identifiers.push({
      type: 'BIC',
      value: cleanBic,
      country: cleanBic.length >= 6 ? cleanBic.slice(4, 6) : undefined,
    });
  }

  const lei = getTagText(partyBlock, 'LEI') || getTagText(partyBlock, 'FinInstnId/LEI');
  if (lei) {
    identifiers.push({
      type: 'LEI',
      value: lei.replace(/\s+/g, ''),
    });
  }

  const taxId = getTagText(partyBlock, 'OrgId/Othr/Id') || getTagText(partyBlock, 'TaxId');
  if (taxId) {
    identifiers.push({
      type: 'TAX_ID',
      value: taxId.trim(),
    });
  }

  const passport =
    getTagText(partyBlock, 'PrvtId/DtAndPlcOfBirth/PrvtId/Othr/Id') ||
    getTagText(partyBlock, 'PrvtId/Othr/Id') ||
    getTagText(partyBlock, 'Othr/Id') ||
    getTagText(partyBlock, 'Passport');
  if (passport) {
    identifiers.push({
      type: 'PASSPORT',
      value: passport.trim(),
    });
  }

  const address = extractPostalAddress(partyBlock);

  return {
    partyId: `pty_${partyTagName}_${Math.random().toString(36).slice(2, 9)}`,
    role,
    name,
    originalName: name,
    accountNumber,
    accountType,
    identifiers,
    address,
    country: address?.country,
    provenance: {
      sourceTag: partyTagName,
      fieldPath: `${sourcePath}/${partyTagName}`,
      rawSnippet: partyBlock.slice(0, 300),
    },
  };
}

/**
 * Extracts all occurrences of a party tag within a parent XML block (preserving repeated parties).
 */
function extractAllParties(
  parentBlock: string,
  partyTagName: string,
  role: CanonicalParty['role'],
  sourcePath: string,
  sequence?: 'A' | 'B' | 'ROOT'
): CanonicalParty[] {
  const blocks = getAllTagBlocks(parentBlock, partyTagName);
  const out: CanonicalParty[] = [];
  for (let idx = 0; idx < blocks.length; idx++) {
    const wrapped = `<${partyTagName}>${blocks[idx]}</${partyTagName}>`;
    const acctBlock = getTagText(parentBlock, `${partyTagName}Acct`);
    const combined = acctBlock ? `${wrapped}<${partyTagName}Acct>${acctBlock}</${partyTagName}Acct>` : wrapped;
    const party = extractParty(combined, partyTagName, role, blocks.length > 1 ? `${sourcePath}[${idx}]` : sourcePath);
    if (party) {
      if (sequence) {
        party.provenance.sequence = sequence;
      }
      out.push(party);
    }
  }
  return out;
}

/**
 * Validates declared ISO 20022 schema version against supported profile versions.
 * If an explicit 4-segment version (e.g., pacs.008.001.02) is present and not in testedVersions,
 * returns isVersionSupported = false so the transaction is flagged for manual review.
 */
export function verifyIso20022SchemaVersion(
  xml: string,
  expectedBase: 'pacs.008' | 'pacs.009' | 'pacs.004' | 'pain.001',
  testedSuffixes: string[]
): { schemaVersion?: string; isVersionSupported: boolean } {
  const escaped = expectedBase.replace('.', '\\.');
  const re = new RegExp(`\\b(${escaped}\\.(\\d{3}\\.\\d{2}))\\b`, 'i');
  const m = xml.match(re);
  if (!m) {
    // Compact XML without explicit 4-segment suffix defaults to supported profile structure
    return { schemaVersion: expectedBase, isVersionSupported: true };
  }
  const fullVersion = m[1].toLowerCase();
  const suffix = m[2];
  return {
    schemaVersion: fullVersion,
    isVersionSupported: testedSuffixes.includes(suffix),
  };
}

/**
 * Parses pacs.008.001.08 / .09 / .10 (FI to FI Customer Credit Transfer).
 */
export function parsePacs008(xml: string): CanonicalPaymentTransaction[] {
  const safeXml = validateAndSanitizeXml(xml);
  const versionCheck = verifyIso20022SchemaVersion(safeXml, 'pacs.008', ['001.08', '001.09', '001.10']);
  const grpHdr = getTagText(safeXml, 'GrpHdr') || '';
  const grpMsgId = getTagText(grpHdr, 'MsgId') || `PACS008-${Date.now()}`;
  const sttlmDt = getTagText(grpHdr, 'IntrBkSttlmDt') || new Date().toISOString().slice(0, 10);

  let txBlocks = getAllTagBlocks(safeXml, 'CdtTrfTxInf');
  if (txBlocks.length === 0) {
    txBlocks = [safeXml];
  }

  const results: CanonicalPaymentTransaction[] = [];

  for (let i = 0; i < txBlocks.length; i++) {
    const block = txBlocks[i];
    const txId = getTagText(block, 'PmtId/EndToEndId') || getTagText(block, 'PmtId/TxId') || `${grpMsgId}-${i + 1}`;
    const uetr = getTagText(block, 'PmtId/UETR') || undefined;

    const { currency, amount } = extractAmountAndCurrency(block, 'IntrBkSttlmAmt');
    const rmtInf = getTagText(block, 'RmtInf/Ustrd') || getTagText(block, 'RmtInf') || undefined;

    const parties: CanonicalParty[] = [
      ...extractAllParties(block, 'Dbtr', 'DEBTOR', `CdtTrfTxInf[${i}]`, 'ROOT'),
      ...extractAllParties(block, 'UltmtDbtr', 'ULTIMATE_DEBTOR', `CdtTrfTxInf[${i}]`, 'ROOT'),
      ...extractAllParties(block, 'InitgPty', 'DEBTOR', `CdtTrfTxInf[${i}]`, 'ROOT'),
      ...extractAllParties(block, 'DbtrAgt', 'ORDERING_INSTITUTION', `CdtTrfTxInf[${i}]`, 'ROOT'),
      ...extractAllParties(block, 'PrvsInstgAgt1', 'INTERMEDIARY_AGENT', `CdtTrfTxInf[${i}]`, 'ROOT'),
      ...extractAllParties(block, 'PrvsInstgAgt2', 'INTERMEDIARY_AGENT', `CdtTrfTxInf[${i}]`, 'ROOT'),
      ...extractAllParties(block, 'PrvsInstgAgt3', 'INTERMEDIARY_AGENT', `CdtTrfTxInf[${i}]`, 'ROOT'),
      ...extractAllParties(block, 'IntrmyAgt1', 'INTERMEDIARY_AGENT', `CdtTrfTxInf[${i}]`, 'ROOT'),
      ...extractAllParties(block, 'IntrmyAgt2', 'INTERMEDIARY_AGENT', `CdtTrfTxInf[${i}]`, 'ROOT'),
      ...extractAllParties(block, 'IntrmyAgt3', 'INTERMEDIARY_AGENT', `CdtTrfTxInf[${i}]`, 'ROOT'),
      ...extractAllParties(block, 'CdtrAgt', 'CREDITOR_AGENT', `CdtTrfTxInf[${i}]`, 'ROOT'),
      ...extractAllParties(block, 'Cdtr', 'CREDITOR', `CdtTrfTxInf[${i}]`, 'ROOT'),
      ...extractAllParties(block, 'UltmtCdtr', 'ULTIMATE_CREDITOR', `CdtTrfTxInf[${i}]`, 'ROOT'),
    ];

    const tx: CanonicalPaymentTransaction = {
      transactionId: txId,
      uetr,
      endToEndId: txId,
      messageFamily: 'ISO20022_MX',
      messageType: 'PACS_008',
      schemaVersion: versionCheck.schemaVersion,
      isProfileTested: versionCheck.isVersionSupported,
      settlementDate: sttlmDt,
      currency,
      amount,
      remittanceInformation: rmtInf,
      parties,
      missingDataIssues: [],
      rawMessageSnippet: block.slice(0, 500),
      provenanceSummary: {
        totalPartiesExtracted: parties.length,
        expectedPartyMarkersInRaw: parties.length,
        parsedSequences: ['CdtTrfTxInf'],
        parserProfile: `ISO 20022 ${versionCheck.schemaVersion || 'pacs.008.001.08/09'} (Customer Credit Transfer)`,
      },
    };

    tx.missingDataIssues = auditPaymentMissingData(tx);
    results.push(tx);
  }

  return results;
}

/**
 * Parses pacs.009 COV (Financial Institution Transfer with Cover).
 */
export function parsePacs009COV(xml: string): CanonicalPaymentTransaction[] {
  const safeXml = validateAndSanitizeXml(xml);
  const versionCheck = verifyIso20022SchemaVersion(safeXml, 'pacs.009', ['001.08', '001.09', '001.10']);
  const grpHdr = getTagText(safeXml, 'GrpHdr') || '';
  const grpMsgId = getTagText(grpHdr, 'MsgId') || `PACS009COV-${Date.now()}`;
  const sttlmDt = getTagText(grpHdr, 'IntrBkSttlmDt') || new Date().toISOString().slice(0, 10);

  let txBlocks = getAllTagBlocks(safeXml, 'CdtTrfTxInf');
  if (txBlocks.length === 0) txBlocks = [safeXml];

  const results: CanonicalPaymentTransaction[] = [];

  for (let i = 0; i < txBlocks.length; i++) {
    const block = txBlocks[i];
    const txId = getTagText(block, 'PmtId/EndToEndId') || `${grpMsgId}-${i + 1}`;
    const uetr = getTagText(block, 'PmtId/UETR') || undefined;

    const { currency, amount } = extractAmountAndCurrency(block, 'IntrBkSttlmAmt');

    // Underlying Customer Cover Parties (<UndrlygCstmrCdtTrf>)
    const covBlock = getTagText(block, 'UndrlygCstmrCdtTrf');
    if (!covBlock) {
      throw new Error('Mandatory <UndrlygCstmrCdtTrf> underlying customer credit transfer block is missing in pacs.009 COV message.');
    }

    const parties: CanonicalParty[] = [
      ...extractAllParties(block, 'InstgAgt', 'INSTRUCTING_AGENT', `pacs009[${i}]/SeqA`, 'A'),
      ...extractAllParties(block, 'InstdAgt', 'CREDITOR_AGENT', `pacs009[${i}]/SeqA`, 'A'),
      ...extractAllParties(covBlock, 'Dbtr', 'DEBTOR', `pacs009[${i}]/Cover`, 'B'),
      ...extractAllParties(covBlock, 'UltmtDbtr', 'ULTIMATE_DEBTOR', `pacs009[${i}]/Cover`, 'B'),
      ...extractAllParties(covBlock, 'DbtrAgt', 'ORDERING_INSTITUTION', `pacs009[${i}]/Cover`, 'B'),
      ...extractAllParties(covBlock, 'IntrmyAgt1', 'INTERMEDIARY_AGENT', `pacs009[${i}]/Cover`, 'B'),
      ...extractAllParties(covBlock, 'IntrmyAgt2', 'INTERMEDIARY_AGENT', `pacs009[${i}]/Cover`, 'B'),
      ...extractAllParties(covBlock, 'IntrmyAgt3', 'INTERMEDIARY_AGENT', `pacs009[${i}]/Cover`, 'B'),
      ...extractAllParties(covBlock, 'CdtrAgt', 'CREDITOR_AGENT', `pacs009[${i}]/Cover`, 'B'),
      ...extractAllParties(covBlock, 'Cdtr', 'CREDITOR', `pacs009[${i}]/Cover`, 'B'),
      ...extractAllParties(covBlock, 'UltmtCdtr', 'ULTIMATE_CREDITOR', `pacs009[${i}]/Cover`, 'B'),
    ];

    const tx: CanonicalPaymentTransaction = {
      transactionId: txId,
      uetr,
      endToEndId: txId,
      messageFamily: 'ISO20022_MX',
      messageType: 'PACS_009_COV',
      schemaVersion: versionCheck.schemaVersion,
      isProfileTested: versionCheck.isVersionSupported,
      settlementDate: sttlmDt,
      currency,
      amount,
      parties,
      missingDataIssues: [],
      rawMessageSnippet: block.slice(0, 500),
      provenanceSummary: {
        totalPartiesExtracted: parties.length,
        expectedPartyMarkersInRaw: parties.length,
        parsedSequences: ['Direct FI Settlement', 'UndrlygCstmrCdtTrf (Cover)'],
        parserProfile: `ISO 20022 ${versionCheck.schemaVersion || 'pacs.009.001.08/09'} COV`,
      },
    };

    tx.missingDataIssues = auditPaymentMissingData(tx);
    results.push(tx);
  }

  return results;
}

/**
 * Parses pacs.004.001.09 / .10 (Payment Return).
 */
export function parsePacs004(xml: string): CanonicalPaymentTransaction[] {
  const safeXml = validateAndSanitizeXml(xml);
  const versionCheck = verifyIso20022SchemaVersion(safeXml, 'pacs.004', ['001.09', '001.10', '001.11']);
  const grpHdr = getTagText(safeXml, 'GrpHdr') || '';
  const grpMsgId = getTagText(grpHdr, 'MsgId') || `PACS004-${Date.now()}`;

  let txBlocks = getAllTagBlocks(safeXml, 'TxInf');
  if (txBlocks.length === 0) txBlocks = [safeXml];

  const results: CanonicalPaymentTransaction[] = [];

  for (let i = 0; i < txBlocks.length; i++) {
    const block = txBlocks[i];
    const rtrId = getTagText(block, 'RtrId') || `${grpMsgId}-RTR-${i + 1}`;
    const origEndToEndId = getTagText(block, 'OrgnlEndToEndId') || undefined;
    const uetr = getTagText(block, 'OrgnlUETR') || undefined;

    const { currency, amount } = extractAmountAndCurrency(block, 'RtrdIntrBkSttlmAmt');

    const origRefBlock = getTagText(block, 'OrgnlTxRef') || block;
    let originalAmount = amount;
    let originalCurrency = currency;
    try {
      const origAmt = extractAmountAndCurrency(origRefBlock, 'InstdAmt');
      originalAmount = origAmt.amount;
      originalCurrency = origAmt.currency;
    } catch {
      // If original amount tag is omitted, use returned amount
    }

    const returnReasonCode =
      getTagText(block, 'RtrRsnInf/Rsn/Cd') ||
      getTagText(block, 'Rsn/Cd') ||
      getTagText(block, 'RtrRsnInf/AddtlInf') ||
      'NARR';

    const parties: CanonicalParty[] = [];

    const rtrAgt = extractParty(block, 'InstgAgt', 'RETURNING_INSTITUTION', `pacs004[${i}]`);
    if (rtrAgt) parties.push(rtrAgt);

    const origDbtr = extractParty(origRefBlock, 'Dbtr', 'ORIGINAL_DEBTOR', `pacs004[${i}]/OrgnlTxRef`);
    if (origDbtr) parties.push(origDbtr);

    const origCdtr = extractParty(origRefBlock, 'Cdtr', 'ORIGINAL_CREDITOR', `pacs004[${i}]/OrgnlTxRef`);
    if (origCdtr) parties.push(origCdtr);

    // Primary Debtor and Creditor aliases for compliance screening
    if (origDbtr) {
      parties.push({ ...origDbtr, role: 'DEBTOR', partyId: `pty_ret_dbtr_${i}` });
    }
    if (origCdtr) {
      parties.push({ ...origCdtr, role: 'CREDITOR', partyId: `pty_ret_cdtr_${i}` });
    }

    const tx: CanonicalPaymentTransaction = {
      transactionId: rtrId,
      uetr,
      endToEndId: origEndToEndId || rtrId,
      messageFamily: 'ISO20022_MX',
      messageType: 'PACS_004',
      schemaVersion: versionCheck.schemaVersion,
      isProfileTested: versionCheck.isVersionSupported,
      settlementDate: new Date().toISOString().slice(0, 10),
      currency,
      amount,
      originalAmount,
      originalCurrency,
      returnReasonCode,
      parties,
      missingDataIssues: [],
      rawMessageSnippet: block.slice(0, 500),
      provenanceSummary: {
        totalPartiesExtracted: parties.length,
        parsedSequences: ['Payment Return (pacs.004)'],
        parserProfile: `ISO 20022 pacs.004 (Return Reason: ${returnReasonCode})`,
      },
    };

    tx.missingDataIssues = auditPaymentMissingData(tx);
    results.push(tx);
  }

  return results;
}

/**
 * Parses pain.001.001.09 / .10 (Customer Credit Transfer Initiation).
 */
export function parsePain001(xml: string): CanonicalPaymentTransaction[] {
  const safeXml = validateAndSanitizeXml(xml);
  const versionCheck = verifyIso20022SchemaVersion(safeXml, 'pain.001', ['001.09', '001.10', '001.11']);
  const grpHdr = getTagText(safeXml, 'GrpHdr') || '';
  const grpMsgId = getTagText(grpHdr, 'MsgId') || `PAIN001-${Date.now()}`;

  const pmtInfBlocks = getAllTagBlocks(safeXml, 'PmtInf');
  const results: CanonicalPaymentTransaction[] = [];

  for (let pIdx = 0; pIdx < pmtInfBlocks.length; pIdx++) {
    const pmtBlock = pmtInfBlocks[pIdx];
    const debtor = extractParty(pmtBlock, 'Dbtr', 'DEBTOR', `PmtInf[${pIdx}]`);
    const debtorAgt = extractParty(pmtBlock, 'DbtrAgt', 'ORDERING_INSTITUTION', `PmtInf[${pIdx}]`);
    const reqdExctnDt = getTagText(pmtBlock, 'ReqdExctnDt/Dt') || new Date().toISOString().slice(0, 10);

    const txBlocks = getAllTagBlocks(pmtBlock, 'CdtTrfTxInf');

    for (let tIdx = 0; tIdx < txBlocks.length; tIdx++) {
      const txBlock = txBlocks[tIdx];
      const endToEndId =
        getTagText(txBlock, 'PmtId/EndToEndId') ||
        getTagText(txBlock, 'EndToEndId') ||
        `${grpMsgId}-${pIdx + 1}-${tIdx + 1}`;
      const uetr = getTagText(txBlock, 'PmtId/UETR') || undefined;

      const { currency, amount } = extractAmountAndCurrency(txBlock, 'InstdAmt');
      const rmtInf = getTagText(txBlock, 'RmtInf/Ustrd') || undefined;

      const parties: CanonicalParty[] = [];
      if (debtor) parties.push(debtor);
      if (debtorAgt) parties.push(debtorAgt);

      const creditor = extractParty(txBlock, 'Cdtr', 'CREDITOR', `PmtInf[${pIdx}]/CdtTrfTxInf[${tIdx}]`);
      if (creditor) parties.push(creditor);

      const creditorAgt = extractParty(txBlock, 'CdtrAgt', 'CREDITOR_AGENT', `PmtInf[${pIdx}]/CdtTrfTxInf[${tIdx}]`);
      if (creditorAgt) parties.push(creditorAgt);

      const ultmtCreditor = extractParty(txBlock, 'UltmtCdtr', 'ULTIMATE_CREDITOR', `PmtInf[${pIdx}]/CdtTrfTxInf[${tIdx}]`);
      if (ultmtCreditor) parties.push(ultmtCreditor);

      const tx: CanonicalPaymentTransaction = {
        transactionId: endToEndId,
        uetr,
        endToEndId,
        messageFamily: 'ISO20022_MX',
        messageType: 'PAIN_001',
        schemaVersion: versionCheck.schemaVersion,
        isProfileTested: versionCheck.isVersionSupported,
        settlementDate: reqdExctnDt,
        currency,
        amount,
        remittanceInformation: rmtInf,
        parties,
        missingDataIssues: [],
        rawMessageSnippet: txBlock.slice(0, 500),
        provenanceSummary: {
          totalPartiesExtracted: parties.length,
          parsedSequences: [`PmtInf[${pIdx}]/CdtTrfTxInf[${tIdx}]`],
          parserProfile: 'ISO 20022 pain.001 (Customer Credit Transfer Initiation)',
        },
      };

      tx.missingDataIssues = auditPaymentMissingData(tx);
      results.push(tx);
    }
  }

  return results;
}

const ISO20022_ROOT_ELEMENT_MAP: Record<string, PaymentMessageType> = {
  FIToFICstmrCdtTrf: 'PACS_008',
  FICdtTrf: 'PACS_009',
  PmtRtr: 'PACS_004',
  FIToFIPmtStsRpt: 'PACS_002',
  FIToFICstmrDrctDbt: 'PACS_003',
  FIToFIPmtRvsl: 'PACS_007',
  FIDrctDbt: 'PACS_010',
  FIToFIPmtStsReq: 'PACS_028',
  CstmrCdtTrfInitn: 'PAIN_001',
  CstmrCdtTrfInit: 'PAIN_001',
  CstmrPmtStsRpt: 'PAIN_002',
  CstmrPmtRvsl: 'PAIN_007',
  CstmrDrctDbtInitn: 'PAIN_008',
  MndtInitnReq: 'PAIN_009',
  MndtAmdmntReq: 'PAIN_010',
  MndtCxlReq: 'PAIN_011',
  MndtAccptncRpt: 'PAIN_012',
  CdtrPmtActvtnReq: 'PAIN_013',
  CdtrPmtActvtnReqStsRpt: 'PAIN_014',
  BkToCstmrAcctRpt: 'CAMT_052',
  BkToCstmrStmt: 'CAMT_053',
  BkToCstmrDbtCdtNtfctn: 'CAMT_054',
  CstmrPmtCxlReq: 'CAMT_055',
  FIToFIPmtCxlReq: 'CAMT_056',
  NtfctnToRcv: 'CAMT_057',
  NtfctnToRcvCxlAdvc: 'CAMT_058',
  NtfctnToRcvStsRpt: 'CAMT_059',
  AcctRptgReq: 'CAMT_060',
  BkSvcsBllgStmt: 'CAMT_086',
  ReqToModfyPmt: 'CAMT_087',
  UnableToApply: 'CAMT_026',
  ClmNonRct: 'CAMT_027',
  AddtlPmtInf: 'CAMT_028',
  RsltnOfInvstgtn: 'CAMT_029',
  LqdtyCdtTrf: 'CAMT_050',
  AppHdr: 'HEAD_001',
  AcctOpngInstr: 'ACMT_001',
  AcctDtlsConf: 'ACMT_002',
  AcctModInstr: 'ACMT_003',
  AcctOpngReq: 'ACMT_007',
  AcctExcldMndtMntncReq: 'ACMT_015',
  SysEvtNtfctn: 'ADMI_004',
  MsgRjct: 'ADMI_002',
  RmtAdvc: 'REMT_001',
  SctiesSttlmTxInstr: 'SESE_023',
  SctiesSttlmTxStsAdvc: 'SESE_024',
  SctiesSttlmTxConf: 'SESE_025',
  SctiesBalCustdyRpt: 'SEMT_002',
  SctiesBalAcctgRpt: 'SEMT_003',
  CorpActnNtfctn: 'SEEV_031',
  CorpActnMvmntConf: 'SEEV_036',
  RedOrdr: 'SETR_004',
  SbcptOrdr: 'SETR_010',
  FXTradInstr: 'FXTR_014',
  CltrlPrpsl: 'COLR_003',
  InvcPmtReconciltnAdvc: 'TSIN_001',
  InitlBaselnSubmissn: 'TSMT_009',
  FullPushThrghRpt: 'TSMT_015',
  InttToPayNtfctn: 'TSMT_019',
  UdrtkgIssnc: 'TSRV_001',
};

/**
 * Detects any ISO 20022 MX message type from XML namespaces, BAH <MsgDefIdr>, or root business elements.
 */
export function detectIso20022MessageType(xml: string): PaymentMessageType {
  // 1. Check BAH <MsgDefIdr> or Document xmlns for standard 4-letter.3-digit ISO 20022 message ID (prefer Document over head.001 if both exist)
  const allMatches = Array.from(
    xml.matchAll(/\b(pacs|pain|camt|acmt|admi|auth|caaa|caad|caam|cafc|cafm|cafr|cain|canm|casr|catm|catp|colr|deri|fxtr|reda|remt|secl|seeu|seev|semt|sese|setr|supl|trea|tsin|tsmt|tsrv|xsys|head)\.(\d{3})(?:[._-](stp|adv|cov))?(?:\.(\d{3})\.(\d{2}))?/gi)
  );

  // Prefer non-head message definition when wrapped in a BAH <AppHdr> envelope
  const primaryMatch = allMatches.find((m) => m[1].toLowerCase() !== 'head') || allMatches[0];
  if (primaryMatch) {
    const area = primaryMatch[1].toUpperCase();
    const num = primaryMatch[2];
    const variant = primaryMatch[3] ? primaryMatch[3].toUpperCase() : undefined;
    if (area === 'PACS' && num === '008') {
      if (variant === 'STP' || /<(?:SvcLvl|BizSvc)[^>]*>[\s\S]*?\bSTP\b[\s\S]*?<\/(?:SvcLvl|BizSvc)>/i.test(xml)) {
        return 'PACS_008_STP';
      }
    }
    if (area === 'PACS' && num === '009') {
      if (variant === 'ADV' || /<(?:SvcLvl|BizSvc)[^>]*>[\s\S]*?\bADV\b[\s\S]*?<\/(?:SvcLvl|BizSvc)>/i.test(xml)) {
        return 'PACS_009_ADV';
      }
      if (variant === 'COV' || /<(?:[a-zA-Z0-9_.-]+:)?UndrlygCstmrCdtTrf[\s>]/i.test(xml)) {
        return 'PACS_009_COV';
      }
      return 'PACS_009';
    }
    return `${area}_${num}` as PaymentMessageType;
  }

  // 2. Check root business element tags
  for (const [rootTag, mappedType] of Object.entries(ISO20022_ROOT_ELEMENT_MAP)) {
    const tagRegex = new RegExp(`<(?:[a-zA-Z0-9_.-]+:)?${rootTag}(?:\\s|>)`, 'i');
    if (tagRegex.test(xml)) {
      if (rootTag === 'FICdtTrf') {
        return /<(?:[a-zA-Z0-9_.-]+:)?UndrlygCstmrCdtTrf[\s>]/i.test(xml) ? 'PACS_009_COV' : 'PACS_009';
      }
      return mappedType;
    }
  }

  return 'GENERIC_ISO20022_MX';
}

/**
 * Generic ISO 20022 envelope parser for any MX message type across all ISO 20022 domains
 * (camt.*, pacs.*, pain.*, acmt.*, admi.*, sese.*, setr.*, semt.*, seev.*, fxtr.*, colr.*, remt.*, tsmt.*, tsrv.*, head.*).
 */
export function parseGenericIso20022(xml: string, messageType: PaymentMessageType = 'GENERIC_ISO20022_MX'): CanonicalPaymentTransaction[] {
  const safeXml = validateAndSanitizeXml(xml);
  const msgId =
    getTagText(safeXml, 'MsgId') ||
    getTagText(safeXml, 'BizMsgIdr') ||
    getTagText(safeXml, 'TxId') ||
    getTagText(safeXml, 'Id') ||
    `MX-GEN-${Date.now()}`;
  const uetr = getTagText(safeXml, 'UETR') || getTagText(safeXml, 'OrgnlUETR') || undefined;
  const sttlmDt =
    getTagText(safeXml, 'IntrBkSttlmDt') ||
    getTagText(safeXml, 'ReqdExctnDt/Dt') ||
    getTagText(safeXml, 'ReqdColltnDt') ||
    getTagText(safeXml, 'TradDt') ||
    new Date().toISOString().slice(0, 10);

  const parties: CanonicalParty[] = [];
  const partyMappings: Array<{ tag: string; role: CanonicalParty['role'] }> = [
    { tag: 'Dbtr', role: 'DEBTOR' },
    { tag: 'UltmtDbtr', role: 'ULTIMATE_DEBTOR' },
    { tag: 'DbtrAgt', role: 'ORDERING_INSTITUTION' },
    { tag: 'IntrmyAgt1', role: 'INTERMEDIARY_AGENT' },
    { tag: 'CdtrAgt', role: 'CREDITOR_AGENT' },
    { tag: 'Cdtr', role: 'CREDITOR' },
    { tag: 'UltmtCdtr', role: 'ULTIMATE_CREDITOR' },
    { tag: 'InstgAgt', role: 'INSTRUCTING_AGENT' },
    { tag: 'InstdAgt', role: 'CREDITOR_AGENT' },
    { tag: 'InitgPty', role: 'DEBTOR' },
    { tag: 'AcctOwnr', role: 'DEBTOR' },
    { tag: 'AcctSvcr', role: 'ORDERING_INSTITUTION' },
    { tag: 'Assgnr', role: 'SENDER' },
    { tag: 'Assgne', role: 'RECEIVER' },
    { tag: 'Buyr', role: 'DEBTOR' },
    { tag: 'Sellr', role: 'CREDITOR' },
    { tag: 'Fr', role: 'SENDER' },
    { tag: 'To', role: 'RECEIVER' },
  ];

  const seenRolesAndNames = new Set<string>();
  for (const mapping of partyMappings) {
    const p = extractParty(safeXml, mapping.tag, mapping.role, 'GenericDocument');
    if (p) {
      // Avoid adding an empty Unknown party if only FIId/BIC was inside <Fr>/<To> without <Nm> unless identifiers exist
      if (p.name.startsWith('Unknown ') && p.identifiers.length > 0) {
        p.name = `Financial Institution ${p.identifiers[0].value}`;
        p.originalName = p.name;
      }
      if (!p.name.startsWith('Unknown ') || p.identifiers.length > 0 || p.accountNumber) {
        const dedupKey = `${p.role}:${p.name}:${p.identifiers.map((i) => i.value).join(',')}`;
        if (!seenRolesAndNames.has(dedupKey)) {
          seenRolesAndNames.add(dedupKey);
          parties.push(p);
        }
      }
    }
  }

  let currency = 'USD';
  let amount = 0;
  try {
    const amt = extractAmountAndCurrency(safeXml, 'InstdAmt');
    currency = amt.currency;
    amount = amt.amount;
  } catch {
    // Check any Ccy="..." amount element in the document
    const anyCcyMatch = safeXml.match(/<[a-zA-Z0-9_.:-]+\s+[^>]*?Ccy=['"]([A-Z]{3})['"][^>]*?>([0-9.]+)<\//i);
    if (anyCcyMatch) {
      currency = anyCcyMatch[1];
      amount = parseFloat(anyCcyMatch[2]) || 0;
    }
  }

  const rmtInf = getTagText(safeXml, 'RmtInf/Ustrd') || getTagText(safeXml, 'AddtlInf') || undefined;

  const tx: CanonicalPaymentTransaction = {
    transactionId: msgId,
    uetr,
    endToEndId: getTagText(safeXml, 'EndToEndId') || getTagText(safeXml, 'OrgnlEndToEndId') || msgId,
    messageFamily: 'ISO20022_MX',
    messageType,
    isProfileTested: false,
    settlementDate: sttlmDt,
    currency,
    amount,
    remittanceInformation: rmtInf,
    parties,
    missingDataIssues: [],
    rawMessageSnippet: safeXml.slice(0, 500),
    provenanceSummary: {
      totalPartiesExtracted: parties.length,
      parsedSequences: ['GenericEnvelope'],
      parserProfile: `Generic ISO 20022 (${messageType}) - Universal MX Envelope`,
    },
  };

  tx.missingDataIssues = auditPaymentMissingData(tx);
  return [tx];
}

/**
 * Universal ISO 20022 entry point. Validates XML namespace and routes to tested profile or universal MX parser.
 */
export function parseIso20022PaymentMessage(xml: string): CanonicalPaymentTransaction[] {
  const safeXml = validateAndSanitizeXml(xml);
  const detectedType = detectIso20022MessageType(safeXml);

  if (detectedType === 'PACS_008' || (detectedType !== 'PACS_008_STP' && (/pacs\.008/i.test(safeXml) || /FIToFICstmrCdtTrf/i.test(safeXml)))) {
    return parsePacs008(safeXml);
  }

  if (detectedType === 'PACS_009_COV') {
    return parsePacs009COV(safeXml);
  }

  if (detectedType === 'PACS_004' || /pacs\.004/i.test(safeXml) || /PmtRtr/i.test(safeXml)) {
    return parsePacs004(safeXml);
  }

  if (detectedType === 'PAIN_001' || /pain\.001/i.test(safeXml) || /CstmrCdtTrfInit/i.test(safeXml)) {
    return parsePain001(safeXml);
  }

  // Ensure generic XML at least represents an ISO 20022 Document/AppHdr/BizData envelope or contains ISO 20022 message elements
  const hasIsoStructure =
    detectedType !== 'GENERIC_ISO20022_MX' ||
    /urn:iso:std:iso:20022/i.test(safeXml) ||
    /<(?:[a-zA-Z0-9_.-]+:)?(Document|AppHdr|BizData|BusMsg|GrpHdr|MsgId|BizMsgIdr)[\s>]/i.test(safeXml);
  if (!hasIsoStructure) {
    throw new Error(
      'Malformed or unrecognized ISO 20022 XML: payload lacks ISO 20022 Document/AppHdr structure and schema namespace.'
    );
  }

  return parseGenericIso20022(safeXml, detectedType);
}
