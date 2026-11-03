/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import {
  CryptoEvaluation,
  CryptoAddressDetails,
  Ivms101Person,
  FindingSeverity,
} from '../../../shared/types.ts';
import { createHash } from 'node:crypto';

export interface EvaluateCryptoRequest {
  asset: 'BTC' | 'ETH' | 'USDT' | 'USDC' | 'SOL';
  amount: number;
  sourceAddress: string;
  sourceNetwork: CryptoAddressDetails['network'];
  destinationAddress: string;
  destinationNetwork: CryptoAddressDetails['network'];
  travelRuleData?: {
    originatorVaspName: string;
    originatorVaspLei?: string;
    beneficiaryVaspName: string;
    beneficiaryVaspLei?: string;
    originator: {
      isLegalPerson: boolean;
      fullName: string;
      nationalIdentifierOrLei?: string;
      country: string;
      addressLines?: string[];
    };
    beneficiary: {
      isLegalPerson: boolean;
      fullName: string;
      nationalIdentifierOrLei?: string;
      country: string;
    };
  };
}

// Known OFAC Sanctioned / Prohibited Mixer Addresses
const KNOWN_SANCTIONED_MIXERS: Record<string, { name: string; category: CryptoAddressDetails['riskCategory']; program: string }> = {
  // Tornado Cash Core Router & Pools
  '0xd90e2f925da726b50c4ed8d0fb909a43a04d3efe': { name: 'Tornado.Cash: Router', category: 'PROHIBITED_SANCTIONED_MIXER', program: 'OFAC-CYBER2' },
  '0x12d66f87a04a9e220743712ce6d9bb1b5616b8fc': { name: 'Tornado.Cash: 0.1 ETH Pool', category: 'PROHIBITED_SANCTIONED_MIXER', program: 'OFAC-CYBER2' },
  '0x47ce0c6ed5b0ce3d3a51fdb1c52dc66a7c3c2936': { name: 'Tornado.Cash: 1 ETH Pool', category: 'PROHIBITED_SANCTIONED_MIXER', program: 'OFAC-CYBER2' },
  '0x910cbd523d972eb0a6f4cae4618ad62622b39dbf': { name: 'Tornado.Cash: 10 ETH Pool', category: 'PROHIBITED_SANCTIONED_MIXER', program: 'OFAC-CYBER2' },
  // Garantex Exchange (OFAC SDN Russia)
  '0x20524296e3F39871032906D5a6F7996c56434440': { name: 'Garantex Deposit Cluster', category: 'PROHIBITED_SANCTIONED_MIXER', program: 'OFAC-RUSSIA-EO14024' },
  // Lazarus Group BTC attribution
  '1245AuAKMSvtGepQCXn2TfG7B5yWjB7bVU': { name: 'Lazarus Group BTC Cluster', category: 'PROHIBITED_SANCTIONED_MIXER', program: 'OFAC-DPRK3' },
  'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh': { name: 'Ronin Bridge Exploit Cluster', category: 'PROHIBITED_SANCTIONED_MIXER', program: 'OFAC-CYBER2' },
  // TRON address attributed to illicit OTC
  'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t': { name: 'Tether USD (TRC-20 Contract - Reference)', category: 'EXCHANGE_TIER_1', program: 'N/A' },
  'TXqg958vK3xN5mR89fM3k8b8h9c2b4d1': { name: 'Sinbad.io Mixer Node (TRON)', category: 'PROHIBITED_SANCTIONED_MIXER', program: 'OFAC-CYBER2' },
};

/**
 * Validates crypto address format for supported chains
 */
export function validateAddressFormat(network: CryptoAddressDetails['network'], address: string): boolean {
  const addr = address.trim();
  switch (network) {
    case 'ETHEREUM':
      return /^0x[a-fA-F0-9]{40}$/.test(addr);
    case 'BITCOIN':
      // Legacy P2PKH (1...), P2SH (3...), Bech32 (bc1q...), Taproot (bc1p...)
      return (
        /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(addr) ||
        /^bc1[a-z0-9]{39,59}$/i.test(addr)
      );
    case 'TRON':
      return /^T[a-km-zA-HJ-NP-Z1-9]{33}$/.test(addr);
    case 'SOLANA':
      return /^[1-9A-HJ-NP-za-km-z]{32,44}$/.test(addr);
    default:
      return false;
  }
}

export function evaluateCryptoTransfer(req: EvaluateCryptoRequest): CryptoEvaluation {
  // 1. Analyze Source Address
  const srcValid = validateAddressFormat(req.sourceNetwork, req.sourceAddress);
  const srcKey = req.sourceAddress.toLowerCase();
  const srcHit = Object.entries(KNOWN_SANCTIONED_MIXERS).find(([k]) => k.toLowerCase() === srcKey);

  const sourceDetails: CryptoAddressDetails = {
    network: req.sourceNetwork,
    address: req.sourceAddress,
    isValidFormat: srcValid,
    isKnownMixerOrSanctionedCluster: !!srcHit && srcHit[1].category === 'PROHIBITED_SANCTIONED_MIXER',
    attributedEntity: srcHit ? srcHit[1].name : undefined,
    riskCategory: srcHit ? srcHit[1].category : 'UNHOSTED_WALLET',
  };

  // 2. Analyze Destination Address
  const dstValid = validateAddressFormat(req.destinationNetwork, req.destinationAddress);
  const dstKey = req.destinationAddress.toLowerCase();
  const dstHit = Object.entries(KNOWN_SANCTIONED_MIXERS).find(([k]) => k.toLowerCase() === dstKey);

  const destinationDetails: CryptoAddressDetails = {
    network: req.destinationNetwork,
    address: req.destinationAddress,
    isValidFormat: dstValid,
    isKnownMixerOrSanctionedCluster: !!dstHit && dstHit[1].category === 'PROHIBITED_SANCTIONED_MIXER',
    attributedEntity: dstHit ? dstHit[1].name : undefined,
    riskCategory: dstHit ? dstHit[1].category : 'UNHOSTED_WALLET',
  };

  // 3. Travel Rule (FATF Recommendation 16 / IVMS 101) Check
  // Threshold: Approx $1,000 USD/EUR. If amount >= 1000, Travel Rule is required.
  const isTravelRuleApplicable = req.amount >= 1000;
  const missingFields: string[] = [];

  const tr = req.travelRuleData;
  if (isTravelRuleApplicable) {
    if (!tr) {
      missingFields.push('MISSING_COMPLETE_TRAVEL_RULE_PAYLOAD');
    } else {
      if (!tr.originatorVaspName) missingFields.push('MISSING_ORIGINATOR_VASP_NAME');
      if (!tr.beneficiaryVaspName) missingFields.push('MISSING_BENEFICIARY_VASP_NAME');
      if (!tr.originator.fullName) missingFields.push('MISSING_ORIGINATOR_FULL_NAME');
      if (!tr.beneficiary.fullName) missingFields.push('MISSING_BENEFICIARY_FULL_NAME');
      if (!tr.originator.nationalIdentifierOrLei && (!tr.originator.addressLines || tr.originator.addressLines.length === 0)) {
        missingFields.push('MISSING_ORIGINATOR_IDENTIFIER_OR_ADDRESS');
      }
    }
  }

  const isIvmsPayloadComplete = isTravelRuleApplicable ? missingFields.length === 0 : true;

  // 4. Overall Finding Severity & Clearance Status
  let findingSeverity: FindingSeverity = 'NO_MATCH_FOUND';
  let highestScore = 0;

  if (sourceDetails.isKnownMixerOrSanctionedCluster || destinationDetails.isKnownMixerOrSanctionedCluster) {
    findingSeverity = 'EXACT_IDENTIFIER_MATCH';
    highestScore = 1.0;
  }

  let clearanceStatus: CryptoEvaluation['clearanceStatus'] = 'TRANSACTION_PERMITTED';
  if (findingSeverity === 'EXACT_IDENTIFIER_MATCH') {
    clearanceStatus = 'BLOCKED_SANCTIONED_ADDRESS';
  } else if (!isIvmsPayloadComplete) {
    clearanceStatus = 'TRAVEL_RULE_DEFICIT';
  }

  const evidenceDigest = createHash('sha256')
    .update(JSON.stringify({ req, sourceDetails, destinationDetails, clearanceStatus, timestamp: new Date().toISOString() }))
    .digest('hex');

  const emptyPerson: Ivms101Person = {
    isLegalPerson: false,
    fullName: '',
    country: '',
    walletAddress: '',
  };

  return {
    id: `crypto_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    asset: req.asset,
    amount: req.amount,
    sourceAddress: sourceDetails,
    destinationAddress: destinationDetails,
    travelRule: {
      protocol: 'IVMS_101',
      isTravelRuleApplicable,
      originatorVasp: { name: tr?.originatorVaspName || 'N/A', vaspLei: tr?.originatorVaspLei },
      beneficiaryVasp: { name: tr?.beneficiaryVaspName || 'N/A', vaspLei: tr?.beneficiaryVaspLei },
      originator: tr
        ? {
            isLegalPerson: tr.originator.isLegalPerson,
            fullName: tr.originator.fullName,
            nationalIdentifierOrLei: tr.originator.nationalIdentifierOrLei,
            country: tr.originator.country,
            addressLines: tr.originator.addressLines,
            walletAddress: req.sourceAddress,
          }
        : { ...emptyPerson, walletAddress: req.sourceAddress },
      beneficiary: tr
        ? {
            isLegalPerson: tr.beneficiary.isLegalPerson,
            fullName: tr.beneficiary.fullName,
            nationalIdentifierOrLei: tr.beneficiary.nationalIdentifierOrLei,
            country: tr.beneficiary.country,
            walletAddress: req.destinationAddress,
          }
        : { ...emptyPerson, walletAddress: req.destinationAddress },
      isIvmsPayloadComplete,
      missingMandatoryFields: missingFields,
    },
    findingSeverity,
    highestScore,
    clearanceStatus,
    evidenceDigest,
  };
}
