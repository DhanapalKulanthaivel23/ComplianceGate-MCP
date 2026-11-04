/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { CanonicalPaymentTransaction, isVerifiedTestedProfile, MissingDataIssue } from '../../shared/types.ts';

export type MissingDataProfile = 'FATF_REC16_WIRE_PROFILE' | 'DOMESTIC_ACH_PROFILE' | 'BASIC_INTEGRITY_PROFILE';

const SUPPORTED_ISO_SCHEMA_SUFFIXES: Record<string, string[]> = {
  PACS_008: ['001.08', '001.09', '001.10'],
  PACS_009_COV: ['001.08', '001.09', '001.10'],
  PACS_004: ['001.09', '001.10', '001.11'],
  PAIN_001: ['001.09', '001.10', '001.11'],
};

/**
 * Server-side structural extraction completeness safeguard.
 * Rather than trusting a caller's isProfileTested boolean flag, verifies:
 *  1. Message type is in VERIFIED_TESTED_PROFILES and not flagged false.
 *  2. Declared ISO 20022 schemaVersion (if 4-part) is in the tested version set.
 *  3. Both Debtor and Creditor parties are extracted with non-empty names.
 *  4. Cover payments (MT202_COV, PACS_009_COV) include both Sequence A interbank and Sequence B cover customer parties.
 *  5. Raw message snippet party tags (if present) were not dropped compared to tx.parties.
 */
export function verifyExtractionCompleteness(tx: CanonicalPaymentTransaction): {
  isComplete: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];

  if (!isVerifiedTestedProfile(tx.messageType, tx.isProfileTested)) {
    reasons.push(`Message type ${tx.messageType} is not an independently verified tested profile.`);
  }

  if (tx.schemaVersion && SUPPORTED_ISO_SCHEMA_SUFFIXES[tx.messageType]) {
    const m = tx.schemaVersion.match(/\.(\d{3}\.\d{2})$/);
    if (m && !SUPPORTED_ISO_SCHEMA_SUFFIXES[tx.messageType].includes(m[1])) {
      reasons.push(`Schema version ${tx.schemaVersion} is outside verified profile versions (${SUPPORTED_ISO_SCHEMA_SUFFIXES[tx.messageType].join(', ')}).`);
    }
  }

  const hasDebtor = tx.parties.some((p) => p.role === 'DEBTOR' && p.name && p.name.trim().length > 0 && !p.name.startsWith('Unknown '));
  const hasCreditor = tx.parties.some((p) => p.role === 'CREDITOR' && p.name && p.name.trim().length > 0 && !p.name.startsWith('Unknown '));
  if (!hasDebtor || !hasCreditor) {
    reasons.push('Transaction lacks extracted primary DEBTOR or CREDITOR party.');
  }

  if (tx.messageType === 'MT202_COV' || tx.messageType === 'MT205_COV' || tx.messageType === 'PACS_009_COV') {
    const hasSeqA = tx.parties.some(
      (p) =>
        p.provenance?.sequence === 'A' ||
        p.role === 'INSTRUCTING_AGENT' ||
        p.role === 'ORDERING_INSTITUTION' ||
        p.role === 'CREDITOR_AGENT'
    );
    const hasSeqBDebtor = tx.parties.some((p) => p.role === 'DEBTOR' && p.provenance?.sequence === 'B');
    const hasSeqBCreditor = tx.parties.some((p) => p.role === 'CREDITOR' && p.provenance?.sequence === 'B');
    if (!hasSeqA || !hasSeqBDebtor || !hasSeqBCreditor) {
      reasons.push(`Cover payment ${tx.messageType} lacks complete Sequence A (interbank) or Sequence B (underlying debtor/creditor) extraction.`);
    }
  }

  if (
    typeof tx.provenanceSummary?.expectedPartyMarkersInRaw === 'number' &&
    tx.provenanceSummary.expectedPartyMarkersInRaw > tx.parties.length
  ) {
    reasons.push(
      `Raw message contained ${tx.provenanceSummary.expectedPartyMarkersInRaw} party markers but only ${tx.parties.length} parties were extracted.`
    );
  }

  if (tx.rawMessageSnippet && tx.messageFamily === 'SWIFT_MT') {
    const rawTagMatches = tx.rawMessageSnippet.match(/^:(?:50|51|52|53|54|55|56|57|58|59)[A-Z]?:/gm);
    if (rawTagMatches && rawTagMatches.length > tx.parties.length) {
      reasons.push(
        `Raw SWIFT snippet contains ${rawTagMatches.length} party tags (${rawTagMatches.join(', ')}) but only ${tx.parties.length} parties are present in transaction.`
      );
    }
  }

  return {
    isComplete: reasons.length === 0,
    reasons,
  };
}

/**
 * Evaluates payment transaction against configurable missing data profiles.
 * Flags missing originator, beneficiary, or intermediary data without issuing
 * premature regulatory conclusions.
 */
export function auditPaymentMissingData(
  tx: CanonicalPaymentTransaction,
  profile: MissingDataProfile = 'FATF_REC16_WIRE_PROFILE'
): MissingDataIssue[] {
  const issues: MissingDataIssue[] = [];

  const debtor = tx.parties.find((p) => p.role === 'DEBTOR');
  const creditor = tx.parties.find((p) => p.role === 'CREDITOR');
  const debtorAgent = tx.parties.find((p) => p.role === 'ORDERING_INSTITUTION' || p.role === 'INSTRUCTING_AGENT');
  const creditorAgent = tx.parties.find((p) => p.role === 'CREDITOR_AGENT');

  // 1. Debtor Verification
  if (!debtor) {
    issues.push({
      field: 'parties.debtor',
      partyRole: 'DEBTOR',
      severity: 'CRITICAL_MISSING',
      ruleId: 'ORIG_01_DEBTOR_MANDATORY',
      ruleDescription: 'Transaction lacks an identifiable ordering customer / debtor party.',
      recommendation: 'Specify full ordering customer name and account number.',
    });
  } else {
    if (!debtor.name || debtor.name.trim().length === 0) {
      issues.push({
        field: 'parties.debtor.name',
        partyRole: 'DEBTOR',
        severity: 'CRITICAL_MISSING',
        ruleId: 'ORIG_02_DEBTOR_NAME_EMPTY',
        ruleDescription: 'Debtor entity exists but has an empty name field.',
        recommendation: 'Provide complete legal or individual name for the ordering customer.',
      });
    }

    if (!debtor.accountNumber || debtor.accountNumber.trim().length === 0) {
      issues.push({
        field: 'parties.debtor.accountNumber',
        partyRole: 'DEBTOR',
        severity: 'CRITICAL_MISSING',
        ruleId: 'ORIG_03_DEBTOR_ACCOUNT_MISSING',
        ruleDescription: 'Ordering customer account number or identifier is omitted.',
        recommendation: 'Supply IBAN or registered account identifier for the debtor.',
      });
    }

    // Address / National ID checks under Cross-Border Wire Profile
    if (profile === 'FATF_REC16_WIRE_PROFILE') {
      const hasAddress = debtor.address && (debtor.address.town || debtor.address.country || (debtor.address.rawLines && debtor.address.rawLines.length > 0));
      const hasNationalId = debtor.identifiers.some((id) => id.type === 'NATIONAL_ID' || id.type === 'PASSPORT' || id.type === 'TAX_ID');

      if (!hasAddress && !hasNationalId) {
        issues.push({
          field: 'parties.debtor.address_or_id',
          partyRole: 'DEBTOR',
          severity: 'CRITICAL_MISSING',
          ruleId: 'ORIG_04_DEBTOR_LOCATION_MISSING',
          ruleDescription: 'Ordering customer lacks both physical postal address and official national identity number.',
          recommendation: 'Provide customer physical address (street, town, country) or government-issued ID number to satisfy cross-border wire standards.',
        });
      } else if (debtor.address && !debtor.address.country) {
        issues.push({
          field: 'parties.debtor.address.country',
          partyRole: 'DEBTOR',
          severity: 'WARNING_ENRICHMENT',
          ruleId: 'ORIG_05_DEBTOR_COUNTRY_CODE',
          ruleDescription: 'Debtor address provided but ISO 3166-1 country code is omitted.',
          recommendation: 'Include explicit 2-letter country code for geographic risk screening.',
        });
      }
    }
  }

  // 2. Creditor Verification
  if (!creditor) {
    issues.push({
      field: 'parties.creditor',
      partyRole: 'CREDITOR',
      severity: 'CRITICAL_MISSING',
      ruleId: 'BEN_01_CREDITOR_MANDATORY',
      ruleDescription: 'Transaction lacks an identifiable beneficiary customer / creditor party.',
      recommendation: 'Specify complete beneficiary customer name and account.',
    });
  } else {
    if (!creditor.name || creditor.name.trim().length === 0) {
      issues.push({
        field: 'parties.creditor.name',
        partyRole: 'CREDITOR',
        severity: 'CRITICAL_MISSING',
        ruleId: 'BEN_02_CREDITOR_NAME_EMPTY',
        ruleDescription: 'Beneficiary customer entity exists but name is empty.',
        recommendation: 'Supply full legal or individual beneficiary name.',
      });
    }

    if (!creditor.accountNumber || creditor.accountNumber.trim().length === 0) {
      issues.push({
        field: 'parties.creditor.accountNumber',
        partyRole: 'CREDITOR',
        severity: 'CRITICAL_MISSING',
        ruleId: 'BEN_03_CREDITOR_ACCOUNT_MISSING',
        ruleDescription: 'Beneficiary account number (IBAN/BBAN) is missing.',
        recommendation: 'Supply destination account number to permit downstream screening and routing.',
      });
    }
  }

  // 3. Intermediary / Agent Enrichment
  if (!debtorAgent && tx.messageType !== 'PAIN_001') {
    issues.push({
      field: 'parties.debtorAgent',
      partyRole: 'ORDERING_INSTITUTION',
      severity: 'WARNING_ENRICHMENT',
      ruleId: 'INST_01_DEBTOR_AGENT_MISSING',
      ruleDescription: 'Ordering institution (SWIFT :52a or DbtrAgt) not populated in transaction body.',
      recommendation: 'Enrich message with originating financial institution BIC.',
    });
  }

  if (!creditorAgent && tx.messageType !== 'PAIN_001') {
    issues.push({
      field: 'parties.creditorAgent',
      partyRole: 'CREDITOR_AGENT',
      severity: 'WARNING_ENRICHMENT',
      ruleId: 'INST_02_CREDITOR_AGENT_MISSING',
      ruleDescription: 'Beneficiary bank / Creditor Agent (SWIFT :57a or CdtrAgt) omitted.',
      recommendation: 'Specify receiving correspondent bank BIC to enable routing checks.',
    });
  }

  // 4. Currency and Amount Bounding
  if (!tx.amount || tx.amount <= 0) {
    issues.push({
      field: 'amount',
      severity: 'CRITICAL_MISSING',
      ruleId: 'AMT_01_AMOUNT_NON_POSITIVE',
      ruleDescription: 'Transaction settlement amount must be a positive numeric value.',
      recommendation: 'Ensure amount is greater than zero.',
    });
  }

  if (!tx.currency || tx.currency.length !== 3) {
    issues.push({
      field: 'currency',
      severity: 'CRITICAL_MISSING',
      ruleId: 'AMT_02_CURRENCY_INVALID',
      ruleDescription: 'Transaction currency must be a valid 3-letter ISO 4217 code.',
      recommendation: 'Provide valid ISO 4217 currency code (e.g. USD, EUR, GBP).',
    });
  }

  // 5. Unprofiled Message Envelope & Server-Side Extraction Completeness Gate
  const completeness = verifyExtractionCompleteness(tx);
  if (!isVerifiedTestedProfile(tx.messageType, tx.isProfileTested) || !completeness.isComplete) {
    issues.push({
      field: 'messageType',
      severity: 'CRITICAL_MISSING',
      ruleId: 'PROF_01_UNPROFILED_MESSAGE_ENVELOPE',
      ruleDescription:
        completeness.reasons.join(' ') ||
        `Message type ${tx.messageType} is not a verified tested profile or failed server-side extraction completeness verification.`,
      recommendation: 'Route to manual compliance review; unprofiled or partially extracted messages cannot be certified as complete screening.',
    });
  }

  return issues;
}
