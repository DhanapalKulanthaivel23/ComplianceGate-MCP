/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { EntityType, Identifier, SourceRecord } from '../../../shared/types.ts';
import { unescapeXmlEntities } from '../parsers/iso20022Parser.ts';

export interface ParsedSourceFeed {
  sourceId: string;
  publicationDate?: string;
  declaredRecordCount?: number;
  records: SourceRecord[];
  rejectedCount: number;
  reasons: string[];
}

/**
 * Sanitizes strings against CSV formula injection and dangerous characters.
 */
export function sanitizeString(val: string): string {
  if (!val) return '';
  let clean = val.trim();
  // Strip formula injection prefixes
  if (/^[=+\-@]/.test(clean)) {
    clean = clean.replace(/^[=+\-@]+/, '').trim();
  }
  return clean;
}

/**
 * Validates XML to guard against XML External Entity (XXE) and billion laughs expansion attacks.
 */
export function assertSafeXml(rawXml: string): void {
  if (
    rawXml.includes('<!DOCTYPE') ||
    rawXml.includes('<!ENTITY') ||
    rawXml.includes('SYSTEM "') ||
    rawXml.includes('PUBLIC "')
  ) {
    throw new Error('SECURITY VIOLATION: XML payload contains DOCTYPE or ENTITY expansion (XXE protection triggered).');
  }
}

/**
 * Helper to parse a single CSV line with quoted fields.
 */
export function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  result.push(current);
  return result;
}

/**
 * RFC 4180 compliant CSV parser that respects embedded newlines inside quoted fields.
 * Prevents multiline records from being incorrectly split into multiple subjects.
 */
export function parseCsvRecords(rawText: string): string[][] {
  const records: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;
  let i = 0;

  while (i < rawText.length) {
    const char = rawText[i];
    if (char === '"') {
      if (inQuotes && rawText[i + 1] === '"') {
        currentField += '"';
        i += 2;
        continue;
      } else {
        inQuotes = !inQuotes;
        i++;
        continue;
      }
    }

    if (!inQuotes) {
      if (char === ',') {
        currentRow.push(currentField);
        currentField = '';
        i++;
        continue;
      }
      if (char === '\r') {
        if (rawText[i + 1] === '\n') i++;
        currentRow.push(currentField);
        currentField = '';
        if (currentRow.length > 0 && currentRow.some((f) => f.trim().length > 0)) {
          records.push(currentRow);
        }
        currentRow = [];
        i++;
        continue;
      }
      if (char === '\n') {
        currentRow.push(currentField);
        currentField = '';
        if (currentRow.length > 0 && currentRow.some((f) => f.trim().length > 0)) {
          records.push(currentRow);
        }
        currentRow = [];
        i++;
        continue;
      }
    }

    currentField += char;
    i++;
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    if (currentRow.some((f) => f.trim().length > 0)) {
      records.push(currentRow);
    }
  }

  return records;
}

/**
 * Source-specific parser for US OFAC Specially Designated Nationals (SDN) XML
 */
export function parseOfacSdnXml(rawXml: string, sourceId = 'OFAC_SDN'): ParsedSourceFeed {
  assertSafeXml(rawXml);

  if (!rawXml.includes('<sdnList') && !rawXml.includes('<sdnEntry')) {
    throw new Error('Invalid OFAC SDN schema: Missing <sdnList> or <sdnEntry> root structure.');
  }

  // Publication metadata
  let publicationDate: string | undefined;
  let declaredRecordCount: number | undefined;

  const pubMatch = rawXml.match(/<Publish_Date>([^<]+)<\/Publish_Date>/i);
  if (pubMatch) publicationDate = pubMatch[1].trim();

  const countMatch = rawXml.match(/<Record_Count>(\d+)<\/Record_Count>/i);
  if (countMatch) declaredRecordCount = parseInt(countMatch[1], 10);

  const records: SourceRecord[] = [];
  const reasons: string[] = [];
  let rejectedCount = 0;
  const seenIds = new Set<string>();

  const entryRegex = /<sdnEntry>([\s\S]*?)<\/sdnEntry>/gi;
  let match: RegExpExecArray | null;

  while ((match = entryRegex.exec(rawXml)) !== null) {
    const entryBlock = match[1];

    const uidMatch = entryBlock.match(/<uid>([^<]+)<\/uid>/i);
    const lastNameMatch = entryBlock.match(/<lastName>([^<]+)<\/lastName>/i);
    const firstNameMatch = entryBlock.match(/<firstName>([^<]+)<\/firstName>/i);
    const sdnTypeMatch = entryBlock.match(/<sdnType>([^<]+)<\/sdnType>/i);
    const remarksMatch = entryBlock.match(/<remarks>([\s\S]*?)<\/remarks>/i);

    if (!uidMatch || (!lastNameMatch && !firstNameMatch)) {
      rejectedCount++;
      reasons.push('Skipped sdnEntry missing uid or name.');
      continue;
    }

    const uid = uidMatch[1].trim();
    const lastName = lastNameMatch ? unescapeXmlEntities(lastNameMatch[1].trim()) : '';
    const firstName = firstNameMatch ? unescapeXmlEntities(firstNameMatch[1].trim()) : '';
    const fullName = firstName ? `${firstName} ${lastName}`.trim() : lastName;

    const recordId = `${sourceId}:${uid}`;
    if (seenIds.has(recordId)) {
      rejectedCount++;
      reasons.push(`Duplicate OFAC uid: ${uid}`);
      continue;
    }
    seenIds.add(recordId);

    // Entity type mapping
    const sdnTypeStr = (sdnTypeMatch ? sdnTypeMatch[1].trim().toLowerCase() : 'entity');
    let entityType: EntityType = 'ORGANIZATION';
    if (sdnTypeStr.includes('individual')) entityType = 'INDIVIDUAL';
    else if (sdnTypeStr.includes('vessel')) entityType = 'VESSEL';
    else if (sdnTypeStr.includes('aircraft')) entityType = 'AIRCRAFT';

    // Programs
    const programs: string[] = [];
    const progRegex = /<program>([^<]+)<\/program>/gi;
    let pMatch;
    while ((pMatch = progRegex.exec(entryBlock)) !== null) {
      programs.push(pMatch[1].trim());
    }

    // AKAs (Aliases)
    const aliases: string[] = [];
    const akaRegex = /<aka>([\s\S]*?)<\/aka>/gi;
    let aMatch;
    while ((aMatch = akaRegex.exec(entryBlock)) !== null) {
      const akaBlock = aMatch[1];
      const akaLast = akaBlock.match(/<lastName>([^<]+)<\/lastName>/i);
      const akaFirst = akaBlock.match(/<firstName>([^<]+)<\/firstName>/i);
      if (akaLast || akaFirst) {
        const al = akaLast ? unescapeXmlEntities(akaLast[1].trim()) : '';
        const af = akaFirst ? unescapeXmlEntities(akaFirst[1].trim()) : '';
        const aFull = af ? `${af} ${al}`.trim() : al;
        if (aFull && aFull !== fullName && !aliases.includes(aFull)) {
          aliases.push(sanitizeString(aFull));
        }
      }
    }

    // Identifiers
    const identifiers: Identifier[] = [];
    const idRegex = /<id>([\s\S]*?)<\/id>/gi;
    let iMatch;
    while ((iMatch = idRegex.exec(entryBlock)) !== null) {
      const idBlock = iMatch[1];
      const typeM = idBlock.match(/<idType>([^<]+)<\/idType>/i);
      const numM = idBlock.match(/<idNumber>([^<]+)<\/idNumber>/i);
      const cM = idBlock.match(/<idCountry>([^<]+)<\/idCountry>/i);
      if (typeM && numM) {
        const rawType = typeM[1].trim().toLowerCase();
        let idType: Identifier['type'] = 'OTHER';
        if (rawType.includes('passport')) idType = 'PASSPORT';
        else if (rawType.includes('tax') || rawType.includes('inn') || rawType.includes('tin')) idType = 'TAX_ID';
        else if (rawType.includes('lei')) idType = 'LEI';
        else if (rawType.includes('imo')) idType = 'IMO';
        else if (rawType.includes('registration')) idType = 'REGISTRATION_NO';
        else if (rawType.includes('national id') || rawType.includes('cedula') || rawType.includes('dni')) idType = 'NATIONAL_ID';

        identifiers.push({
          type: idType,
          value: numM[1].trim(),
          country: cM ? cM[1].trim() : undefined,
        });
      }
    }

    // Country from address
    let country: string | undefined;
    const addrCountry = entryBlock.match(/<country>([^<]+)<\/country>/i);
    if (addrCountry) country = unescapeXmlEntities(addrCountry[1].trim());

    records.push({
      id: recordId,
      sourceId,
      providerRecordId: uid,
      name: sanitizeString(fullName),
      aliases,
      entityType,
      identifiers,
      country: country ? sanitizeString(country) : undefined,
      programs,
      remarks: remarksMatch ? sanitizeString(unescapeXmlEntities(remarksMatch[1].trim())) : undefined,
    });
  }

  return {
    sourceId,
    publicationDate,
    declaredRecordCount,
    records,
    rejectedCount,
    reasons,
  };
}

/**
 * Source-specific parser for UK Foreign, Commonwealth & Development Office (FCDO) / OFSI XML
 */
export function parseUkSanctionsXml(rawXml: string, sourceId = 'UK_SANCTIONS_LIST'): ParsedSourceFeed {
  assertSafeXml(rawXml);

  if (!rawXml.includes('<Designations') && !rawXml.includes('<Designation')) {
    throw new Error('Invalid UK Sanctions schema: Missing <Designations> or <Designation> tag.');
  }

  let publicationDate: string | undefined;
  const genMatch = rawXml.match(/DateGenerated="([^"]+)"/i);
  if (genMatch) publicationDate = genMatch[1].trim();

  const records: SourceRecord[] = [];
  const reasons: string[] = [];
  let rejectedCount = 0;
  const seenIds = new Set<string>();

  const desigRegex = /<Designation>([\s\S]*?)<\/Designation>/gi;
  let match: RegExpExecArray | null;

  while ((match = desigRegex.exec(rawXml)) !== null) {
    const block = match[1];

    const uidMatch = block.match(/<UniqueID>([^<]+)<\/UniqueID>/i);
    const regimeMatch = block.match(/<RegimeName>([^<]+)<\/RegimeName>/i);
    const typeMatch = block.match(/<IndividualEntityShip>([^<]+)<\/IndividualEntityShip>/i);
    const otherInfoMatch = block.match(/<OtherInformation>([\s\S]*?)<\/OtherInformation>/i);

    if (!uidMatch) {
      rejectedCount++;
      reasons.push('Skipped Designation missing UniqueID.');
      continue;
    }

    const uid = uidMatch[1].trim();
    const recordId = `${sourceId}:${uid}`;
    if (seenIds.has(recordId)) {
      rejectedCount++;
      reasons.push(`Duplicate UK UniqueID: ${uid}`);
      continue;
    }
    seenIds.add(recordId);

    // Entity type
    let entityType: EntityType = 'ORGANIZATION';
    const typeStr = (typeMatch ? typeMatch[1].trim().toLowerCase() : '');
    if (typeStr.includes('individual')) entityType = 'INDIVIDUAL';
    else if (typeStr.includes('ship')) entityType = 'VESSEL';
    else if (typeStr.includes('aircraft')) entityType = 'AIRCRAFT';

    // Names and Aliases
    let primaryName = '';
    const aliases: string[] = [];

    const nameRegex = /<Name>([\s\S]*?)<\/Name>/gi;
    let nMatch;
    while ((nMatch = nameRegex.exec(block)) !== null) {
      const nBlock = nMatch[1];
      const nTypeMatch = nBlock.match(/<NameType>([^<]+)<\/NameType>/i);
      const name6Match = nBlock.match(/<Name6>([^<]+)<\/Name6>/i);

      let extractedName = '';
      if (name6Match) {
        extractedName = unescapeXmlEntities(name6Match[1].trim());
      } else {
        const n1 = nBlock.match(/<Name1>([^<]+)<\/Name1>/i)?.[1] || '';
        const n2 = nBlock.match(/<Name2>([^<]+)<\/Name2>/i)?.[1] || '';
        const n3 = nBlock.match(/<Name3>([^<]+)<\/Name3>/i)?.[1] || '';
        extractedName = [n1, n2, n3].filter(Boolean).map((s) => unescapeXmlEntities(s.trim())).join(' ');
      }

      if (extractedName) {
        if (!primaryName && (!nTypeMatch || nTypeMatch[1].toLowerCase().includes('primary'))) {
          primaryName = extractedName;
        } else if (extractedName !== primaryName && !aliases.includes(extractedName)) {
          aliases.push(sanitizeString(extractedName));
        }
      }
    }

    if (!primaryName) {
      rejectedCount++;
      reasons.push(`Designation ${uid}: Missing valid primary name.`);
      continue;
    }

    // Country from address
    let country: string | undefined;
    const countryMatch = block.match(/<Country>([^<]+)<\/Country>/i);
    if (countryMatch) country = unescapeXmlEntities(countryMatch[1].trim());

    // Identifiers
    const identifiers: Identifier[] = [];
    const idRegex = /<Identifier>([\s\S]*?)<\/Identifier>/gi;
    let idMatch;
    while ((idMatch = idRegex.exec(block)) !== null) {
      const idBlock = idMatch[1];
      const tMatch = idBlock.match(/<Type>([^<]+)<\/Type>/i);
      const numMatch = idBlock.match(/<Number>([^<]+)<\/Number>/i);
      if (tMatch && numMatch) {
        const rawType = tMatch[1].toLowerCase();
        let idType: Identifier['type'] = 'OTHER';
        if (rawType.includes('passport')) idType = 'PASSPORT';
        else if (rawType.includes('tax') || rawType.includes('inn')) idType = 'TAX_ID';
        else if (rawType.includes('imo')) idType = 'IMO';
        else if (rawType.includes('lei')) idType = 'LEI';
        else if (rawType.includes('national id')) idType = 'NATIONAL_ID';

        identifiers.push({
          type: idType,
          value: numMatch[1].trim(),
        });
      }
    }

    records.push({
      id: recordId,
      sourceId,
      providerRecordId: uid,
      name: sanitizeString(primaryName),
      aliases,
      entityType,
      identifiers,
      country: country ? sanitizeString(country) : undefined,
      programs: regimeMatch ? [regimeMatch[1].trim()] : [],
      remarks: otherInfoMatch ? sanitizeString(unescapeXmlEntities(otherInfoMatch[1].trim())) : undefined,
    });
  }

  return {
    sourceId,
    publicationDate,
    records,
    rejectedCount,
    reasons,
  };
}

/**
 * Source-specific parser for UN Security Council Consolidated Sanctions XML
 */
export function parseUnSanctionsXml(rawXml: string, sourceId = 'UN_CONSOLIDATED'): ParsedSourceFeed {
  assertSafeXml(rawXml);

  if (!rawXml.includes('<CONSOLIDATED_LIST') && !rawXml.includes('<INDIVIDUAL') && !rawXml.includes('<ENTITY')) {
    throw new Error('Invalid UN Consolidated Sanctions schema: Missing <CONSOLIDATED_LIST> root.');
  }

  let publicationDate: string | undefined;
  const genMatch = rawXml.match(/dateGenerated="([^"]+)"/i);
  if (genMatch) publicationDate = genMatch[1].trim();

  const records: SourceRecord[] = [];
  const reasons: string[] = [];
  let rejectedCount = 0;
  const seenIds = new Set<string>();

  // Helper for UN nodes
  const processUnBlock = (block: string, isIndividual: boolean) => {
    const dataIdMatch = block.match(/<DATAID>([^<]+)<\/DATAID>/i);
    const firstMatch = block.match(/<FIRST_NAME>([^<]+)<\/FIRST_NAME>/i);
    const secondMatch = block.match(/<SECOND_NAME>([^<]+)<\/SECOND_NAME>/i);
    const thirdMatch = block.match(/<THIRD_NAME>([^<]+)<\/THIRD_NAME>/i);
    const listTypeMatch = block.match(/<UN_LIST_TYPE>([^<]+)<\/UN_LIST_TYPE>/i);
    const commentsMatch = block.match(/<COMMENTS1>([\s\S]*?)<\/COMMENTS1>/i);
    const countryMatch = block.match(/<COUNTRY>([^<]+)<\/COUNTRY>/i);

    if (!dataIdMatch || (!firstMatch && !secondMatch)) {
      rejectedCount++;
      reasons.push('Skipped UN record missing DATAID or name.');
      return;
    }

    const dataId = dataIdMatch[1].trim();
    const recordId = `${sourceId}:${dataId}`;
    if (seenIds.has(recordId)) {
      rejectedCount++;
      reasons.push(`Duplicate UN DATAID: ${dataId}`);
      return;
    }
    seenIds.add(recordId);

    const nameParts = [firstMatch?.[1], secondMatch?.[1], thirdMatch?.[1]]
      .filter(Boolean)
      .map((s) => unescapeXmlEntities(s!.trim()));
    const fullName = nameParts.join(' ');

    // Aliases
    const aliases: string[] = [];
    const aliasRegex = /<ALIAS_NAME>([^<]+)<\/ALIAS_NAME>/gi;
    let aMatch;
    while ((aMatch = aliasRegex.exec(block)) !== null) {
      const aName = unescapeXmlEntities(aMatch[1].trim());
      if (aName && aName !== fullName && !aliases.includes(aName)) {
        aliases.push(sanitizeString(aName));
      }
    }

    // Documents / Identifiers
    const identifiers: Identifier[] = [];
    const docRegex = /<INDIVIDUAL_DOCUMENT>([\s\S]*?)<\/INDIVIDUAL_DOCUMENT>/gi;
    let dMatch;
    while ((dMatch = docRegex.exec(block)) !== null) {
      const dBlock = dMatch[1];
      const typeM = dBlock.match(/<TYPE_OF_DOCUMENT>([^<]+)<\/TYPE_OF_DOCUMENT>/i);
      const numM = dBlock.match(/<NUMBER>([^<]+)<\/NUMBER>/i);
      const cM = dBlock.match(/<ISSUING_COUNTRY>([^<]+)<\/ISSUING_COUNTRY>/i);
      if (typeM && numM) {
        const rawType = typeM[1].toLowerCase();
        let idType: Identifier['type'] = 'OTHER';
        if (rawType.includes('passport')) idType = 'PASSPORT';
        else if (rawType.includes('national id')) idType = 'NATIONAL_ID';

        identifiers.push({
          type: idType,
          value: numM[1].trim(),
          country: cM ? cM[1].trim() : undefined,
        });
      }
    }

    records.push({
      id: recordId,
      sourceId,
      providerRecordId: dataId,
      name: sanitizeString(fullName),
      aliases,
      entityType: isIndividual ? 'INDIVIDUAL' : 'ORGANIZATION',
      identifiers,
      country: countryMatch ? sanitizeString(unescapeXmlEntities(countryMatch[1].trim())) : undefined,
      programs: listTypeMatch ? [listTypeMatch[1].trim()] : [],
      remarks: commentsMatch ? sanitizeString(unescapeXmlEntities(commentsMatch[1].trim())) : undefined,
    });
  };

  // Individuals
  const indRegex = /<INDIVIDUAL>([\s\S]*?)<\/INDIVIDUAL>/gi;
  let iMatch;
  while ((iMatch = indRegex.exec(rawXml)) !== null) {
    processUnBlock(iMatch[1], true);
  }

  // Entities
  const entRegex = /<ENTITY>([\s\S]*?)<\/ENTITY>/gi;
  let eMatch;
  while ((eMatch = entRegex.exec(rawXml)) !== null) {
    processUnBlock(eMatch[1], false);
  }

  return {
    sourceId,
    publicationDate,
    records,
    rejectedCount,
    reasons,
  };
}

/**
 * Source-specific parser for EU Financial Sanctions Files (EEAS) XML
 */
export function parseEuFsfXml(rawXml: string, sourceId = 'EU_FSF'): ParsedSourceFeed {
  assertSafeXml(rawXml);

  if (!rawXml.includes('<export') && !rawXml.includes('<sanctionEntity')) {
    throw new Error('Invalid EU FSF schema: Missing <export> or <sanctionEntity> tag.');
  }

  let publicationDate: string | undefined;
  const genMatch = rawXml.match(/generationDate="([^"]+)"/i);
  if (genMatch) publicationDate = genMatch[1].trim();

  const records: SourceRecord[] = [];
  const reasons: string[] = [];
  let rejectedCount = 0;
  const seenIds = new Set<string>();

  const entityRegex = /<sanctionEntity\s+logicalId="([^"]+)"[^>]*>([\s\S]*?)<\/sanctionEntity>/gi;
  let match: RegExpExecArray | null;

  while ((match = entityRegex.exec(rawXml)) !== null) {
    const logicalId = match[1].trim();
    const block = match[2];

    const recordId = `${sourceId}:${logicalId}`;
    if (seenIds.has(recordId)) {
      rejectedCount++;
      reasons.push(`Duplicate EU logicalId: ${logicalId}`);
      continue;
    }
    seenIds.add(recordId);

    // Entity type
    let entityType: EntityType = 'ORGANIZATION';
    const typeMatch = block.match(/<subjectType\s+classificationCode="([^"]+)"/i);
    if (typeMatch && typeMatch[1].toLowerCase().includes('person')) {
      entityType = 'INDIVIDUAL';
    }

    // Names and Aliases
    const names: string[] = [];
    const nameRegex = /<nameAlias\s+[^>]*wholeName="([^"]+)"/gi;
    let nMatch;
    while ((nMatch = nameRegex.exec(block)) !== null) {
      const rawName = unescapeXmlEntities(nMatch[1].trim());
      if (rawName && !names.includes(rawName)) {
        names.push(rawName);
      }
    }

    if (names.length === 0) {
      rejectedCount++;
      reasons.push(`EU Entity ${logicalId}: No nameAlias found.`);
      continue;
    }

    const primaryName = names[0];
    const aliases = names.slice(1).map((a) => sanitizeString(a));

    // Regulation / Program
    const programs: string[] = [];
    const regMatch = block.match(/<regulation\s+[^>]*regulationType="([^"]+)"/i);
    if (regMatch) programs.push(regMatch[1].trim());

    // Country
    let country: string | undefined;
    const addrMatch = block.match(/<address\s+[^>]*countryDescription="([^"]+)"/i);
    if (addrMatch) country = unescapeXmlEntities(addrMatch[1].trim());

    // Identifiers
    const identifiers: Identifier[] = [];
    const idRegex = /<identification\s+[^>]*identificationTypeCode="([^"]+)"[^>]*identificationNumber="([^"]+)"/gi;
    let idMatch;
    while ((idMatch = idRegex.exec(block)) !== null) {
      const typeCode = idMatch[1].toLowerCase();
      const num = idMatch[2].trim();
      let idType: Identifier['type'] = 'OTHER';
      if (typeCode.includes('passport')) idType = 'PASSPORT';
      else if (typeCode.includes('tax') || typeCode.includes('inn')) idType = 'TAX_ID';
      else if (typeCode.includes('national id')) idType = 'NATIONAL_ID';

      identifiers.push({
        type: idType,
        value: num,
      });
    }

    // Remark
    let remarks: string | undefined;
    const remMatch = block.match(/<remark>([\s\S]*?)<\/remark>/i);
    if (remMatch) remarks = unescapeXmlEntities(remMatch[1].trim());

    records.push({
      id: recordId,
      sourceId,
      providerRecordId: logicalId,
      name: sanitizeString(primaryName),
      aliases,
      entityType,
      identifiers,
      country: country ? sanitizeString(country) : undefined,
      programs,
      remarks: remarks ? sanitizeString(remarks) : undefined,
    });
  }

  return {
    sourceId,
    publicationDate,
    records,
    rejectedCount,
    reasons,
  };
}

/**
 * Source-specific parser for Australia DFAT Regulation 8 Consolidated CSV
 */
export function parseDfatCsv(rawCsv: string, sourceId = 'AU_DFAT'): ParsedSourceFeed {
  const lines = rawCsv.split(/\r?\n/).filter(Boolean);
  if (lines.length <= 1) {
    return { sourceId, records: [], rejectedCount: 0, reasons: ['CSV empty or header only.'] };
  }

  const headers = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const refIdx = headers.findIndex((h) => h.includes('reference'));
  const nameIdx = headers.findIndex((h) => h.includes('name'));
  const typeIdx = headers.findIndex((h) => h.includes('type'));
  const countryIdx = headers.findIndex((h) => h.includes('citizenship') || h.includes('address'));
  const listInfoIdx = headers.findIndex((h) => h.includes('listing information'));
  const committeeIdx = headers.findIndex((h) => h.includes('committee'));
  const addInfoIdx = headers.findIndex((h) => h.includes('additional information'));

  if (nameIdx === -1) {
    throw new Error('Invalid DFAT CSV: Missing "Name" header column.');
  }

  const records: SourceRecord[] = [];
  const reasons: string[] = [];
  let rejectedCount = 0;
  const seenIds = new Set<string>();

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols = parseCsvLine(line);
    const rawName = cols[nameIdx]?.trim();
    if (!rawName) {
      rejectedCount++;
      reasons.push(`Row ${i + 1}: Missing name.`);
      continue;
    }

    const ref = (refIdx >= 0 && cols[refIdx]?.trim()) ? cols[refIdx].trim() : `dfat_${i}`;
    const recordId = `${sourceId}:${ref}`;
    if (seenIds.has(recordId)) {
      rejectedCount++;
      reasons.push(`Duplicate DFAT Reference: ${ref}`);
      continue;
    }
    seenIds.add(recordId);

    const rawType = (typeIdx >= 0 && cols[typeIdx]?.trim()) ? cols[typeIdx].trim().toLowerCase() : '';
    let entityType: EntityType = 'ORGANIZATION';
    if (rawType.includes('individual') || rawType.includes('person')) entityType = 'INDIVIDUAL';
    else if (rawType.includes('vessel') || rawType.includes('ship')) entityType = 'VESSEL';

    const programs = [cols[listInfoIdx]?.trim(), cols[committeeIdx]?.trim()].filter(Boolean);

    records.push({
      id: recordId,
      sourceId,
      providerRecordId: ref,
      name: sanitizeString(rawName),
      aliases: [],
      entityType,
      identifiers: [],
      country: countryIdx >= 0 && cols[countryIdx]?.trim() ? sanitizeString(cols[countryIdx].trim()) : undefined,
      programs,
      remarks: addInfoIdx >= 0 && cols[addInfoIdx]?.trim() ? sanitizeString(cols[addInfoIdx].trim()) : undefined,
    });
  }

  return {
    sourceId,
    records,
    rejectedCount,
    reasons,
  };
}

/**
 * Source-specific parser for Canada SEMA Consolidated Sanctions CSV
 */
export function parseSemaCsv(rawCsv: string, sourceId = 'CA_SEMA'): ParsedSourceFeed {
  const lines = rawCsv.split(/\r?\n/).filter(Boolean);
  if (lines.length <= 1) {
    return { sourceId, records: [], rejectedCount: 0, reasons: ['CSV empty or header only.'] };
  }

  const headers = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const itemIdx = headers.findIndex((h) => h === 'item');
  const countryIdx = headers.findIndex((h) => h === 'country');
  const nameIdx = headers.findIndex((h) => h === 'name');
  const aliasIdx = headers.findIndex((h) => h === 'aliases');
  const scheduleIdx = headers.findIndex((h) => h === 'schedule');

  if (nameIdx === -1) {
    throw new Error('Invalid SEMA CSV: Missing "Name" header column.');
  }

  const records: SourceRecord[] = [];
  const reasons: string[] = [];
  let rejectedCount = 0;
  const seenIds = new Set<string>();

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols = parseCsvLine(line);
    const rawName = cols[nameIdx]?.trim();
    if (!rawName) {
      rejectedCount++;
      reasons.push(`Row ${i + 1}: Missing name.`);
      continue;
    }

    const item = (itemIdx >= 0 && cols[itemIdx]?.trim()) ? cols[itemIdx].trim() : `sema_${i}`;
    const recordId = `${sourceId}:${item}`;
    if (seenIds.has(recordId)) {
      rejectedCount++;
      reasons.push(`Duplicate SEMA item: ${item}`);
      continue;
    }
    seenIds.add(recordId);

    const aliases = (aliasIdx >= 0 && cols[aliasIdx]?.trim())
      ? cols[aliasIdx].split(/[;|]/).map((a) => sanitizeString(a.trim())).filter(Boolean)
      : [];

    records.push({
      id: recordId,
      sourceId,
      providerRecordId: item,
      name: sanitizeString(rawName),
      aliases,
      entityType: 'ORGANIZATION', // SEMA lists individuals and entities, refined by name heuristic or payload
      identifiers: [],
      country: countryIdx >= 0 && cols[countryIdx]?.trim() ? sanitizeString(cols[countryIdx].trim()) : undefined,
      programs: scheduleIdx >= 0 && cols[scheduleIdx]?.trim() ? [cols[scheduleIdx].trim()] : [],
    });
  }

  return {
    sourceId,
    records,
    rejectedCount,
    reasons,
  };
}

