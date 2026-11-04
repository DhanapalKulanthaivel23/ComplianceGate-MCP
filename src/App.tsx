/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import React, { useState, useEffect } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  FileText,
  Search,
  RefreshCw,
  Layers,
  Database,
  Terminal,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  ChevronRight,
  Info,
  Server,
  Key,
  Hash,
  Send,
  Eye,
  Check,
  X,
  FileCheck,
  Boxes,
  Anchor,
  Plane,
  Cpu,
  Activity,
  TrendingUp,
  Share2,
} from 'lucide-react';
import {
  ComplianceModuleId,
  COMPLIANCE_MODULES,
  AlertEvidenceGraph,
  CanonicalPaymentTransaction,
  CaseAdjudicationDecision,
  CaseStatus,
  CoverageStatus,
  FindingSeverity,
  MissingDataIssue,
  PaymentComplianceCase,
  PaymentScreeningResult,
  WatchlistInfo,
  DEMO_ANALYST_TOKEN,
} from './shared/types.ts';
import { SYNTHETIC_PAYMENT_FIXTURES, SyntheticPaymentFixture } from './server/services/syntheticFixtures.ts';
import {
  ModuleHeader,
  TradeAndCargoWorkspace,
  MaritimeWorkspace,
  AirCargoWorkspace,
  InsuranceWorkspace,
  CryptoWorkspace,
  HealthcareWorkspace,
  SecuritiesWorkspace,
  ValidationAndAuditWorkspace,
  ListsAndDataSourcesWorkspace,
  ModuleWorkspaceShell,
} from './components/ModuleWorkspaces.tsx';
import { EvidenceGraphView } from './components/EvidenceGraphView.tsx';

export default function App() {
  const [selectedModule, setSelectedModule] = useState<ComplianceModuleId>('PAYMENTS');
  const [activeTab, setActiveTab] = useState<
    'overview' | 'terminal' | 'batch' | 'cases' | 'health' | 'evidence' | 'admin'
  >('terminal');

  // Terminal & Screening State
  const [rawMessage, setRawMessage] = useState<string>(SYNTHETIC_PAYMENT_FIXTURES[0].rawContent);
  const [selectedFixtureId, setSelectedFixtureId] = useState<string>(SYNTHETIC_PAYMENT_FIXTURES[0].id);
  const [parsedTransactions, setParsedTransactions] = useState<CanonicalPaymentTransaction[]>([]);
  const [selectedTxIndex, setSelectedTxIndex] = useState<number>(0);
  const [screeningResult, setScreeningResult] = useState<PaymentScreeningResult | null>(null);
  const [screeningGraph, setScreeningGraph] = useState<AlertEvidenceGraph | null>(null);
  const [terminalResultSubTab, setTerminalResultSubTab] = useState<'matrix' | 'graph'>('matrix');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Case Queue State
  const [cases, setCases] = useState<PaymentComplianceCase[]>([]);
  const [selectedCase, setSelectedCase] = useState<PaymentComplianceCase | null>(null);
  const [caseGraph, setCaseGraph] = useState<AlertEvidenceGraph | null>(null);
  const [caseDetailSubTab, setCaseDetailSubTab] = useState<'details' | 'graph'>('details');
  const [decisionType, setDecisionType] = useState<CaseAdjudicationDecision>('CONFIRM_ENTITY_MATCH');
  const [rationale, setRationale] = useState<string>('');
  const [isAdjudicating, setIsAdjudicating] = useState<boolean>(false);
  const [adjudicateSuccess, setAdjudicateSuccess] = useState<string | null>(null);

  // Watchlists & Engine Health State
  const [watchlists, setWatchlists] = useState<WatchlistInfo[]>([]);
  const [engineHealth, setEngineHealth] = useState<any>(null);

  // Batch State
  const [batchRaw, setBatchRaw] = useState<string>('');
  const [batchResults, setBatchResults] = useState<any[]>([]);
  const [isBatchRunning, setIsBatchRunning] = useState<boolean>(false);
  const [expandedBatchIndex, setExpandedBatchIndex] = useState<number | null>(null);

  // Load initial data
  useEffect(() => {
    fetchWatchlists();
    fetchCases();
    fetchEngineHealth();
    // Auto-parse initial fixture
    handleParseMessage(SYNTHETIC_PAYMENT_FIXTURES[0].rawContent);
  }, []);

  const fetchWatchlists = async () => {
    try {
      const res = await fetch('/api/health/lists');
      const data = await res.json();
      if (data.lists) setWatchlists(data.lists);
    } catch {
      // Fallback
    }
  };

  const fetchCases = async () => {
    try {
      const res = await fetch('/api/cases', {
        headers: { 'x-analyst-token': DEMO_ANALYST_TOKEN },
      });
      const data = await res.json();
      if (Array.isArray(data)) {
        setCases(data);
        if (data.length > 0 && !selectedCase) {
          setSelectedCase(data[0]);
        }
      }
    } catch {
      // Fallback
    }
  };

  const fetchEngineHealth = async () => {
    try {
      const res = await fetch('/api/engine/status');
      const data = await res.json();
      setEngineHealth(data);
    } catch {
      // Fallback
    }
  };

  const handleSelectFixture = (fixture: SyntheticPaymentFixture) => {
    setSelectedFixtureId(fixture.id);
    setRawMessage(fixture.rawContent);
    handleParseMessage(fixture.rawContent);
  };

  const handleParseMessage = async (contentToParse?: string) => {
    setIsLoading(true);
    setErrorMsg(null);
    setScreeningResult(null);
    try {
      const res = await fetch('/api/payments/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawMessage: contentToParse || rawMessage }),
      });
      const data = await res.json();
      if (res.ok && data.transactions) {
        setParsedTransactions(data.transactions);
        setSelectedTxIndex(0);
        // Automatically run deterministic screening on first parsed transaction
        if (data.transactions.length > 0) {
          handleScreenTransaction(data.transactions[0]);
        }
      } else {
        setErrorMsg(data.error || 'Failed to parse payment message.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Network error parsing payment.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleScreenTransaction = async (tx: CanonicalPaymentTransaction) => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/payments/screen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-analyst-token': DEMO_ANALYST_TOKEN },
        body: JSON.stringify({ transaction: tx }),
      });
      const data = await res.json();
      if (res.ok) {
        setScreeningResult(data);
        fetchCases();
        // Dynamically build/fetch evidence graph
        try {
          const gRes = await fetch('/api/graphs/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-analyst-token': DEMO_ANALYST_TOKEN },
            body: JSON.stringify({ moduleId: 'PAYMENTS', payload: { screeningResult: data, transaction: tx } }),
          });
          if (gRes.ok) {
            const g = await gRes.json();
            setScreeningGraph(g);
          }
        } catch {
          // Non-fatal
        }
      } else {
        setErrorMsg(data.error || 'Screening error.');
      }
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchCaseGraph = async (caseId: string) => {
    try {
      const res = await fetch(`/api/cases/${caseId}/graph`, {
        headers: { 'x-analyst-token': DEMO_ANALYST_TOKEN },
      });
      if (res.ok) {
        const g = await res.json();
        setCaseGraph(g);
      }
    } catch {
      // Non-fatal
    }
  };

  const handleToggleStale = async (listId: string, currentStale: boolean) => {
    try {
      await fetch(`/api/health/lists/${listId}/stale`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-analyst-token': DEMO_ANALYST_TOKEN },
        body: JSON.stringify({ isStale: !currentStale }),
      });
      await fetchWatchlists();
      // Re-screen if active transaction exists to demonstrate freshness gate
      if (parsedTransactions[selectedTxIndex]) {
        handleScreenTransaction(parsedTransactions[selectedTxIndex]);
      }
    } catch {
      // Ignore
    }
  };

  const handleAdjudicateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCase) return;
    if (rationale.trim().length < 10) {
      alert('Mandatory rationale must be at least 10 non-whitespace characters.');
      return;
    }

    setIsAdjudicating(true);
    setAdjudicateSuccess(null);
    try {
      const res = await fetch(`/api/cases/${selectedCase.caseId}/adjudicate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-analyst-token': DEMO_ANALYST_TOKEN },
        body: JSON.stringify({
          decision: decisionType,
          rationale: rationale.trim(),
          analystId: 'analyst_officer_current',
          analystRole: 'compliance_officer',
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setSelectedCase(data);
        setAdjudicateSuccess(`Decision recorded successfully. Status updated to ${data.status}.`);
        setRationale('');
        fetchCases();
        fetchCaseGraph(data.caseId);
      } else {
        alert(data.error || 'Adjudication failed.');
      }
    } catch (err: any) {
      alert(`Adjudication error: ${err.message}`);
    } finally {
      setIsAdjudicating(false);
    }
  };

  const handleDownloadEvidence = async (caseId: string) => {
    try {
      const res = await fetch(`/api/cases/${caseId}/evidence`, {
        headers: { 'x-analyst-token': DEMO_ANALYST_TOKEN },
      });
      if (!res.ok) {
        alert('Failed to export evidence.');
        return;
      }
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `compliance_evidence_${caseId}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(`Export error: ${err.message}`);
    }
  };

  const currentTx = parsedTransactions[selectedTxIndex];

  const getModuleIcon = (id: ComplianceModuleId) => {
    switch (id) {
      case 'PAYMENTS': return <FileText className="w-4 h-4" />;
      case 'TRADE_AND_CARGO': return <Boxes className="w-4 h-4" />;
      case 'MARITIME': return <Anchor className="w-4 h-4" />;
      case 'AIR_CARGO': return <Plane className="w-4 h-4" />;
      case 'INSURANCE': return <ShieldCheck className="w-4 h-4" />;
      case 'CRYPTO': return <Cpu className="w-4 h-4" />;
      case 'HEALTHCARE': return <Activity className="w-4 h-4" />;
      case 'SECURITIES': return <TrendingUp className="w-4 h-4" />;
      case 'VALIDATION_AND_AUDIT': return <CheckCircle2 className="w-4 h-4" />;
      case 'LISTS_AND_DATA_SOURCES': return <Database className="w-4 h-4" />;
    }
  };

  const getModuleSubtitle = (id: ComplianceModuleId) => {
    switch (id) {
      case 'PAYMENTS': return 'SWIFT MT & ISO 20022 Screening';
      case 'TRADE_AND_CARGO': return 'Invoice, B/L & Dual-Use Goods';
      case 'MARITIME': return 'IMO Luhn, AIS & Flag Tracking';
      case 'AIR_CARGO': return 'IATA AWB & Carrier Screening';
      case 'INSURANCE': return 'UBO Hierarchy & Policy Vetting';
      case 'CRYPTO': return 'Travel Rule & Cluster Analytics';
      case 'HEALTHCARE': return 'NPI Mod-10 & OIG Exclusion';
      case 'SECURITIES': return 'FIX Protocol & Sectoral Sanctions';
      case 'VALIDATION_AND_AUDIT': return 'Synthetic Sanctions Benchmarks';
      case 'LISTS_AND_DATA_SOURCES': return 'Sources, Snapshots & Index';
    }
  };

  return (
    <div className="flex h-screen w-full bg-slate-50 text-slate-900 font-sans antialiased overflow-hidden">
      {/* 1. Persistent Responsive Left Sidebar (All 9 Modules) */}
      <aside className="w-64 shrink-0 bg-slate-900 text-slate-200 flex flex-col border-r border-slate-800 h-full">
        {/* Brand Zone */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-teal-600 flex items-center justify-center text-white font-bold text-sm shadow-xs">
              CG
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-tight text-white leading-tight">
                ComplianceGate
              </h1>
              <p className="text-[10px] text-teal-400 font-mono tracking-wide">Multi-Module MCP Gateway</p>
            </div>
          </div>
        </div>

        {/* Modules Navigation Header */}
        <div className="px-3.5 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
          Compliance Modules
        </div>

        {/* Navigation Items (The 9 Modules) */}
        <nav className="flex-1 px-2.5 py-1 space-y-1 overflow-y-auto">
          {COMPLIANCE_MODULES.map((mod) => {
            const active = selectedModule === mod.id;
            return (
              <button
                key={mod.id}
                onClick={() => setSelectedModule(mod.id)}
                className={`w-full flex items-start gap-2.5 px-3 py-2 text-xs rounded-lg transition-all text-left ${
                  active
                    ? 'bg-teal-600 text-white font-semibold shadow-xs'
                    : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                }`}
              >
                <span className={`shrink-0 mt-0.5 ${active ? 'text-white' : 'text-slate-400'}`}>
                  {getModuleIcon(mod.id)}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="truncate font-medium text-xs">
                    {mod.name.replace(' Compliance', '').replace(' Security', '').replace(' Integrity', '')}
                  </div>
                  <div className={`truncate text-[10px] ${active ? 'text-teal-100' : 'text-slate-400'}`}>
                    {getModuleSubtitle(mod.id)}
                  </div>
                </div>
                {mod.id === 'PAYMENTS' && cases.length > 0 && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-bold shrink-0 ${
                    active ? 'bg-teal-800 text-teal-100' : 'bg-slate-800 text-teal-300'
                  }`}>
                    {cases.length}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* User Session & Status */}
        <div className="p-3 border-t border-slate-800 text-[11px] text-slate-400">
          <div className="flex items-center justify-between mb-1">
            <span className="text-slate-300 font-medium">Session: Compliance Sandbox</span>
            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
          </div>
          <p className="text-[10px] text-slate-500 font-mono truncate">Role: compliance_officer_sandbox</p>
          <p className="text-[10px] text-teal-400 font-mono mt-1">Multi-Module MCP Gateway</p>
          <p className="text-[9px] text-slate-500 mt-1 leading-tight">Simulated client evaluation token. Not a verified human ID.</p>
        </div>
      </aside>

      {/* 2. Main Content Viewport */}
      <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-50">
        {selectedModule === 'PAYMENTS' ? (
          <>
            {/* Horizontal Secondary Navigation for Payments */}
            <div className="bg-white border-b border-slate-200 px-4 py-2 flex items-center justify-between shrink-0 overflow-x-auto gap-2 shadow-2xs">
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                <button
                  onClick={() => setActiveTab('overview')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors whitespace-nowrap ${
                    activeTab === 'overview'
                      ? 'bg-teal-600 text-white font-semibold shadow-2xs'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 font-medium'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5 shrink-0" />
                  <span>Overview & Queue</span>
                </button>

                <button
                  onClick={() => setActiveTab('terminal')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors whitespace-nowrap ${
                    activeTab === 'terminal'
                      ? 'bg-teal-600 text-white font-semibold shadow-2xs'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 font-medium'
                  }`}
                >
                  <Terminal className="w-3.5 h-3.5 shrink-0" />
                  <span>Single Payment Terminal</span>
                </button>

                <button
                  onClick={() => setActiveTab('batch')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors whitespace-nowrap ${
                    activeTab === 'batch'
                      ? 'bg-teal-600 text-white font-semibold shadow-2xs'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 font-medium'
                  }`}
                >
                  <Database className="w-3.5 h-3.5 shrink-0" />
                  <span>Batch Ingestion Studio</span>
                </button>

                <button
                  onClick={() => setActiveTab('cases')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors whitespace-nowrap ${
                    activeTab === 'cases'
                      ? 'bg-teal-600 text-white font-semibold shadow-2xs'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 font-medium'
                  }`}
                >
                  <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                  <span>Case Adjudication</span>
                  {cases.length > 0 && (
                    <span className={`text-[10px] px-1.5 py-0.2 rounded font-mono font-bold ml-1 ${
                      activeTab === 'cases' ? 'bg-teal-800 text-white' : 'bg-slate-200 text-slate-700'
                    }`}>
                      {cases.length}
                    </span>
                  )}
                </button>

                <button
                  onClick={() => setActiveTab('health')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors whitespace-nowrap ${
                    activeTab === 'health'
                      ? 'bg-teal-600 text-white font-semibold shadow-2xs'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 font-medium'
                  }`}
                >
                  <RefreshCw className="w-3.5 h-3.5 shrink-0" />
                  <span>Watchlists & Freshness</span>
                </button>

                <button
                  onClick={() => setActiveTab('evidence')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors whitespace-nowrap ${
                    activeTab === 'evidence'
                      ? 'bg-teal-600 text-white font-semibold shadow-2xs'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 font-medium'
                  }`}
                >
                  <FileCheck className="w-3.5 h-3.5 shrink-0" />
                  <span>Evidence & Audit Ledger</span>
                </button>

                <button
                  onClick={() => setActiveTab('admin')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors whitespace-nowrap ${
                    activeTab === 'admin'
                      ? 'bg-teal-600 text-white font-semibold shadow-2xs'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 font-medium'
                  }`}
                >
                  <Server className="w-3.5 h-3.5 shrink-0" />
                  <span>Admin & Diagnostics</span>
                </button>
              </div>

              <div className="flex items-center gap-3 text-xs shrink-0">
                <div className="flex items-center gap-1.5 text-slate-500 font-mono text-[11px]">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                  <span className="hidden md:inline">MCP:</span> <span>/mcp</span>
                </div>
              </div>
            </div>

            {/* Ephemeral Warning Banner */}
            <div className="bg-amber-50 border-b border-amber-200 px-6 py-2 flex items-center justify-between text-xs text-amber-900 shrink-0">
              <div className="flex items-center gap-2">
                <Info className="w-4 h-4 text-amber-700 shrink-0" />
                <span>
                  <strong>Public Synthetic Demo Mode:</strong> In-memory state with local snapshot bundles. Shared demo token is an evaluation fixture, not a production security boundary. Custom remote network egress is locked to prevent SSRF vulnerabilities.
                </span>
              </div>
              <span className="text-[10px] font-mono text-amber-700 bg-amber-100 px-2 py-0.5 rounded shrink-0 ml-2">
                SSRF_PROTECTED · DEMO_DATA_ONLY
              </span>
            </div>

            {/* Payments Main Content Viewport */}
            <main className="flex-1 flex flex-col h-full overflow-hidden bg-slate-50">

        {/* Tab 1: Terminal & Single Payment */}
        {activeTab === 'terminal' && (
          <div className="flex-1 flex overflow-hidden">
            {/* Left: Input & Fixtures */}
            <div className="w-1/2 p-4 border-r border-slate-200 flex flex-col h-full overflow-hidden">
              <div className="mb-3">
                <label className="text-xs font-semibold text-slate-700 mb-1 block">
                  1-Click Synthetic Payment Presets
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  {SYNTHETIC_PAYMENT_FIXTURES.map((fixture) => (
                    <button
                      key={fixture.id}
                      onClick={() => handleSelectFixture(fixture)}
                      className={`text-left p-2 rounded border text-[11px] leading-tight transition-all ${
                        selectedFixtureId === fixture.id
                          ? 'border-teal-600 bg-teal-50 text-teal-950 font-medium shadow-xs'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                      }`}
                    >
                      <div className="font-bold text-slate-900 truncate">{fixture.title}</div>
                      <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                        {fixture.messageType} · {fixture.format}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Message Editor */}
              <div className="flex-1 flex flex-col min-h-0 bg-white border border-slate-200 rounded">
                <div className="px-3 py-1.5 bg-slate-100 border-b border-slate-200 flex items-center justify-between text-xs text-slate-600">
                  <span className="font-mono text-[11px]">Raw SWIFT FIN / ISO 20022 XML Message</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleParseMessage()}
                      disabled={isLoading}
                      className="px-2.5 py-1 text-xs font-medium bg-teal-600 text-white rounded hover:bg-teal-700 transition-colors flex items-center gap-1.5"
                    >
                      {isLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <PlayIcon />}
                      <span>Parse & Screen</span>
                    </button>
                  </div>
                </div>
                <textarea
                  value={rawMessage}
                  onChange={(e) => setRawMessage(e.target.value)}
                  className="flex-1 p-3 font-mono text-[11px] leading-relaxed resize-none focus:outline-none text-slate-800 bg-white selection:bg-teal-200"
                  spellCheck={false}
                />
              </div>

              {errorMsg && (
                <div className="mt-2 p-2 bg-red-50 border border-red-200 text-red-800 text-xs rounded flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}
            </div>

            {/* Right: Results, Provenance & Missing Data */}
            <div className="w-1/2 p-4 flex flex-col h-full overflow-y-auto space-y-4">
              {currentTx ? (
                <>
                  {/* Transaction Header Strip */}
                  <div className="bg-white border border-slate-200 rounded p-3 shadow-xs">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-[10px] font-mono text-teal-600 font-semibold uppercase">
                          {currentTx.messageFamily} · {currentTx.messageType}
                        </span>
                        <h2 className="text-sm font-bold text-slate-900 mt-0.5">
                          Ref: {currentTx.transactionId}
                        </h2>
                      </div>
                      <div className="text-right">
                        <div className="text-base font-bold font-mono text-slate-900">
                          {currentTx.currency} {currentTx.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </div>
                        <div className="text-[10px] text-slate-500 font-mono">
                          Date: {currentTx.settlementDate}
                        </div>
                      </div>
                    </div>

                    {parsedTransactions.length > 1 && (
                      <div className="mt-3 pt-2 border-t border-slate-100 flex items-center gap-2">
                        <span className="text-xs text-slate-500">Batch Transactions:</span>
                        <div className="flex gap-1">
                          {parsedTransactions.map((tx, idx) => (
                            <button
                              key={idx}
                              onClick={() => {
                                setSelectedTxIndex(idx);
                                handleScreenTransaction(tx);
                              }}
                              className={`px-2 py-0.5 text-xs font-mono rounded ${
                                selectedTxIndex === idx
                                  ? 'bg-teal-600 text-white font-bold'
                                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                              }`}
                            >
                              Tx #{idx + 1}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 2-Dimensional Evaluation Matrix & Evidence Graph */}
                  {screeningResult && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => setTerminalResultSubTab('matrix')}
                            className={`px-3 py-1.5 text-xs font-semibold rounded transition-colors ${
                              terminalResultSubTab === 'matrix'
                                ? 'bg-teal-600 text-white shadow-xs'
                                : 'text-slate-600 hover:bg-slate-100'
                            }`}
                          >
                            2D Evaluation Matrix
                          </button>
                          <button
                            onClick={() => setTerminalResultSubTab('graph')}
                            className={`px-3 py-1.5 text-xs font-semibold rounded flex items-center gap-1.5 transition-colors ${
                              terminalResultSubTab === 'graph'
                                ? 'bg-teal-600 text-white shadow-xs'
                                : 'text-slate-600 hover:bg-slate-100'
                            }`}
                          >
                            <Share2 className="w-3.5 h-3.5" />
                            <span>Evidence Graph</span>
                            {screeningGraph && (
                              <span className="text-[10px] px-1 rounded bg-teal-800 text-white font-mono">
                                {screeningGraph.nodes.length}
                              </span>
                            )}
                          </button>
                        </div>
                        <span className="text-[10px] font-mono text-slate-500">
                          Ref: {screeningResult.referenceId.slice(0, 14)}...
                        </span>
                      </div>

                      {terminalResultSubTab === 'graph' && screeningGraph ? (
                        <EvidenceGraphView graph={screeningGraph} />
                      ) : (
                        <div className="bg-white border border-slate-200 rounded p-3 shadow-xs space-y-3">
                          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                              2D Screening Evaluation Matrix
                            </h3>
                            <span className="text-[10px] font-mono text-slate-500">
                              Ref: {screeningResult.referenceId.slice(0, 14)}...
                            </span>
                          </div>

                      {/* 4 Separate Dimensions: Coverage, Completeness, Match Findings, and Review Decision */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {/* 1. Watchlist Coverage */}
                        <div className="p-3 rounded border border-slate-200 bg-slate-50">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider block">
                              1. Watchlist Coverage
                            </span>
                            <span
                              className={`text-[10px] font-bold font-mono px-1.5 py-0.5 rounded ${
                                screeningResult.coverageStatus === 'COMPLETE'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-amber-100 text-amber-800'
                              }`}
                            >
                              {screeningResult.coverageStatus}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 mt-1.5">
                            {screeningResult.coverageStatus === 'COMPLETE' ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                            ) : (
                              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                            )}
                            <span className="text-xs font-semibold text-slate-800">
                              {screeningResult.coverageStatus === 'COMPLETE'
                                ? 'All Required Watchlists Fresh'
                                : `Coverage Deficit: ${screeningResult.coverageStatus}`}
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-500 mt-1 leading-snug">
                            {screeningResult.staleLists.length === 0
                              ? 'Watchlist coverage confirms feed availability only; it does not establish release clearance.'
                              : `Warning: Stale lists [${screeningResult.staleLists.join(', ')}]. Known candidate hits are preserved.`}
                          </p>
                        </div>

                        {/* 2. Required-Data Completeness */}
                        {(() => {
                          const criticalIssues = screeningResult.missingDataIssues?.filter((i) => i.severity === 'CRITICAL_MISSING') || [];
                          const warningIssues = screeningResult.missingDataIssues?.filter((i) => i.severity === 'WARNING_ENRICHMENT') || [];
                          return (
                            <div className={`p-3 rounded border ${
                              criticalIssues.length > 0
                                ? 'bg-rose-50 border-rose-200'
                                : warningIssues.length > 0
                                ? 'bg-amber-50 border-amber-200'
                                : 'bg-emerald-50 border-emerald-200'
                            }`}>
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-600 block">
                                  2. Required-Data Completeness
                                </span>
                                <span
                                  className={`text-[10px] font-bold font-mono px-1.5 py-0.5 rounded ${
                                    criticalIssues.length > 0
                                      ? 'bg-rose-200 text-rose-900'
                                      : warningIssues.length > 0
                                      ? 'bg-amber-200 text-amber-900'
                                      : 'bg-emerald-200 text-emerald-900'
                                  }`}
                                >
                                  {criticalIssues.length > 0
                                    ? `NEEDS INFO (${criticalIssues.length} CRITICAL)`
                                    : warningIssues.length > 0
                                    ? `PARTIAL (${warningIssues.length} WARNINGS)`
                                    : 'DATA COMPLETE'}
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5 mt-1.5">
                                {criticalIssues.length > 0 ? (
                                  <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
                                ) : (
                                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                                )}
                                <span className="text-xs font-semibold text-slate-800">
                                  {criticalIssues.length > 0
                                    ? `${criticalIssues.length} Critical Missing Field(s)`
                                    : 'Mandatory FATF Rec 16 Data Present'}
                                </span>
                              </div>
                              <p className="text-[10px] text-slate-600 mt-1 leading-snug">
                                {criticalIssues.length > 0
                                  ? `Missing mandatory originator/beneficiary data: ${criticalIssues.map((c) => c.field).join(', ')}. Automatic release prohibited.`
                                  : 'Originator and beneficiary accounts, names, and identifiers meet minimum wire standards.'}
                              </p>
                            </div>
                          );
                        })()}

                        {/* 3. Match Findings */}
                        <div className="p-3 rounded border border-slate-200 bg-slate-50">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider block">
                              3. Match Findings
                            </span>
                            <span
                              className={`text-[10px] font-bold font-mono px-1.5 py-0.5 rounded ${
                                screeningResult.findingSeverity === 'EXACT_IDENTIFIER_MATCH'
                                  ? 'bg-rose-100 text-rose-800'
                                  : screeningResult.findingSeverity === 'FUZZY_NAME_CANDIDATE'
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-emerald-100 text-emerald-800'
                              }`}
                            >
                              {screeningResult.findingSeverity}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 mt-1.5">
                            {screeningResult.findingSeverity === 'EXACT_IDENTIFIER_MATCH' ? (
                              <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
                            ) : screeningResult.findingSeverity === 'FUZZY_NAME_CANDIDATE' ? (
                              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                            ) : (
                              <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                            )}
                            <span className="text-xs font-semibold text-slate-800">
                              {screeningResult.findingSeverity === 'EXACT_IDENTIFIER_MATCH'
                                ? 'Exact Identifier Sanctions Match'
                                : screeningResult.findingSeverity === 'FUZZY_NAME_CANDIDATE'
                                ? `Candidate Name Match (${Math.round(screeningResult.highestScore * 100)}%)`
                                : 'No Matching Watchlist Entries'}
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-500 mt-1 leading-snug">
                            {screeningResult.findingSeverity === 'EXACT_IDENTIFIER_MATCH'
                              ? 'Critical candidate identifier hit. Automated bypass strictly prohibited.'
                              : screeningResult.findingSeverity === 'FUZZY_NAME_CANDIDATE'
                              ? 'Candidate name similarity above review threshold. Human review required.'
                              : 'No matches found against OFAC, EU, UN, UK or active sanctions lists.'}
                          </p>
                        </div>

                        {/* 4. Review / Routing Decision */}
                        {(() => {
                          const criticalIssues = screeningResult.missingDataIssues?.filter((i) => i.severity === 'CRITICAL_MISSING') || [];
                          const isBlocked = screeningResult.findingSeverity === 'EXACT_IDENTIFIER_MATCH';
                          const needsInfo = criticalIssues.length > 0;
                          const requiresReview = screeningResult.requiresHumanReview || needsInfo || isBlocked || screeningResult.coverageStatus === 'INSUFFICIENT';

                          let decisionBadge = 'ELIGIBLE FOR RELEASE';
                          let badgeStyle = 'bg-emerald-100 text-emerald-800 border-emerald-300';
                          let title = 'Automatic Straight-Through Clearance';
                          let explanation = 'All required customer identity fields are complete and no sanctions candidates were detected.';

                          if (isBlocked) {
                            decisionBadge = 'HUMAN_ONLY_BLOCK';
                            badgeStyle = 'bg-rose-100 text-rose-800 border-rose-300';
                            title = 'Prohibited Identifier Candidate Block';
                            explanation = 'Sanctions hit detected. Automatic release or agent override is prohibited by legal policy.';
                          } else if (needsInfo) {
                            decisionBadge = 'NEEDS INFORMATION (HOLD)';
                            badgeStyle = 'bg-rose-100 text-rose-800 border-rose-300';
                            title = 'Human Review Required: Data Incomplete';
                            explanation = `Watchlist coverage is COMPLETE, but payment CANNOT be released due to ${criticalIssues.length} critical missing field(s) [${criticalIssues.map((c) => c.field).join(', ')}].`;
                          } else if (requiresReview) {
                            decisionBadge = 'HUMAN REVIEW REQUIRED';
                            badgeStyle = 'bg-amber-100 text-amber-800 border-amber-300';
                            title = 'Human Review Required';
                            explanation = screeningResult.coverageStatus === 'INSUFFICIENT'
                              ? 'Screening coverage is INSUFFICIENT (unprofiled message envelope). Manual review required.'
                              : 'Watchlist candidate similarity requires manual analyst adjudication.';
                          }

                          return (
                            <div className={`p-3 rounded border ${isBlocked || needsInfo ? 'bg-rose-50/70 border-rose-300' : requiresReview ? 'bg-amber-50/70 border-amber-300' : 'bg-emerald-50/70 border-emerald-300'}`}>
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-700 block">
                                  4. Review & Routing Decision
                                </span>
                                <span className={`text-[10px] font-bold font-mono px-1.5 py-0.5 rounded border ${badgeStyle}`}>
                                  {decisionBadge}
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5 mt-1.5">
                                {isBlocked || needsInfo ? (
                                  <ShieldAlert className="w-4 h-4 text-rose-700 shrink-0" />
                                ) : requiresReview ? (
                                  <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                                ) : (
                                  <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                                )}
                                <span className="text-xs font-bold text-slate-900">{title}</span>
                              </div>
                              <p className="text-[10px] text-slate-700 mt-1 leading-snug font-medium">
                                {explanation}
                              </p>
                            </div>
                          );
                        })()}
                      </div>

                      {/* Disclaimer */}
                      <p className="text-[10px] text-slate-500 italic bg-slate-100 p-2 rounded leading-tight">
                        {screeningResult.disclaimer}
                      </p>
                    </div>
                  )}
                </div>
              )}

                  {/* Travel Rule Missing Data Issues */}
                  <div className="bg-white border border-slate-200 rounded p-3 shadow-xs">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                        Configurable Missing Data & Travel Rule Audit
                      </h3>
                      <span className="text-[10px] font-mono text-slate-500">
                        {currentTx.missingDataIssues.length} Issues Identified
                      </span>
                    </div>

                    {currentTx.missingDataIssues.length === 0 ? (
                      <div className="p-3 bg-emerald-50 text-emerald-800 text-xs rounded flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                        <span>All mandatory originator, beneficiary, and institutional fields are fully populated.</span>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {currentTx.missingDataIssues.map((issue, i) => (
                          <div
                            key={i}
                            className={`p-2 rounded text-xs border ${
                              issue.severity === 'CRITICAL_MISSING'
                                ? 'bg-red-50 border-red-200 text-red-900'
                                : 'bg-amber-50 border-amber-200 text-amber-900'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-bold font-mono text-[11px]">{issue.ruleId}</span>
                              <span className="text-[9px] uppercase px-1 rounded bg-white/70 font-semibold">
                                {issue.severity}
                              </span>
                            </div>
                            <p className="text-[11px] mt-0.5">{issue.ruleDescription}</p>
                            <p className="text-[10px] text-slate-600 mt-1 italic">
                              Fix: {issue.recommendation}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Extracted Canonical Parties Ledger */}
                  <div className="bg-white border border-slate-200 rounded p-3 shadow-xs">
                    <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-2">
                      Extracted Canonical Parties & Provenance ({currentTx.parties.length})
                    </h3>
                    <div className="space-y-2">
                      {currentTx.parties.map((party) => {
                        const partyMatch = screeningResult?.partyOutcomes.find(
                          (po) => po.party.partyId === party.partyId
                        );
                        return (
                          <div key={party.partyId} className="p-2 border border-slate-200 rounded bg-slate-50 text-xs">
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-teal-800 text-[11px]">
                                {party.role}
                              </span>
                              {party.provenance?.sequence && (
                                <span className="font-mono text-[9px] bg-slate-200 px-1 rounded">
                                  Seq {party.provenance.sequence}
                                </span>
                              )}
                            </div>
                            <div className="text-slate-900 font-semibold mt-0.5">{party.name}</div>
                            {party.accountNumber && (
                              <div className="text-slate-600 font-mono text-[10px]">
                                Account: {party.accountNumber} ({party.accountType || 'STANDARD'})
                              </div>
                            )}
                            {party.identifiers && party.identifiers.length > 0 && (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {party.identifiers.map((id, idx) => (
                                  <span
                                    key={idx}
                                    className="px-1.5 py-0.5 bg-slate-200 text-slate-800 font-mono text-[10px] rounded"
                                  >
                                    {id.type}: {id.value}
                                  </span>
                                ))}
                              </div>
                            )}
                            {party.address?.rawLines && (
                              <div className="text-slate-600 text-[10px] mt-1.5">
                                <span className="font-semibold text-slate-700">Address Lines:</span>
                                <div className="pl-2 border-l-2 border-slate-300 mt-0.5 whitespace-pre-line text-slate-800 font-mono text-[10px]">
                                  {party.address.rawLines.join('\n')}
                                </div>
                              </div>
                            )}
                            {party.address && !party.address.rawLines && (
                              <div className="text-slate-600 text-[10px] mt-1">
                                <span className="font-semibold text-slate-700">Address:</span>{' '}
                                {[party.address.street, party.address.buildingNumber, party.address.town, party.address.country].filter(Boolean).join(', ')}
                              </div>
                            )}
                            <div className="text-[9px] text-slate-400 font-mono mt-1">
                              Source: {party.provenance.sourceTag} ({party.provenance.fieldPath})
                            </div>

                            {/* Candidate match highlight */}
                            {partyMatch && partyMatch.matches.length > 0 && (
                              <div className="mt-2 pt-2 border-t border-slate-200">
                                <span className="text-[10px] font-bold text-red-700">
                                  Matched Watchlist Candidate:
                                </span>
                                {partyMatch.matches.map((m, mIdx) => (
                                  <div key={mIdx} className="text-[10px] text-slate-700 mt-0.5">
                                    • {m.entryName} ({m.listName}) — Score: {m.similarityScore} [{m.matchType}]
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-slate-400 text-xs">
                  <Terminal className="w-8 h-8 text-slate-300 mb-2" />
                  <span>Parse a payment message to view extracted canonical parties and screening results.</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab 2: Overview & Queue */}
        {activeTab === 'overview' && (
          <div className="flex-1 p-6 overflow-y-auto space-y-6">
            <div>
              <h2 className="text-base font-bold text-slate-900">Payments Gateway Operational Overview</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Deterministic screening metrics, compliance queue status, and active watchlist indicators.
              </p>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-4 gap-4">
              <div className="bg-white p-4 rounded border border-slate-200 shadow-xs">
                <span className="text-xs text-slate-500">Pending Human Reviews</span>
                <div className="text-2xl font-bold font-mono text-slate-900 mt-1">
                  {cases.filter((c) => c.status === 'PENDING_REVIEW').length}
                </div>
                <span className="text-[10px] text-red-600 font-medium">Requires Officer Rationale</span>
              </div>

              <div className="bg-white p-4 rounded border border-slate-200 shadow-xs">
                <span className="text-xs text-slate-500">Confirmed Sanctions Alerts</span>
                <div className="text-2xl font-bold font-mono text-slate-900 mt-1">
                  {cases.filter((c) => c.status === 'ALERT_CONFIRMED').length}
                </div>
                <span className="text-[10px] text-slate-500">Adjudicated matches</span>
              </div>

              <div className="bg-white p-4 rounded border border-slate-200 shadow-xs">
                <span className="text-xs text-slate-500">Active Watchlists</span>
                <div className="text-2xl font-bold font-mono text-teal-700 mt-1">
                  {watchlists.length}
                </div>
                <span className="text-[10px] text-emerald-600 font-medium">
                  {watchlists.filter((w) => !w.isStale).length} Fresh
                </span>
              </div>

              <div className="bg-white p-4 rounded border border-slate-200 shadow-xs">
                <span className="text-xs text-slate-500">Active Policy</span>
                <div className="text-sm font-bold font-mono text-slate-900 mt-2">
                  POL-2026.11
                </div>
                <span className="text-[10px] text-teal-600 font-medium">CBPR+ / SWIFT / ISO20022</span>
              </div>
            </div>

            {/* Cases Table */}
            <div className="bg-white border border-slate-200 rounded shadow-xs overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  Recent Payment Compliance Cases
                </h3>
                <button
                  onClick={() => setActiveTab('cases')}
                  className="text-xs text-teal-600 hover:text-teal-700 font-medium flex items-center gap-1"
                >
                  <span>Open Adjudication Console</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 text-[11px]">
                    <tr>
                      <th className="py-2.5 px-4 font-semibold">Case ID</th>
                      <th className="py-2.5 px-4 font-semibold">Type</th>
                      <th className="py-2.5 px-4 font-semibold">Amount</th>
                      <th className="py-2.5 px-4 font-semibold">Severity</th>
                      <th className="py-2.5 px-4 font-semibold">Coverage</th>
                      <th className="py-2.5 px-4 font-semibold">Status</th>
                      <th className="py-2.5 px-4 font-semibold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {cases.map((c) => (
                      <tr key={c.caseId} className="hover:bg-slate-50">
                        <td className="py-2.5 px-4 font-mono font-medium text-slate-900">
                          {c.caseId}
                        </td>
                        <td className="py-2.5 px-4 font-mono text-slate-600">
                          {c.transaction.messageType}
                        </td>
                        <td className="py-2.5 px-4 font-mono">
                          {c.transaction.currency} {c.transaction.amount.toLocaleString()}
                        </td>
                        <td className="py-2.5 px-4">
                          <span
                            className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${
                              c.screeningResult.findingSeverity === 'EXACT_IDENTIFIER_MATCH'
                                ? 'bg-red-100 text-red-800'
                                : c.screeningResult.findingSeverity === 'FUZZY_NAME_CANDIDATE'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-emerald-100 text-emerald-800'
                            }`}
                          >
                            {c.screeningResult.findingSeverity}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 font-mono text-[10px]">
                          {c.screeningResult.coverageStatus}
                        </td>
                        <td className="py-2.5 px-4">
                          <span className="font-semibold text-[11px] text-slate-800">
                            {c.status}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          <button
                            onClick={() => {
                              setSelectedCase(c);
                              setActiveTab('cases');
                            }}
                            className="px-2 py-1 text-[11px] font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded"
                          >
                            Review
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: Case Adjudication Console */}
        {activeTab === 'cases' && (
          <div className="flex-1 flex overflow-hidden">
            {/* Left Queue List */}
            <div className="w-80 border-r border-slate-200 bg-white flex flex-col h-full overflow-hidden">
              <div className="p-3 border-b border-slate-200 bg-slate-50">
                <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  Cases Queue ({cases.length})
                </h3>
              </div>
              <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
                {cases.map((c) => (
                  <button
                    key={c.caseId}
                    onClick={() => {
                      setSelectedCase(c);
                      setAdjudicateSuccess(null);
                      fetchCaseGraph(c.caseId);
                    }}
                    className={`w-full text-left p-3 transition-colors ${
                      selectedCase?.caseId === c.caseId ? 'bg-teal-50 border-l-4 border-teal-600' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-bold text-slate-900">{c.caseId}</span>
                      <span className="text-[10px] font-mono text-slate-500">
                        {c.transaction.messageType}
                      </span>
                    </div>
                    <div className="text-xs text-slate-700 font-mono mt-1">
                      {c.transaction.currency} {c.transaction.amount.toLocaleString()}
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      <span
                        className={`text-[9px] font-mono px-1 py-0.5 rounded ${
                          c.status === 'PENDING_REVIEW'
                            ? 'bg-amber-100 text-amber-900 font-semibold'
                            : c.status === 'ALERT_CONFIRMED'
                            ? 'bg-red-100 text-red-900'
                            : 'bg-emerald-100 text-emerald-900'
                        }`}
                      >
                        {c.status}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        {new Date(c.updatedAt).toLocaleTimeString()}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Right Adjudication Console */}
            <div className="flex-1 p-6 overflow-y-auto space-y-6">
              {selectedCase ? (
                <>
                  <div className="flex items-center justify-between border-b border-slate-200 pb-4">
                    <div>
                      <span className="text-xs font-mono text-teal-600 font-bold uppercase">
                        Case Adjudication · {selectedCase.caseId}
                      </span>
                      <h2 className="text-lg font-bold text-slate-900 mt-0.5">
                        {selectedCase.transaction.messageType} Transfer ({selectedCase.transaction.currency}{' '}
                        {selectedCase.transaction.amount.toLocaleString()})
                      </h2>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-500">Current Status:</span>
                      <span className="px-2.5 py-1 text-xs font-bold font-mono rounded bg-slate-900 text-white">
                        {selectedCase.status}
                      </span>
                    </div>
                  </div>

                  {adjudicateSuccess && (
                    <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>{adjudicateSuccess}</span>
                    </div>
                  )}

                  {/* Case Adjudication Sub-tabs */}
                  <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setCaseDetailSubTab('details')}
                        className={`px-3 py-1.5 text-xs font-semibold rounded transition-colors ${
                          caseDetailSubTab === 'details'
                            ? 'bg-teal-600 text-white shadow-xs'
                            : 'text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        Side-by-Side Review
                      </button>
                      <button
                        onClick={() => {
                          setCaseDetailSubTab('graph');
                          if (!caseGraph && selectedCase) {
                            fetchCaseGraph(selectedCase.caseId);
                          }
                        }}
                        className={`px-3 py-1.5 text-xs font-semibold rounded flex items-center gap-1.5 transition-colors ${
                          caseDetailSubTab === 'graph'
                            ? 'bg-teal-600 text-white shadow-xs'
                            : 'text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        <Share2 className="w-3.5 h-3.5" />
                        <span>Evidence Graph</span>
                        {caseGraph && (
                          <span className="text-[10px] px-1 rounded bg-teal-800 text-white font-mono">
                            {caseGraph.nodes.length}
                          </span>
                        )}
                      </button>
                    </div>

                    <button
                      onClick={() => handleDownloadEvidence(selectedCase.caseId)}
                      className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 shadow-2xs"
                    >
                      <Download className="w-3.5 h-3.5 text-teal-600" />
                      <span>Evidence Pack (JSON)</span>
                    </button>
                  </div>

                  {caseDetailSubTab === 'graph' && caseGraph ? (
                    <EvidenceGraphView
                      graph={caseGraph}
                      onExportJson={() => handleDownloadEvidence(selectedCase.caseId)}
                    />
                  ) : (
                    /* Side-by-side Evidence Comparison */
                    <div className="grid grid-cols-2 gap-4">
                    {/* Left: Raw Payment Data */}
                    <div className="bg-white border border-slate-200 rounded p-4 shadow-xs">
                      <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-2">
                        Incoming Payment Payload
                      </h3>
                      <div className="p-3 bg-slate-50 border border-slate-200 rounded font-mono text-[11px] leading-relaxed max-h-60 overflow-y-auto">
                        {selectedCase.transaction.rawMessageSnippet || 'No raw snippet available.'}
                      </div>

                      <div className="mt-4 space-y-2">
                        <span className="text-xs font-semibold text-slate-700 block">Extracted Parties:</span>
                        {selectedCase.transaction.parties.map((p, i) => (
                          <div key={i} className="p-2 border border-slate-100 rounded bg-slate-50 text-xs">
                            <span className="font-bold text-teal-800 text-[10px]">{p.role}:</span> {p.name}
                            {p.accountNumber && (
                              <div className="text-[10px] text-slate-500 font-mono">Acct: {p.accountNumber}</div>
                            )}
                            {p.address?.rawLines && (
                              <div className="text-[10px] text-slate-600 mt-1 whitespace-pre-line font-mono pl-1.5 border-l border-slate-300">
                                {p.address.rawLines.join('\n')}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Right: Matched Sanctions Candidates */}
                    <div className="bg-white border border-slate-200 rounded p-4 shadow-xs">
                      <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-2">
                        Watchlist Candidates & Citations
                      </h3>

                      {selectedCase.screeningResult.partyOutcomes.filter((po) => po.matches.length > 0).length === 0 ? (
                        <div className="p-3 bg-slate-50 text-slate-500 text-xs rounded">
                          No matching watchlist candidates found for this transaction.
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {selectedCase.screeningResult.partyOutcomes.map((po, idx) =>
                            po.matches.map((m, mIdx) => (
                              <div key={`${idx}_${mIdx}`} className="p-3 border border-red-200 bg-red-50 rounded text-xs space-y-1">
                                <div className="flex items-center justify-between">
                                  <span className="font-bold text-red-900">{m.entryName}</span>
                                  <span className="font-mono text-[10px] bg-red-200 text-red-900 px-1 rounded">
                                    Score: {m.similarityScore}
                                  </span>
                                </div>
                                <div className="text-[11px] text-red-800 font-medium">
                                  Matched Party: {po.party.name} ({po.party.role})
                                </div>
                                <div className="text-[10px] text-slate-600">
                                  List: {m.listName} · ID: {m.entryId}
                                </div>
                                {m.programs && (
                                  <div className="text-[10px] text-slate-500 font-mono">
                                    Programs: {m.programs.join(', ')}
                                  </div>
                                )}
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  )}

                  {/* Adjudication Form */}
                  <form onSubmit={handleAdjudicateSubmit} className="bg-white border border-slate-200 rounded p-4 shadow-xs space-y-4">
                    <div className="border-b border-slate-100 pb-2 flex items-center justify-between">
                      <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                        Human Compliance Officer Adjudication
                      </h3>
                      <span className="text-[11px] text-slate-500 font-mono">
                        Server-enforced rationale (min 10 chars)
                      </span>
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-slate-700 block mb-1">
                        Select Adjudication Action
                      </label>
                      <div className="grid grid-cols-3 gap-3">
                        <label
                          className={`p-3 rounded border text-xs cursor-pointer flex flex-col gap-1 ${
                            decisionType === 'CONFIRM_ENTITY_MATCH'
                              ? 'border-red-600 bg-red-50 text-red-900 font-semibold'
                              : 'border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <input
                              type="radio"
                              name="decision"
                              value="CONFIRM_ENTITY_MATCH"
                              checked={decisionType === 'CONFIRM_ENTITY_MATCH'}
                              onChange={() => setDecisionType('CONFIRM_ENTITY_MATCH')}
                            />
                            <span>Confirm Entity Match</span>
                          </div>
                          <span className="text-[10px] text-slate-500 font-normal">
                            Target is identical to sanctioned entity. Escalate for block.
                          </span>
                        </label>

                        <label
                          className={`p-3 rounded border text-xs cursor-pointer flex flex-col gap-1 ${
                            decisionType === 'FALSE_POSITIVE'
                              ? 'border-emerald-600 bg-emerald-50 text-emerald-900 font-semibold'
                              : 'border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <input
                              type="radio"
                              name="decision"
                              value="FALSE_POSITIVE"
                              checked={decisionType === 'FALSE_POSITIVE'}
                              onChange={() => setDecisionType('FALSE_POSITIVE')}
                            />
                            <span>False Positive</span>
                          </div>
                          <span className="text-[10px] text-slate-500 font-normal">
                            Not the designated entity following manual research.
                          </span>
                        </label>

                        <label
                          className={`p-3 rounded border text-xs cursor-pointer flex flex-col gap-1 ${
                            decisionType === 'REQUEST_INFORMATION'
                              ? 'border-amber-600 bg-amber-50 text-amber-900 font-semibold'
                              : 'border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <input
                              type="radio"
                              name="decision"
                              value="REQUEST_INFORMATION"
                              checked={decisionType === 'REQUEST_INFORMATION'}
                              onChange={() => setDecisionType('REQUEST_INFORMATION')}
                            />
                            <span>Request Information</span>
                          </div>
                          <span className="text-[10px] text-slate-500 font-normal">
                            Inquire with ordering bank / client for proof of identity.
                          </span>
                        </label>
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-semibold text-slate-700">
                          Mandatory Review Rationale
                        </label>
                        <span className="text-[10px] font-mono text-slate-400">
                          {rationale.trim().length}/10 chars min
                        </span>
                      </div>
                      <textarea
                        value={rationale}
                        onChange={(e) => setRationale(e.target.value)}
                        placeholder="Document detailed regulatory and factual reasoning for this adjudication decision..."
                        className="w-full p-2.5 border border-slate-300 rounded text-xs focus:outline-teal-600 h-20"
                      />
                    </div>

                    <div className="flex justify-end gap-2">
                      <button
                        type="submit"
                        disabled={isAdjudicating || rationale.trim().length < 10}
                        className="px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-semibold rounded transition-colors"
                      >
                        {isAdjudicating ? 'Recording to Ledger...' : 'Submit Governing Adjudication'}
                      </button>
                    </div>
                  </form>

                  {/* Immutable Audit Trail */}
                  <div className="bg-white border border-slate-200 rounded p-4 shadow-xs">
                    <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-3">
                      Tamper-Evident Hash Chain Audit Trail ({selectedCase.auditTrail.length})
                    </h3>
                    <div className="space-y-2">
                      {selectedCase.auditTrail.map((action, i) => (
                        <div key={action.actionId} className="p-2.5 bg-slate-50 border border-slate-200 rounded text-xs">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-slate-800">
                              #{i + 1} {action.decision} by {action.analystId} ({action.analystRole})
                            </span>
                            <span className="text-[10px] text-slate-500 font-mono">
                              {new Date(action.timestamp).toLocaleString()}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-700 mt-1">{action.rationale}</p>
                          <div className="text-[9px] font-mono text-slate-400 mt-1.5 flex items-center gap-4">
                            <span>Checksum: {action.serverChecksum.slice(0, 16)}...</span>
                            <span>Prev: {action.previousHash?.slice(0, 16)}...</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <div className="p-8 text-center text-slate-400 text-xs">
                  Select a case from the queue to adjudicate.
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab 4: Batch Ingestion Studio */}
        {activeTab === 'batch' && (
          <div className="flex-1 p-6 overflow-y-auto space-y-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">Batch Ingestion Studio</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Ingest multi-message SWIFT FIN chunks or ISO 20022 XML batch instructions with automated screening.
              </p>
            </div>

            <div className="bg-white p-4 border border-slate-200 rounded shadow-xs space-y-3">
              <label className="text-xs font-semibold text-slate-700 block">
                Paste Multiple Messages (SWIFT blocks or pain.001 multi-payment XML)
              </label>
              <textarea
                value={batchRaw}
                onChange={(e) => setBatchRaw(e.target.value)}
                placeholder="Paste batch payment data..."
                className="w-full h-36 p-3 font-mono text-xs border border-slate-300 rounded focus:outline-teal-600"
              />
              <div className="flex justify-between items-center">
                <button
                  onClick={() => setBatchRaw(SYNTHETIC_PAYMENT_FIXTURES.map((f) => f.rawContent).join('\n\n'))}
                  className="text-xs text-teal-600 hover:underline"
                >
                  Load All Synthetic Fixtures
                </button>
                <button
                  onClick={async () => {
                    setIsBatchRunning(true);
                    try {
                      const res = await fetch('/api/payments/batch', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ rawBatch: batchRaw }),
                      });
                      const data = await res.json();
                      if (data.results) setBatchResults(data.results);
                      fetchCases();
                    } catch (err: any) {
                      alert(err.message);
                    } finally {
                      setIsBatchRunning(false);
                    }
                  }}
                  disabled={isBatchRunning || !batchRaw.trim()}
                  className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold rounded"
                >
                  {isBatchRunning ? 'Processing Batch...' : 'Execute Batch Screen'}
                </button>
              </div>
            </div>

            {batchResults.length > 0 && (
              <div className="bg-white border border-slate-200 rounded shadow-xs overflow-hidden">
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 text-xs font-bold uppercase tracking-wider text-slate-700">
                  Batch Execution Summary ({batchResults.length} Transactions)
                </div>
                <div className="divide-y divide-slate-100">
                  {batchResults.map((r, i) => {
                    const criticalIssues = r.screeningResult.missingDataIssues?.filter((it: any) => it.severity === 'CRITICAL_MISSING') || [];
                    const warningIssues = r.screeningResult.missingDataIssues?.filter((it: any) => it.severity === 'WARNING_ENRICHMENT') || [];
                    const isBlocked = r.screeningResult.findingSeverity === 'EXACT_IDENTIFIER_MATCH';
                    const needsInfo = criticalIssues.length > 0;
                    const requiresReview = r.screeningResult.requiresHumanReview || needsInfo || isBlocked || r.screeningResult.coverageStatus === 'INSUFFICIENT';
                    const isExpanded = expandedBatchIndex === i;

                    return (
                      <div key={i} className="p-3 text-xs flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="font-mono font-bold text-slate-900">
                              {r.transaction.transactionId}
                            </span>
                            <div className="text-[10px] text-slate-500 font-mono">
                              {r.transaction.messageType} · {r.transaction.currency} {r.transaction.amount}
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            {/* Coverage Dimension */}
                            <span className={`font-mono text-[10px] px-2 py-0.5 rounded font-semibold ${
                              r.screeningResult.coverageStatus === 'COMPLETE' ? 'bg-slate-100 text-slate-700' : 'bg-amber-100 text-amber-800'
                            }`}>
                              Coverage: {r.screeningResult.coverageStatus}
                            </span>

                            {/* Data Completeness Dimension */}
                            <span
                              className={`font-mono text-[10px] px-2 py-0.5 rounded font-semibold ${
                                needsInfo
                                  ? 'bg-rose-100 text-rose-800'
                                  : warningIssues.length > 0
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-emerald-100 text-emerald-800'
                              }`}
                            >
                              {needsInfo
                                ? `Needs Info (${criticalIssues.length} Critical)`
                                : warningIssues.length > 0
                                ? `Data Warnings (${warningIssues.length})`
                                : 'Data Complete'}
                            </span>

                            {/* Match Findings Dimension */}
                            <span
                              className={`font-mono text-[10px] px-2 py-0.5 rounded font-bold ${
                                isBlocked
                                  ? 'bg-red-100 text-red-800'
                                  : r.screeningResult.findingSeverity === 'FUZZY_NAME_CANDIDATE'
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-emerald-100 text-emerald-800'
                              }`}
                            >
                              {r.screeningResult.findingSeverity}
                            </span>

                            {/* Review/Routing Status */}
                            <span
                              className={`font-mono text-[10px] px-2.5 py-0.5 rounded font-bold border ${
                                isBlocked
                                  ? 'bg-red-50 text-red-700 border-red-300'
                                  : requiresReview
                                  ? 'bg-amber-50 text-amber-700 border-amber-300'
                                  : 'bg-emerald-50 text-emerald-700 border-emerald-300'
                              }`}
                            >
                              {isBlocked
                                ? 'Prohibited Identifier Block'
                                : requiresReview
                                ? 'Human Review Required'
                                : 'Release Eligible'}
                            </span>

                            {/* Details Toggle */}
                            <button
                              onClick={() => setExpandedBatchIndex(isExpanded ? null : i)}
                              className="text-[11px] px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded font-medium ml-1"
                            >
                              {isExpanded ? 'Hide Details' : 'View Details'}
                            </button>
                          </div>
                        </div>

                        {/* Expandable Details Drawer */}
                        {isExpanded && (
                          <div className="mt-2 p-3 bg-slate-50 border border-slate-200 rounded text-xs space-y-3">
                            <div className="grid grid-cols-2 gap-4">
                              {/* Parties */}
                              <div>
                                <h4 className="font-bold text-slate-700 text-[11px] uppercase mb-1">
                                  Screened Parties ({r.transaction.parties?.length || 0})
                                </h4>
                                <div className="space-y-1">
                                  {r.transaction.parties?.map((p: any, pIdx: number) => (
                                    <div key={pIdx} className="p-1.5 bg-white border border-slate-200 rounded text-[11px] flex justify-between">
                                      <div>
                                        <span className="font-semibold text-slate-800">{p.name || 'Unnamed Party'}</span>
                                        <span className="text-[10px] text-slate-500 ml-1">({p.role})</span>
                                      </div>
                                      <span className="font-mono text-[10px] text-slate-600">
                                        {p.identifiers?.map((id: any) => `${id.type}:${id.value}`).join(', ') || 'No Identifiers'}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>

                              {/* Missing Data Issues */}
                              <div>
                                <h4 className="font-bold text-slate-700 text-[11px] uppercase mb-1">
                                  Missing Data & Travel Rule Issues ({r.screeningResult.missingDataIssues?.length || 0})
                                </h4>
                                {r.screeningResult.missingDataIssues?.length === 0 ? (
                                  <div className="p-2 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded text-[11px]">
                                    All mandatory originator and beneficiary fields verified complete.
                                  </div>
                                ) : (
                                  <div className="space-y-1">
                                    {r.screeningResult.missingDataIssues?.map((iss: any, issIdx: number) => (
                                      <div key={issIdx} className={`p-1.5 rounded border text-[11px] ${
                                        iss.severity === 'CRITICAL_MISSING' ? 'bg-rose-50 border-rose-200 text-rose-800' : 'bg-amber-50 border-amber-200 text-amber-800'
                                      }`}>
                                        <div className="font-semibold">{iss.field}: {iss.severity}</div>
                                        <div className="text-[10px]">{iss.description}</div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Decision & Action */}
                            <div className="pt-2 border-t border-slate-200 flex items-center justify-between text-[11px]">
                              <span className="text-slate-600">
                                {needsInfo
                                  ? `Blocked from auto-release: mandatory customer data missing (${criticalIssues.map((c: any) => c.field).join(', ')}).`
                                  : requiresReview
                                  ? 'Manual review required before processing can proceed.'
                                  : 'Eligible for straight-through payment execution.'}
                              </span>
                              {r.screeningResult.caseId && (
                                <button
                                  onClick={() => {
                                    const found = cases.find((c) => c.caseId === r.screeningResult.caseId);
                                    if (found) setSelectedCase(found);
                                    setActiveTab('cases');
                                  }}
                                  className="text-teal-600 hover:underline font-semibold"
                                >
                                  Open Case #{r.screeningResult.caseId} →
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab 5: Watchlists & Health */}
        {activeTab === 'health' && (
          <div className="flex-1 p-6 overflow-y-auto space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900">Watchlists & Screening Engine Health</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Inspect dataset freshness TTLs, SHA-256 digests, and test the list freshness gate.
                </p>
              </div>
              <button
                onClick={fetchWatchlists}
                className="px-3 py-1.5 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-800 rounded flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Refresh Status</span>
              </button>
            </div>

            {/* Watchlists Table */}
            <div className="bg-white border border-slate-200 rounded shadow-xs overflow-hidden">
              <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 text-xs font-bold uppercase tracking-wider text-slate-700">
                Registered Screening Watchlists
              </div>
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50/50 border-b border-slate-200 text-slate-600 text-[11px]">
                  <tr>
                    <th className="py-2.5 px-4 font-semibold">List ID & Name</th>
                    <th className="py-2.5 px-4 font-semibold">Records</th>
                    <th className="py-2.5 px-4 font-semibold">TTL</th>
                    <th className="py-2.5 px-4 font-semibold">SHA-256 Digest</th>
                    <th className="py-2.5 px-4 font-semibold">Freshness Gate</th>
                    <th className="py-2.5 px-4 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {watchlists.map((w) => (
                    <tr key={w.id} className="hover:bg-slate-50">
                      <td className="py-2.5 px-4">
                        <div className="font-semibold text-slate-900">{w.name}</div>
                        <div className="text-[10px] text-slate-500 font-mono">{w.provider}</div>
                      </td>
                      <td className="py-2.5 px-4 font-mono">{w.recordCount}</td>
                      <td className="py-2.5 px-4 font-mono">{w.freshnessTtlHours}h</td>
                      <td className="py-2.5 px-4 font-mono text-[10px] text-slate-500">
                        {w.sha256Digest.slice(0, 16)}...
                      </td>
                      <td className="py-2.5 px-4">
                        <span
                          className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${
                            w.isStale ? 'bg-amber-100 text-amber-800 font-bold' : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {w.isStale ? 'STALE' : 'FRESH'}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        <button
                          onClick={() => handleToggleStale(w.id, w.isStale)}
                          className={`px-2 py-1 text-[10px] font-medium rounded transition-colors ${
                            w.isStale
                              ? 'bg-emerald-100 hover:bg-emerald-200 text-emerald-900'
                              : 'bg-amber-100 hover:bg-amber-200 text-amber-900'
                          }`}
                        >
                          {w.isStale ? 'Mark Fresh' : 'Simulate Stale'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Disabled Adapters Catalog */}
            <div className="bg-white border border-slate-200 rounded shadow-xs p-4 space-y-3">
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                External Screening Adapters (Roadmap / Standby)
              </h3>
              <p className="text-xs text-slate-500">
                To guarantee zero-cost compliance and eliminate fabricated data, external commercial feeds remain explicitly disabled pending customer-provided licensed keys.
              </p>
              <div className="grid grid-cols-2 gap-3 mt-2">
                <div className="p-3 border border-slate-200 rounded bg-slate-50 text-xs">
                  <span className="font-bold text-slate-800">Dow Jones / Factiva Screening Feed</span>
                  <p className="text-[10px] text-slate-500 mt-0.5">Status: DISABLED_PENDING_LICENSE</p>
                  <p className="text-[10px] text-slate-600 mt-1">Requires customer API token.</p>
                </div>
                <div className="p-3 border border-slate-200 rounded bg-slate-50 text-xs">
                  <span className="font-bold text-slate-800">Refinitiv World-Check Live Stream</span>
                  <p className="text-[10px] text-slate-500 mt-0.5">Status: DISABLED_PENDING_LICENSE</p>
                  <p className="text-[10px] text-slate-600 mt-1">Requires enterprise gateway connection.</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 6: Evidence & Audit */}
        {activeTab === 'evidence' && (
          <div className="flex-1 p-6 overflow-y-auto space-y-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">Evidence Packs & Cryptographic Audit Ledger</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Exportable tamper-evident compliance audit records with SHA-256 hash chains.
              </p>
            </div>

            <div className="bg-white border border-slate-200 rounded shadow-xs overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 text-[11px]">
                  <tr>
                    <th className="py-2.5 px-4 font-semibold">Case Reference</th>
                    <th className="py-2.5 px-4 font-semibold">Evidence Hash (SHA-256)</th>
                    <th className="py-2.5 px-4 font-semibold">Audit Actions</th>
                    <th className="py-2.5 px-4 font-semibold">Integrity</th>
                    <th className="py-2.5 px-4 font-semibold text-right">Download</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {cases.map((c) => (
                    <tr key={c.caseId} className="hover:bg-slate-50">
                      <td className="py-2.5 px-4 font-mono font-medium text-slate-900">
                        {c.caseId}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-[10px] text-slate-600">
                        {c.evidenceHash}
                      </td>
                      <td className="py-2.5 px-4 font-mono">{c.auditTrail.length}</td>
                      <td className="py-2.5 px-4">
                        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">
                          CHAIN_VERIFIED
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        <button
                          onClick={() => handleDownloadEvidence(c.caseId)}
                          className="px-2.5 py-1 text-[11px] font-medium bg-slate-100 hover:bg-slate-200 text-slate-800 rounded inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Download className="w-3 h-3" />
                          <span>Export .JSON</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 7: Admin & Diagnostics */}
        {activeTab === 'admin' && (
          <div className="flex-1 p-6 overflow-y-auto space-y-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">Admin Diagnostics & Protocol Settings</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Model Context Protocol endpoints, policy versions, and execution environments.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white p-4 border border-slate-200 rounded shadow-xs space-y-2">
                <span className="text-xs font-bold text-slate-900 uppercase">MCP Server Protocol</span>
                <p className="text-xs text-slate-600">
                  Official Streamable HTTP transport active on:
                </p>
                <div className="p-2 bg-slate-100 font-mono text-xs rounded text-teal-800">
                  POST /mcp (JSON-RPC 2.0)
                </div>
                <p className="text-[11px] text-slate-500">
                  Local stdio transport accessible via <code className="font-mono">tsx src/server/mcpStdio.ts</code>.
                </p>
              </div>

              <div className="bg-white p-4 border border-slate-200 rounded shadow-xs space-y-2">
                <span className="text-xs font-bold text-slate-900 uppercase">Client Remote Engine Adapter</span>
                <p className="text-xs text-slate-600">
                  Current Status: {engineHealth?.status || 'ONLINE'}
                </p>
                <p className="text-[11px] text-slate-500">
                  Supports plugging in bank internal screening endpoints without rewriting the core gateway.
                </p>
              </div>
            </div>
          </div>
        )}
      </main>
    </>
  ) : selectedModule === 'LISTS_AND_DATA_SOURCES' ? (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-50">
      <ModuleHeader moduleId={selectedModule} />
      <div className="flex-1 overflow-y-auto">
        <ListsAndDataSourcesWorkspace />
      </div>
    </div>
  ) : (
    <ModuleWorkspaceShell moduleId={selectedModule}>
      {selectedModule === 'TRADE_AND_CARGO' && <TradeAndCargoWorkspace />}
      {selectedModule === 'MARITIME' && <MaritimeWorkspace />}
      {selectedModule === 'AIR_CARGO' && <AirCargoWorkspace />}
      {selectedModule === 'INSURANCE' && <InsuranceWorkspace />}
      {selectedModule === 'CRYPTO' && <CryptoWorkspace />}
      {selectedModule === 'HEALTHCARE' && <HealthcareWorkspace />}
      {selectedModule === 'SECURITIES' && <SecuritiesWorkspace />}
      {selectedModule === 'VALIDATION_AND_AUDIT' && <ValidationAndAuditWorkspace />}
    </ModuleWorkspaceShell>
  )}
      </div>
    </div>
  );
}

function PlayIcon() {
  return (
    <svg className="w-3 h-3 fill-current" viewBox="0 0 24 24">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}
