/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { runPaymentsTests } from './payments_gateway.test.ts';
import { runMultiModuleTests } from './multi_module_gateway.test.ts';
import { runCodexRemediationTests } from './codex_remediation_regression.test.ts';
import { runMutationChecks } from './isolated_mutations.test.ts';
import { runPaymentsUatSuite } from './payments_uat_remediation.test.ts';
import { runTradeCargoUatSuite } from './trade_cargo_uat_remediation.test.ts';
import { runMaritimeUatSuite } from './maritime_uat_remediation.test.ts';
import { runAirCargoUatSuite } from './air_cargo_uat_remediation.test.ts';
import { runInsuranceUatSuite } from './insurance_uat_remediation.test.ts';
import { runCryptoUatSuite } from './crypto_uat_remediation.test.ts';
import { runHealthcareUatSuite } from './healthcare_uat_remediation.test.ts';
import { runSecuritiesUatSuite } from './securities_uat_remediation.test.ts';
import { runValidationAuditUatSuite } from './validation_audit_uat_remediation.test.ts';
import { runSharedDataPersistenceSuite } from './shared_data_screening_persistence.test.ts';
import { runEvidenceGraphTests } from './evidence_graph.test.ts';
import { runOfficialSourcesAndByoRemediationTests } from './official_sources_and_byo_remediation.test.ts';
import { runWorkflowAndIsolationAcceptanceSuite } from './workflow_and_isolation_acceptance.test.ts';

async function main() {
  console.log('\n======================================================');
  console.log('   ComplianceGate-MCP: Executing All Test Suites      ');
  console.log('======================================================\n');

  const paymentsResult = await runPaymentsTests();
  const multiModuleResult = await runMultiModuleTests();
  const codexResult = await runCodexRemediationTests();
  const mutationResult = await runMutationChecks();
  const uatResult = await runPaymentsUatSuite();
  const tradeCargoUatResult = await runTradeCargoUatSuite();
  const maritimeUatResult = await runMaritimeUatSuite();
  const airCargoUatResult = await runAirCargoUatSuite();
  const insuranceUatResult = await runInsuranceUatSuite();
  const cryptoUatResult = await runCryptoUatSuite();
  const healthcareUatResult = await runHealthcareUatSuite();
  const securitiesUatResult = await runSecuritiesUatSuite();
  const validationAuditUatResult = await runValidationAuditUatSuite();
  const sharedDataResult = await runSharedDataPersistenceSuite();
  const evidenceGraphResult = await runEvidenceGraphTests();
  const officialSourcesResult = await runOfficialSourcesAndByoRemediationTests();
  const workflowIsolationResult = await runWorkflowAndIsolationAcceptanceSuite();

  const totalPassed =
    paymentsResult.passed +
    multiModuleResult.passed +
    codexResult.passed +
    mutationResult.passedMutations +
    uatResult.passed +
    tradeCargoUatResult.passed +
    maritimeUatResult.passed +
    airCargoUatResult.passed +
    insuranceUatResult.passed +
    cryptoUatResult.passed +
    healthcareUatResult.passed +
    securitiesUatResult.passed +
    validationAuditUatResult.passed +
    sharedDataResult.passed +
    evidenceGraphResult.passed +
    officialSourcesResult.passed +
    workflowIsolationResult.passed;
  const totalFailed =
    paymentsResult.failed +
    multiModuleResult.failed +
    codexResult.failed +
    (mutationResult.totalMutations - mutationResult.passedMutations) +
    uatResult.failed +
    tradeCargoUatResult.failed +
    maritimeUatResult.failed +
    airCargoUatResult.failed +
    insuranceUatResult.failed +
    cryptoUatResult.failed +
    healthcareUatResult.failed +
    securitiesUatResult.failed +
    validationAuditUatResult.failed +
    sharedDataResult.failed +
    evidenceGraphResult.failed +
    officialSourcesResult.failed +
    workflowIsolationResult.failed;

  console.log('\n======================================================');
  console.log(`GRAND TOTAL: ${totalPassed} Passed, ${totalFailed} Failed`);
  console.log('======================================================\n');

  if (totalFailed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal test runner execution failure:', err);
  process.exit(1);
});
