/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import express from 'express';
import { unifiedParserFactory } from './services/parsers/parserFactory.ts';
import { auditPaymentMissingData } from './services/missingDataEngine.ts';
import { paymentStoreService } from './services/paymentStore.ts';
import { watchlistService } from './services/watchlist.ts';
import { embeddedSyntheticEngine, clientRemoteEngineAdapter, goCoreEngineAdapter } from './services/engineAdapter.ts';
import { authService, AuthenticatedPrincipal, Permission } from './services/authService.ts';
import { durableStorage } from './services/durableStorage.ts';
import { moduleWorkflowStore } from './services/moduleWorkflowStore.ts';
import {
  ingestAndEvaluateTradeDocuments,
  ingestAndEvaluateAirWaybill,
  ingestAndEvaluateX12HealthcareClaim,
  ingestAndEvaluateAcordPolicy,
  extractStructuredTradeDocument,
  extractStructuredAirWaybill,
  extractX12HealthcareClaim,
  extractAcordInsurancePolicy,
} from './services/documentIntelligence.ts';
import {
  createOfficialMcpServer,
  redactSensitiveDataForAgent,
} from './mcpServer.ts';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CanonicalPaymentTransaction,
  DEMO_ANALYST_TOKEN,
  COMPLIANCE_MODULES,
} from '../shared/types.ts';
import { SYNTHETIC_PAYMENT_FIXTURES, MULTI_MODULE_FIXTURES } from './services/syntheticFixtures.ts';
import { evaluateTradeAndCargo } from './services/modules/tradeAndCargoService.ts';
import { evaluateMaritimeVessel } from './services/modules/maritimeService.ts';
import { evaluateAirCargo } from './services/modules/airCargoService.ts';
import { evaluateInsurancePolicy } from './services/modules/insuranceService.ts';
import { evaluateCryptoTransfer } from './services/modules/cryptoService.ts';
import { evaluateHealthcareClaim } from './services/modules/healthcareService.ts';
import { evaluateSecuritiesOrder } from './services/modules/securitiesService.ts';
import { runValidationAndAuditBenchmark, runExtendedValidationSuite } from './services/modules/validationAndAuditService.ts';
import { sourceRegistryService } from './services/sourceRegistry.ts';
import { storageRepository } from './services/storage/storageRepository.ts';
import { screeningService } from './services/screeningService.ts';
import { subjectRepositoryService } from './services/subjectRepository.ts';
import { referenceLookupService } from './services/referenceLookupService.ts';
import { memorySearchIndex } from './services/memoryIndex.ts';
import { evidenceGraphService } from './services/evidenceGraphService.ts';
import { parseCsvLine, parseCsvRecords } from './services/sources/officialParsers.ts';

export interface AppOptions {
  isPublicDemo?: boolean;
}

/**
 * Creates and configures the core ComplianceGate-MCP Express application.
 * In PUBLIC_SYNTHETIC_DEMO mode (default):
 *  1. Remote engine outbound network configuration is blocked to prevent SSRF vulnerabilities.
 *  2. Query URL parameter tokens (?token=) are rejected to prevent token leakage in proxy logs/headers.
 *  3. Analyst auth is explicitly scoped as a simulated sandbox session for compliance evaluation.
 */
export function createComplianceApp(options: AppOptions = {}): express.Express {
  const isPublicDemo = options.isPublicDemo !== false;
  const app = express();

  // Middleware: JSON parsing with 500KB safe payload boundary
  app.use(express.json({ limit: '500kb' }));
  app.use(express.text({ type: ['text/*', 'application/xml', 'text/xml'], limit: '500kb' }));

  // Security headers
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-ComplianceGate-Mode', isPublicDemo ? 'PUBLIC_SYNTHETIC_DEMO' : 'ENTERPRISE_GATEWAY');
    next();
  });

  // Authentication helper: Strictly header-based (Authorization: Bearer or x-analyst-token)
  // Query parameter token (?token=...) is strictly disallowed to prevent URL and log leakage.
  const getAuthenticatedPrincipal = (req: express.Request): AuthenticatedPrincipal | null => {
    const authHeader = req.headers['authorization'];
    const analystHeader = req.headers['x-analyst-token'];
    let rawToken = '';

    if (authHeader && authHeader.startsWith('Bearer ')) {
      rawToken = authHeader.slice(7).trim();
    } else if (analystHeader && typeof analystHeader === 'string') {
      rawToken = analystHeader.trim();
    }

    if (!rawToken) return null;
    const principal = authService.verifyToken(rawToken);
    if (!principal) return null;

    // Allow header-scoped tenant in demo token mode for testing
    const reqTenant = req.headers['x-tenant-id'];
    if (principal.authMethod === 'LEGACY_DEMO_TOKEN' && typeof reqTenant === 'string' && reqTenant.trim()) {
      return { ...principal, tenantId: reqTenant.trim() };
    }
    return principal;
  };

  const isAnalystAuthenticated = (req: express.Request): boolean => {
    return getAuthenticatedPrincipal(req) !== null;
  };

  const requireAnalystAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const principal = getAuthenticatedPrincipal(req);
    if (!principal) {
      return res.status(401).json({
        error: 'Unauthorized: Valid analyst session token required in x-analyst-token or Authorization: Bearer header.',
        code: 'AUTH_REQUIRED',
        securityNotice: 'Query-parameter tokens are prohibited. Use header-based analyst authentication.',
      });
    }
    (req as any).principal = principal;
    next();
  };

  const requirePermission = (permission: Permission) => {
    return (req: express.Request, res: express.Response, next: express.NextFunction) => {
      const principal = getAuthenticatedPrincipal(req);
      if (!principal) {
        return res.status(401).json({
          error: 'Unauthorized: Valid session token required.',
          code: 'AUTH_REQUIRED',
        });
      }
      if (!authService.hasPermission(principal, permission)) {
        return res.status(403).json({
          error: `Forbidden: Role [${principal.role}] lacks required permission [${permission}].`,
          code: 'INSUFFICIENT_ROLE_PERMISSION',
          role: principal.role,
          requiredPermission: permission,
        });
      }
      (req as any).principal = principal;
      next();
    };
  };

  // ==========================================
  // Official Streamable HTTP MCP Endpoint (Stateless SDK Transport)
  // ==========================================
  app.post(['/mcp', '/api/mcp'], async (req, res) => {
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      const mcpServer = createOfficialMcpServer(true);
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err: any) {
      console.error('[ComplianceGate-MCP] MCP transport request error:', err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          id: req.body?.id || null,
          error: { code: -32603, message: err?.message || 'MCP transport execution error' },
        });
      }
    }
  });

  // ==========================================
  // Auth & Session Endpoints (Real Login + RBAC + Session Inspection)
  // ==========================================
  app.post('/api/auth/login', (req, res) => {
    try {
      const { username, password } = req.body || {};
      if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required.' });
      }
      const session = authService.authenticateCredentials(username, password);
      res.json(session);
    } catch (err: any) {
      res.status(401).json({ error: err.message || 'Authentication failed.' });
    }
  });

  app.post('/api/auth/logout', requireAnalystAuth, (req, res) => {
    const principal = (req as any).principal as AuthenticatedPrincipal;
    authService.revokeSession(principal.sessionId);
    res.json({ status: 'LOGGED_OUT', sessionId: principal.sessionId });
  });

  app.get('/api/auth/me', requireAnalystAuth, (req, res) => {
    const principal = (req as any).principal as AuthenticatedPrincipal;
    res.json({ principal });
  });

  app.get('/api/auth/session', (req, res) => {
    const principal = getAuthenticatedPrincipal(req);
    const isAuthed = principal !== null;
    res.json({
      isAuthenticated: isAuthed,
      mode: isPublicDemo ? 'PUBLIC_SYNTHETIC_DEMO' : 'AUTHENTICATED_GATEWAY',
      demoToken: DEMO_ANALYST_TOKEN,
      role: principal ? (principal.authMethod === 'LEGACY_DEMO_TOKEN' ? 'compliance_officer_sandbox' : principal.role) : 'unauthenticated_agent',
      rbAcRole: principal ? principal.role : 'UNAUTHENTICATED',
      tenantId: principal?.tenantId || 'default',
      authMethod: principal?.authMethod || 'NONE',
      isProductionCredential: principal?.authMethod === 'SIGNED_SESSION_TOKEN',
      disclaimer:
        'Supports signed HMAC-SHA256 enterprise session tokens (/api/auth/login) with RBAC and tenant isolation, as well as the sandbox demo token.',
    });
  });

  // ==========================================
  // REST API Endpoints for Analyst Dashboard
  // ==========================================

  // 0. Container / Service Health Probe
  app.get('/health', (_req, res) => {
    const freshness = watchlistService.checkListFreshness();
    res.json({
      status: 'UP',
      service: 'ComplianceGate-MCP',
      mode: isPublicDemo ? 'PUBLIC_SYNTHETIC_DEMO' : 'ENTERPRISE_GATEWAY',
      watchlistsFresh: freshness.isFresh,
      configuredListFolders: isPublicDemo ? [] : watchlistService.getConfiguredListFolders(),
    });
  });

  // 1. Parse raw MT or MX payment messages via Unified Parser Factory
  app.post('/api/payments/parse', (req, res) => {
    try {
      const raw = typeof req.body === 'string' ? req.body : req.body?.rawMessage;
      const formatHint = typeof req.body === 'object' ? req.body?.formatHint : undefined;
      if (!raw || typeof raw !== 'string') {
        return res.status(400).json({ error: 'Missing raw payment message in request body.' });
      }

      const dispatched = unifiedParserFactory.dispatch(raw, formatHint);

      res.json({
        header: dispatched.header,
        totalTransactions: dispatched.totalTransactions,
        transactions: dispatched.transactions,
      });
    } catch (err: any) {
      res.status(422).json({ error: `Payment parsing failed: ${err.message}` });
    }
  });

  // 1b. Catalogue of all supported SWIFT MT and ISO 20022 MX message types
  app.get('/api/payments/supported-types', (_req, res) => {
    res.json(unifiedParserFactory.getSupportedMessageCatalog());
  });

  // 2. Deterministically screen a transaction
  app.post('/api/payments/screen', async (req, res) => {
    try {
      let tx = req.body?.transaction as CanonicalPaymentTransaction | undefined;
      if (!tx && typeof req.body?.rawMessage === 'string') {
        const dispatched = unifiedParserFactory.dispatch(req.body.rawMessage);
        tx = dispatched.transactions[0];
      }
      if (!tx || !tx.parties) {
        return res.status(400).json({ error: 'Missing transaction payload with parties array.' });
      }
      const principal = getAuthenticatedPrincipal(req);
      const clientId = principal ? principal.userId : 'agent_caller';
      const tenantId = principal?.tenantId || tx.tenantId || 'default';
      const result = await paymentStoreService.screenTransaction(tx, clientId, tenantId);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: `Screening execution error: ${err.message}` });
    }
  });

  // 3. Resolve and validate server-held result reference
  app.post('/api/payments/route', (req, res) => {
    try {
      const refId = req.body?.referenceId;
      if (!refId) {
        return res.status(400).json({ error: 'Missing referenceId in request body.' });
      }
      const principal = getAuthenticatedPrincipal(req);
      const clientId = principal ? principal.userId : 'agent_caller';
      const result = paymentStoreService.resolveReference(refId, clientId, principal?.tenantId);

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

      res.json({
        ...result,
        routingAction,
        requiresHumanReview,
        hasCriticalMissing,
        criticalMissingCount: criticalMissingIssues.length,
        blockingIssueCodes,
        requiredCorrections,
        message,
      });
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  // 4. Audit missing data fields against profile
  app.post('/api/payments/audit-fields', (req, res) => {
    try {
      const { transaction, profile } = req.body;
      if (!transaction || !transaction.parties) {
        return res.status(400).json({ error: 'Missing transaction payload.' });
      }
      const issues = auditPaymentMissingData(transaction, profile);
      res.json({
        profile: profile || 'FATF_REC16_WIRE_PROFILE',
        issues,
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // 5. Batch processing
  app.post('/api/payments/batch', async (req, res) => {
    try {
      const raw = req.body?.rawBatch;
      if (!raw || typeof raw !== 'string') {
        return res.status(400).json({ error: 'Missing rawBatch text in request body.' });
      }

      const dispatched = unifiedParserFactory.dispatch(raw);
      const transactions = dispatched.transactions;

      const results = [];
      for (const tx of transactions) {
        const screenResult = await paymentStoreService.screenTransaction(tx, 'batch_pipeline');
        results.push({
          transaction: tx,
          screeningResult: screenResult,
        });
      }

      res.json({
        batchId: `batch_${Date.now()}`,
        processedCount: results.length,
        results,
      });
    } catch (err: any) {
      res.status(500).json({ error: `Batch processing failed: ${err.message}` });
    }
  });

  // 6. Case management (Tenant-isolated + RBAC-enforced)
  app.get('/api/cases', (req, res) => {
    const principal = getAuthenticatedPrincipal(req);
    const tenantFilter = principal ? principal.tenantId : 'default';
    const cases = paymentStoreService.getAllCases(tenantFilter);
    // If not authenticated as analyst, redact sensitive PII in case summaries
    if (!principal) {
      return res.json(redactSensitiveDataForAgent(cases));
    }
    res.json(cases);
  });

  app.get('/api/cases/:id', (req, res) => {
    const principal = getAuthenticatedPrincipal(req);
    const rawCase = paymentStoreService.getCase(req.params.id);
    if (!rawCase) {
      return res.status(404).json({ error: 'Case not found.' });
    }
    if (principal && !authService.canAccessTenant(principal, rawCase.tenantId)) {
      return res.status(403).json({ error: 'Forbidden: Cross-tenant case access denied.', code: 'TENANT_ISOLATION_VIOLATION' });
    }
    if (!principal && (rawCase.tenantId || 'default') !== 'default') {
      return res.status(403).json({ error: 'Forbidden: Authentication required for tenant case.', code: 'TENANT_AUTH_REQUIRED' });
    }
    const integrity = paymentStoreService.verifyCaseIntegrity(rawCase);
    const data = {
      ...rawCase,
      integrityCheck: integrity,
    };
    // Redact for unauthenticated callers / agents
    if (!principal) {
      return res.json(redactSensitiveDataForAgent(data));
    }
    res.json(data);
  });

  // Protected: Adjudication requires ADJUDICATE_CASE permission and enforces tenant isolation
  app.post(['/api/cases/:id/adjudicate', '/api/cases/:id/decide'], requirePermission('ADJUDICATE_CASE'), (req, res) => {
    try {
      const principal = (req as any).principal as AuthenticatedPrincipal;
      const decision = req.body?.decision || req.body?.decisionType;
      const { rationale, analystId, analystRole } = req.body;
      if (!decision || !rationale) {
        return res.status(400).json({ error: 'Decision and mandatory rationale are required.' });
      }

      if (decision === 'CONFIRM_ENTITY_MATCH' && !authService.hasPermission(principal, 'CONFIRM_SANCTIONS_MATCH')) {
        return res.status(403).json({
          error: `Forbidden: Role [${principal.role}] is not authorized to issue final CONFIRM_ENTITY_MATCH blocks (requires SENIOR_OFFICER or ADMIN).`,
          code: 'SENIOR_OFFICER_REQUIRED',
        });
      }

      const rawCase = paymentStoreService.getCase(req.params.id);
      if (!rawCase) {
        return res.status(404).json({ error: 'Case not found.' });
      }
      if (!authService.canAccessTenant(principal, rawCase.tenantId)) {
        return res.status(403).json({ error: 'Forbidden: Cross-tenant adjudication prohibited.', code: 'TENANT_ISOLATION_VIOLATION' });
      }

      const updated = paymentStoreService.adjudicateCase(
        req.params.id,
        decision,
        rationale,
        analystId || principal.userId,
        analystRole || (principal.role === 'SENIOR_OFFICER' ? 'senior_sanctions_analyst' : 'compliance_officer'),
        rawCase.tenantId || 'default'
      );

      res.json(updated);
    } catch (err: any) {
      res.status(422).json({ error: err.message });
    }
  });

  app.get('/api/cases/:id/evidence', (req, res) => {
    const principal = getAuthenticatedPrincipal(req);
    const compCase = paymentStoreService.getCase(req.params.id);
    if (!compCase) {
      return res.status(404).json({ error: 'Case not found.' });
    }
    if (principal && !authService.canAccessTenant(principal, compCase.tenantId)) {
      return res.status(403).json({ error: 'Forbidden: Cross-tenant evidence export prohibited.', code: 'TENANT_ISOLATION_VIOLATION' });
    }
    if (!principal && (compCase.tenantId || 'default') !== 'default') {
      return res.status(403).json({ error: 'Forbidden: Authentication required for tenant evidence.', code: 'TENANT_AUTH_REQUIRED' });
    }
    const integrity = paymentStoreService.verifyCaseIntegrity(compCase);
    const graph = evidenceGraphService.buildGraphForPaymentCase(compCase, compCase.tenantId || 'default');
    const bundle = {
      packId: `pack_${compCase.caseId}_${Date.now()}`,
      exportedAt: new Date().toISOString(),
      policyVersion: compCase.policyVersion,
      case: compCase,
      integrityVerification: integrity,
      evidenceGraph: graph,
      disclaimer: 'SYNTHETIC COMPLIANCE GATEWAY EVIDENCE: Demonstrates deterministic audit trail consistency.',
    };

    // If caller is NOT authenticated as analyst, return redacted evidence bundle
    if (!principal) {
      return res.json(redactSensitiveDataForAgent(bundle));
    }
    res.json(bundle);
  });

  // 7. Watchlists health & simulated staleness (stale/refresh requires analyst token)
  app.get('/api/health/lists', (req, res) => {
    const lists = watchlistService.getAllLists();
    const freshness = watchlistService.checkListFreshness();
    res.json({
      isFresh: freshness.isFresh,
      staleLists: freshness.staleLists,
      configuredFolders: isPublicDemo ? [] : watchlistService.getConfiguredListFolders(),
      lists,
    });
  });

  app.post('/api/health/lists/reload', requireAnalystAuth, (_req, res) => {
    if (isPublicDemo) {
      return res.status(403).json({
        error: 'Client watchlist folder loading is disabled in public synthetic demo mode to prevent exposing real list records.',
        code: 'PUBLIC_DEMO_CLIENT_LISTS_DISABLED',
        mode: 'PUBLIC_SYNTHETIC_DEMO',
      });
    }
    const reloadSummary = watchlistService.reloadFromEnvironment();
    res.json({
      status: 'RELOADED',
      ...reloadSummary,
      lists: watchlistService.getAllLists(),
    });
  });

  app.post('/api/health/lists/:id/stale', requireAnalystAuth, (req, res) => {
    const { isStale } = req.body;
    const ok = watchlistService.toggleSimulatedStale(req.params.id, Boolean(isStale));
    if (!ok) return res.status(404).json({ error: 'List not found' });
    res.json({ success: true, listId: req.params.id, isStale: Boolean(isStale) });
  });

  app.post('/api/health/lists/:id/refresh', requireAnalystAuth, (req, res) => {
    const info = watchlistService.refreshList(req.params.id);
    if (!info) return res.status(404).json({ error: 'List not found' });
    res.json(info);
  });

  // 8. Screening engine adapter status & configuration
  app.get('/api/engine/status', async (req, res) => {
    const active = paymentStoreService.getScreeningEngine();
    const health = await active.getHealth();
    res.json(health);
  });

  app.post('/api/engine/select', requireAnalystAuth, (req, res) => {
    const { engineId } = req.body;
    if (engineId === 'CLIENT_REMOTE_ADAPTER') {
      paymentStoreService.setScreeningEngine(clientRemoteEngineAdapter);
    } else if (engineId === 'GO_CORE_NATIVE_V1') {
      paymentStoreService.setScreeningEngine(goCoreEngineAdapter);
    } else {
      paymentStoreService.setScreeningEngine(embeddedSyntheticEngine);
    }
    res.json({ activeEngine: paymentStoreService.getScreeningEngine().id });
  });

  app.get('/api/engine/go-health', async (req, res) => {
    try {
      const health = await goCoreEngineAdapter.getHealth();
      res.json(health);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Go engine health check failed' });
    }
  });

  app.post('/api/engine/go-screen', async (req, res) => {
    try {
      const { rawMessage } = req.body;
      if (!rawMessage) return res.status(400).json({ error: 'rawMessage is required' });
      const result = await goCoreEngineAdapter.parseAndScreenMessageInGo(rawMessage);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Go message screening failed' });
    }
  });

  // 8b. Durable Storage Backup, Restore & WAL Integrity
  app.get('/api/storage/wal-integrity', requirePermission('VIEW_CASES'), (req, res) => {
    res.json(durableStorage.verifyWalIntegrity());
  });

  app.get('/api/storage/backups', requirePermission('MANAGE_STORAGE_BACKUPS'), (req, res) => {
    res.json({ backups: durableStorage.listBackups() });
  });

  app.post('/api/storage/backups', requirePermission('MANAGE_STORAGE_BACKUPS'), (req, res) => {
    try {
      const backup = durableStorage.createBackup(req.body?.label || 'manual');
      res.json(backup);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Backup failed' });
    }
  });

  app.post('/api/storage/restore', requirePermission('MANAGE_STORAGE_BACKUPS'), (req, res) => {
    try {
      const { backupId } = req.body;
      if (!backupId) return res.status(400).json({ error: 'backupId is required' });
      const restored = durableStorage.restoreFromBackup(backupId);
      paymentStoreService.reloadFromDisk();
      res.json({ success: true, backupId, recordCounts: {
        transactions: restored.transactions.length,
        cases: restored.cases.length,
        auditLog: restored.auditLog.length,
      }});
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Restore failed' });
    }
  });

  // 8c. Document Intelligence (PDF / OCR / EDIFACT / Cargo-IMP / X12 / ACORD)
  app.post('/api/documents/trade/ingest', (req, res) => {
    try {
      const { documentType, content } = req.body;
      if (!documentType || !content) {
        return res.status(400).json({ error: 'documentType and content are required' });
      }
      const doc = extractStructuredTradeDocument(documentType, content);
      res.json(doc);
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Trade document extraction failed' });
    }
  });

  app.post('/api/documents/airwaybill/ingest', (req, res) => {
    try {
      const { content } = req.body;
      if (!content) return res.status(400).json({ error: 'content is required' });
      res.json(extractStructuredAirWaybill(content));
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Air waybill extraction failed' });
    }
  });

  app.post('/api/documents/healthcare-x12/ingest', (req, res) => {
    try {
      const { content } = req.body;
      if (!content) return res.status(400).json({ error: 'content is required' });
      res.json(extractX12HealthcareClaim(content));
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'X12 claim extraction failed' });
    }
  });

  app.post('/api/documents/insurance-acord/ingest', (req, res) => {
    try {
      const { content } = req.body;
      if (!content) return res.status(400).json({ error: 'content is required' });
      res.json(extractAcordInsurancePolicy(content));
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'ACORD policy extraction failed' });
    }
  });

  // 8d. Multi-Module Investigation & Reconciliation Workflows
  app.get('/api/workflows', requirePermission('VIEW_CASES'), (req, res) => {
    const user = getAuthenticatedPrincipal(req);
    const moduleId = req.query.moduleId as any;
    const tenantFilter = user && user.role !== 'ADMIN' ? user.tenantId : undefined;
    res.json(moduleWorkflowStore.listWorkflows(tenantFilter, moduleId));
  });

  app.get('/api/workflows/:id', requirePermission('VIEW_CASES'), (req, res) => {
    const wf = moduleWorkflowStore.getWorkflow(req.params.id);
    if (!wf) return res.status(404).json({ error: 'Workflow not found' });
    const user = getAuthenticatedPrincipal(req);
    if (user && !authService.canAccessTenant(user, wf.tenantId)) {
      return res.status(403).json({ error: 'Tenant isolation violation', code: 'TENANT_ISOLATION_VIOLATION' });
    }
    res.json({
      ...wf,
      integrity: moduleWorkflowStore.verifyWorkflowChain(wf.workflowId),
    });
  });

  app.post('/api/workflows', requirePermission('VIEW_CASES'), (req, res) => {
    try {
      const user = getAuthenticatedPrincipal(req);
      const { moduleId, subjectId, subjectSummary, findings } = req.body;
      if (!moduleId || !subjectId) {
        return res.status(400).json({ error: 'moduleId and subjectId are required' });
      }
      const wf = moduleWorkflowStore.createWorkflow({
        tenantId: user?.tenantId || req.body.tenantId || 'tenant_default',
        moduleId,
        subjectId,
        subjectSummary: subjectSummary || subjectId,
        findings: findings || [],
        actorId: user?.username || 'SYNTHETIC_ANALYST',
      });
      res.json(wf);
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Workflow creation failed' });
    }
  });

  app.post('/api/workflows/:id/checklist', requirePermission('ADJUDICATE_CASE'), (req, res) => {
    try {
      const user = getAuthenticatedPrincipal(req);
      const wf = moduleWorkflowStore.getWorkflow(req.params.id);
      if (!wf) return res.status(404).json({ error: 'Workflow not found' });
      if (user && !authService.canAccessTenant(user, wf.tenantId)) {
        return res.status(403).json({ error: 'Tenant isolation violation', code: 'TENANT_ISOLATION_VIOLATION' });
      }
      const { itemId, evidenceNotes } = req.body;
      const updated = moduleWorkflowStore.completeChecklistItem({
        workflowId: req.params.id,
        itemId,
        actorId: user?.username || 'ANALYST_01',
        evidenceNotes,
      });
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Checklist update failed' });
    }
  });

  app.post('/api/workflows/:id/transition', requirePermission('ADJUDICATE_CASE'), (req, res) => {
    try {
      const user = getAuthenticatedPrincipal(req);
      const wf = moduleWorkflowStore.getWorkflow(req.params.id);
      if (!wf) return res.status(404).json({ error: 'Workflow not found' });
      if (user && !authService.canAccessTenant(user, wf.tenantId)) {
        return res.status(403).json({ error: 'Tenant isolation violation', code: 'TENANT_ISOLATION_VIOLATION' });
      }
      const { targetStatus, rationale, assignedRole } = req.body;
      if ((targetStatus === 'REJECTED_BLOCKED' || targetStatus === 'ESCALATED_SENIOR_COMPLIANCE') && user && !authService.hasPermission(user, 'CONFIRM_SANCTIONS_MATCH')) {
        return res.status(403).json({
          error: 'Target status requires SENIOR_OFFICER or ADMIN role.',
          code: 'INSUFFICIENT_ROLE_PRIVILEGE',
        });
      }
      const updated = moduleWorkflowStore.transitionWorkflow({
        workflowId: req.params.id,
        targetStatus,
        actorId: user?.username || 'ANALYST_01',
        rationale,
        assignedRole,
      });
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Workflow transition failed' });
    }
  });

  // Remote configuration endpoint: Enforces strict SSRF protection in public demo mode
  app.post('/api/engine/configure-remote', requireAnalystAuth, (req, res) => {
    if (isPublicDemo) {
      return res.status(403).json({
        error: 'Remote engine outbound configuration is disabled in public synthetic demo mode to prevent SSRF vulnerabilities.',
        code: 'SSRF_PROTECTION_ENABLED',
        mode: 'PUBLIC_SYNTHETIC_DEMO',
        message: 'The public demo operates exclusively with the local deterministic synthetic engine and contract fixtures. Custom remote endpoints cannot be configured in public demo mode.',
      });
    }

    const { endpointUrl, apiKey } = req.body;
    clientRemoteEngineAdapter.setConfiguration(endpointUrl, apiKey);
    res.json({ success: true, message: 'Remote adapter configuration updated.' });
  });

  // 9. Synthetic test fixtures & Module Catalogue
  app.get('/api/fixtures', (req, res) => {
    res.json(SYNTHETIC_PAYMENT_FIXTURES);
  });

  app.get('/api/fixtures/all', (req, res) => {
    res.json({
      payments: SYNTHETIC_PAYMENT_FIXTURES,
      modules: MULTI_MODULE_FIXTURES,
    });
  });

  app.get('/api/modules', (req, res) => {
    res.json(COMPLIANCE_MODULES.filter((m) => m.id !== 'LISTS_AND_DATA_SOURCES'));
  });

  // ==========================================
  // Multi-Module Evaluation REST Endpoints
  // ==========================================

  // Trade and Cargo: Invoice, B/L, Packing List, and Payment cross-checks
  app.post('/api/modules/trade/evaluate', (req, res) => {
    try {
      const evaluation = evaluateTradeAndCargo(req.body);
      const safe = isAnalystAuthenticated(req) ? evaluation : redactSensitiveDataForAgent(evaluation);
      res.json(safe);
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Trade evaluation failed' });
    }
  });

  // Maritime: IMO checksum, ownership hierarchy, port risk & dark AIS
  app.post('/api/modules/maritime/evaluate', (req, res) => {
    try {
      const evaluation = evaluateMaritimeVessel(req.body);
      const safe = isAnalystAuthenticated(req) ? evaluation : redactSensitiveDataForAgent(evaluation);
      res.json(safe);
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Maritime evaluation failed' });
    }
  });

  // Air Cargo: IATA AWB mod-7, routing & hazardous/dual-use cargo
  app.post('/api/modules/air-cargo/evaluate', (req, res) => {
    try {
      const evaluation = evaluateAirCargo(req.body);
      const safe = isAnalystAuthenticated(req) ? evaluation : redactSensitiveDataForAgent(evaluation);
      res.json(safe);
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Air cargo evaluation failed' });
    }
  });

  // Insurance: Policy parties, UBO analysis & OFAC 50% Rule
  app.post('/api/modules/insurance/evaluate', (req, res) => {
    try {
      const evaluation = evaluateInsurancePolicy(req.body);
      const safe = isAnalystAuthenticated(req) ? evaluation : redactSensitiveDataForAgent(evaluation);
      res.json(safe);
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Insurance evaluation failed' });
    }
  });

  // Crypto: Blockchain address validation, mixer risk & IVMS 101 Travel Rule
  app.post('/api/modules/crypto/evaluate', (req, res) => {
    try {
      const evaluation = evaluateCryptoTransfer(req.body);
      const safe = isAnalystAuthenticated(req) ? evaluation : redactSensitiveDataForAgent(evaluation);
      res.json(safe);
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Crypto evaluation failed' });
    }
  });

  // Healthcare: NPI/DEA verification, OIG-LEIE/SAM.gov exclusions & claims review
  app.post('/api/modules/healthcare/evaluate', (req, res) => {
    try {
      const evaluation = evaluateHealthcareClaim(req.body);
      const safe = isAnalystAuthenticated(req) ? evaluation : redactSensitiveDataForAgent(evaluation);
      res.json(safe);
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Healthcare evaluation failed' });
    }
  });

  // Securities: FIX protocol tags, ISIN validation & EU/OFAC sectoral debt/equity restrictions
  app.post('/api/modules/securities/evaluate', (req, res) => {
    try {
      const evaluation = evaluateSecuritiesOrder(req.body);
      const safe = isAnalystAuthenticated(req) ? evaluation : redactSensitiveDataForAgent(evaluation);
      res.json(safe);
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Securities evaluation failed' });
    }
  });

  // Validation & Audit: Synthetic evasion test generation & engine benchmarking
  const handleBenchmark = (req: express.Request, res: express.Response) => {
    try {
      const evaluation = runValidationAndAuditBenchmark();
      const safe = isAnalystAuthenticated(req) ? evaluation : redactSensitiveDataForAgent(evaluation);
      res.json(safe);
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Validation benchmark failed' });
    }
  };

  app.post('/api/modules/validation/benchmark', handleBenchmark);
  app.get('/api/modules/validation/benchmark', handleBenchmark);

  const handleExtended = (req: express.Request, res: express.Response) => {
    try {
      const suite = runExtendedValidationSuite();
      res.json(suite);
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Extended validation suite failed' });
    }
  };

  app.get('/api/modules/validation/extended', handleExtended);
  app.post('/api/modules/validation/extended', handleExtended);

  // ==========================================
  // Shared Data, Screening & Persistence API
  // (BUILD-SPEC-LISTS-SCREENING-PERSISTENCE)
  // ==========================================

  const getEffectiveTenant = (req: express.Request): string => {
    const principal = getAuthenticatedPrincipal(req);
    if (principal?.tenantId) return principal.tenantId;
    const reqHeader = req.headers['x-tenant-id'];
    if (typeof reqHeader === 'string' && reqHeader.trim()) {
      const requested = reqHeader.trim();
      if (requested !== 'default') {
        if (!principal) {
          const err: any = new Error('Authentication required for private tenant access');
          err.statusCode = 401;
          err.code = 'TENANT_AUTHENTICATION_REQUIRED';
          throw err;
        }
        if (!authService.canAccessTenant(principal, requested)) {
          const err: any = new Error('Forbidden: Cross-tenant access prohibited');
          err.statusCode = 403;
          err.code = 'TENANT_ISOLATION_VIOLATION';
          throw err;
        }
      }
      return requested;
    }
    return 'default';
  };

  // 1. Sources Catalogue
  app.get('/api/sources', (req, res) => {
    try {
      const tenantId = getEffectiveTenant(req);
      const sources = sourceRegistryService.listSources(tenantId);
      res.json({ sources, tenantId });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/sources/manifest', (req, res) => {
    try {
      const tenantId = getEffectiveTenant(req);
      const manifest = storageRepository.getActiveManifest(tenantId);
      res.json(manifest);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/sources/index-stats', (req, res) => {
    try {
      const stats = memorySearchIndex.getStats();
      res.json(stats);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/sources/index-rebuild', requirePermission('MANAGE_SOURCES'), async (req, res) => {
    try {
      const tenantId = getEffectiveTenant(req);
      const stats = await memorySearchIndex.rebuildIndex(tenantId);
      res.json({ status: 'REBUILT', stats });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/sources/jobs', (req, res) => {
    try {
      const tenantId = getEffectiveTenant(req);
      const jobs = storageRepository.listImportJobs(tenantId);
      res.json({ jobs, tenantId });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/sources/:id', (req, res) => {
    const tenantId = getEffectiveTenant(req);
    const source = sourceRegistryService.getSource(req.params.id, tenantId);
    if (!source) return res.status(404).json({ error: `Source not found: ${req.params.id}` });
    const snapshots = storageRepository.listSnapshots(req.params.id, tenantId);
    res.json({ source, snapshots });
  });

  app.post('/api/sources/:id/toggle', requirePermission('MANAGE_SOURCES'), (req, res) => {
    try {
      const tenantId = getEffectiveTenant(req);
      const { enabled } = req.body;
      const updated = sourceRegistryService.toggleSource(req.params.id, Boolean(enabled), tenantId);
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/sources/upload', requirePermission('MANAGE_SOURCES'), async (req, res) => {
    try {
      const tenantId = getEffectiveTenant(req);
      const principal = getAuthenticatedPrincipal(req);
      const { sourceId, filename, format, rawContent, autoActivate, bypassQuarantine } = req.body;

      if (!sourceId || !rawContent) {
        return res.status(400).json({ error: 'sourceId and rawContent are mandatory for upload.' });
      }

      const result = await sourceRegistryService.ingestAndValidate({
        sourceId,
        tenantId,
        rawContent,
        filename: filename || 'uploaded_data.csv',
        format: format || 'CSV',
        actor: principal?.username || 'analyst',
        autoActivate: Boolean(autoActivate),
        bypassQuarantine: Boolean(bypassQuarantine),
      });

      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/sources/:id/activate', requirePermission('MANAGE_SOURCES'), async (req, res) => {
    try {
      const principal = getAuthenticatedPrincipal(req);
      const { snapshotId } = req.body;
      if (!snapshotId) return res.status(400).json({ error: 'snapshotId is mandatory for activation.' });
      const tenantId = getEffectiveTenant(req);
      const targetSnap = storageRepository.getSnapshot(snapshotId);
      if (targetSnap && targetSnap.sourceId !== req.params.id) {
        return res.status(400).json({
          error: `Foreign snapshot activation rejected: snapshot '${snapshotId}' belongs to source '${targetSnap.sourceId}', not '${req.params.id}'.`,
          code: 'FOREIGN_SNAPSHOT_REJECTION',
        });
      }
      const manifest = storageRepository.activateSnapshot(snapshotId, principal?.username || 'analyst');
      await memorySearchIndex.rebuildIndex(tenantId);
      res.json({ status: 'ACTIVATED', snapshotId, manifest });
    } catch (err: any) {
      res.status(err.statusCode || 400).json({ error: err.message, code: err.code });
    }
  });

  app.post('/api/sources/:id/rollback', requirePermission('MANAGE_SOURCES'), async (req, res) => {
    try {
      const principal = getAuthenticatedPrincipal(req);
      const { targetSnapshotId } = req.body;
      if (!targetSnapshotId) return res.status(400).json({ error: 'targetSnapshotId is mandatory for rollback.' });
      const manifest = storageRepository.rollbackSnapshot(req.params.id, targetSnapshotId, principal?.username || 'analyst');
      await memorySearchIndex.rebuildIndex(getEffectiveTenant(req));
      res.json({ status: 'ROLLED_BACK', sourceId: req.params.id, targetSnapshotId, manifest });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Official Source Download & Refresh Routes
  app.post('/api/sources/:id/refresh', requirePermission('MANAGE_SOURCES'), async (req, res) => {
    try {
      const principal = getAuthenticatedPrincipal(req);
      const tenantId = getEffectiveTenant(req);
      const result = await sourceRegistryService.refreshSource(req.params.id, tenantId, principal?.username || 'analyst');
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/sources/refresh-all', requirePermission('MANAGE_SOURCES'), async (req, res) => {
    try {
      const tenantId = getEffectiveTenant(req);
      const results = await sourceRegistryService.refreshAllOfficialSources(tenantId);
      res.json({ results });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/sources/upload-preview', requirePermission('MANAGE_SOURCES'), (req, res) => {
    try {
      const tenantId = getEffectiveTenant(req);
      const { rawContent, format, sourceId } = req.body;
      if (!rawContent || !format || !sourceId) {
        return res.status(400).json({ error: 'rawContent, format, and sourceId are required for preview.' });
      }
      const preview = sourceRegistryService.previewUpload(rawContent, format, sourceId, tenantId);
      res.json(preview);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/sources/create-source', requirePermission('MANAGE_SOURCES'), (req, res) => {
    try {
      const tenantId = getEffectiveTenant(req);
      const { sourceId, name, publisher, category, format, description, isRequired } = req.body;
      if (!sourceId || !name || !publisher || !category || !format) {
        return res.status(400).json({ error: 'sourceId, name, publisher, category, and format are mandatory.' });
      }
      const newSource = sourceRegistryService.createCustomSource(
        { sourceId, name, publisher, category, format, description, isRequired },
        tenantId
      );
      res.status(201).json({ status: 'CREATED', source: newSource });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // 2. Shared Multi-Dimension Name Scanner
  app.post('/api/sources/scan', async (req, res) => {
    try {
      const tenantId = getEffectiveTenant(req);
      const { name, entityType, country, identifiers, sourceIds } = req.body;
      const runRecord = await screeningService.screenEntity({
        name,
        entityType,
        country,
        identifiers,
        sourceIds,
        tenantId,
      });

      const safeResult = isAnalystAuthenticated(req) ? runRecord : redactSensitiveDataForAgent(runRecord);
      res.json(safeResult);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // 3. Customer Subject Register (Strict Tenant Isolation)
  app.get('/api/subjects', requirePermission('VIEW_SUBJECTS'), (req, res) => {
    try {
      const tenantId = getEffectiveTenant(req);
      const subjects = subjectRepositoryService.listSubjects(tenantId);
      res.json({ subjects, tenantId });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/subjects', requirePermission('MANAGE_SUBJECTS'), (req, res) => {
    try {
      const tenantId = getEffectiveTenant(req);
      const subject = subjectRepositoryService.registerSubject({
        ...req.body,
        tenantId,
      });
      res.json(subject);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/subjects/:id', requirePermission('VIEW_SUBJECTS'), (req, res) => {
    const tenantId = getEffectiveTenant(req);
    const subject = subjectRepositoryService.getSubject(req.params.id, tenantId);
    if (!subject) return res.status(404).json({ error: `Subject not found: ${req.params.id}` });
    res.json(subject);
  });

  app.delete('/api/subjects/:id', requirePermission('MANAGE_SUBJECTS'), (req, res) => {
    const tenantId = getEffectiveTenant(req);
    const deleted = subjectRepositoryService.deleteSubject(req.params.id, tenantId);
    if (!deleted) return res.status(404).json({ error: `Subject not found or access denied: ${req.params.id}` });
    res.json({ success: true, subjectId: req.params.id });
  });

  app.post('/api/subjects/:id/screen', requirePermission('SCREEN_TRANSACTION'), async (req, res) => {
    try {
      const tenantId = getEffectiveTenant(req);
      const run = await screeningService.rescreenSubject(req.params.id, tenantId);
      res.json(run);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/subjects/:id/rescreen', requirePermission('SCREEN_TRANSACTION'), async (req, res) => {
    try {
      const tenantId = getEffectiveTenant(req);
      const run = await screeningService.rescreenSubject(req.params.id, tenantId);
      res.json(run);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/subjects/rescreen-all', requirePermission('SCREEN_TRANSACTION'), async (req, res) => {
    try {
      const tenantId = getEffectiveTenant(req);
      const result = await screeningService.rescreenAllActiveSubjects(tenantId);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Batch / File Screening Endpoint for Customer Subjects (Intake)
  app.post('/api/subjects/batch-screen', requirePermission('SCREEN_TRANSACTION'), async (req, res) => {
    try {
      const tenantId = getEffectiveTenant(req);
      let subjectsList: Array<{ id?: string; name: string; entityType?: any; country?: string; identifiers?: any[] }> = [];
      const rejectedRows: Array<{ rowNumber: number; reason: string }> = [];

      if (Array.isArray(req.body.subjects)) {
        let rowNum = 1;
        for (const sub of req.body.subjects) {
          const name = typeof sub?.name === 'string' ? sub.name.trim() : '';
          if (!name) {
            rejectedRows.push({ rowNumber: rowNum, reason: 'Missing mandatory name' });
          } else {
            subjectsList.push({
              ...sub,
              name,
              entityType: sub.entityType || 'ORGANIZATION',
              country: sub.country,
              identifiers: sub.identifiers || [],
            });
          }
          rowNum++;
        }
      } else if (typeof req.body.rawContent === 'string') {
        const records = parseCsvRecords(req.body.rawContent);
        if (records.length > 0) {
          const header = records[0].map((h) => h.trim().toLowerCase());
          const nameIdx = header.findIndex((h) => h === 'name' || h === 'entity_name' || h === 'full_name');
          const typeIdx = header.findIndex((h) => h === 'type' || h === 'entity_type');
          const countryIdx = header.findIndex((h) => h === 'country' || h === 'domicile' || h === 'nationality');
          const idIdx = header.findIndex((h) => h === 'id' || h === 'identifier');

          if (nameIdx === -1) {
            return res.status(400).json({ error: 'CSV requires a "name" or "entity_name" header column.' });
          }

          for (let i = 1; i < records.length; i++) {
            const cols = records[i];
            const name = cols[nameIdx]?.trim();
            if (!name) {
              rejectedRows.push({ rowNumber: i + 1, reason: 'Missing mandatory name' });
              continue;
            }
            const type = (typeIdx >= 0 && cols[typeIdx]?.trim()) ? cols[typeIdx].trim().toUpperCase() : 'ORGANIZATION';
            const country = countryIdx >= 0 ? cols[countryIdx]?.trim() : undefined;
            const idVal = idIdx >= 0 ? cols[idIdx]?.trim() : undefined;
            const identifiers = idVal ? [{ type: 'REGISTRATION_NO', value: idVal }] : [];

            subjectsList.push({ id: `sub_${i}`, name, entityType: type as any, country, identifiers });
          }
        }
      } else {
        return res.status(400).json({ error: 'Either subjects array or rawContent CSV string must be provided.' });
      }

      const results = [];
      for (const sub of subjectsList) {
        const record = await screeningService.screenEntity({
          name: sub.name,
          entityType: sub.entityType,
          country: sub.country,
          identifiers: sub.identifiers,
          tenantId,
        });
        results.push(record);
      }

      res.json({
        totalSubmitted: results.length + rejectedRows.length,
        validCount: results.length,
        rejectedCount: rejectedRows.length,
        rejectedRows,
        results: isAnalystAuthenticated(req) ? results : redactSensitiveDataForAgent(results),
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // 4. Screening Runs History (Tenant-Scoped)
  app.get('/api/screenings', requirePermission('VIEW_CASES'), (req, res) => {
    try {
      const tenantId = getEffectiveTenant(req);
      const subjectId = typeof req.query.subjectId === 'string' ? req.query.subjectId : undefined;
      const runs = storageRepository.listScreeningRuns(tenantId, subjectId);
      res.json({ runs, tenantId });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/screenings/:id', requirePermission('VIEW_CASES'), (req, res) => {
    const tenantId = getEffectiveTenant(req);
    const run = storageRepository.getScreeningRun(req.params.id, tenantId);
    if (!run) return res.status(404).json({ error: `Screening run not found: ${req.params.id}` });
    res.json(run);
  });

  // 5. Reference Lookup Endpoints (Separated from Adverse Findings)
  app.get('/api/reference/gleif/:lei', (req, res) => {
    const result = referenceLookupService.lookupGleif(req.params.lei);
    res.json(result);
  });

  app.get('/api/reference/companies-house/:num', (req, res) => {
    const result = referenceLookupService.lookupCompaniesHouse(req.params.num);
    res.json(result);
  });

  app.get('/api/reference/nppes/:npi', (req, res) => {
    const result = referenceLookupService.lookupNppesNpi(req.params.npi);
    res.json(result);
  });

  // 6. Storage Persistence & Cloud Capability Status
  app.get('/api/storage/cloud-status', (req, res) => {
    const status = storageRepository.getCloudPersistenceStatus();
    res.json(status);
  });

  // 7. Alert Evidence Graph Endpoints (Shared Across All Modules)
  app.get('/api/cases/:id/graph', (req, res) => {
    const principal = getAuthenticatedPrincipal(req);
    const compCase = paymentStoreService.getCase(req.params.id);
    if (!compCase) {
      return res.status(404).json({ error: `Case not found: ${req.params.id}` });
    }
    const tenantId = compCase.tenantId || 'default';
    if (principal && !authService.canAccessTenant(principal, tenantId)) {
      return res.status(403).json({ error: 'Forbidden: Cross-tenant graph access prohibited.', code: 'TENANT_ISOLATION_VIOLATION' });
    }

    let graph = storageRepository.getEvidenceGraphByCaseId(req.params.id, tenantId);
    if (!graph) {
      graph = evidenceGraphService.buildGraphForPaymentCase(compCase, tenantId);
      storageRepository.saveEvidenceGraph(graph);
    }

    if (principal) {
      graph = evidenceGraphService.filterGraphForRole(graph, principal.role, tenantId);
    } else {
      graph = evidenceGraphService.redactGraphForAgent(graph);
    }
    res.json(graph);
  });

  app.get('/api/screenings/:id/graph', (req, res) => {
    const principal = getAuthenticatedPrincipal(req);
    const requestedTenant = principal?.tenantId || (req.query.tenantId as string) || (req.headers['x-tenant-id'] as string) || 'default';
    if (requestedTenant !== 'default' && !principal) {
      return res.status(401).json({ error: 'Authentication required to access private tenant screening graph.', code: 'TENANT_AUTHENTICATION_REQUIRED' });
    }
    if (principal && !authService.canAccessTenant(principal, requestedTenant)) {
      return res.status(403).json({ error: 'Forbidden: Cross-tenant graph access prohibited.', code: 'TENANT_ISOLATION_VIOLATION' });
    }
    const tenantId = requestedTenant;
    const run = storageRepository.getScreeningRun(req.params.id, tenantId);
    if (!run) {
      return res.status(404).json({ error: `Screening run not found: ${req.params.id}` });
    }

    let graph = storageRepository.getEvidenceGraphByRunId(req.params.id, tenantId);
    if (!graph) {
      graph = evidenceGraphService.buildGraphForScreeningRun(run, tenantId);
      storageRepository.saveEvidenceGraph(graph);
    }

    if (principal) {
      graph = evidenceGraphService.filterGraphForRole(graph, principal.role, tenantId);
    } else {
      graph = evidenceGraphService.redactGraphForAgent(graph);
    }
    res.json(graph);
  });

  app.get('/api/graphs/:id', (req, res) => {
    const principal = getAuthenticatedPrincipal(req);
    const requestedTenant = principal?.tenantId || (req.query.tenantId as string) || (req.headers['x-tenant-id'] as string) || 'default';
    if (requestedTenant !== 'default' && !principal) {
      return res.status(401).json({ error: 'Authentication required to access private tenant graph.', code: 'TENANT_AUTHENTICATION_REQUIRED' });
    }
    if (principal && !authService.canAccessTenant(principal, requestedTenant)) {
      return res.status(403).json({ error: 'Forbidden: Cross-tenant graph access prohibited.', code: 'TENANT_ISOLATION_VIOLATION' });
    }
    const graph = storageRepository.getEvidenceGraph(req.params.id, requestedTenant);
    if (!graph) {
      return res.status(404).json({ error: `Evidence graph not found: ${req.params.id}` });
    }

    if (graph.tenantId && graph.tenantId !== 'default' && !principal) {
      return res.status(401).json({ error: 'Authentication required to access private tenant graph.', code: 'TENANT_AUTHENTICATION_REQUIRED' });
    }
    if (principal && !authService.canAccessTenant(principal, graph.tenantId)) {
      return res.status(403).json({ error: 'Forbidden: Cross-tenant graph access prohibited.', code: 'TENANT_ISOLATION_VIOLATION' });
    }

    let filtered = principal
      ? evidenceGraphService.filterGraphForRole(graph, principal.role, requestedTenant)
      : evidenceGraphService.redactGraphForAgent(graph);

    res.json(filtered);
  });

  app.get('/api/graphs/:id/export', (req, res) => {
    const principal = getAuthenticatedPrincipal(req);
    const requestedTenant = principal?.tenantId || (req.query.tenantId as string) || (req.headers['x-tenant-id'] as string) || 'default';
    if (requestedTenant !== 'default' && !principal) {
      return res.status(401).json({ error: 'Authentication required to access private tenant export.', code: 'TENANT_AUTHENTICATION_REQUIRED' });
    }
    if (principal && !authService.canAccessTenant(principal, requestedTenant)) {
      return res.status(403).json({ error: 'Forbidden: Cross-tenant export prohibited.', code: 'TENANT_ISOLATION_VIOLATION' });
    }
    const graph = storageRepository.getEvidenceGraph(req.params.id, requestedTenant);
    if (!graph) {
      return res.status(404).json({ error: `Evidence graph not found: ${req.params.id}` });
    }

    if (graph.tenantId && graph.tenantId !== 'default' && !principal) {
      return res.status(401).json({ error: 'Authentication required for private export.', code: 'TENANT_AUTHENTICATION_REQUIRED' });
    }
    if (principal && !authService.canAccessTenant(principal, graph.tenantId)) {
      return res.status(403).json({ error: 'Forbidden: Cross-tenant export prohibited.', code: 'TENANT_ISOLATION_VIOLATION' });
    }

    const exportBundle = {
      packId: `pack_graph_${graph.graphId}_${Date.now()}`,
      exportedAt: new Date().toISOString(),
      graph,
      evidenceDigest: graph.evidenceDigest,
      disclaimer: 'COMPLIANCEGATE ALERT EVIDENCE GRAPH: Cryptographically sealed provenance and structural adjacency projection.',
    };

    if (!principal) {
      return res.json(redactSensitiveDataForAgent(exportBundle));
    }
    res.json(exportBundle);
  });

  app.post('/api/graphs/generate', (req, res) => {
    const principal = getAuthenticatedPrincipal(req);
    const requestedTenant = principal?.tenantId || (req.body.tenantId as string) || (req.headers['x-tenant-id'] as string) || 'default';
    if (requestedTenant !== 'default' && !principal) {
      return res.status(401).json({ error: 'Authentication required for private tenant graph generation.', code: 'TENANT_AUTHENTICATION_REQUIRED' });
    }
    if (principal && !authService.canAccessTenant(principal, requestedTenant)) {
      return res.status(403).json({ error: 'Forbidden: Cross-tenant graph generation prohibited.', code: 'TENANT_ISOLATION_VIOLATION' });
    }
    const tenantId = requestedTenant;
    const { moduleId, payload } = req.body;

    if (!moduleId || !payload) {
      return res.status(400).json({ error: 'Missing mandatory moduleId or payload in request body.' });
    }

    let graph;
    if (moduleId === 'PAYMENTS' && payload.screeningResult && payload.transaction) {
      graph = evidenceGraphService.buildGraphForPaymentScreening(payload.screeningResult, payload.transaction, tenantId);
    } else if (moduleId === 'LISTS_AND_DATA_SOURCES' || (payload.queryEntity && payload.candidates)) {
      graph = evidenceGraphService.buildGraphForScreeningRun(payload, tenantId);
    } else {
      graph = evidenceGraphService.buildGraphForModuleEvaluation(moduleId, payload, tenantId);
    }
    const safeGraph = principal ? graph : evidenceGraphService.redactGraphForAgent(graph);
    res.json(safeGraph);
  });

  // Catch-all 404 for ANY unmatched /api/* route: ALWAYS returns JSON, never HTML SPA!
  app.all('/api/*', (req, res) => {
    res.status(404).json({
      error: `API endpoint not found: ${req.method} ${req.path}`,
      availableEndpoints: [
        '/api/modules/validation/benchmark',
        '/api/modules/validation/extended',
        '/api/modules/payments/screen',
        '/api/modules/trade/evaluate',
        '/api/modules/maritime/evaluate',
        '/api/modules/air-cargo/evaluate',
        '/api/modules/insurance/evaluate',
        '/api/modules/crypto/evaluate',
        '/api/modules/healthcare/evaluate',
        '/api/modules/securities/evaluate',
      ],
    });
  });

  return app;
}
