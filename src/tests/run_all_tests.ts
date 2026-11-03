/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { runPaymentsTests } from './payments_gateway.test.ts';
import { runMultiModuleTests } from './multi_module_gateway.test.ts';

async function main() {
  console.log('\n======================================================');
  console.log('   ComplianceGate-MCP: Executing All Test Suites      ');
  console.log('======================================================\n');

  const paymentsResult = await runPaymentsTests();
  const multiModuleResult = await runMultiModuleTests();

  const totalPassed = paymentsResult.passed + multiModuleResult.passed;
  const totalFailed = paymentsResult.failed + multiModuleResult.failed;

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
