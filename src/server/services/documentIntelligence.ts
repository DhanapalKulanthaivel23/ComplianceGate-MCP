/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { EvaluateTradeRequest, evaluateTradeAndCargo } from './modules/tradeAndCargoService.ts';
import { EvaluateAirCargoRequest, evaluateAirCargo } from './modules/airCargoService.ts';
import { EvaluateHealthcareRequest, evaluateHealthcareClaim } from './modules/healthcareService.ts';
import { EvaluateInsuranceRequest, evaluateInsurancePolicy } from './modules/insuranceService.ts';
import {
  AirCargoEvaluation,
  HealthcareEvaluation,
  InsuranceEvaluation,
  TradeAndCargoEvaluation,
} from '../../shared/types.ts';

export interface ExtractedDocumentBundle {
  documentFormat: 'PDF_STREAM' | 'OCR_TEXT' | 'UN_EDIFACT' | 'IATA_CARGO_IMP_FWB';
  extractionConfidence: number;
  extractedFieldsCount: number;
  warnings: string[];
}

/**
 * Extracts readable text streams from a raw PDF buffer/string (%PDF-1.x ... BT (...) Tj ET)
 * or returns normalized OCR/plain text.
 */
export function extractTextFromPdfOrOcr(input: string | Buffer): {
  text: string;
  detectedFormat: 'PDF_STREAM' | 'OCR_TEXT';
} {
  const raw = Buffer.isBuffer(input) ? input.toString('latin1') : String(input || '');
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('Empty document payload provided to Document Intelligence extractor.');
  }

  if (trimmed.startsWith('%PDF-')) {
    const fragments: string[] = [];
    // Extract literal strings inside PDF text objects (...) Tj / TJ
    for (const m of trimmed.matchAll(/\(([^()\\]*(?:\\.[^()\\]*)*)\)\s*(?:Tj|'|")?/g)) {
      const decoded = m[1]
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, ' ')
        .replace(/\\\(/g, '(')
        .replace(/\\\)/g, ')')
        .replace(/\\\\/g, '\\');
      if (decoded.trim().length > 0) {
        fragments.push(decoded.trim());
      }
    }
    const joined = fragments.join('\n');
    if (joined.length === 0) {
      throw new Error('PDF document contains no extractable text streams and no OCR layer.');
    }
    return { text: joined, detectedFormat: 'PDF_STREAM' };
  }

  return { text: trimmed, detectedFormat: 'OCR_TEXT' };
}

function matchField(text: string, patterns: RegExp[], fallback = ''): string {
  for (const re of patterns) {
    const m = text.match(re);
    if (m && m[1] && m[1].trim()) {
      return m[1].trim();
    }
  }
  return fallback;
}

function parseNumeric(val: string, fallback = 0): number {
  if (!val) return fallback;
  const cleaned = val.replace(/,/g, '').replace(/[^0-9.]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? fallback : num;
}

/**
 * Parses unstructured PDF/OCR text or UN/EDIFACT INVOIC/IFTMIN into an EvaluateTradeRequest.
 */
export function parseRawTradeDocuments(params: {
  invoiceRaw: string | Buffer;
  billOfLadingRaw: string | Buffer;
  packingListRaw?: string | Buffer;
  paymentRaw?: string;
}): { tradeRequest: EvaluateTradeRequest; metadata: ExtractedDocumentBundle } {
  const invExtracted = extractTextFromPdfOrOcr(params.invoiceRaw);
  const blExtracted = extractTextFromPdfOrOcr(params.billOfLadingRaw);
  const invText = invExtracted.text;
  const blText = blExtracted.text;
  const warnings: string[] = [];

  // Check if invoiceRaw is UN/EDIFACT INVOIC
  const isEdifact = /UNH\+[^+]*\+INVOIC/i.test(invText) || /BGM\+380\+/i.test(invText);

  let invoiceNumber = '';
  let invoiceDate = new Date().toISOString().slice(0, 10);
  let sellerName = '';
  let sellerCountry = 'DE';
  let buyerName = '';
  let buyerCountry = 'AE';
  let currency = 'USD';
  let totalAmount = 0;
  let invPol: string | undefined;
  let invPod: string | undefined;
  const lineItems: EvaluateTradeRequest['invoice']['lineItems'] = [];

  if (isEdifact) {
    invoiceNumber = matchField(invText, [/BGM\+380\+([^+'"]+)/i], 'EDI-INV-001');
    sellerName = matchField(invText, [/NAD\+SE\+[^+]*\+([^+']+)/i], 'Unknown Seller');
     sellerCountry = matchField(invText, [/NAD\+SE\+[^+]*\+[^+']*?\+([A-Z]{2})'/i], 'DE');
    buyerName = matchField(invText, [/NAD\+BY\+[^+]*\+([^+']+)/i], 'Unknown Buyer');
    buyerCountry = matchField(invText, [/NAD\+BY\+[^+]*\+[^+']*?\+([A-Z]{2})'/i], 'AE');
    const moaMatch = invText.match(/MOA\+(?:77|86|9):([0-9.]+):?([A-Z]{3})?/i);
    if (moaMatch) {
      totalAmount = parseNumeric(moaMatch[1]);
      currency = moaMatch[2] || 'USD';
    }
    invPol = matchField(invText, [/LOC\+9\+([^+']+)/i]) || undefined;
    invPod = matchField(invText, [/LOC\+11\+([^+']+)/i]) || undefined;
    for (const lin of invText.matchAll(/IMD\+F\+\+:::([^+']+)'(?:\s*PIA\+[^+]*\+([0-9]{4,10}))?/gi)) {
      lineItems.push({
        description: lin[1].trim(),
        hsCode: lin[2]?.trim(),
        quantity: 1,
        unitPrice: totalAmount,
        amount: totalAmount,
      });
    }
  } else {
    invoiceNumber = matchField(invText, [
      /Invoice\s*(?:No|Number|#)\s*[:.-]?\s*([A-Z0-9_-]+)/i,
      /INV\s*[:#]\s*([A-Z0-9_-]+)/i,
    ]);
    invoiceDate = matchField(invText, [/Date\s*[:.-]?\s*(\d{4}-\d{2}-\d{2})/i], invoiceDate);
    sellerName = matchField(invText, [/(?:Seller|Exporter|Vendor|Shipper)\s*[:.-]\s*([^\r\n]+)/i]);
    sellerCountry = matchField(invText, [/(?:Seller|Exporter)\s*Country\s*[:.-]\s*([A-Za-z\s]{2,})/i], 'DE');
    buyerName = matchField(invText, [/(?:Buyer|Importer|Consignee|Sold\s*To)\s*[:.-]\s*([^\r\n]+)/i]);
    buyerCountry = matchField(invText, [/(?:Buyer|Importer)\s*Country\s*[:.-]\s*([A-Za-z\s]{2,})/i], 'AE');
    invPol = matchField(invText, [/Port\s*of\s*Loading\s*[:.-]\s*([^\r\n]+)/i]) || undefined;
    invPod = matchField(invText, [/Port\s*of\s*Discharge\s*[:.-]\s*([^\r\n]+)/i]) || undefined;

    const totalMatch = invText.match(/(?:Total\s*Amount|Invoice\s*Total|Total)\s*[:.-]?\s*([A-Z]{3})\s*([0-9,]+(?:\.[0-9]{1,2})?)/i);
    if (totalMatch) {
      currency = totalMatch[1].toUpperCase();
      totalAmount = parseNumeric(totalMatch[2]);
    }

    // Extract line items with HS codes (e.g., "HS: 8401.20 | Gas Centrifuge Rotor | Qty: 4 | Unit: 120000 | Amount: 480000")
    for (const line of invText.split(/\r?\n/)) {
      const hsMatch = line.match(/\bHS(?:\s*Code)?\s*[:#-]?\s*(\d{4}(?:\.?\d{2,6})?)/i);
      if (hsMatch) {
        const hsCode = hsMatch[1].replace(/\./g, '');
        const desc =
          matchField(line, [/(?:Item|Description|Desc)\s*[:.-]\s*([^|;\r\n]+)/i]) ||
          line.replace(hsMatch[0], '').replace(/[|;]/g, ' ').trim();
        const qty = parseNumeric(matchField(line, [/Qty\s*[:.-]?\s*([0-9,]+)/i]), 1);
        const amt = parseNumeric(matchField(line, [/(?:Amount|Subtotal)\s*[:.-]?\s*[A-Z]{0,3}\s*([0-9,]+(?:\.[0-9]+)?)/i]), totalAmount);
        lineItems.push({
          description: desc,
          hsCode,
          quantity: qty,
          unitPrice: qty > 0 ? amt / qty : amt,
          amount: amt,
        });
      }
    }
  }

  if (lineItems.length === 0) {
    const fallbackDesc = matchField(invText, [/(?:Goods|Description|Commodity)\s*[:.-]\s*([^\r\n]+)/i], 'General Commercial Goods');
    const fallbackHs = matchField(invText, [/\b(\d{6,8})\b/]);
    lineItems.push({
      description: fallbackDesc,
      hsCode: fallbackHs || undefined,
      quantity: 1,
      unitPrice: totalAmount,
      amount: totalAmount,
    });
  }

  // Parse Bill of Lading (B/L)
  const blNumber = matchField(blText, [
    /(?:B\/L|Bill\s*of\s*Lading)\s*(?:No|Number|#)?\s*[:.-]\s*([A-Z0-9_-]+)/i,
    /BL#\s*([A-Z0-9_-]+)/i,
  ]);
  const carrierName = matchField(blText, [/Carrier\s*[:.-]\s*([^\r\n]+)/i], 'Ocean Carrier Line');
  const blShipper = matchField(blText, [/Shipper\s*[:.-]\s*([^\r\n]+)/i], sellerName);
  const blConsignee = matchField(blText, [/Consignee\s*[:.-]\s*([^\r\n]+)/i], buyerName);
  const notifyParty = matchField(blText, [/Notify\s*Party\s*[:.-]\s*([^\r\n]+)/i]) || undefined;
  const blPol = matchField(blText, [/Port\s*of\s*Loading\s*[:.-]\s*([^\r\n]+)/i], invPol || 'Hamburg');
  const blPod = matchField(blText, [/Port\s*of\s*Discharge\s*[:.-]\s*([^\r\n]+)/i], invPod || 'Jebel Ali');
  const vesselName = matchField(blText, [/Vessel(?:\s*Name)?\s*[:.-]\s*([^\r\n]+)/i]) || undefined;
  const grossWeightKg = parseNumeric(
    matchField(blText, [/Gross\s*Weight\s*[:.-]?\s*([0-9,]+(?:\.[0-9]+)?)\s*(?:KG|KGS)?/i]),
    1000
  );
  const cargoDescription = matchField(
    blText,
    [/(?:Cargo\s*Description|Description\s*of\s*Goods)\s*[:.-]\s*([^\r\n]+)/i],
    lineItems[0]?.description || 'Containerized Cargo'
  );

  if (!invoiceNumber || !sellerName || !buyerName || !blNumber) {
    throw new Error(
      'Document extraction failed: mandatory fields (Invoice Number, Seller, Buyer, or B/L Number) could not be extracted from unstructured payload.'
    );
  }

  let packingList: EvaluateTradeRequest['packingList'] | undefined;
  if (params.packingListRaw) {
    const plText = extractTextFromPdfOrOcr(params.packingListRaw).text;
    const plNum = matchField(plText, [/Packing\s*List\s*(?:No|Number|#)?\s*[:.-]\s*([A-Z0-9_-]+)/i], `PL-${invoiceNumber}`);
    const plGross = parseNumeric(matchField(plText, [/(?:Total\s*)?Gross\s*Weight\s*[:.-]?\s*([0-9,]+(?:\.[0-9]+)?)/i]), grossWeightKg);
    const plNet = parseNumeric(matchField(plText, [/(?:Total\s*)?Net\s*Weight\s*[:.-]?\s*([0-9,]+(?:\.[0-9]+)?)/i]), plGross * 0.9);
    const pkgCount = parseNumeric(matchField(plText, [/(?:Packages|Cartons|Pieces)\s*[:.-]?\s*([0-9,]+)/i]), 10);
    packingList = {
      packingListNumber: plNum,
      totalGrossWeightKg: plGross,
      totalNetWeightKg: plNet,
      packageCount: pkgCount,
    };
  }

  const tradeRequest: EvaluateTradeRequest = {
    invoice: {
      invoiceNumber,
      date: invoiceDate,
      sellerName,
      sellerCountry,
      buyerName,
      buyerCountry,
      totalAmount,
      currency,
      portOfLoading: invPol,
      portOfDischarge: invPod,
      lineItems,
    },
    billOfLading: {
      blNumber,
      blType: 'OCEAN_BILL_OF_LADING',
      carrierName,
      shipperName: blShipper,
      consigneeName: blConsignee,
      notifyPartyName: notifyParty,
      portOfLoading: blPol,
      portOfDischarge: blPod,
      vesselName,
      grossWeightKg,
      cargoDescription,
    },
    packingList,
  };

  return {
    tradeRequest,
    metadata: {
      documentFormat: isEdifact ? 'UN_EDIFACT' : invExtracted.detectedFormat,
      extractionConfidence: 0.96,
      extractedFieldsCount: 12 + lineItems.length,
      warnings,
    },
  };
}

/**
 * Parses IATA Cargo-IMP FWB (e.g. FWB/16\n176-49281702DXBFRA/T10K450.0...) or PDF/OCR Air Waybill text.
 */
export function parseRawAirWaybill(rawInput: string | Buffer): {
  airCargoRequest: EvaluateAirCargoRequest;
  metadata: ExtractedDocumentBundle;
} {
  const extracted = extractTextFromPdfOrOcr(rawInput);
  const text = extracted.text;
  const isFwb = /^FWB\/\d+/im.test(text);

  if (isFwb) {
    // IATA Cargo-IMP FWB standard format
    const awbMatch = text.match(/(\d{3}-\d{8})([A-Z]{3})([A-Z]{3})\/T(\d+)K([0-9.]+)/i);
    if (!awbMatch) {
      throw new Error('Malformed IATA Cargo-IMP FWB message: missing AWB header line (e.g. 176-49281702DXBFRA/T10K450.0).');
    }
    const awbNumber = awbMatch[1];
    const originAirport = awbMatch[2].toUpperCase();
    const destinationAirport = awbMatch[3].toUpperCase();
    const piecesCount = parseInt(awbMatch[4], 10) || 1;
    const grossWeightKg = parseFloat(awbMatch[5]) || 100;

    const rtgMatch = text.match(/RTG\/([A-Z]{3})/i);
    const transitAirports = rtgMatch ? [rtgMatch[1].toUpperCase()] : [];

    const shpName = matchField(text, [/SHP[\s\S]*?\/([^\r\n/]+)/i], 'Unknown Shipper');
    const shpCountry = matchField(text, [/SHP[\s\S]*?\/([A-Z]{2})(?:\r|\n|$)/i], 'AE');
    const cneName = matchField(text, [/CNE[\s\S]*?\/([^\r\n/]+)/i], 'Unknown Consignee');
    const cneCountry = matchField(text, [/CNE[\s\S]*?\/([A-Z]{2})(?:\r|\n|$)/i], 'DE');
    const desc = matchField(text, [/(?:NG|NC)\/([^\r\n/]+)/i, /SSR\/([^\r\n]+)/i], 'Air Freight Consignment');
    const hsCode = matchField(text, [/NH\/(\d{4,10})/i]) || undefined;

    return {
      airCargoRequest: {
        awbNumber,
        originAirport,
        destinationAirport,
        transitAirports,
        shipper: { name: shpName, country: shpCountry },
        consignee: { name: cneName, country: cneCountry },
        cargo: {
          description: desc,
          grossWeightKg,
          piecesCount,
          declaredHsCode: hsCode,
          isHazardous: /DGR|HAZ/i.test(text),
        },
      },
      metadata: {
        documentFormat: 'IATA_CARGO_IMP_FWB',
        extractionConfidence: 0.98,
        extractedFieldsCount: 9,
        warnings: [],
      },
    };
  }

  // PDF/OCR Air Waybill extraction
  const awbNumber = matchField(text, [/AWB\s*(?:No|Number|#)?\s*[:.-]?\s*(\d{3}-?\d{8})/i]);
  const originAirport = matchField(text, [/Origin(?:\s*Airport)?\s*[:.-]?\s*([A-Z]{3})/i]);
  const destinationAirport = matchField(text, [/Destination(?:\s*Airport)?\s*[:.-]?\s*([A-Z]{3})/i]);
  if (!awbNumber || !originAirport || !destinationAirport) {
    throw new Error('Air Waybill extraction failed: missing AWB Number, Origin Airport, or Destination Airport.');
  }

  const transitStr = matchField(text, [/(?:Transit|Routing|Via)\s*[:.-]?\s*([A-Z,\s]+)/i]);
  const transitAirports = transitStr
    ? transitStr
        .split(/[,\s]+/)
        .map((s) => s.trim().toUpperCase())
        .filter((s) => /^[A-Z]{3}$/.test(s))
    : [];

  const shipperName = matchField(text, [/Shipper\s*[:.-]\s*([^\r\n]+)/i], 'Unknown Shipper');
  const consigneeName = matchField(text, [/Consignee\s*[:.-]\s*([^\r\n]+)/i], 'Unknown Consignee');
  const description = matchField(text, [/(?:Cargo|Nature\s*of\s*Goods|Description)\s*[:.-]\s*([^\r\n]+)/i], 'Air Cargo');
  const grossWeightKg = parseNumeric(matchField(text, [/Gross\s*Weight\s*[:.-]?\s*([0-9,]+(?:\.[0-9]+)?)/i]), 100);
  const piecesCount = parseNumeric(matchField(text, [/Pieces\s*[:.-]?\s*([0-9]+)/i]), 1);
  const declaredHsCode = matchField(text, [/HS\s*(?:Code)?\s*[:.-]?\s*(\d{4,10})/i]) || undefined;

  return {
    airCargoRequest: {
      awbNumber,
      originAirport,
      destinationAirport,
      transitAirports,
      shipper: { name: shipperName, country: 'AE' },
      consignee: { name: consigneeName, country: 'DE' },
      cargo: {
        description,
        grossWeightKg,
        piecesCount,
        declaredHsCode,
        isHazardous: /Dangerous\s*Goods\s*:\s*Yes|HAZARDOUS/i.test(text),
      },
    },
    metadata: {
      documentFormat: extracted.detectedFormat,
      extractionConfidence: 0.95,
      extractedFieldsCount: 9,
      warnings: [],
    },
  };
}

/**
 * Parses ASC X12 837 EDI Healthcare Claim messages into EvaluateHealthcareRequest.
 */
export function parseX12HealthcareClaim(rawX12: string): EvaluateHealthcareRequest {
  const clean = (rawX12 || '').trim();
  if (!clean.includes('CLM*') && !clean.includes('NM1*')) {
    throw new Error('Malformed ASC X12 837 claim: missing mandatory CLM or NM1 segments.');
  }
  const clmMatch = clean.match(/CLM\*([^*~]+)\*([0-9.]+)/i);
  const claimId = clmMatch ? clmMatch[1].trim() : `X12-CLM-${Date.now()}`;
  const billedAmount = clmMatch ? parseFloat(clmMatch[2]) || 0 : 0;

  // NM1*82*1*LastName*FirstName****XX*NPI~ (Rendering Provider)
  const prvMatch = clean.match(/NM1\*(?:82|85)\*[12]\*([^*~]+)\*([^*~]*)\*[^*~]*\*[^*~]*\*[^*~]*\*XX\*([0-9]{10})/i);
  const deaMatch = clean.match(/REF\*0B\*([A-Z]{2}[0-9]{7})/i) || clean.match(/REF\*G2\*([A-Z]{2}[0-9]{7})/i);

  return {
    claimId,
    serviceDate: new Date().toISOString().slice(0, 10),
    billedAmount,
    practitioner: prvMatch
      ? {
          name: [prvMatch[2], prvMatch[1]].filter(Boolean).join(' ').trim(),
          npi: prvMatch[3],
          deaNumber: deaMatch ? deaMatch[1] : undefined,
          specialty: 'Healthcare Provider (X12 837)',
        }
      : undefined,
  };
}

/**
 * Parses ACORD XML Insurance Policy messages into EvaluateInsuranceRequest.
 */
export function parseAcordInsuranceXml(rawXml: string): EvaluateInsuranceRequest {
  if (/<!DOCTYPE/i.test(rawXml) || /<!ENTITY/i.test(rawXml)) {
    throw new Error('Security violation: ACORD XML contains prohibited DOCTYPE/ENTITY.');
  }
  const polNum = matchField(rawXml, [/<PolicyNumber>([^<]+)<\/PolicyNumber>/i], `ACORD-${Date.now()}`);
  const amtStr = matchField(rawXml, [/<LimitAmt>([^<]+)<\/LimitAmt>/i, /<SumInsured>([^<]+)<\/SumInsured>/i], '1000000');
  const ccy = matchField(rawXml, [/<CurCd>([A-Z]{3})<\/CurCd>/i], 'USD');
  const insuredName = matchField(rawXml, [/<InsuredOrPrincipal[\s\S]*?<CommlName>([^<]+)<\/CommlName>/i, /<InsuredName>([^<]+)<\/InsuredName>/i]);
  if (!insuredName) {
    throw new Error('Malformed ACORD XML: missing <InsuredName> or <InsuredOrPrincipal><CommlName>.');
  }

  const beneficialOwners: NonNullable<EvaluateInsuranceRequest['corporateEntityUbo']>['beneficialOwners'] = [];
  for (const m of rawXml.matchAll(/<BeneficialOwner>\s*<Name>([^<]+)<\/Name>\s*<OwnershipPct>([0-9.]+)<\/OwnershipPct>\s*<Country>([^<]+)<\/Country>\s*<\/BeneficialOwner>/gi)) {
    beneficialOwners.push({
      name: m[1].trim(),
      ownershipPercentage: parseFloat(m[2]) || 0,
      country: m[3].trim(),
    });
  }

  return {
    policyNumber: polNum,
    lineOfBusiness: 'MARINE_HULL_AND_CARGO',
    sumInsured: parseNumeric(amtStr, 1000000),
    currency: ccy,
    screeningStage: 'PRE_BIND_UNDERWRITING',
    policyParties: [
      {
        role: 'PRIMARY_INSURED',
        name: insuredName,
        entityType: 'ORGANIZATION',
        country: 'DE',
      },
    ],
    corporateEntityUbo:
      beneficialOwners.length > 0
        ? {
            entityName: insuredName,
            beneficialOwners,
          }
        : undefined,
  };
}

export function extractStructuredTradeDocument(
  documentType: 'INVOICE' | 'BILL_OF_LADING' | 'PACKING_LIST',
  rawInput: string | Buffer
) {
  const extracted = extractTextFromPdfOrOcr(rawInput);
  const text = extracted.text;
  const isEdifact = text.includes('UNB+') || text.includes('BGM+');

  if (isEdifact) {
    const docId = matchField(text, [/BGM\+\d+\+([^+'":]+)/i], `EDI-${Date.now()}`);
    const exporterName = matchField(text, [/NAD\+(?:SE|CZ)\+[^+]*\+\+([^+':]+)/i], 'UNKNOWN_EXPORTER');
    const exporterCountry = matchField(text, [/NAD\+(?:SE|CZ)\+[^\r\n']*?\+([A-Z]{2})'/i], 'XX');
    const importerName = matchField(text, [/NAD\+(?:BY|CN)\+[^+]*\+\+([^+':]+)/i], 'UNKNOWN_IMPORTER');
    const importerCountry = matchField(text, [/NAD\+(?:BY|CN)\+[^\r\n']*?\+([A-Z]{2})'/i], 'XX');
    const vesselName = matchField(text, [/TDT\+20\+[^']*?\+::([^+']+)/i]) || undefined;
    const pol = matchField(text, [/LOC\+9\+([^+':]+)/i], 'UNKNOWN');
    const pod = matchField(text, [/LOC\+11\+([^+':]+)/i], 'UNKNOWN');
    const hsCode = matchField(text, [/LIN\+\d+\+\+([0-9.]+):HS/i], '0000.00');
    const goodsDesc = matchField(text, [/IMD\+F\+\+:::([^+']+)/i], 'Trade Goods');
    const weight = parseNumeric(matchField(text, [/MEA\+AAE\+G\+KGM:([0-9.]+)/i]), 0);
    const moaMatch = text.match(/MOA\+\d+:([0-9.]+):([A-Z]{3})/i);

    return {
      documentType,
      documentId: docId,
      exporterName,
      exporterCountry,
      importerName,
      importerCountry,
      vesselName,
      portOfLoading: pol,
      portOfDischarge: pod,
      totalAmount: moaMatch ? parseFloat(moaMatch[1]) : 0,
      currency: moaMatch ? moaMatch[2] : 'USD',
      grossWeightKg: weight,
      goods: [{ hsCode, description: goodsDesc }],
      extractionFormat: 'EDIFACT' as const,
      extractionConfidence: 0.96,
    };
  }

  const documentId = matchField(
    text,
    [
      /(?:Document|Invoice|B\/L|Packing\s*List)\s*(?:ID|No|Number|#)?\s*[:.-]\s*([A-Z0-9_-]+)/i,
    ],
    `DOC-${Date.now()}`
  );
  const exporterName = matchField(text, [/(?:Exporter|Seller|Shipper)\s*[:.-]\s*([^\r\n]+)/i], 'UNKNOWN_EXPORTER');
  const importerName = matchField(text, [/(?:Importer|Buyer|Consignee)\s*[:.-]\s*([^\r\n]+)/i], 'UNKNOWN_IMPORTER');
  const exporterCountry = matchField(text, [/(?:Origin|Exporter)\s*Country\s*[:.-]\s*([A-Z]{2})/i], 'XX');
  const importerCountry = matchField(text, [/(?:Destination|Importer)\s*Country\s*[:.-]\s*([A-Z]{2})/i], 'XX');
  const vesselName = matchField(text, [/Vessel(?:\s*Name)?\s*[:.-]\s*([^\r\n]+)/i]) || undefined;
  const vesselImo = matchField(text, [/IMO\s*[:.-]?\s*(\d{7})/i]) || undefined;
  const portOfLoading = matchField(text, [/Port\s*of\s*Loading\s*[:.-]\s*([^\r\n]+)/i], 'UNKNOWN');
  const portOfDischarge = matchField(text, [/Port\s*of\s*Discharge\s*[:.-]\s*([^\r\n]+)/i], 'UNKNOWN');
  const hsMatch = text.match(/HS\s*(?:Code)?\s*[:.-]?\s*(\d{4}(?:\.\d{2})?)\s*[-–:]?\s*([^\r\n]*)/i);
  const amtMatch = text.match(/Total\s*Amount\s*[:.-]?\s*([A-Z]{3})\s*([0-9,]+(?:\.[0-9]+)?)/i);
  const grossWeightKg = parseNumeric(matchField(text, [/Gross\s*Weight\s*[:.-]?\s*([0-9,]+(?:\.[0-9]+)?)/i]), 0);

  return {
    documentType,
    documentId,
    exporterName,
    exporterCountry,
    importerName,
    importerCountry,
    vesselName,
    vesselImo,
    portOfLoading,
    portOfDischarge,
    totalAmount: amtMatch ? parseNumeric(amtMatch[2], 0) : 0,
    currency: amtMatch ? amtMatch[1] : 'USD',
    grossWeightKg,
    goods: hsMatch
      ? [{ hsCode: hsMatch[1], description: hsMatch[2].trim() || 'Commercial Goods' }]
      : [],
    extractionFormat: extracted.detectedFormat === 'PDF_STREAM' ? ('PDF_STREAM' as const) : ('OCR_TEXT' as const),
    extractionConfidence: extracted.detectedFormat === 'PDF_STREAM' ? 0.94 : 0.88,
  };
}

export function extractStructuredAirWaybill(rawInput: string | Buffer) {
  const { airCargoRequest, metadata } = parseRawAirWaybill(rawInput);
  const rawText = typeof rawInput === 'string' ? rawInput : rawInput.toString('utf-8');
  const hsFallback = matchField(rawText, [/\/HS\/([0-9.]+)/i, /NH\/([0-9.]+)/i]) || airCargoRequest.cargo.declaredHsCode || '0000.00';
  return {
    awbNumber: airCargoRequest.awbNumber,
    shipperName: airCargoRequest.shipper.name,
    shipperCountry: airCargoRequest.shipper.country,
    consigneeName: airCargoRequest.consignee.name,
    consigneeCountry: airCargoRequest.consignee.country,
    originAirport: airCargoRequest.originAirport,
    destinationAirport: airCargoRequest.destinationAirport,
    Routing: airCargoRequest.transitAirports,
    pieces: airCargoRequest.cargo.piecesCount,
    grossWeightKg: airCargoRequest.cargo.grossWeightKg,
    goodsDescription: airCargoRequest.cargo.description,
    hsCode: hsFallback,
    extractionFormat: metadata.documentFormat,
  };
}

export function extractX12HealthcareClaim(rawX12: string) {
  const req = parseX12HealthcareClaim(rawX12);
  const cptCodes: string[] = [];
  for (const m of rawX12.matchAll(/SV1\*HC:([0-9A-Z]+)/gi)) {
    cptCodes.push(m[1]);
  }
  const icd10Codes: string[] = [];
  for (const m of rawX12.matchAll(/HI\*ABK:([0-9A-Z.]+)/gi)) {
    icd10Codes.push(m[1]);
  }
  const patientMatch = rawX12.match(/NM1\*IL\*1\*([^*~]+)\*([^*~]*)/i);
  const payerMatch = rawX12.match(/NM1\*PR\*2\*([^*~]+)/i);
  return {
    claimId: req.claimId,
    providerName: req.practitioner?.name || 'UNKNOWN_PROVIDER',
    providerNpi: req.practitioner?.npi || '',
    providerDea: req.practitioner?.deaNumber,
    patientName: patientMatch ? `${patientMatch[2]} ${patientMatch[1]}`.trim() : 'UNKNOWN_PATIENT',
    payerName: payerMatch ? payerMatch[1].trim() : 'UNKNOWN_PAYER',
    cptCodes,
    icd10Codes,
    totalChargeAmount: req.billedAmount,
    currency: 'USD',
  };
}

export function extractAcordInsurancePolicy(rawXml: string) {
  if (/<!DOCTYPE/i.test(rawXml) || /<!ENTITY/i.test(rawXml)) {
    throw new Error('Security violation: ACORD XML contains prohibited DOCTYPE/ENTITY.');
  }
  const policyId = matchField(rawXml, [/<PolicyNumber>([^<]+)<\/PolicyNumber>/i], `POL-${Date.now()}`);
  const policyType = matchField(rawXml, [/<PolicyType>([^<]+)<\/PolicyType>/i, /<LOBCd>([^<]+)<\/LOBCd>/i], 'MARINE_HULL_AND_CARGO');
  const policyholderName = matchField(
    rawXml,
    [
      /<CommercialName>([^<]+)<\/CommercialName>/i,
      /<CommlName>([^<]+)<\/CommlName>/i,
      /<InsuredName>([^<]+)<\/InsuredName>/i,
    ],
    'UNKNOWN_INSURED'
  );
  const policyholderCountry = matchField(rawXml, [/<InsuredOrPrincipal[\s\S]*?<Country>([A-Z]{2})<\/Country>/i], 'XX');
  const beneficiaryName = matchField(rawXml, [/<Beneficiary>[\s\S]*?<Name>([^<]+)<\/Name>/i], 'NONE');
  const beneficiaryCountry = matchField(rawXml, [/<Beneficiary>[\s\S]*?<Country>([A-Z]{2})<\/Country>/i], 'XX');
  const amtStr = matchField(rawXml, [/<InsuredAmt>[\s\S]*?<Amt>([0-9.]+)<\/Amt>/i, /<LimitAmt>([0-9.]+)<\/LimitAmt>/i], '0');
  const currency = matchField(rawXml, [/<CurCd>([A-Z]{3})<\/CurCd>/i], 'USD');
  return {
    policyId,
    policyType,
    policyholderName,
    policyholderCountry,
    beneficiaryName,
    beneficiaryCountry,
    insuredAmount: parseNumeric(amtStr, 0),
    currency,
  };
}

export function ingestAndEvaluateTradeDocuments(params: {
  invoiceRaw: string | Buffer;
  billOfLadingRaw: string | Buffer;
  packingListRaw?: string | Buffer;
}): { evaluation: TradeAndCargoEvaluation; extractedRequest: EvaluateTradeRequest; metadata: ExtractedDocumentBundle } {
  const { tradeRequest, metadata } = parseRawTradeDocuments(params);
  const evaluation = evaluateTradeAndCargo(tradeRequest);
  return { evaluation, extractedRequest: tradeRequest, metadata };
}

export function ingestAndEvaluateAirWaybill(rawInput: string | Buffer): {
  evaluation: AirCargoEvaluation;
  extractedRequest: EvaluateAirCargoRequest;
  metadata: ExtractedDocumentBundle;
} {
  const { airCargoRequest, metadata } = parseRawAirWaybill(rawInput);
  const evaluation = evaluateAirCargo(airCargoRequest);
  return { evaluation, extractedRequest: airCargoRequest, metadata };
}

export function ingestAndEvaluateX12HealthcareClaim(rawX12: string): HealthcareEvaluation {
  const req = parseX12HealthcareClaim(rawX12);
  return evaluateHealthcareClaim(req);
}

export function ingestAndEvaluateAcordPolicy(rawXml: string): InsuranceEvaluation {
  const req = parseAcordInsuranceXml(rawXml);
  return evaluateInsurancePolicy(req);
}
