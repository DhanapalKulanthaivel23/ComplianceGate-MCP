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
} from '../../../shared/types.ts';
import { embeddedSyntheticEngine } from '../engineAdapter.ts';
import { createHash } from 'node:crypto';

export interface EvaluateTradeRequest {
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
  const discrepancies: TradeDiscrepancy[] = [];
  const dualUseHits: DualUseGoodHit[] = [];

  // 1. Cross-document discrepancy analysis
  // A. Price and Value Check (Invoice vs Payment)
  if (req.paymentInstruction) {
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
  }

  // B. Port Consistency Check (Invoice vs B/L)
  if (req.invoice.portOfLoading && req.invoice.portOfLoading.trim().toLowerCase() !== req.billOfLading.portOfLoading.trim().toLowerCase()) {
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

  if (req.invoice.portOfDischarge && req.invoice.portOfDischarge.trim().toLowerCase() !== req.billOfLading.portOfDischarge.trim().toLowerCase()) {
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

  // C. Weight Discrepancy Check (B/L vs Packing List)
  if (req.packingList) {
    const blWeight = req.billOfLading.grossWeightKg;
    const plWeight = req.packingList.totalGrossWeightKg;
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
  } else {
    discrepancies.push({
      category: 'MISSING_MANDATORY_DOC',
      severity: 'INFORMATIONAL',
      description: 'Packing list was omitted from presentation set; gross/tare cargo weight cannot be reconciled.',
      sourceDoc: 'Presentation Set',
      comparedDoc: 'Packing List',
      sourceValue: 'MISSING',
      comparedValue: 'EXPECTED',
    });
  }

  // D. Party Mismatch Check (Shipper vs Seller, Consignee vs Buyer)
  const normSeller = req.invoice.sellerName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const normShipper = req.billOfLading.shipperName.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!normSeller.includes(normShipper) && !normShipper.includes(normSeller)) {
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

  // 2. Dual-use goods check on line items & cargo description
  for (const item of req.invoice.lineItems) {
    if (item.hsCode) {
      const cleanHs = item.hsCode.replace(/[^0-9]/g, '').slice(0, 4);
      if (CONTROLLED_HS_PREFIXES[cleanHs]) {
        const ctrl = CONTROLLED_HS_PREFIXES[cleanHs];
        dualUseHits.push({
          hsCode: item.hsCode,
          eccnCode: ctrl.eccn,
          commodityDescription: `${item.description} (${ctrl.desc})`,
          proliferationCategory: ctrl.category,
          isControlled: true,
          licensingRequirement: `Export license required under ECCN ${ctrl.eccn} / Wassenaar Arrangement Category ${ctrl.category}.`,
        });
      }
    }

    const descLower = item.description.toLowerCase();
    for (const kw of DUAL_USE_KEYWORDS) {
      if (descLower.includes(kw.keyword)) {
        if (!dualUseHits.some((h) => h.commodityDescription.toLowerCase().includes(kw.keyword))) {
          dualUseHits.push({
            hsCode: item.hsCode || 'CONTROLLED_KEYWORDS',
            eccnCode: kw.eccn,
            commodityDescription: item.description,
            proliferationCategory: kw.category,
            isControlled: true,
            licensingRequirement: `Flagged under keyword "${kw.keyword}": Requires dual-use technical assessment under ECCN ${kw.eccn}.`,
          });
        }
      }
    }
  }

  // 3. Screen trade parties against sanctions engine
  const partiesToScreen: { role: any; name: string; country: string }[] = [
    { role: 'EXPORTER_SELLER', name: req.invoice.sellerName, country: req.invoice.sellerCountry },
    { role: 'IMPORTER_BUYER', name: req.invoice.buyerName, country: req.invoice.buyerCountry },
    { role: 'CARRIER', name: req.billOfLading.carrierName, country: 'UNKNOWN' },
    { role: 'CONSIGNEE', name: req.billOfLading.consigneeName, country: req.invoice.buyerCountry },
  ];
  if (req.billOfLading.notifyPartyName) {
    partiesToScreen.push({ role: 'NOTIFY_PARTY', name: req.billOfLading.notifyPartyName, country: 'UNKNOWN' });
  }

  let highestScore = 0;
  let findingSeverity: FindingSeverity = 'NO_MATCH_FOUND';
  const screenedParties: TradeAndCargoEvaluation['parties'] = [];

  for (const p of partiesToScreen) {
    const canonicalP: CanonicalParty = {
      partyId: `party_${Math.random().toString(36).slice(2, 9)}`,
      role: 'DEBTOR',
      name: p.name,
      country: p.country,
      identifiers: [],
      provenance: { sourceTag: p.role, rawSnippet: `${p.role}: ${p.name}` },
    };
    const outcome = embeddedSyntheticEngine.screenPartySync(canonicalP);
    if (outcome.highestScore > highestScore) highestScore = outcome.highestScore;
    if (outcome.findingSeverity === 'EXACT_IDENTIFIER_MATCH') {
      findingSeverity = 'EXACT_IDENTIFIER_MATCH';
    } else if (outcome.findingSeverity === 'FUZZY_NAME_CANDIDATE' && findingSeverity !== 'EXACT_IDENTIFIER_MATCH') {
      findingSeverity = 'FUZZY_NAME_CANDIDATE';
    }

    screenedParties.push({
      role: p.role,
      name: p.name,
      country: p.country,
      matches: outcome.matches,
    });
  }

  const passedVerification =
    discrepancies.filter((d) => d.severity === 'CRITICAL').length === 0 &&
    dualUseHits.length === 0 &&
    findingSeverity === 'NO_MATCH_FOUND';

  const evidenceDigest = createHash('sha256')
    .update(JSON.stringify({ req, discrepancies, dualUseHits, findingSeverity, timestamp: new Date().toISOString() }))
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
      packingListNumber: req.packingList?.packingListNumber || 'N/A',
      paymentRef: req.paymentInstruction?.paymentRef,
    },
    parties: screenedParties,
    discrepancies,
    dualUseGoods: dualUseHits,
    findingSeverity,
    highestScore,
    passedVerification,
    evidenceDigest,
  };
}
