/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CanonicalPaymentTransaction,
  PaymentScreeningResult,
} from '../shared/types.ts';
import { unifiedParserFactory } from './services/parsers/parserFactory.ts';
import { auditPaymentMissingData } from './services/missingDataEngine.ts';
import { paymentStoreService } from './services/paymentStore.ts';
import { watchlistService } from './services/watchlist.ts';
import { SYNTHETIC_PAYMENT_FIXTURES, MULTI_MODULE_FIXTURES } from './services/syntheticFixtures.ts';
import { evaluateTradeAndCargo } from './services/modules/tradeAndCargoService.ts';
import { evaluateMaritimeVessel } from './services/modules/maritimeService.ts';
import { evaluateAirCargo } from './services/modules/airCargoService.ts';
import { evaluateInsurancePolicy } from './services/modules/insuranceService.ts';
import { evaluateCryptoTransfer } from './services/modules/cryptoService.ts';
import { evaluateHealthcareClaim } from './services/modules/healthcareService.ts';
import { evaluateSecuritiesOrder } from './services/modules/securitiesService.ts';
import { runValidationAndAuditBenchmark } from './services/modules/validationAndAuditService.ts';
import { screeningService } from './services/screeningService.ts';
import { sourceRegistryService } from './services/sourceRegistry.ts';
import { storageRepository } from './services/storage/storageRepository.ts';
import { subjectRepositoryService } from './services/subjectRepository.ts';
import { referenceLookupService } from './services/referenceLookupService.ts';
import { evidenceGraphService } from './services/evidenceGraphService.ts';

import { redactSensitiveDataForAgent } from './services/normalizer.ts';
export { redactSensitiveDataForAgent };

/**
 * MCP Tools Definitions according to the Model Context Protocol specification.
 */
export const MCP_TOOLS = [
  {
    name: 'extract_payment_parties',
    description: 'Extracts standardized canonical payment parties, roles, amounts, and provenance from any SWIFT MT (Categories 1-9: MT101..MT999, including 103, 103 STP, 202 COV, 205 COV, 300, 400, 540-548, 700, 760, 940) or ISO 20022 MX (pacs, pain, camt, head, acmt, admi, auth, colr, fxtr, reda, remt, secl, seev, semt, sese, setr, trea, tsin, tsmt, tsrv, caaa) message via the unified parser factory.',
    inputSchema: {
      type: 'object',
      properties: {
        rawMessage: {
          type: 'string',
          description: 'The raw SWIFT FIN text block or ISO 20022 XML string.',
        },
        formatHint: {
          type: 'string',
          enum: ['SWIFT_MT', 'ISO20022_MX', 'AUTO'],
          description: 'Optional format hint or AUTO detection.',
        },
      },
      required: ['rawMessage'],
    },
  },
  {
    name: 'screen_payment',
    description: 'Executes deterministic sanctions and watchlists screening across extracted payment parties. Returns 2D evaluation matrix (Coverage vs Finding Severity) and server reference token.',
    inputSchema: {
      type: 'object',
      properties: {
        transaction: {
          type: 'object',
          description: 'Canonical payment transaction object obtained from extract_payment_parties.',
        },
      },
      required: ['transaction'],
    },
  },
  {
    name: 'route_payment_alert',
    description: 'Validates a server-held payment reference token (ref_<uuid>) and confirms compliance routing disposition. Enforces that agent scopes cannot bypass or adjudicate alerts.',
    inputSchema: {
      type: 'object',
      properties: {
        referenceId: {
          type: 'string',
          description: 'The opaque server-held reference ID returned by screen_payment.',
        },
      },
      required: ['referenceId'],
    },
  },
  {
    name: 'audit_missing_data',
    description: 'Audits transaction against configurable missing-data profiles (e.g. FATF Recommendation 16 cross-border wire standards) for missing originator or beneficiary details.',
    inputSchema: {
      type: 'object',
      properties: {
        transaction: {
          type: 'object',
          description: 'Canonical payment transaction to audit.',
        },
        profile: {
          type: 'string',
          enum: ['FATF_REC16_WIRE_PROFILE', 'DOMESTIC_ACH_PROFILE', 'BASIC_INTEGRITY_PROFILE'],
          description: 'The missing-data compliance profile to apply.',
        },
      },
      required: ['transaction'],
    },
  },
  {
    name: 'list_health',
    description: 'Queries status, record counts, SHA-256 digests, and freshness TTLs for all registered synthetic screening watchlists.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_payment_evidence',
    description: 'Exports a verified, tamper-evident audit evidence pack for a payment compliance case, verifying SHA-256 hash chains. Redacts sensitive PII for agent callers.',
    inputSchema: {
      type: 'object',
      properties: {
        caseId: {
          type: 'string',
          description: 'The case identifier to retrieve evidence for.',
        },
      },
      required: ['caseId'],
    },
  },
  {
    name: 'generate_test_payments',
    description: 'Provides standardized synthetic test payment fixtures covering MT103, MT202 COV, pacs.008, pacs.004 return, pain.001 batch, and Travel Rule missing data.',
    inputSchema: {
      type: 'object',
      properties: {
        fixtureId: {
          type: 'string',
          description: 'Optional ID of a specific synthetic fixture to retrieve.',
        },
      },
    },
  },
  {
    name: 'screen_trade_and_cargo',
    description: 'Cross-checks trade finance documents (Invoice, Bill of Lading, Packing List, Payment), identifies discrepancy risks, detects dual-use controlled goods (HS/ECCN codes), and screens trade parties.',
    inputSchema: {
      type: 'object',
      properties: {
        invoice: { type: 'object', description: 'Commercial invoice details' },
        billOfLading: { type: 'object', description: 'Ocean B/L or Sea Waybill transport document' },
        packingList: { type: 'object', description: 'Optional packing list' },
        paymentInstruction: { type: 'object', description: 'Optional payment instruction' },
      },
      required: ['invoice', 'billOfLading'],
    },
  },
  {
    name: 'screen_maritime_vessel',
    description: 'Screens maritime vessel identifiers (IMO number Luhn checksum, MMSI, call sign), evaluates registered and beneficial ownership hierarchy, assesses sanctioned port calls, and flags dark AIS activity.',
    inputSchema: {
      type: 'object',
      properties: {
        vessel: { type: 'object', description: 'Vessel identification details including 7-digit IMO number' },
        ownershipHierarchy: { type: 'array', description: 'List of owners, commercial managers, and ISM managers' },
        portsCalled: { type: 'array', description: 'List of ports called or planned with UN/LOCODE' },
        aisSignals: { type: 'object', description: 'Optional AIS transponder and STS transfer data' },
      },
      required: ['vessel', 'ownershipHierarchy', 'portsCalled'],
    },
  },
  {
    name: 'screen_air_cargo',
    description: 'Validates IATA Air Waybill (11-digit mod-7 check digit), compares MAWB/HAWB and manifest routing, flags high-risk transit hubs (THR, DAM, FNJ), and screens for hazardous or dual-use aerospace goods.',
    inputSchema: {
      type: 'object',
      properties: {
        awbNumber: { type: 'string', description: '11-digit IATA AWB number' },
        flightNumber: { type: 'string' },
        originAirport: { type: 'string', description: '3-letter IATA airport code' },
        destinationAirport: { type: 'string', description: '3-letter IATA airport code' },
        transitAirports: { type: 'array', items: { type: 'string' } },
        shipper: { type: 'object' },
        consignee: { type: 'object' },
        cargo: { type: 'object' },
      },
      required: ['awbNumber', 'originAirport', 'destinationAirport', 'shipper', 'consignee', 'cargo'],
    },
  },
  {
    name: 'screen_insurance_policy',
    description: 'Screens policyholders, insured persons, and beneficiaries. Performs Ultimate Beneficial Ownership (UBO) calculation and enforces the OFAC 50% Rule across corporate insureds.',
    inputSchema: {
      type: 'object',
      properties: {
        policyNumber: { type: 'string' },
        lineOfBusiness: { type: 'string' },
        sumInsured: { type: 'number' },
        currency: { type: 'string' },
        screeningStage: { type: 'string', enum: ['PRE_BIND_UNDERWRITING', 'CLAIMS_PAYMENT_CLEARANCE'] },
        policyParties: { type: 'array' },
        corporateEntityUbo: { type: 'object' },
      },
      required: ['policyNumber', 'lineOfBusiness', 'sumInsured', 'currency', 'screeningStage', 'policyParties'],
    },
  },
  {
    name: 'verify_crypto_travel_rule',
    description: 'Validates multi-chain addresses (BTC, ETH, TRON, SOL), flags known sanctioned mixers and exploit clusters (Tornado Cash, Garantex), and audits FATF Recommendation 16 / IVMS 101 Travel Rule data.',
    inputSchema: {
      type: 'object',
      properties: {
        asset: { type: 'string', enum: ['BTC', 'ETH', 'USDT', 'USDC', 'SOL'] },
        amount: { type: 'number' },
        sourceAddress: { type: 'string' },
        sourceNetwork: { type: 'string', enum: ['BITCOIN', 'ETHEREUM', 'TRON', 'SOLANA'] },
        destinationAddress: { type: 'string' },
        destinationNetwork: { type: 'string', enum: ['BITCOIN', 'ETHEREUM', 'TRON', 'SOLANA'] },
        travelRuleData: { type: 'object' },
      },
      required: ['asset', 'amount', 'sourceAddress', 'sourceNetwork', 'destinationAddress', 'destinationNetwork'],
    },
  },
  {
    name: 'verify_healthcare_practitioner',
    description: 'Validates US National Provider Identifier (10-digit NPI via CMS Luhn Mod-10) and DEA number, cross-checks against federal exclusions (OIG-LEIE, SAM.gov), and checks healthcare supply chain integrity.',
    inputSchema: {
      type: 'object',
      properties: {
        claimId: { type: 'string' },
        serviceDate: { type: 'string' },
        billedAmount: { type: 'number' },
        practitioner: { type: 'object' },
        supplier: { type: 'object' },
      },
      required: ['claimId', 'serviceDate', 'billedAmount'],
    },
  },
  {
    name: 'screen_securities_fix',
    description: 'Parses FIX protocol messages (FIX 4.2/4.4/5.0), validates International Securities Identification Numbers (12-character ISIN checksum), and enforces EU & OFAC Sectoral Sanctions (Directives 1-4 debt/equity restrictions).',
    inputSchema: {
      type: 'object',
      properties: {
        rawFixMessage: { type: 'string', description: 'Raw tag-value FIX message with SOH or pipe delimiters' },
        parties: { type: 'array' },
      },
      required: ['rawFixMessage'],
    },
  },
  {
    name: 'run_validation_benchmark',
    description: 'Executes synthetic sanctions evasion testing across 8 evasion typologies (Cyrillic homoglyphs, vowel dropping, inverted names, spacing, container disguise, vessel IMO scrubbing, missing originator account, narrative noise). Benchmarks precision, recall, and verifies historical SHA-256 audit ledger.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'screen_name_and_identifiers',
    description: 'Screens an entity name and typed identifiers across all active official, licensed and internal sanctions sources. Returns complete 4-dimension screening results (input completeness, source coverage, candidate findings, review outcome) pinned to the current active snapshot manifest digest.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Primary entity or personal name to screen' },
        entityType: { type: 'string', enum: ['INDIVIDUAL', 'ORGANIZATION', 'VESSEL', 'AIRCRAFT'] },
        country: { type: 'string', description: 'Country of nationality, domicile or registration' },
        identifiers: { type: 'array', description: 'List of typed identifiers (LEI, TAX_ID, PASSPORT, IMO, NPI, ISIN, etc.)' },
        sourceIds: { type: 'array', items: { type: 'string' }, description: 'Optional list of specific source IDs to screen against' },
        tenantId: { type: 'string', description: 'Tenant identifier for private list scope (defaults to "default")' },
      },
      required: ['name'],
    },
  },
  {
    name: 'list_sources_and_health',
    description: 'Lists all available official sanctions, licensed watchlists and internal lists with their category, enabled state, current active snapshot version, record count, and freshness/health status.',
    inputSchema: {
      type: 'object',
      properties: {
        tenantId: { type: 'string', description: 'Optional tenant scope for private lists' },
      },
    },
  },
  {
    name: 'manage_customer_subject',
    description: 'Registers or updates a customer subject in the persistent register (separate from watchlist entries). Stores customer identifiers and configuration for automated re-screening.',
    inputSchema: {
      type: 'object',
      properties: {
        subjectId: { type: 'string', description: 'Optional unique subject identifier' },
        primaryName: { type: 'string', description: 'Customer legal or personal name' },
        entityType: { type: 'string', enum: ['INDIVIDUAL', 'ORGANIZATION', 'VESSEL', 'AIRCRAFT'] },
        aliases: { type: 'array', items: { type: 'string' } },
        typedIdentifiers: { type: 'array' },
        jurisdiction: { type: 'string' },
        retentionPolicy: { type: 'string', enum: ['PERMANENT', 'ONE_OFF_EPHEMERAL', 'RE_SCREEN_ACTIVE'] },
        tenantId: { type: 'string', description: 'Tenant identifier for isolation' },
      },
      required: ['primaryName'],
    },
  },
  {
    name: 'rescreen_customer_subject',
    description: 'Executes scoped re-screening of a registered customer subject against the current active memory search index. Creates a linked new screening run while preserving prior history.',
    inputSchema: {
      type: 'object',
      properties: {
        subjectId: { type: 'string', description: 'ID of the registered customer subject' },
        tenantId: { type: 'string', description: 'Tenant identifier' },
      },
      required: ['subjectId'],
    },
  },
  {
    name: 'lookup_reference_registry',
    description: 'Performs corporate or healthcare reference lookup against GLEIF LEI, Companies House, or CMS NPPES directory. Strictly separated from adverse screening findings (adverseFinding: false).',
    inputSchema: {
      type: 'object',
      properties: {
        registry: { type: 'string', enum: ['GLEIF_LEI', 'COMPANIES_HOUSE', 'NPPES_NPI'] },
        queryId: { type: 'string', description: 'LEI code, UK company number, or 10-digit NPI' },
      },
      required: ['registry', 'queryId'],
    },
  },
  {
    name: 'get_alert_evidence_graph',
    description: 'Retrieves or generates an Alert Evidence Graph with explicit typed nodes, edges, and provenance for a case, screening run, or module evaluation. Enforces PII redaction for agent contexts.',
    inputSchema: {
      type: 'object',
      properties: {
        graphId: { type: 'string', description: 'ID of an existing saved evidence graph' },
        caseId: { type: 'string', description: 'ID of a payment or compliance case' },
        screeningRunId: { type: 'string', description: 'ID of a multi-dimensional screening run' },
        moduleId: { type: 'string', description: 'Module ID if generating for module evaluation' },
        evaluationPayload: { type: 'object', description: 'Evaluation result payload if generating dynamically' },
        tenantId: { type: 'string', description: 'Tenant identifier' },
      },
    },
  },
];

/**
 * Executes an MCP Tool.
 */
export async function executeMcpTool(name: string, args: any, isAgentCaller = true): Promise<any> {
  switch (name) {
    case 'extract_payment_parties': {
      const raw = args.rawMessage || '';
      const dispatched = unifiedParserFactory.dispatch(raw, args.formatHint);

      const output = {
        header: dispatched.header,
        totalTransactions: dispatched.totalTransactions,
        transactions: dispatched.transactions,
      };
      return isAgentCaller ? redactSensitiveDataForAgent(output) : output;
    }

    case 'screen_payment': {
      const tx = args.transaction as CanonicalPaymentTransaction;
      if (!tx || !tx.parties) {
        throw new Error('Invalid transaction payload: missing parties array.');
      }
      const result = await paymentStoreService.screenTransaction(tx, isAgentCaller ? 'mcp_agent' : 'analyst');
      const response = {
        referenceId: result.referenceId,
        timestamp: result.timestamp,
        coverageStatus: result.coverageStatus,
        findingSeverity: result.findingSeverity,
        highestScore: result.highestScore,
        requiresHumanReview: result.requiresHumanReview,
        missingDataIssuesCount: result.missingDataIssues.length,
        partyOutcomesCount: result.partyOutcomes.length,
        policyVersion: result.policyVersion,
        disclaimer: result.disclaimer,
        staleLists: result.staleLists,
        expiresAt: result.expiresAt,
      };
      return isAgentCaller ? redactSensitiveDataForAgent(response) : response;
    }

    case 'route_payment_alert': {
      const refId = args.referenceId;
      if (!refId) throw new Error('Missing referenceId argument.');
      const result = paymentStoreService.resolveReference(refId, isAgentCaller ? 'mcp_agent' : 'analyst');
      const criticalMissingIssues = result.missingDataIssues?.filter((i: any) => i.severity === 'CRITICAL_MISSING') || [];
      const hasCriticalMissing = criticalMissingIssues.length > 0;
      const requiresHumanReview =
        result.requiresHumanReview ||
        hasCriticalMissing ||
        result.findingSeverity !== 'NO_MATCH_FOUND' ||
        result.coverageStatus === 'INSUFFICIENT';

      let routingAction: 'HUMAN_ONLY_BLOCK' | 'HUMAN_REVIEW_REQUIRED' | 'NO_MATCH_FOUND' = 'NO_MATCH_FOUND';
      if (result.findingSeverity === 'EXACT_IDENTIFIER_MATCH') {
        routingAction = 'HUMAN_ONLY_BLOCK';
      } else if (requiresHumanReview) {
        routingAction = 'HUMAN_REVIEW_REQUIRED';
      }

      const blockingIssueCodes = criticalMissingIssues.map((i: any) => i.code || i.field);
      const requiredCorrections = criticalMissingIssues.map((i: any) => `${i.field}: ${i.description}`);

      let message = 'No matching entries found on active watchlists. Eligible for automated release.';
      if (result.findingSeverity === 'EXACT_IDENTIFIER_MATCH') {
        message = 'Critical candidate identifier hit on sanctions list. Automated release or agent override strictly prohibited.';
      } else if (hasCriticalMissing) {
        message = `Human review required: ${criticalMissingIssues.length} critical missing data issue(s) detected [${blockingIssueCodes.join(', ')}]. Automatic release prohibited until required originator/beneficiary information is supplied.`;
      } else if (result.findingSeverity === 'FUZZY_NAME_CANDIDATE') {
        message = 'Candidate name similarity above threshold. Human compliance review required.';
      } else if (result.coverageStatus === 'INSUFFICIENT') {
        message = 'Screening coverage is INSUFFICIENT (unprofiled message envelope or missing mandatory watchlist/party data). Manual compliance review required.';
      }

      const response = {
        referenceId: result.referenceId,
        transactionId: result.transactionId,
        coverageStatus: result.coverageStatus,
        findingSeverity: result.findingSeverity,
        routingAction,
        requiresHumanReview,
        hasCriticalMissing,
        criticalMissingCount: criticalMissingIssues.length,
        blockingIssueCodes,
        requiredCorrections,
        message,
      };
      return response;
    }

    case 'audit_missing_data': {
      const tx = args.transaction as CanonicalPaymentTransaction;
      if (!tx || !tx.parties) {
        throw new Error('Invalid transaction payload: missing parties array.');
      }
      const profile = args.profile || 'FATF_REC16_WIRE_PROFILE';
      const issues = auditPaymentMissingData(tx, profile);
      return {
        profile,
        totalIssues: issues.length,
        criticalMissingCount: issues.filter((i) => i.severity === 'CRITICAL_MISSING').length,
        warningsCount: issues.filter((i) => i.severity === 'WARNING_ENRICHMENT').length,
        issues: isAgentCaller ? redactSensitiveDataForAgent(issues) : issues,
      };
    }

    case 'list_health': {
      const lists = watchlistService.getAllLists();
      const freshness = watchlistService.checkListFreshness();
      return {
        totalLists: lists.length,
        isFresh: freshness.isFresh,
        staleLists: freshness.staleLists,
        configuredFolders: watchlistService.isPublicDemoMode() ? [] : watchlistService.getConfiguredListFolders(),
        lists: lists.map((l) => ({
          id: l.id,
          name: l.name,
          recordCount: l.recordCount,
          lastUpdated: l.lastUpdated,
          freshnessTtlHours: l.freshnessTtlHours,
          sha256Digest: l.sha256Digest,
          isStale: l.isStale,
        })),
      };
    }

    case 'get_payment_evidence': {
      const caseId = args.caseId;
      const compCase = paymentStoreService.getCase(caseId);
      if (!compCase) throw new Error(`Case not found: ${caseId}`);

      const integrity = paymentStoreService.verifyCaseIntegrity(compCase);
      const evidence = {
        caseId: compCase.caseId,
        createdAt: compCase.createdAt,
        updatedAt: compCase.updatedAt,
        status: compCase.status,
        priority: compCase.priority,
        evidenceHash: compCase.evidenceHash,
        integrityCheck: integrity,
        auditTrailLength: compCase.auditTrail.length,
        auditTrail: compCase.auditTrail,
        transaction: compCase.transaction,
        screeningResult: compCase.screeningResult,
      };
      return isAgentCaller ? redactSensitiveDataForAgent(evidence) : evidence;
    }

    case 'generate_test_payments': {
      if (args.fixtureId) {
        const fixture = SYNTHETIC_PAYMENT_FIXTURES.find((f) => f.id === args.fixtureId);
        if (!fixture) throw new Error(`Fixture not found: ${args.fixtureId}`);
        return fixture;
      }
      return {
        totalFixtures: SYNTHETIC_PAYMENT_FIXTURES.length,
        fixtures: SYNTHETIC_PAYMENT_FIXTURES.map((f) => ({
          id: f.id,
          title: f.title,
          format: f.format,
          messageType: f.messageType,
          description: f.description,
          expectedOutcome: f.expectedOutcome,
        })),
      };
    }

    case 'screen_trade_and_cargo': {
      const evaluation = evaluateTradeAndCargo(args);
      return isAgentCaller ? redactSensitiveDataForAgent(evaluation) : evaluation;
    }

    case 'screen_maritime_vessel': {
      const evaluation = evaluateMaritimeVessel(args);
      return isAgentCaller ? redactSensitiveDataForAgent(evaluation) : evaluation;
    }

    case 'screen_air_cargo': {
      const evaluation = evaluateAirCargo(args);
      return isAgentCaller ? redactSensitiveDataForAgent(evaluation) : evaluation;
    }

    case 'screen_insurance_policy': {
      const evaluation = evaluateInsurancePolicy(args);
      return isAgentCaller ? redactSensitiveDataForAgent(evaluation) : evaluation;
    }

    case 'verify_crypto_travel_rule': {
      const evaluation = evaluateCryptoTransfer(args);
      return isAgentCaller ? redactSensitiveDataForAgent(evaluation) : evaluation;
    }

    case 'verify_healthcare_practitioner': {
      const evaluation = evaluateHealthcareClaim(args);
      return isAgentCaller ? redactSensitiveDataForAgent(evaluation) : evaluation;
    }

    case 'screen_securities_fix': {
      const evaluation = evaluateSecuritiesOrder(args);
      return isAgentCaller ? redactSensitiveDataForAgent(evaluation) : evaluation;
    }

    case 'run_validation_benchmark': {
      const evaluation = runValidationAndAuditBenchmark();
      return isAgentCaller ? redactSensitiveDataForAgent(evaluation) : evaluation;
    }

    case 'screen_name_and_identifiers': {
      const run = await screeningService.screenEntity({
        name: args.name,
        entityType: args.entityType,
        country: args.country,
        identifiers: args.identifiers,
        sourceIds: args.sourceIds,
        tenantId: args.tenantId || 'default',
      });
      return isAgentCaller ? redactSensitiveDataForAgent(run) : run;
    }

    case 'list_sources_and_health': {
      const tenantId = args.tenantId || 'default';
      const sources = sourceRegistryService.listSources(tenantId);
      const manifest = storageRepository.getActiveManifest(tenantId);
      const output = {
        tenantId,
        activeSourcesCount: sources.filter((s) => s.enabled).length,
        totalSourcesCount: sources.length,
        manifestDigest: manifest.manifestDigest,
        sources: sources.map((s) => ({
          id: s.id,
          name: s.name,
          category: s.category,
          enabled: s.enabled,
          healthStatus: s.healthStatus || 'HEALTHY',
          activeVersionTag: s.activeVersionTag,
          recordCount: s.recordCount || 0,
          authoritativeUrl: s.authoritativeUrl,
          termsUrl: s.termsUrl,
        })),
      };
      return isAgentCaller ? redactSensitiveDataForAgent(output) : output;
    }

    case 'manage_customer_subject': {
      const subject = subjectRepositoryService.registerSubject({
        tenantId: args.tenantId || 'default',
        subjectId: args.subjectId,
        primaryName: args.primaryName,
        entityType: args.entityType || 'ORGANIZATION',
        aliases: args.aliases,
        typedIdentifiers: args.typedIdentifiers,
        jurisdiction: args.jurisdiction,
        retentionPolicy: args.retentionPolicy || 'RE_SCREEN_ACTIVE',
        provenance: 'MCP_TOOL_INVOCATION',
      });
      return isAgentCaller ? redactSensitiveDataForAgent(subject) : subject;
    }

    case 'rescreen_customer_subject': {
      const tenantId = args.tenantId || 'default';
      const run = await screeningService.rescreenSubject(args.subjectId, tenantId);
      return isAgentCaller ? redactSensitiveDataForAgent(run) : run;
    }

    case 'lookup_reference_registry': {
      let result;
      if (args.registry === 'GLEIF_LEI') {
        result = referenceLookupService.lookupGleif(args.queryId);
      } else if (args.registry === 'COMPANIES_HOUSE') {
        result = referenceLookupService.lookupCompaniesHouse(args.queryId);
      } else if (args.registry === 'NPPES_NPI') {
        result = referenceLookupService.lookupNppesNpi(args.queryId);
      } else {
        throw new Error(`Unsupported reference registry: ${args.registry}. Must be GLEIF_LEI, COMPANIES_HOUSE, or NPPES_NPI.`);
      }
      return isAgentCaller ? redactSensitiveDataForAgent(result) : result;
    }

    case 'get_alert_evidence_graph': {
      const tenantId = args.tenantId || 'default';
      let graph: any = null;

      if (args.graphId) {
        graph = storageRepository.getEvidenceGraph(args.graphId, tenantId);
      } else if (args.caseId) {
        const compCase = paymentStoreService.getCase(args.caseId, tenantId);
        if (!compCase) throw new Error(`Case not found: ${args.caseId}`);
        graph = evidenceGraphService.buildGraphForPaymentCase(compCase, tenantId);
      } else if (args.screeningRunId) {
        const run = storageRepository.getScreeningRun(args.screeningRunId, tenantId);
        if (!run) throw new Error(`Screening run not found: ${args.screeningRunId}`);
        graph = evidenceGraphService.buildGraphForScreeningRun(run, tenantId);
      } else if (args.moduleId && args.evaluationPayload) {
        graph = evidenceGraphService.buildGraphForModuleEvaluation(args.moduleId, args.evaluationPayload, tenantId);
      } else {
        throw new Error('Must provide either graphId, caseId, screeningRunId, or moduleId + evaluationPayload.');
      }

      if (!graph) throw new Error('Evidence graph could not be resolved or generated.');
      return isAgentCaller ? evidenceGraphService.redactGraphForAgent(graph) : graph;
    }

    default:
      throw new Error(`Unknown MCP tool: ${name}`);
  }
}

/**
 * Creates and initializes an official MCP SDK Server instance.
 */
export function createOfficialMcpServer(isAgentContext = true): Server {
  const server = new Server(
    {
      name: 'ComplianceGate-MCP',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // List tools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: MCP_TOOLS,
    };
  });

  // Call tool handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: toolArgs } = request.params;
    const toolResult = await executeMcpTool(name, toolArgs || {}, isAgentContext);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(toolResult, null, 2),
        },
      ],
    };
  });

  return server;
}

// Singleton instances
export const officialMcpServer = createOfficialMcpServer(true);

// Official Streamable HTTP Server Transport
export const mcpStreamableTransport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined, // Stateless streamable HTTP mode
  enableJsonResponse: true,
});

let transportConnected = false;
export async function ensureMcpTransportConnected() {
  if (!transportConnected) {
    await officialMcpServer.connect(mcpStreamableTransport);
    transportConnected = true;
  }
}
