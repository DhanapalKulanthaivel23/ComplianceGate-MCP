/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import {
  TradeAndCargoEvaluation,
  TradeDiscrepancy,
  DualUseGoodHit,
  FindingSeverity,
  CanonicalParty,
  TradeScreenedParty,
} from '../../../shared/types.ts';
import { embeddedSyntheticEngine } from '../engineAdapter.ts';
import { createHash } from 'node:crypto';

export interface EvaluateTradeRequest {
  tenantId?: string;
  invoice: {
    invoiceNumber: string;
    date: string;
    sellerName: string;
    sellerCountry: string;
    buyerName: string;
    buyerCountry: string;
    totalAmount: number;
    currency: string;
    portOfLoading?: string;
    portOfDischarge?: string;
    lineItems: {
      description: string;
      hsCode?: string;
      quantity: number;
      unitPrice: number;
      amount: number;
    }[];
  };
  billOfLading: {
    blNumber: string;
    blType: 'OCEAN_BILL_OF_LADING' | 'SEA_WAYBILL' | 'MULTIMODAL_BL';
    carrierName: string;
    shipperName: string;
    consigneeName: string;
    notifyPartyName?: string;
    portOfLoading: string;
    portOfDischarge: string;
    vesselName?: string;
    grossWeightKg: number;
    cargoDescription: string;
  };
  packingList?: {
    packingListNumber: string;
    totalGrossWeightKg: number;
    totalNetWeightKg: number;
    packageCount: number;
    cargoDescription?: string;
  };
  paymentInstruction?: {
    paymentRef: string;
    amount: number;
    currency: string;
    remitterName: string;
    beneficiaryName: string;
  };
}

// Known dual-use HS code prefixes and controlled keywords
const CONTROLLED_HS_PREFIXES: Record<string, { category: DualUseGoodHit['proliferationCategory']; eccn: string; desc: string }> = {
  '8401': { category: 'NUCLEAR', eccn: '0A001', desc: 'Nuclear reactors & fuel elements' },
  '2844': { category: 'NUCLEAR', eccn: '0C001', desc: 'Radioactive isotopes and compounds' },
  '8542': { category: 'ELECTRONICS_DUAL_USE', eccn: '3A001', desc: 'Advanced electronic integrated circuits & microprocessors' },
  '8806': { category: 'MILITARY_EQUIPMENT', eccn: '9A012', desc: 'Unmanned aerial vehicles (UAVs / drones)' },
  '9013': { category: 'ELECTRONICS_DUAL_USE', eccn: '6A005', desc: 'Laser and optical sensor equipment' },
  '2804': { category: 'CHEMICAL_BIOLOGICAL', eccn: '1C350', desc: 'Specialized chemical precursors' },
};

const DUAL_USE_KEYWORDS = [
  { keyword: 'centrifuge', category: 'NUCLEAR' as const, eccn: '0B001' },
  { keyword: 'heavy water', category: 'NUCLEAR' as const, eccn: '0C002' },
  { keyword: 'guidance system', category: 'MISSILE_TECH' as const, eccn: '7A003' },
  { keyword: 'accelerometer', category: 'MISSILE_TECH' as const, eccn: '7A001' },
  { keyword: 'drone', category: 'MILITARY_EQUIPMENT' as const, eccn: '9A012' },
  { keyword: 'night vision', category: 'MILITARY_EQUIPMENT' as const, eccn: '6A002' },
  { keyword: 'cryptographic module', category: 'ELECTRONICS_DUAL_USE' as const, eccn: '5A002' },
];

export function evaluateTradeAndCargo(req: EvaluateTradeRequest): TradeAndCargoEvaluation {
  // Input validation with actionable client errors
  if (!req || typeof req !== 'object') {
    throw new Error('Invalid trade evaluation request: request body must be a non-empty JSON object.');
  }
  if (!req.invoice || typeof req.invoice !== 'object') {
    throw new Error('Invalid trade evaluation request: missing mandatory "invoice" document object.');
  }
  if (!req.billOfLading || typeof req.billOfLading !== 'object') {
    throw new Error('Invalid trade evaluation request: missing mandatory "billOfLading" transport document object.');
  }

  const discrepancies: TradeDiscrepancy[] = [];
  const dualUseHits: DualUseGoodHit[] = [];
  const omittedComparisons: string[] = [];

  // Document presence tracking
  const hasPackingList = Boolean(req.packingList && typeof req.packingList === 'object');
  const hasPayment = Boolean(req.paymentInstruction && typeof req.paymentInstruction === 'object');

  // ---------------------------------------------------------------------------
  // 1. Mandatory Field & Country Validation
  // ---------------------------------------------------------------------------
  if (!req.invoice.sellerName || req.invoice.sellerName.trim() === '') {
    discrepancies.push({
      category: 'PARTY_MISMATCH',
      severity: 'CRITICAL',
      description: 'Invoice Seller/Exporter name is missing or blank. Trade parties cannot be screened.',
      sourceDoc: 'Commercial Invoice',
      comparedDoc: 'Mandatory Party Identity',
      sourceValue: 'EMPTY',
      comparedValue: 'MANDATORY_EXPORTER_NAME',
    });
  }

  if (!req.invoice.sellerCountry || req.invoice.sellerCountry === 'UNKNOWN' || req.invoice.sellerCountry.trim() === '') {
    discrepancies.push({
      category: 'MISSING_MANDATORY_DOC',
      severity: 'CRITICAL',
      description: 'Seller/Exporter country could not be established from trade presentation set.',
      sourceDoc: 'Commercial Invoice',
      comparedDoc: 'Jurisdiction Screening',
      sourceValue: req.invoice.sellerCountry || 'EMPTY',
      comparedValue: 'ISO_COUNTRY_CODE',
    });
  }

  if (!req.invoice.buyerName || req.invoice.buyerName.trim() === '') {
    discrepancies.push({
      category: 'PARTY_MISMATCH',
      severity: 'CRITICAL',
      description: 'Invoice Buyer/Importer name is missing or blank. Trade parties cannot be screened.',
      sourceDoc: 'Commercial Invoice',
      comparedDoc: 'Mandatory Party Identity',
      sourceValue: 'EMPTY',
      comparedValue: 'MANDATORY_IMPORTER_NAME',
    });
  }

  if (!req.invoice.buyerCountry || req.invoice.buyerCountry === 'UNKNOWN' || req.invoice.buyerCountry.trim() === '') {
    discrepancies.push({
      category: 'MISSING_MANDATORY_DOC',
      severity: 'CRITICAL',
      description: 'Buyer/Importer country could not be established from trade presentation set.',
      sourceDoc: 'Commercial Invoice',
      comparedDoc: 'Jurisdiction Screening',
      sourceValue: req.invoice.buyerCountry || 'EMPTY',
      comparedValue: 'ISO_COUNTRY_CODE',
    });
  }

  if (!req.invoice.currency || req.invoice.currency === 'UNKNOWN' || req.invoice.currency.trim() === '') {
    discrepancies.push({
      category: 'MISSING_MANDATORY_DOC',
      severity: 'CRITICAL',
      description: 'Commercial invoice currency could not be established from trade presentation set.',
      sourceDoc: 'Commercial Invoice',
      comparedDoc: 'Payment Valuation',
      sourceValue: req.invoice.currency || 'EMPTY',
      comparedValue: 'ISO_CURRENCY_CODE',
    });
  }

  if (!req.billOfLading.shipperName || req.billOfLading.shipperName.trim() === '') {
    discrepancies.push({
      category: 'PARTY_MISMATCH',
      severity: 'CRITICAL',
      description: 'Bill of Lading Shipper name is missing or blank.',
      sourceDoc: 'Bill of Lading',
      comparedDoc: 'Mandatory Party Identity',
      sourceValue: 'EMPTY',
      comparedValue: 'MANDATORY_SHIPPER_NAME',
    });
  }

  if (!req.billOfLading.consigneeName || req.billOfLading.consigneeName.trim() === '') {
    discrepancies.push({
      category: 'PARTY_MISMATCH',
      severity: 'CRITICAL',
      description: 'Bill of Lading Consignee name is missing or blank.',
      sourceDoc: 'Bill of Lading',
      comparedDoc: 'Mandatory Party Identity',
      sourceValue: 'EMPTY',
      comparedValue: 'MANDATORY_CONSIGNEE_NAME',
    });
  }

  if (!req.billOfLading.portOfLoading || req.billOfLading.portOfLoading === 'UNKNOWN' || req.billOfLading.portOfLoading.trim() === '') {
    discrepancies.push({
      category: 'PORT_INCONSISTENCY',
      severity: 'CRITICAL',
      description: 'Bill of Lading port of loading is missing or unspecified.',
      sourceDoc: 'Bill of Lading',
      comparedDoc: 'Maritime Routing',
      sourceValue: req.billOfLading.portOfLoading || 'EMPTY',
      comparedValue: 'VALID_PORT_NAME',
    });
  }

  if (!req.billOfLading.portOfDischarge || req.billOfLading.portOfDischarge === 'UNKNOWN' || req.billOfLading.portOfDischarge.trim() === '') {
    discrepancies.push({
      category: 'PORT_INCONSISTENCY',
      severity: 'CRITICAL',
      description: 'Bill of Lading port of discharge is missing or unspecified.',
      sourceDoc: 'Bill of Lading',
      comparedDoc: 'Maritime Routing',
      sourceValue: req.billOfLading.portOfDischarge || 'EMPTY',
      comparedValue: 'VALID_PORT_NAME',
    });
  }

  if (typeof req.billOfLading.grossWeightKg !== 'number' || !isFinite(req.billOfLading.grossWeightKg) || req.billOfLading.grossWeightKg <= 0) {
    discrepancies.push({
      category: 'WEIGHT_DISCREPANCY',
      severity: 'CRITICAL',
      description: `Bill of Lading cargo gross weight must be a positive finite number (got ${req.billOfLading.grossWeightKg} kg).`,
      sourceDoc: 'Bill of Lading',
      comparedDoc: 'Cargo Manifest',
      sourceValue: `${req.billOfLading.grossWeightKg} kg`,
      comparedValue: '>0 kg',
    });
  }

  // ---------------------------------------------------------------------------
  // 2. Numeric & Arithmetic Validation
  // ---------------------------------------------------------------------------
  if (typeof req.invoice.totalAmount !== 'number' || !isFinite(req.invoice.totalAmount) || req.invoice.totalAmount <= 0) {
    discrepancies.push({
      category: 'PRICE_OR_VALUE',
      severity: 'CRITICAL',
      description: `Commercial invoice total amount must be a positive finite number (got ${req.invoice.totalAmount}). Negative or zero totals are not permitted on commercial invoices.`,
      sourceDoc: 'Commercial Invoice',
      comparedDoc: 'Invoice Total',
      sourceValue: String(req.invoice.totalAmount),
      comparedValue: '> 0',
    });
  }

  const lineItems = Array.isArray(req.invoice.lineItems) ? req.invoice.lineItems : [];
  let calculatedLineSum = 0;
  for (let idx = 0; idx < lineItems.length; idx++) {
    const item = lineItems[idx];
    const desc = item.description || `Line Item #${idx + 1}`;

    if (typeof item.quantity !== 'number' || !isFinite(item.quantity) || item.quantity <= 0) {
      discrepancies.push({
        category: 'PRICE_OR_VALUE',
        severity: 'CRITICAL',
        description: `Line item "${desc}" has invalid quantity (${item.quantity}). Quantity must be a positive finite number.`,
        sourceDoc: 'Commercial Invoice Line Item',
        comparedDoc: 'Quantity Standards',
        sourceValue: String(item.quantity),
        comparedValue: '> 0',
      });
    }

    if (typeof item.unitPrice !== 'number' || !isFinite(item.unitPrice) || item.unitPrice <= 0) {
      discrepancies.push({
        category: 'PRICE_OR_VALUE',
        severity: 'CRITICAL',
        description: `Line item "${desc}" has invalid unit price (${item.unitPrice}). Unit price must be a positive finite number.`,
        sourceDoc: 'Commercial Invoice Line Item',
        comparedDoc: 'Unit Price Standards',
        sourceValue: String(item.unitPrice),
        comparedValue: '> 0',
      });
    }

    if (item.quantity > 0 && item.unitPrice > 0) {
      const expectedLineAmount = Math.round(item.quantity * item.unitPrice * 100) / 100;
      if (Math.abs(item.amount - expectedLineAmount) > 0.05) {
        discrepancies.push({
          category: 'PRICE_OR_VALUE',
          severity: 'CRITICAL',
          description: `Line item arithmetic discrepancy on "${desc}": stated amount is ${item.amount}, but quantity (${item.quantity}) × unit price (${item.unitPrice}) = ${expectedLineAmount.toFixed(2)}.`,
          sourceDoc: `Invoice Line #${idx + 1}`,
          comparedDoc: 'Calculated Line Total',
          sourceValue: String(item.amount),
          comparedValue: expectedLineAmount.toFixed(2),
        });
      }
    }

    calculatedLineSum += (item.amount || 0);
  }

  if (lineItems.length > 0 && req.invoice.totalAmount > 0) {
    if (Math.abs(calculatedLineSum - req.invoice.totalAmount) > 0.05) {
      discrepancies.push({
        category: 'PRICE_OR_VALUE',
        severity: 'CRITICAL',
        description: `Invoice line item sum (${calculatedLineSum.toFixed(2)}) does not match invoice total amount (${req.invoice.totalAmount.toFixed(2)}).`,
        sourceDoc: 'Line Items Sum',
        comparedDoc: 'Invoice Total Amount',
        sourceValue: calculatedLineSum.toFixed(2),
        comparedValue: req.invoice.totalAmount.toFixed(2),
      });
    }
  }

  // ---------------------------------------------------------------------------
  // 3. Cross-Document Discrepancy Analysis
  // ---------------------------------------------------------------------------

  // A. Price and Value Check (Invoice vs Payment)
  if (req.paymentInstruction) {
    // 1. Numerical amount check
    if (Math.abs(req.invoice.totalAmount - req.paymentInstruction.amount) > 0.01) {
      discrepancies.push({
        category: 'PRICE_OR_VALUE',
        severity: 'CRITICAL',
        description: `Amount mismatch between Commercial Invoice (${req.invoice.currency} ${req.invoice.totalAmount.toFixed(2)}) and Payment Instruction (${req.paymentInstruction.currency} ${req.paymentInstruction.amount.toFixed(2)})`,
        sourceDoc: `Invoice #${req.invoice.invoiceNumber}`,
        comparedDoc: `Payment #${req.paymentInstruction.paymentRef}`,
        sourceValue: `${req.invoice.currency} ${req.invoice.totalAmount}`,
        comparedValue: `${req.paymentInstruction.currency} ${req.paymentInstruction.amount}`,
      });
    }

    // 2. Separate Currency Code Check (CRITICAL)
    const invCcy = (req.invoice.currency || '').trim().toUpperCase();
    const pmtCcy = (req.paymentInstruction.currency || '').trim().toUpperCase();
    if (invCcy && pmtCcy && invCcy !== pmtCcy) {
      discrepancies.push({
        category: 'PRICE_OR_VALUE',
        severity: 'CRITICAL',
        description: `Currency mismatch between Commercial Invoice (${invCcy}) and Payment Instruction (${pmtCcy}). Amounts cannot be silently equated across different currencies.`,
        sourceDoc: `Invoice #${req.invoice.invoiceNumber}`,
        comparedDoc: `Payment #${req.paymentInstruction.paymentRef}`,
        sourceValue: invCcy,
        comparedValue: pmtCcy,
      });
    }

    // 3. Payment amount positive check
    if (typeof req.paymentInstruction.amount !== 'number' || !isFinite(req.paymentInstruction.amount) || req.paymentInstruction.amount <= 0) {
      discrepancies.push({
        category: 'PRICE_OR_VALUE',
        severity: 'CRITICAL',
        description: `Payment instruction amount must be a positive finite number (got ${req.paymentInstruction.amount}).`,
        sourceDoc: `Payment #${req.paymentInstruction.paymentRef}`,
        comparedDoc: 'Financial Settlement Standards',
        sourceValue: String(req.paymentInstruction.amount),
        comparedValue: '> 0',
      });
    }
  } else {
    omittedComparisons.push('Invoice vs Payment Instruction (Payment instruction not provided)');
    discrepancies.push({
      category: 'MISSING_MANDATORY_DOC',
      severity: 'WARNING',
      description: 'Payment instruction omitted from presentation set; settlement amount, currency, and remitter/beneficiary could not be cross-reconciled.',
      sourceDoc: 'Presentation Set',
      comparedDoc: 'Payment Instruction',
      sourceValue: 'MISSING',
      comparedValue: 'EXPECTED_FOR_FINANCING',
    });
  }

  // B. Port Consistency Check (Invoice vs B/L)
  if (req.invoice.portOfLoading && req.billOfLading.portOfLoading) {
    if (req.invoice.portOfLoading.trim().toLowerCase() !== req.billOfLading.portOfLoading.trim().toLowerCase()) {
      discrepancies.push({
        category: 'PORT_INCONSISTENCY',
        severity: 'WARNING',
        description: `Port of Loading differs between Invoice (${req.invoice.portOfLoading}) and Bill of Lading (${req.billOfLading.portOfLoading})`,
        sourceDoc: 'Commercial Invoice',
        comparedDoc: 'Bill of Lading',
        sourceValue: req.invoice.portOfLoading,
        comparedValue: req.billOfLading.portOfLoading,
      });
    }
  }

  if (req.invoice.portOfDischarge && req.billOfLading.portOfDischarge) {
    if (req.invoice.portOfDischarge.trim().toLowerCase() !== req.billOfLading.portOfDischarge.trim().toLowerCase()) {
      discrepancies.push({
        category: 'PORT_INCONSISTENCY',
        severity: 'WARNING',
        description: `Port of Discharge differs between Invoice (${req.invoice.portOfDischarge}) and Bill of Lading (${req.billOfLading.portOfDischarge})`,
        sourceDoc: 'Commercial Invoice',
        comparedDoc: 'Bill of Lading',
        sourceValue: req.invoice.portOfDischarge,
        comparedValue: req.billOfLading.portOfDischarge,
      });
    }
  }

  // C. Weight Discrepancy Check (B/L vs Packing List)
  if (req.packingList) {
    if (typeof req.packingList.totalGrossWeightKg !== 'number' || !isFinite(req.packingList.totalGrossWeightKg) || req.packingList.totalGrossWeightKg <= 0) {
      discrepancies.push({
        category: 'WEIGHT_DISCREPANCY',
        severity: 'CRITICAL',
        description: `Packing List gross weight must be a positive finite number (got ${req.packingList.totalGrossWeightKg} kg).`,
        sourceDoc: 'Packing List',
        comparedDoc: 'Cargo Standards',
        sourceValue: String(req.packingList.totalGrossWeightKg),
        comparedValue: '> 0 kg',
      });
    } else {
      const blWeight = req.billOfLading.grossWeightKg;
      const plWeight = req.packingList.totalGrossWeightKg;
      if (blWeight > 0 && plWeight > 0) {
        const diffPct = Math.abs(blWeight - plWeight) / Math.max(blWeight, plWeight);
        if (diffPct > 0.05) {
          discrepancies.push({
            category: 'WEIGHT_DISCREPANCY',
            severity: 'WARNING',
            description: `Gross weight differs by ${(diffPct * 100).toFixed(1)}% between Bill of Lading (${blWeight} kg) and Packing List (${plWeight} kg)`,
            sourceDoc: 'Bill of Lading',
            comparedDoc: 'Packing List',
            sourceValue: `${blWeight} kg`,
            comparedValue: `${plWeight} kg`,
          });
        }
      }
    }
  } else {
    omittedComparisons.push('Bill of Lading vs Packing List (Packing list not provided)');
    discrepancies.push({
      category: 'MISSING_MANDATORY_DOC',
      severity: 'WARNING',
      description: 'Packing list omitted from presentation set; cargo gross/tare weight and package counts could not be reconciled against transport document.',
      sourceDoc: 'Presentation Set',
      comparedDoc: 'Packing List',
      sourceValue: 'MISSING',
      comparedValue: 'EXPECTED_FOR_WEIGHT_RECONCILIATION',
    });
  }

  // D. Party Reconciliation (Seller vs Shipper, Buyer vs Consignee, Payment Counterparties)
  const normSeller = (req.invoice.sellerName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const normShipper = (req.billOfLading.shipperName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (normSeller && normShipper && !normSeller.includes(normShipper) && !normShipper.includes(normSeller)) {
    discrepancies.push({
      category: 'PARTY_MISMATCH',
      severity: 'WARNING',
      description: `Shipper on Bill of Lading (${req.billOfLading.shipperName}) does not match Seller on Invoice (${req.invoice.sellerName})`,
      sourceDoc: 'Invoice Seller',
      comparedDoc: 'B/L Shipper',
      sourceValue: req.invoice.sellerName,
      comparedValue: req.billOfLading.shipperName,
    });
  }

  const normBuyer = (req.invoice.buyerName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const normConsignee = (req.billOfLading.consigneeName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (normBuyer && normConsignee) {
    const isToOrder = normConsignee.includes('toorder');
    if (isToOrder) {
      const normNotify = (req.billOfLading.notifyPartyName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (normNotify && !normNotify.includes(normBuyer) && !normBuyer.includes(normNotify)) {
        discrepancies.push({
          category: 'PARTY_MISMATCH',
          severity: 'WARNING',
          description: `Consignee is 'TO ORDER', but Notify Party on Bill of Lading (${req.billOfLading.notifyPartyName}) does not match Buyer on Invoice (${req.invoice.buyerName})`,
          sourceDoc: 'Invoice Buyer',
          comparedDoc: 'B/L Notify Party',
          sourceValue: req.invoice.buyerName,
          comparedValue: req.billOfLading.notifyPartyName || 'MISSING',
        });
      }
    } else if (!normBuyer.includes(normConsignee) && !normConsignee.includes(normBuyer)) {
      discrepancies.push({
        category: 'PARTY_MISMATCH',
        severity: 'WARNING',
        description: `Consignee on Bill of Lading (${req.billOfLading.consigneeName}) does not match Buyer on Invoice (${req.invoice.buyerName})`,
        sourceDoc: 'Invoice Buyer',
        comparedDoc: 'B/L Consignee',
        sourceValue: req.invoice.buyerName,
        comparedValue: req.billOfLading.consigneeName,
      });
    }
  }

  // Reconcile Payment Remitter & Beneficiary
  if (req.paymentInstruction) {
    const normRemitter = (req.paymentInstruction.remitterName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const normBeneficiary = (req.paymentInstruction.beneficiaryName || '').toLowerCase().replace(/[^a-z0-9]/g, '');

    if (normRemitter && normBuyer && !normRemitter.includes(normBuyer) && !normBuyer.includes(normRemitter)) {
      discrepancies.push({
        category: 'PARTY_MISMATCH',
        severity: 'WARNING',
        description: `Payment Instruction Remitter (${req.paymentInstruction.remitterName}) does not match Invoice Buyer (${req.invoice.buyerName}) [Third-Party Settlement Risk].`,
        sourceDoc: 'Invoice Buyer',
        comparedDoc: 'Payment Remitter',
        sourceValue: req.invoice.buyerName,
        comparedValue: req.paymentInstruction.remitterName,
      });
    }

    if (normBeneficiary && normSeller && !normBeneficiary.includes(normSeller) && !normSeller.includes(normBeneficiary)) {
      discrepancies.push({
        category: 'PARTY_MISMATCH',
        severity: 'WARNING',
        description: `Payment Instruction Beneficiary (${req.paymentInstruction.beneficiaryName}) does not match Invoice Seller (${req.invoice.sellerName}) [Third-Party Payee Risk].`,
        sourceDoc: 'Invoice Seller',
        comparedDoc: 'Payment Beneficiary',
        sourceValue: req.invoice.sellerName,
        comparedValue: req.paymentInstruction.beneficiaryName,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // 4. Dual-Use & Controlled Goods Check (Invoice Line Items & Transport Cargo)
  // ---------------------------------------------------------------------------
  const textSources: Array<{ doc: 'Commercial Invoice' | 'Bill of Lading' | 'Packing List'; text: string; hs?: string }> = [];

  for (const item of lineItems) {
    if (item.description) {
      textSources.push({ doc: 'Commercial Invoice', text: item.description, hs: item.hsCode });
    }
  }
  if (req.billOfLading.cargoDescription) {
    textSources.push({ doc: 'Bill of Lading', text: req.billOfLading.cargoDescription });
  }
  if (req.packingList?.cargoDescription) {
    textSources.push({ doc: 'Packing List', text: req.packingList.cargoDescription });
  }

  for (const src of textSources) {
    // 1. HS code check
    if (src.hs) {
      const cleanHs = src.hs.replace(/[^0-9]/g, '').slice(0, 4);
      if (CONTROLLED_HS_PREFIXES[cleanHs]) {
        const ctrl = CONTROLLED_HS_PREFIXES[cleanHs];
        if (!dualUseHits.some((h) => h.hsCode === src.hs)) {
          dualUseHits.push({
            hsCode: src.hs,
            eccnCode: ctrl.eccn,
            commodityDescription: `${src.text} (${ctrl.desc})`,
            sourceDocument: src.doc,
            proliferationCategory: ctrl.category,
            isControlled: true,
            assessmentCandidateNote: `Dual-use assessment candidate: HS ${src.hs} indicates potential control under ECCN ${ctrl.eccn} / Category ${ctrl.category}. Requires technical export verification.`,
            licensingRequirement: `Flagged under HS ${src.hs}: Subject to technical dual-use evaluation before trade finance approval.`,
          });
        }
      }
    }

    // 2. Keyword check across invoice line items AND transport cargo description
    const descLower = src.text.toLowerCase();
    for (const kw of DUAL_USE_KEYWORDS) {
      if (descLower.includes(kw.keyword)) {
        if (!dualUseHits.some((h) => h.commodityDescription.toLowerCase().includes(kw.keyword) && h.sourceDocument === src.doc)) {
          dualUseHits.push({
            hsCode: src.hs || 'KEYWORD_MATCH',
            eccnCode: kw.eccn,
            commodityDescription: src.text,
            sourceDocument: src.doc,
            proliferationCategory: kw.category,
            isControlled: true,
            assessmentCandidateNote: `Dual-use assessment candidate: keyword "${kw.keyword}" in ${src.doc} indicates potential classification under ECCN ${kw.eccn} (${kw.category}). Technical specialist assessment required.`,
            licensingRequirement: `Keyword hit on "${kw.keyword}": Requires dual-use classification verification.`,
          });
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 5. Screen All Trade & Payment Parties Against Sanctions Engine
  // ---------------------------------------------------------------------------
  const partiesToScreen: Array<{
    role: TradeScreenedParty['role'];
    name: string;
    country: string;
    sourceDoc: string;
  }> = [
    { role: 'EXPORTER_SELLER', name: req.invoice.sellerName, country: req.invoice.sellerCountry, sourceDoc: 'Commercial Invoice' },
    { role: 'IMPORTER_BUYER', name: req.invoice.buyerName, country: req.invoice.buyerCountry, sourceDoc: 'Commercial Invoice' },
    { role: 'SHIPPER', name: req.billOfLading.shipperName, country: req.invoice.sellerCountry || 'UNKNOWN', sourceDoc: 'Bill of Lading' },
    { role: 'CONSIGNEE', name: req.billOfLading.consigneeName, country: req.invoice.buyerCountry || 'UNKNOWN', sourceDoc: 'Bill of Lading' },
    { role: 'CARRIER', name: req.billOfLading.carrierName, country: 'UNKNOWN', sourceDoc: 'Bill of Lading' },
  ];

  if (req.billOfLading.notifyPartyName && req.billOfLading.notifyPartyName.trim()) {
    partiesToScreen.push({ role: 'NOTIFY_PARTY', name: req.billOfLading.notifyPartyName, country: 'UNKNOWN', sourceDoc: 'Bill of Lading' });
  }

  if (req.paymentInstruction) {
    if (req.paymentInstruction.remitterName) {
      partiesToScreen.push({ role: 'PAYMENT_REMITTER', name: req.paymentInstruction.remitterName, country: req.invoice.buyerCountry || 'UNKNOWN', sourceDoc: 'Payment Instruction' });
    }
    if (req.paymentInstruction.beneficiaryName) {
      partiesToScreen.push({ role: 'PAYMENT_BENEFICIARY', name: req.paymentInstruction.beneficiaryName, country: req.invoice.sellerCountry || 'UNKNOWN', sourceDoc: 'Payment Instruction' });
    }
  }

  let highestScore = 0;
  let findingSeverity: FindingSeverity = 'NO_MATCH_FOUND';
  const screenedParties: TradeScreenedParty[] = [];

  for (const p of partiesToScreen) {
    const rawName = (p.name || '').trim();
    if (!rawName) {
      screenedParties.push({
        role: p.role,
        name: '[NOT SUPPLIED]',
        country: p.country || 'UNKNOWN',
        status: 'INCOMPLETE_NOT_SCREENED',
        isScreened: false,
        matches: [],
        notes: `Mandatory party ${p.role} was not supplied in ${p.sourceDoc}; could not be screened.`,
      });
      continue;
    }

    const canonicalP: CanonicalParty = {
      partyId: `party_${Math.random().toString(36).slice(2, 9)}`,
      role: 'DEBTOR',
      name: rawName,
      country: p.country,
      identifiers: [],
      provenance: { sourceTag: p.role, rawSnippet: `${p.role}: ${rawName} (${p.sourceDoc})` },
    };

    const outcome = embeddedSyntheticEngine.screenPartySync(canonicalP, req.tenantId || 'default');
    if (outcome.highestScore > highestScore) highestScore = outcome.highestScore;
    if (outcome.findingSeverity === 'EXACT_IDENTIFIER_MATCH') {
      findingSeverity = 'EXACT_IDENTIFIER_MATCH';
    } else if (outcome.findingSeverity === 'FUZZY_NAME_CANDIDATE' && findingSeverity !== 'EXACT_IDENTIFIER_MATCH') {
      findingSeverity = 'FUZZY_NAME_CANDIDATE';
    }

    const isMatch = outcome.matches.length > 0;
    screenedParties.push({
      role: p.role,
      name: rawName,
      country: p.country || 'UNKNOWN',
      status: isMatch ? 'MATCH_CANDIDATE' : 'SCREENED_CLEAR',
      isScreened: true,
      matches: outcome.matches,
      notes: isMatch ? `Candidate match on ${outcome.matches[0].listName}` : undefined,
    });
  }

  // ---------------------------------------------------------------------------
  // 6. Completeness, Verification, and Decision Synthesis
  // ---------------------------------------------------------------------------
  const criticalDiscrepancies = discrepancies.filter((d) => d.severity === 'CRITICAL');
  const warningDiscrepancies = discrepancies.filter((d) => d.severity === 'WARNING');
  const hasIncompleteParties = screenedParties.some((p) => !p.isScreened);
  const isFullPresentation = hasPackingList && hasPayment;

  const completenessStatus =
    criticalDiscrepancies.length > 0 || hasIncompleteParties
      ? 'INCOMPLETE_REJECTED'
      : isFullPresentation
      ? 'FULL_PRESENTATION'
      : 'PARTIAL_PRESENTATION';

  // Verification passes ONLY if all documents are present, no critical discrepancies exist,
  // no dual-use triggers are flagged, no sanctions candidates are matched, and all parties are screened.
  const passedVerification =
    criticalDiscrepancies.length === 0 &&
    dualUseHits.length === 0 &&
    findingSeverity === 'NO_MATCH_FOUND' &&
    !hasIncompleteParties &&
    isFullPresentation;

  const reviewReasons: string[] = [];
  if (criticalDiscrepancies.length > 0) {
    reviewReasons.push(`${criticalDiscrepancies.length} critical document discrepancy/data issue(s) detected.`);
  }
  if (warningDiscrepancies.length > 0) {
    reviewReasons.push(`${warningDiscrepancies.length} trade consistency warning(s) require review.`);
  }
  if (dualUseHits.length > 0) {
    reviewReasons.push(`${dualUseHits.length} dual-use proliferation candidate(s) require export control classification.`);
  }
  if (findingSeverity !== 'NO_MATCH_FOUND') {
    reviewReasons.push(`Watchlist candidate match detected on trade counterparty (${findingSeverity}).`);
  }
  if (hasIncompleteParties) {
    reviewReasons.push('One or more trade parties were not supplied and could not be screened.');
  }
  if (!isFullPresentation) {
    reviewReasons.push(`Partial document presentation set: missing ${omittedComparisons.length} comparison document(s).`);
  }

  let decisionRecommendation: 'APPROVE_FINANCING' | 'HOLD_FOR_CORRECTIONS' | 'REJECT_TRADE_CRIME_RISK' = 'APPROVE_FINANCING';
  if (findingSeverity === 'EXACT_IDENTIFIER_MATCH' || dualUseHits.some((h) => h.proliferationCategory === 'NUCLEAR' || h.proliferationCategory === 'MILITARY_EQUIPMENT')) {
    decisionRecommendation = 'REJECT_TRADE_CRIME_RISK';
  } else if (!passedVerification) {
    decisionRecommendation = 'HOLD_FOR_CORRECTIONS';
  }

  const evidenceDigest = createHash('sha256')
    .update(
      JSON.stringify({
        req,
        discrepancies,
        dualUseHits,
        findingSeverity,
        completenessStatus,
        passedVerification,
        timestamp: new Date().toISOString(),
      })
    )
    .digest('hex');

  return {
    id: `trade_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    referenceId: `TRD-${Date.now().toString(36).toUpperCase()}`,
    timestamp: new Date().toISOString(),
    documentsScreened: {
      invoiceNumber: req.invoice.invoiceNumber,
      invoiceAmount: req.invoice.totalAmount,
      invoiceCurrency: req.invoice.currency,
      blNumber: req.billOfLading.blNumber,
      blType: req.billOfLading.blType,
      packingListNumber: req.packingList?.packingListNumber || 'NOT_SUPPLIED',
      paymentRef: req.paymentInstruction?.paymentRef || 'NOT_SUPPLIED',
      paymentCurrency: req.paymentInstruction?.currency,
      paymentAmount: req.paymentInstruction?.amount,
    },
    completenessStatus,
    comparisonsPerformed: {
      invoiceVsTransport: true,
      transportVsPackingList: hasPackingList,
      invoiceVsPayment: hasPayment,
      omittedComparisons,
    },
    parties: screenedParties,
    discrepancies,
    dualUseGoods: dualUseHits,
    findingSeverity,
    highestScore,
    passedVerification,
    requiresHumanReview: !passedVerification || reviewReasons.length > 0,
    reviewReasons,
    decisionRecommendation,
    evidenceDigest,
  };
}
