/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import {
  evaluateCryptoTransfer,
  validateAddressFormat,
  EvaluateCryptoRequest,
  ASSET_NETWORK_COMPATIBILITY,
} from '../server/services/modules/cryptoService.ts';
import { executeMcpTool } from '../server/mcpServer.ts';
import { MULTI_MODULE_FIXTURES } from '../server/services/syntheticFixtures.ts';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
  console.log(`  ✓ PASS: ${message}`);
}

export async function runCryptoUatSuite(): Promise<{ passed: number; failed: number }> {
  console.log('\n================================================================');
  console.log('   RUNNING CRYPTO & TRAVEL RULE UAT REMEDIATION TEST SUITE');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  async function runCheck(name: string, fn: () => void | Promise<void>) {
    console.log(`\n[${name}]`);
    try {
      await fn();
      passed++;
    } catch (err: any) {
      console.error(`  ✗ FAIL: ${name} ->`, err.message);
      failed++;
    }
  }

  // ---------------------------------------------------------------------------
  // Check 1: Sample Fixture Tornado Cash Detection (Positive Control)
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 1: Sample Fixture Tornado Cash Detection (Positive Control)', () => {
    const fixture = MULTI_MODULE_FIXTURES.CRYPTO;
    const result = evaluateCryptoTransfer(fixture);

    assert(result.asset === 'ETH', 'Evaluates sample ETH asset');
    assert(result.sourceAddress.isKnownMixerOrSanctionedCluster === true, 'Identified Tornado.Cash Router');
    assert(result.sourceAddress.attributedEntity === 'Tornado.Cash: Router', 'Attributed to Tornado.Cash: Router');
    assert(result.clearanceStatus === 'BLOCKED_SANCTIONED_ADDRESS', 'Clearance status is BLOCKED_SANCTIONED_ADDRESS');
    assert(result.decisionRecommendation === 'REJECT_SANCTIONS_RISK', 'Recommendation is REJECT_SANCTIONS_RISK');
    assert(result.requiresHumanReview === true, 'Mandatory human compliance review required');
    assert(result.evidenceDigest.length === 64, 'Generated 64-char SHA-256 evidence digest');
  });

  // ---------------------------------------------------------------------------
  // Check 2: Clean Below-Threshold P2P Transfer (Positive Control)
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 2: Clean Below-Threshold P2P Transfer (Positive Control)', () => {
    const cleanBtcReq: EvaluateCryptoRequest = {
      asset: 'BTC',
      amount: 0.005,
      fiatValueUsd: 350.0, // Documented fiat value $350 < $1,000 threshold
      sourceAddress: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT', // Clean unlisted BTC address
      sourceNetwork: 'BITCOIN',
      destinationAddress: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
      destinationNetwork: 'BITCOIN',
    };

    const result = evaluateCryptoTransfer(cleanBtcReq);
    assert(result.clearanceStatus === 'TRANSACTION_PERMITTED', 'Below-threshold clean transfer is permitted');
    assert(result.travelRule.travelRuleStatus === 'NOT_APPLICABLE_BELOW_THRESHOLD', 'Travel rule marked NOT_APPLICABLE_BELOW_THRESHOLD');
    assert(result.travelRule.isTravelRuleApplicable === false, 'Travel Rule not applicable under $1,000 USD');
    assert(result.requiresHumanReview === false, 'No human review required');
  });

  // ---------------------------------------------------------------------------
  // Check 3: Clean Compliant VASP-to-VASP Travel Rule Transfer (Positive Control)
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 3: Clean Compliant VASP-to-VASP Travel Rule Transfer (Positive Control)', () => {
    const compliantUsdcReq: EvaluateCryptoRequest = {
      asset: 'USDC',
      amount: 25000.0, // $25,000 USDC >= $1,000 threshold
      sourceAddress: '0x1111111111111111111111111111111111111111',
      sourceNetwork: 'ETHEREUM',
      destinationAddress: '0x2222222222222222222222222222222222222222',
      destinationNetwork: 'ETHEREUM',
      travelRuleData: {
        originatorVaspName: 'Coinbase Custody Trust',
        originatorVaspLei: '549300COINBASE999',
        isOriginatorVaspVerified: true,
        beneficiaryVaspName: 'Kraken Financial Europe',
        beneficiaryVaspLei: '549300KRAKEN8888',
        isBeneficiaryVaspVerified: true,
        originator: {
          isLegalPerson: true,
          fullName: 'Acme European Holdings BV',
          country: 'NL',
          nationalIdentifierOrLei: '724500ACMEHOLDING',
          addressLines: ['Keizersgracht 421', 'Amsterdam'],
        },
        beneficiary: {
          isLegalPerson: false,
          fullName: 'Emma Charlotte Watson',
          country: 'GB',
          nationalIdentifierOrLei: 'GB-PASSPORT-991244',
          addressLines: ['10 Downing Street', 'London'],
        },
      },
    };

    const result = evaluateCryptoTransfer(compliantUsdcReq);
    assert(result.clearanceStatus === 'TRANSACTION_PERMITTED', 'Fully compliant Travel Rule transfer is permitted');
    assert(result.travelRule.isIvmsPayloadComplete === true, 'IVMS 101 payload is complete');
    assert(result.travelRule.travelRuleStatus === 'TRAVEL_RULE_COMPLIANT', 'Travel Rule marked compliant');
    assert(result.decisionRecommendation === 'APPROVE_CRYPTO_TRANSFER', 'Recommendation is APPROVE_CRYPTO_TRANSFER');
  });

  // ---------------------------------------------------------------------------
  // Check 4: Invalid Wallet Address Syntax (Rejects TRANSACTION_PERMITTED)
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 4: Invalid Wallet Address Syntax (Rejects TRANSACTION_PERMITTED)', () => {
    const invalidAddrReq: EvaluateCryptoRequest = {
      asset: 'ETH',
      amount: 2.5,
      fiatValueUsd: 7500.0,
      sourceAddress: '0xInvalidEthereumAddressNotHex40Chars',
      sourceNetwork: 'ETHEREUM',
      destinationAddress: '0x71C83D482bB6A562283995f7DbD35c391B33B106',
      destinationNetwork: 'ETHEREUM',
    };

    const result = evaluateCryptoTransfer(invalidAddrReq);
    assert(result.clearanceStatus !== 'TRANSACTION_PERMITTED', 'Invalid address must never return TRANSACTION_PERMITTED');
    assert(result.clearanceStatus === 'INVALID_TRANSACTION_PAYLOAD', 'Clearance status marked INVALID_TRANSACTION_PAYLOAD');
    assert(result.sourceAddress.isValidFormat === false, 'Source address isValidFormat is false');
    assert(result.requiresHumanReview === true, 'Requires human review');
  });

  // ---------------------------------------------------------------------------
  // Check 5: Unsupported Blockchain Network Rejection
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 5: Unsupported Blockchain Network Rejection', () => {
    let threw = false;
    try {
      evaluateCryptoTransfer({
        asset: 'ETH',
        amount: 1.0,
        sourceAddress: '0x71C83D482bB6A562283995f7DbD35c391B33B106',
        sourceNetwork: 'POLYGON_UNSUPPORTED' as any,
        destinationAddress: '0x71C83D482bB6A562283995f7DbD35c391B33B106',
        destinationNetwork: 'ETHEREUM',
      });
    } catch (err: any) {
      threw = true;
      assert(err.message.includes('Unsupported source blockchain network'), 'Throws descriptive error on unsupported network');
    }
    assert(threw, 'Unsupported network was rejected');
  });

  // ---------------------------------------------------------------------------
  // Check 6: Asset/Network Incompatibility Detection
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 6: Asset/Network Incompatibility Detection', () => {
    // Attempting to send native BTC on ETHEREUM network
    const mismatchReq: EvaluateCryptoRequest = {
      asset: 'BTC',
      amount: 1.5,
      fiatValueUsd: 105000.0,
      sourceAddress: '0x71C83D482bB6A562283995f7DbD35c391B33B106',
      sourceNetwork: 'ETHEREUM', // Incompatible with BTC
      destinationAddress: '0x71C83D482bB6A562283995f7DbD35c391B33B106',
      destinationNetwork: 'ETHEREUM',
    };

    const result = evaluateCryptoTransfer(mismatchReq);
    assert(result.clearanceStatus !== 'TRANSACTION_PERMITTED', 'Asset/network mismatch must not return TRANSACTION_PERMITTED');
    assert(result.assetNetworkCompatibility?.isCompatible === false, 'isCompatible marked false');
    assert(result.clearanceStatus === 'INVALID_TRANSACTION_PAYLOAD', 'Clearance marked INVALID_TRANSACTION_PAYLOAD');
    assert(result.requiresHumanReview === true, 'Requires human review');
  });

  // ---------------------------------------------------------------------------
  // Check 7: Direct Cross-Chain Network Mismatch
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 7: Direct Cross-Chain Network Mismatch', () => {
    const crossChainReq: EvaluateCryptoRequest = {
      asset: 'USDT',
      amount: 5000.0,
      sourceAddress: '0x71C83D482bB6A562283995f7DbD35c391B33B106',
      sourceNetwork: 'ETHEREUM',
      destinationAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
      destinationNetwork: 'TRON', // Cross chain!
    };

    const result = evaluateCryptoTransfer(crossChainReq);
    assert(result.clearanceStatus !== 'TRANSACTION_PERMITTED', 'Direct cross-chain mismatch must not return TRANSACTION_PERMITTED');
    assert(result.assetNetworkCompatibility?.isCompatible === false, 'Cross-chain mismatch flagged');
    assert(result.clearanceStatus === 'INVALID_TRANSACTION_PAYLOAD', 'Clearance marked INVALID_TRANSACTION_PAYLOAD');
  });

  // ---------------------------------------------------------------------------
  // Check 8: Zero or Negative Amount Rejection
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 8: Zero or Negative Amount Rejection', () => {
    let zeroThrew = false;
    try {
      evaluateCryptoTransfer({
        asset: 'ETH',
        amount: 0,
        sourceAddress: '0x71C83D482bB6A562283995f7DbD35c391B33B106',
        sourceNetwork: 'ETHEREUM',
        destinationAddress: '0x71C83D482bB6A562283995f7DbD35c391B33B106',
        destinationNetwork: 'ETHEREUM',
      });
    } catch (err: any) {
      zeroThrew = true;
      assert(err.message.includes('Amount must be a positive finite number'), 'Throws error on zero amount');
    }
    assert(zeroThrew, 'Zero amount was rejected');

    let negThrew = false;
    try {
      evaluateCryptoTransfer({
        asset: 'ETH',
        amount: -15.5,
        sourceAddress: '0x71C83D482bB6A562283995f7DbD35c391B33B106',
        sourceNetwork: 'ETHEREUM',
        destinationAddress: '0x71C83D482bB6A562283995f7DbD35c391B33B106',
        destinationNetwork: 'ETHEREUM',
      });
    } catch (err: any) {
      negThrew = true;
    }
    assert(negThrew, 'Negative amount was rejected');
  });

  // ---------------------------------------------------------------------------
  // Check 9: Missing Fiat Valuation for Volatile Crypto (No Silent Pass)
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 9: Missing Fiat Valuation for Volatile Crypto (No Silent Pass)', () => {
    const missingValReq: EvaluateCryptoRequest = {
      asset: 'ETH',
      amount: 10.0, // 10 ETH (~$30,000 USD, NOT $10)
      // fiatValueUsd omitted!
      sourceAddress: '0x71C83D482bB6A562283995f7DbD35c391B33B106',
      sourceNetwork: 'ETHEREUM',
      destinationAddress: '0x2222222222222222222222222222222222222222',
      destinationNetwork: 'ETHEREUM',
    };

    const result = evaluateCryptoTransfer(missingValReq);
    assert(result.clearanceStatus !== 'TRANSACTION_PERMITTED', 'Missing valuation must not silently pass');
    assert(result.fiatValuation?.isValuationEstablished === false, 'Valuation is unestablished');
    assert(result.travelRule.travelRuleStatus === 'UNASSESSED_MISSING_VALUATION', 'Status is UNASSESSED_MISSING_VALUATION');
    assert(
      result.travelRule.missingMandatoryFields.includes('MISSING_FIAT_VALUATION'),
      'Missing fields records MISSING_FIAT_VALUATION'
    );
    assert(result.requiresHumanReview === true, 'Requires human review');
  });

  // ---------------------------------------------------------------------------
  // Check 10: Address Lookup Whitespace Bypass Fix (Spaces Around Address)
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 10: Address Lookup Whitespace Bypass Fix (Spaces Around Address)', () => {
    // Leading and trailing spaces around Tornado Cash router address
    const spacedAddress = '   0xd90e2f925da726b50c4ed8d0fb909a43a04d3efe   ';
    const spacedReq: EvaluateCryptoRequest = {
      asset: 'ETH',
      amount: 50.0,
      fiatValueUsd: 150000.0,
      sourceAddress: spacedAddress,
      sourceNetwork: 'ETHEREUM',
      destinationAddress: '0x71C83D482bB6A562283995f7DbD35c391B33B106',
      destinationNetwork: 'ETHEREUM',
    };

    const result = evaluateCryptoTransfer(spacedReq);
    assert(result.sourceAddress.isKnownMixerOrSanctionedCluster === true, 'Identified Tornado Cash despite whitespace');
    assert(result.sourceAddress.attributedEntity === 'Tornado.Cash: Router', 'Attributed to Tornado.Cash Router');
    assert(result.clearanceStatus === 'BLOCKED_SANCTIONED_ADDRESS', 'Blocked sanctioned address despite whitespace');
    assert(result.sourceAddress.rawAddress === spacedAddress, 'Preserved raw address for audit');
    assert(result.sourceAddress.address === '0xd90e2f925da726b50c4ed8d0fb909a43a04d3efe', 'Normalized address for screening and display');
  });

  // ---------------------------------------------------------------------------
  // Check 11: Whitespace-Only VASP and Party Names Rejection
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 11: Whitespace-Only VASP and Party Names Rejection', () => {
    const whitespaceReq: EvaluateCryptoRequest = {
      asset: 'USDT',
      amount: 5000.0,
      sourceAddress: '0x71C83D482bB6A562283995f7DbD35c391B33B106',
      sourceNetwork: 'ETHEREUM',
      destinationAddress: '0x2222222222222222222222222222222222222222',
      destinationNetwork: 'ETHEREUM',
      travelRuleData: {
        originatorVaspName: '   ', // Whitespace VASP
        beneficiaryVaspName: '   ',
        originator: {
          fullName: '   ', // Whitespace name
          country: 'US',
        },
        beneficiary: {
          fullName: '   ',
          country: 'GB',
        },
      },
    };

    const result = evaluateCryptoTransfer(whitespaceReq);
    assert(result.clearanceStatus !== 'TRANSACTION_PERMITTED', 'Whitespace fields must not permit transfer');
    assert(result.travelRule.isIvmsPayloadComplete === false, 'Payload is incomplete');
    assert(result.travelRule.missingMandatoryFields.includes('MISSING_ORIGINATOR_VASP_NAME'), 'Flagged missing originator VASP');
    assert(result.travelRule.missingMandatoryFields.includes('MISSING_BENEFICIARY_VASP_NAME'), 'Flagged missing beneficiary VASP');
    assert(result.travelRule.missingMandatoryFields.includes('MISSING_ORIGINATOR_FULL_NAME'), 'Flagged missing originator name');
    assert(result.travelRule.missingMandatoryFields.includes('MISSING_BENEFICIARY_FULL_NAME'), 'Flagged missing beneficiary name');
  });

  // ---------------------------------------------------------------------------
  // Check 12: Missing / Invalid Country Jurisdiction Rejection
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 12: Missing / Invalid Country Jurisdiction Rejection', () => {
    const invalidCountryReq: EvaluateCryptoRequest = {
      asset: 'USDC',
      amount: 10000.0,
      sourceAddress: '0x71C83D482bB6A562283995f7DbD35c391B33B106',
      sourceNetwork: 'ETHEREUM',
      destinationAddress: '0x2222222222222222222222222222222222222222',
      destinationNetwork: 'ETHEREUM',
      travelRuleData: {
        originatorVaspName: 'Originator VASP Inc',
        beneficiaryVaspName: 'Beneficiary VASP LLC',
        originator: {
          fullName: 'Valid Customer',
          country: 'INVALID_COUNTRY_XYZ', // Invalid ISO
          nationalIdentifierOrLei: 'US-ID-12345',
        },
        beneficiary: {
          fullName: 'Valid Beneficiary',
          country: '', // Empty country
          nationalIdentifierOrLei: 'GB-ID-67890',
        },
      },
    };

    const result = evaluateCryptoTransfer(invalidCountryReq);
    assert(result.clearanceStatus !== 'TRANSACTION_PERMITTED', 'Invalid country must not permit transfer');
    assert(result.travelRule.missingMandatoryFields.includes('INVALID_ORIGINATOR_COUNTRY'), 'Flagged invalid originator country');
    assert(result.travelRule.missingMandatoryFields.includes('INVALID_BENEFICIARY_COUNTRY'), 'Flagged invalid beneficiary country');
    assert(result.requiresHumanReview === true, 'Requires human review');
  });

  // ---------------------------------------------------------------------------
  // Check 13: Whitespace Address Lines & Missing Identifier Rejection
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 13: Whitespace Address Lines & Missing Identifier Rejection', () => {
    const blankAddressReq: EvaluateCryptoRequest = {
      asset: 'USDC',
      amount: 8000.0,
      sourceAddress: '0x71C83D482bB6A562283995f7DbD35c391B33B106',
      sourceNetwork: 'ETHEREUM',
      destinationAddress: '0x2222222222222222222222222222222222222222',
      destinationNetwork: 'ETHEREUM',
      travelRuleData: {
        originatorVaspName: 'Originator VASP Inc',
        beneficiaryVaspName: 'Beneficiary VASP LLC',
        originator: {
          fullName: 'Valid Customer',
          country: 'US',
          nationalIdentifierOrLei: '   ', // Blank identifier
          addressLines: ['   ', ''], // Blank address lines
        },
        beneficiary: {
          fullName: 'Valid Beneficiary',
          country: 'GB',
        },
      },
    };

    const result = evaluateCryptoTransfer(blankAddressReq);
    assert(result.travelRule.missingMandatoryFields.includes('MISSING_ORIGINATOR_IDENTIFIER_OR_ADDRESS'), 'Flagged missing identifier or address');
    assert(result.travelRule.isIvmsPayloadComplete === false, 'Payload marked incomplete');
  });

  // ---------------------------------------------------------------------------
  // Check 14: Originator Matching Demo Watchlist Screened and Flagged
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 14: Originator Matching Demo Watchlist Screened and Flagged', () => {
    const sanctionedOrigReq: EvaluateCryptoRequest = {
      asset: 'USDT',
      amount: 15000.0,
      sourceAddress: '0x71C83D482bB6A562283995f7DbD35c391B33B106',
      sourceNetwork: 'ETHEREUM',
      destinationAddress: '0x2222222222222222222222222222222222222222',
      destinationNetwork: 'ETHEREUM',
      travelRuleData: {
        originatorVaspName: 'Crypto OTC Desk',
        beneficiaryVaspName: 'Apex Custody',
        originator: {
          fullName: 'Dmitry Sergeyevich Volkov', // Sanctioned person on DEMO_OFAC_SDN
          country: 'RU',
          nationalIdentifierOrLei: 'RU-DEMO-8829140',
        },
        beneficiary: {
          fullName: 'Clean Counterparty Ltd',
          country: 'AE',
        },
      },
    };

    const result = evaluateCryptoTransfer(sanctionedOrigReq);
    assert(result.counterpartyScreening?.hasSanctionedParty === true, 'Counterparty screening flagged sanctioned originator');
    assert(result.clearanceStatus === 'BLOCKED_SANCTIONED_ADDRESS', 'Blocked due to sanctioned counterparty');
    assert(result.decisionRecommendation === 'REJECT_SANCTIONS_RISK', 'Decision is REJECT_SANCTIONS_RISK');
    assert(result.requiresHumanReview === true, 'Requires human review');
  });

  // ---------------------------------------------------------------------------
  // Check 15: Beneficiary Matching Sanctions Watchlist Screened and Flagged
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 15: Beneficiary Matching Sanctions Watchlist Screened and Flagged', () => {
    const sanctionedBenReq: EvaluateCryptoRequest = {
      asset: 'USDT',
      amount: 12000.0,
      sourceAddress: '0x71C83D482bB6A562283995f7DbD35c391B33B106',
      sourceNetwork: 'ETHEREUM',
      destinationAddress: '0x2222222222222222222222222222222222222222',
      destinationNetwork: 'ETHEREUM',
      travelRuleData: {
        originatorVaspName: 'Origin VASP',
        beneficiaryVaspName: 'Dest VASP',
        originator: {
          fullName: 'John Clean',
          country: 'US',
        },
        beneficiary: {
          fullName: 'Al-Furqan Foundation', // Sanctioned candidate on DEMO_OFAC_SDN
          country: 'SY',
        },
      },
    };

    const result = evaluateCryptoTransfer(sanctionedBenReq);
    assert(result.counterpartyScreening?.hasSanctionedParty === true, 'Counterparty screening flagged sanctioned beneficiary');
    assert(result.clearanceStatus !== 'TRANSACTION_PERMITTED', 'Must not permit transfer to sanctioned beneficiary');
    assert(result.requiresHumanReview === true, 'Requires human review');
  });

  // ---------------------------------------------------------------------------
  // Check 16: VASP Submitted vs Independently Verified Distinction
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 16: VASP Submitted vs Independently Verified Distinction', () => {
    const unverifiedVaspReq: EvaluateCryptoRequest = {
      asset: 'USDC',
      amount: 5000.0,
      sourceAddress: '0x71C83D482bB6A562283995f7DbD35c391B33B106',
      sourceNetwork: 'ETHEREUM',
      destinationAddress: '0x2222222222222222222222222222222222222222',
      destinationNetwork: 'ETHEREUM',
      travelRuleData: {
        originatorVaspName: 'Self-Reported Unlicensed Exchange',
        isOriginatorVaspVerified: false,
        beneficiaryVaspName: 'Regulated Institutional Custodian',
        isBeneficiaryVaspVerified: true,
        originator: {
          fullName: 'Alice Walker',
          country: 'US',
        },
        beneficiary: {
          fullName: 'Bob Smith',
          country: 'GB',
        },
      },
    };

    const result = evaluateCryptoTransfer(unverifiedVaspReq);
    assert(result.vaspVerification?.isOriginatorVaspVerified === false, 'Originator VASP unverified');
    assert(result.vaspVerification?.originatorVaspSource === 'SUBMITTED_PAYLOAD', 'Marked SUBMITTED_PAYLOAD');
    assert(result.vaspVerification?.isBeneficiaryVaspVerified === true, 'Beneficiary VASP verified');
    assert(result.vaspVerification?.beneficiaryVaspSource === 'INDEPENDENTLY_VERIFIED', 'Marked INDEPENDENTLY_VERIFIED');
  });

  // ---------------------------------------------------------------------------
  // Check 17: Official MCP Tool Execution with PII Redaction
  // ---------------------------------------------------------------------------
  await runCheck('CHECK 17: Official MCP Tool Execution with PII Redaction', async () => {
    const fixture = MULTI_MODULE_FIXTURES.CRYPTO;
    const response = await executeMcpTool('verify_crypto_travel_rule', fixture, true);

    assert(response !== null && typeof response === 'object', 'MCP tool returned valid object');
    assert(response.asset === 'ETH', 'Returned asset ETH');
    assert(response.clearanceStatus === 'BLOCKED_SANCTIONED_ADDRESS', 'Blocked sanctioned address');
    assert(response.evidenceDigest.length === 64, 'Evidence digest generated');
  });

  console.log('\n================================================================');
  console.log(`CRYPTO & TRAVEL RULE UAT RESULTS: ${passed} Passed, ${failed} Failed`);
  console.log('================================================================\n');

  return { passed, failed };
}

if (process.argv[1]?.endsWith('crypto_uat_remediation.test.ts')) {
  runCryptoUatSuite().then((res) => {
    if (res.failed > 0) process.exit(1);
  });
}
