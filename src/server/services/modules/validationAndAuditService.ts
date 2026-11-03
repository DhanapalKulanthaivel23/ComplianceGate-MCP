/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import {
  ValidationAndAuditEvaluation,
  SyntheticEvasionTestCase,
  EvasionTypology,
  CanonicalParty,
} from '../../../shared/types.ts';
import { embeddedSyntheticEngine } from '../engineAdapter.ts';
import { paymentStoreService } from '../paymentStore.ts';
import { createHash } from 'node:crypto';

// Ground truth synthetic evasion test library aligned with active watchlists
const BASELINE_EVASION_SPECS: {
  typology: EvasionTypology;
  description: string;
  baselineEntity: string;
  evasionPayload: string;
  targetList: string;
  expectedDetection: boolean;
}[] = [
  {
    typology: 'CYRILLIC_HOMOGLYPH_SUBSTITUTION',
    description: 'Replaces Latin letters with visually identical Cyrillic glyphs in corporate executive name',
    baselineEntity: 'Dmitry Sergeyevich Volkov',
    // D + Cyrillic 'і' + try S + Cyrillic 'е' + rg + Cyrillic 'е' + y + Cyrillic 'е' + v + Cyrillic 'і' + ch V + Cyrillic 'о' + lk + Cyrillic 'о' + v
    evasionPayload: 'Dm\u0456try S\u0435rg\u0435y\u0435v\u0456ch V\u043Elk\u043Ev',
    targetList: 'DEMO_OFAC_SDN',
    expectedDetection: true,
  },
  {
    typology: 'VOWEL_DROPPING',
    description: 'Abbreviates corporate structure and drops interior vowels',
    baselineEntity: 'Al-Huda International Trading LLC',
    evasionPayload: 'Al-Huda Intnl Trading LLC',
    targetList: 'DEMO_OFAC_SDN',
    expectedDetection: true,
  },
  {
    typology: 'INVERTED_WORD_ORDER',
    description: 'Inverts corporate name components to test token sort ratio invariance',
    baselineEntity: 'Al-Huda International Trading LLC',
    evasionPayload: 'Trading International Al-Huda LLC',
    targetList: 'DEMO_OFAC_SDN',
    expectedDetection: true,
  },
  {
    typology: 'SPACING_INSERTION',
    description: 'Inserts whitespace between letters to test fragmentation normalization',
    baselineEntity: 'Oceanic Aurora Maritime Ltd',
    evasionPayload: 'O c e a n i c   A u r o r a   M a r i t i m e',
    targetList: 'DEMO_OFAC_SDN',
    expectedDetection: true,
  },
  {
    typology: 'VESSEL_IMO_SCRUBBING',
    description: 'Omits official IMO number while applying commercial prefix alteration to vessel entity',
    baselineEntity: 'Oceanic Aurora Maritime Ltd',
    evasionPayload: 'M/V Oceanic Aurora Maritime Co',
    targetList: 'DEMO_OFAC_SDN',
    expectedDetection: true,
  },
  {
    typology: 'NARRATIVE_NOISE_INJECTION',
    description: 'Embeds sanctioned entity name inside commercial narrative text',
    baselineEntity: 'Nordic Volga Logistics OOO',
    evasionPayload: 'SETTLEMENT FOR WHEAT VIA NORDIC VOLGA LOGISTICS OOO',
    targetList: 'DEMO_EU_FSF',
    expectedDetection: true,
  },
  {
    typology: 'CONTAINER_PREFIX_DISGUISE',
    description: 'Alters humanitarian branch terminology in charity trust',
    baselineEntity: 'Al-Furqan Humanitarian Relief Foundation',
    evasionPayload: 'Al-Furqan Humanitarian Relief Trust',
    targetList: 'DEMO_UN_CONSOLIDATED',
    expectedDetection: true,
  },
  {
    typology: 'MISSING_ORIGINATOR_ACCOUNT',
    description: 'Negative control: Completely benign European lighting design supplier',
    baselineEntity: 'Lumen Lighting Design SAS',
    evasionPayload: 'Lumen Lighting Design SAS',
    targetList: 'BENIGN_BASELINE',
    expectedDetection: false,
  },
];

export function runValidationAndAuditBenchmark(): ValidationAndAuditEvaluation {
  const startTime = Date.now();
  const testCases: SyntheticEvasionTestCase[] = [];

  let truePositives = 0;
  let falsePositives = 0;
  let trueNegatives = 0;
  let falseNegatives = 0;

  for (let idx = 0; idx < BASELINE_EVASION_SPECS.length; idx++) {
    const spec = BASELINE_EVASION_SPECS[idx];
    const canonicalParty: CanonicalParty = {
      partyId: `evasion_${idx + 1}`,
      role: 'DEBTOR',
      name: spec.evasionPayload,
      identifiers: [],
      provenance: { sourceTag: 'BENCHMARK_TEST', rawSnippet: spec.evasionPayload },
    };

    const outcome = embeddedSyntheticEngine.screenPartySync(canonicalParty);
    const engineDetected = outcome.matches.length > 0;
    const passed = engineDetected === spec.expectedDetection;

    if (spec.expectedDetection) {
      if (engineDetected) truePositives++;
      else falseNegatives++;
    } else {
      if (engineDetected) falsePositives++;
      else trueNegatives++;
    }

    testCases.push({
      caseId: `EVASION-CASE-${(idx + 1).toString().padStart(3, '0')}`,
      typology: spec.typology,
      description: spec.description,
      baselineEntity: spec.baselineEntity,
      evasionPayload: spec.evasionPayload,
      targetList: spec.targetList,
      expectedDetection: spec.expectedDetection,
      actualDetection: engineDetected,
      score: outcome.highestScore,
      passed,
    });
  }

  const casesPassed = testCases.filter((c) => c.passed).length;
  const casesFailed = testCases.filter((c) => !c.passed).length;

  const precision = truePositives + falsePositives > 0 ? truePositives / (truePositives + falsePositives) : 1.0;
  const recall = truePositives + falseNegatives > 0 ? truePositives / (truePositives + falseNegatives) : 1.0;
  const f1Score = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 1.0;
  const falsePositiveRate = falsePositives + trueNegatives > 0 ? falsePositives / (falsePositives + trueNegatives) : 0.0;
  const meanLatencyMs = (Date.now() - startTime) / testCases.length;

  // Re-verify historical case store ledger integrity
  const allCases = paymentStoreService.listCases();
  let validChains = 0;
  let brokenChains = 0;

  for (const c of allCases) {
    const isIntact = paymentStoreService.verifyCaseAuditTrail(c.caseId);
    if (isIntact) validChains++;
    else brokenChains++;
  }

  const evidenceDigest = createHash('sha256')
    .update(JSON.stringify({
      casesPassed,
      casesFailed,
      precision,
      recall,
      f1Score,
      validChains,
      brokenChains,
      timestamp: new Date().toISOString(),
    }))
    .digest('hex');

  return {
    id: `val_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    totalCasesTested: testCases.length,
    casesPassed,
    casesFailed,
    testCases,
    benchmarkMetrics: {
      precision: parseFloat(precision.toFixed(4)),
      recall: parseFloat(recall.toFixed(4)),
      f1Score: parseFloat(f1Score.toFixed(4)),
      falsePositiveRate: parseFloat(falsePositiveRate.toFixed(4)),
      meanLatencyMs: parseFloat(meanLatencyMs.toFixed(2)),
    },
    historicalLedgerVerification: {
      totalRecordsAudited: allCases.length,
      chainsIntact: validChains,
      brokenChains,
      tamperDetected: brokenChains > 0,
      verificationStatus: brokenChains > 0 ? 'TAMPER_ALERT' : 'VERIFIED_TAMPER_EVIDENT',
    },
    evidenceDigest,
  };
}

export interface ExtendedValidationReport {
  goldenDatasetSize: number;
  confusionMatrix: {
    truePositives: number;
    falsePositives: number;
    trueNegatives: number;
    falseNegatives: number;
    precision: number;
    recall: number;
    specificity: number;
    f1Score: number;
  };
  thresholdSensitivity: Array<{
    threshold: number;
    precision: number;
    recall: number;
    f1Score: number;
  }>;
  walIntegrity: {
    isValid: boolean;
    totalRecords: number;
  };
}

const EXTENDED_GOLDEN_DATASET: Array<{
  name: string;
  identifiers?: CanonicalParty['identifiers'];
  expectedMatch: boolean;
  category: 'TRUE_POSITIVE_EXACT' | 'TRUE_POSITIVE_FUZZY' | 'TRUE_POSITIVE_MULTISCRIPT' | 'BENIGN_LOOKALIKE_NEGATIVE';
}> = [
  { name: 'Oceanic Aurora Maritime Ltd', expectedMatch: true, category: 'TRUE_POSITIVE_EXACT' },
  { name: 'Oceanic Aurora Shipping Co', expectedMatch: true, category: 'TRUE_POSITIVE_FUZZY' },
  { name: 'Al-Huda International Trading LLC', expectedMatch: true, category: 'TRUE_POSITIVE_EXACT' },
  { name: 'Trading International Al-Huda LLC', expectedMatch: true, category: 'TRUE_POSITIVE_FUZZY' },
  { name: 'Дмитрий Сергеевич Волков', expectedMatch: true, category: 'TRUE_POSITIVE_MULTISCRIPT' },
  { name: '北京地平线微电子有限公司', expectedMatch: true, category: 'TRUE_POSITIVE_MULTISCRIPT' },
  { name: 'طارق عبد الكريم المنصور', expectedMatch: true, category: 'TRUE_POSITIVE_MULTISCRIPT' },
  { name: 'مؤسسة الفرقان الإغاثية', expectedMatch: true, category: 'TRUE_POSITIVE_MULTISCRIPT' },
  { name: 'Nordic Volga Logistics OOO', expectedMatch: true, category: 'TRUE_POSITIVE_EXACT' },
  { name: 'Caspian Sea Petrochemical Transshipment Ltd', expectedMatch: true, category: 'TRUE_POSITIVE_EXACT' },
  {
    name: 'Unrelated Shell Name',
    identifiers: [{ type: 'LEI', value: '549300DEMOBEIJING01' }],
    expectedMatch: true,
    category: 'TRUE_POSITIVE_EXACT',
  },
  {
    name: 'Another Entity Name',
    identifiers: [{ type: 'IMO', value: '9123456' }],
    expectedMatch: true,
    category: 'TRUE_POSITIVE_EXACT',
  },
  // Benign Lookalikes (False-Positive Controls)
  { name: 'Oceanic Pacific Fisheries Corp', expectedMatch: false, category: 'BENIGN_LOOKALIKE_NEGATIVE' },
  { name: 'Aurora Borealis Hospitality Group AS', expectedMatch: false, category: 'BENIGN_LOOKALIKE_NEGATIVE' },
  { name: 'Beijing Solar Photovoltaic Equipment Co', expectedMatch: false, category: 'BENIGN_LOOKALIKE_NEGATIVE' },
  { name: 'Nordic Baltic Timber Exports AB', expectedMatch: false, category: 'BENIGN_LOOKALIKE_NEGATIVE' },
  { name: 'Caspian Wind Renewable Energy GmbH', expectedMatch: false, category: 'BENIGN_LOOKALIKE_NEGATIVE' },
  { name: 'Lumen Lighting Design SAS', expectedMatch: false, category: 'BENIGN_LOOKALIKE_NEGATIVE' },
  { name: 'Alpine Precision Medical Instruments AG', expectedMatch: false, category: 'BENIGN_LOOKALIKE_NEGATIVE' },
  { name: 'Helvetia Global Reinsurance Zurich Ltd', expectedMatch: false, category: 'BENIGN_LOOKALIKE_NEGATIVE' },
];

export function runExtendedValidationSuite(): ExtendedValidationReport {
  const outcomes = EXTENDED_GOLDEN_DATASET.map((item, idx) => {
    const party: CanonicalParty = {
      partyId: `gold_${idx + 1}`,
      role: 'DEBTOR',
      name: item.name,
      identifiers: item.identifiers || [],
      provenance: { sourceTag: item.category },
    };
    const res = embeddedSyntheticEngine.screenPartySync(party);
    return {
      expectedMatch: item.expectedMatch,
      highestScore: res.highestScore,
      hasExactId: res.findingSeverity === 'EXACT_IDENTIFIER_MATCH',
    };
  });

  const evalAtThreshold = (cutoff: number) => {
    let tp = 0;
    let fp = 0;
    let tn = 0;
    let fn = 0;
    for (const o of outcomes) {
      const detected = o.hasExactId || o.highestScore >= cutoff;
      if (o.expectedMatch) {
        if (detected) tp++;
        else fn++;
      } else {
        if (detected) fp++;
        else tn++;
      }
    }
    const precision = tp + fp > 0 ? tp / (tp + fp) : 1.0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 1.0;
    const specificity = tn + fp > 0 ? tn / (tn + fp) : 1.0;
    const f1Score = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 1.0;
    return {
      truePositives: tp,
      falsePositives: fp,
      trueNegatives: tn,
      falseNegatives: fn,
      precision: Number(precision.toFixed(4)),
      recall: Number(recall.toFixed(4)),
      specificity: Number(specificity.toFixed(4)),
      f1Score: Number(f1Score.toFixed(4)),
    };
  };

  const confusionMatrix = evalAtThreshold(0.82);
  const thresholds = [0.70, 0.75, 0.80, 0.82, 0.85, 0.90];
  const thresholdSensitivity = thresholds.map((t) => {
    const m = evalAtThreshold(t);
    return {
      threshold: t,
      precision: m.precision,
      recall: m.recall,
      f1Score: m.f1Score,
    };
  });

  const walCheck = paymentStoreService.verifyWalIntegrity();

  return {
    goldenDatasetSize: EXTENDED_GOLDEN_DATASET.length,
    confusionMatrix,
    thresholdSensitivity,
    walIntegrity: {
      isValid: walCheck.isValid,
      totalRecords: walCheck.totalRecords,
    },
  };
}
