/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import React, { useState } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  FileText,
  Search,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Download,
  Info,
  Key,
  Anchor,
  Plane,
  Cpu,
  Activity,
  TrendingUp,
  FileCheck,
  ChevronRight,
  Boxes,
  Check,
  X,
  Clock,
  ArrowRight,
  Database,
} from 'lucide-react';
import {
  ComplianceModuleId,
  COMPLIANCE_MODULES,
  TradeAndCargoEvaluation,
  MaritimeEvaluation,
  AirCargoEvaluation,
  InsuranceEvaluation,
  CryptoEvaluation,
  HealthcareEvaluation,
  SecuritiesEvaluation,
  ValidationAndAuditEvaluation,
  DEMO_ANALYST_TOKEN,
} from '../shared/types.ts';
import { MULTI_MODULE_FIXTURES } from '../server/services/syntheticFixtures.ts';

interface ModuleWorkspacesProps {
  selectedModule: ComplianceModuleId;
  onSelectModule: (id: ComplianceModuleId) => void;
}

export function ModuleSelectorBar({ selectedModule, onSelectModule }: ModuleWorkspacesProps) {
  const getIcon = (id: ComplianceModuleId) => {
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
    }
  };

  return (
    <div className="bg-slate-900 border-b border-slate-800 px-4 py-2 flex items-center gap-1.5 overflow-x-auto text-xs no-scrollbar">
      <span className="text-slate-400 font-semibold uppercase tracking-wider text-[11px] mr-2 shrink-0 flex items-center gap-1">
        <Database className="w-3.5 h-3.5 text-teal-400" /> Modules:
      </span>
      {COMPLIANCE_MODULES.map((mod) => {
        const active = selectedModule === mod.id;
        return (
          <button
            key={mod.id}
            onClick={() => onSelectModule(mod.id)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded font-medium transition-all shrink-0 ${
              active
                ? 'bg-teal-600 text-white shadow-xs'
                : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
          >
            {getIcon(mod.id)}
            <span>{mod.name.replace(' Compliance', '').replace(' Security', '').replace(' Integrity', '')}</span>
            <span
              className={`text-[9px] px-1 py-0.2 rounded uppercase ${
                active ? 'bg-teal-800 text-teal-100' : 'bg-slate-800 text-slate-400'
              }`}
            >
              {mod.badge}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function ModuleHeader({ moduleId }: { moduleId: ComplianceModuleId }) {
  const mod = COMPLIANCE_MODULES.find((m) => m.id === moduleId)!;
  return (
    <div className="bg-white border-b border-slate-200 px-6 py-4 shadow-2xs">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-slate-900">{mod.name}</h2>
            <span className="text-xs px-2 py-0.5 bg-teal-50 text-teal-700 font-semibold border border-teal-200 rounded">
              {mod.badge}
            </span>
            <span className="text-[11px] font-mono bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded border border-slate-200">
              Module ID: {mod.id}
            </span>
          </div>
          <p className="text-xs text-slate-600 mt-1">{mod.tagline}</p>
        </div>

        <div className="text-xs text-slate-500 bg-slate-50 p-2.5 rounded border border-slate-200 max-w-md">
          <div className="font-semibold text-slate-700">Target Buyers & Clients:</div>
          <div className="text-slate-600 truncate">{mod.potentialClients}</div>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------
// 2. Trade and Cargo Workspace
// ----------------------------------------------------
export function TradeAndCargoWorkspace() {
  const [tradeData, setTradeData] = useState(MULTI_MODULE_FIXTURES.TRADE_AND_CARGO);
  const [result, setResult] = useState<TradeAndCargoEvaluation | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleEvaluate = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/modules/trade/evaluate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-analyst-token': DEMO_ANALYST_TOKEN,
        },
        body: JSON.stringify(tradeData),
      });
      const data = await res.json();
      setResult(data);
    } catch (e: any) {
      alert(`Error evaluating trade documents: ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Input Configuration Panel */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
              <Boxes className="w-4 h-4 text-teal-600" /> Multi-Document Presentation Set
            </h3>
            <button
              onClick={() => setTradeData(MULTI_MODULE_FIXTURES.TRADE_AND_CARGO)}
              className="text-xs text-teal-600 hover:underline flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" /> Reload Sample
            </button>
          </div>

          <div className="space-y-3 text-xs">
            <div>
              <label className="font-semibold text-slate-700 block mb-1">Commercial Invoice</label>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  value={tradeData.invoice.invoiceNumber}
                  onChange={(e) => setTradeData({ ...tradeData, invoice: { ...tradeData.invoice, invoiceNumber: e.target.value } })}
                  className="p-1.5 border border-slate-200 rounded font-mono text-xs"
                  placeholder="Invoice #"
                />
                <input
                  type="number"
                  value={tradeData.invoice.totalAmount}
                  onChange={(e) => setTradeData({ ...tradeData, invoice: { ...tradeData.invoice, totalAmount: parseFloat(e.target.value) } })}
                  className="p-1.5 border border-slate-200 rounded font-mono text-xs"
                  placeholder="Total Amount"
                />
              </div>
              <div className="grid grid-cols-2 gap-2 mt-1.5">
                <input
                  type="text"
                  value={tradeData.invoice.sellerName}
                  onChange={(e) => setTradeData({ ...tradeData, invoice: { ...tradeData.invoice, sellerName: e.target.value } })}
                  className="p-1.5 border border-slate-200 rounded text-xs"
                  placeholder="Seller"
                />
                <input
                  type="text"
                  value={tradeData.invoice.buyerName}
                  onChange={(e) => setTradeData({ ...tradeData, invoice: { ...tradeData.invoice, buyerName: e.target.value } })}
                  className="p-1.5 border border-slate-200 rounded text-xs"
                  placeholder="Buyer"
                />
              </div>
            </div>

            <div>
              <label className="font-semibold text-slate-700 block mb-1">Ocean Bill of Lading (Transport Document)</label>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  value={tradeData.billOfLading.blNumber}
                  onChange={(e) => setTradeData({ ...tradeData, billOfLading: { ...tradeData.billOfLading, blNumber: e.target.value } })}
                  className="p-1.5 border border-slate-200 rounded font-mono text-xs"
                  placeholder="B/L #"
                />
                <input
                  type="text"
                  value={tradeData.billOfLading.vesselName}
                  onChange={(e) => setTradeData({ ...tradeData, billOfLading: { ...tradeData.billOfLading, vesselName: e.target.value } })}
                  className="p-1.5 border border-slate-200 rounded text-xs"
                  placeholder="Vessel Name"
                />
              </div>
              <div className="grid grid-cols-2 gap-2 mt-1.5">
                <input
                  type="text"
                  value={tradeData.billOfLading.portOfLoading}
                  onChange={(e) => setTradeData({ ...tradeData, billOfLading: { ...tradeData.billOfLading, portOfLoading: e.target.value } })}
                  className="p-1.5 border border-slate-200 rounded text-xs"
                  placeholder="Port of Loading"
                />
                <input
                  type="text"
                  value={tradeData.billOfLading.portOfDischarge}
                  onChange={(e) => setTradeData({ ...tradeData, billOfLading: { ...tradeData.billOfLading, portOfDischarge: e.target.value } })}
                  className="p-1.5 border border-slate-200 rounded text-xs"
                  placeholder="Port of Discharge"
                />
              </div>
            </div>

            <div>
              <label className="font-semibold text-slate-700 block mb-1">Line Item HS Codes & Descriptions</label>
              <div className="p-2 bg-slate-50 border border-slate-200 rounded text-[11px] font-mono space-y-1">
                {tradeData.invoice.lineItems.map((item, idx) => (
                  <div key={idx} className="flex justify-between border-b border-slate-200 pb-1">
                    <span>{item.description}</span>
                    <span className="text-teal-700 font-bold">{item.hsCode}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <button
            onClick={handleEvaluate}
            disabled={isLoading}
            className="w-full py-2.5 bg-teal-600 hover:bg-teal-700 text-white font-semibold rounded text-xs flex items-center justify-center gap-2 shadow-xs"
          >
            {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            Run Cross-Document Discrepancy & Goods Screening
          </button>
        </div>

        {/* Results Panel */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="font-bold text-slate-900 text-sm">Trade Compliance Audit Results</h3>
            {result && (
              <span
                className={`text-xs px-2 py-0.5 rounded font-bold uppercase ${
                  result.passedVerification
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-rose-50 text-rose-700 border border-rose-200'
                }`}
              >
                {result.passedVerification ? 'CLEARED FOR FINANCING' : 'DISCREPANCIES & RED FLAGS DETECTED'}
              </span>
            )}
          </div>

          {!result ? (
            <div className="py-16 text-center text-slate-400 text-xs">
              <Boxes className="w-8 h-8 mx-auto text-slate-300 mb-2" />
              Click "Run Cross-Document Discrepancy & Goods Screening" to inspect invoice, transport B/L, and dual-use classification.
            </div>
          ) : (
            <div className="space-y-4 text-xs">
              {/* Discrepancies */}
              <div>
                <h4 className="font-bold text-slate-800 uppercase text-[11px] mb-1.5 flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500" /> Document Discrepancy Matrix ({result.discrepancies.length})
                </h4>
                {result.discrepancies.length === 0 ? (
                  <p className="text-emerald-700 text-xs bg-emerald-50 p-2 rounded border border-emerald-100">
                    No cross-document discrepancies detected between invoice, B/L, and packing list.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {result.discrepancies.map((d, i) => (
                      <div key={i} className="p-2.5 bg-amber-50 border border-amber-200 rounded text-slate-800">
                        <div className="font-bold text-amber-800 flex items-center justify-between">
                          <span>{d.category}</span>
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-200 text-amber-900">{d.severity}</span>
                        </div>
                        <p className="mt-0.5 text-slate-700">{d.description}</p>
                        <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-500 font-mono">
                          <span>{d.sourceDoc}: {d.sourceValue}</span>
                          <ArrowRight className="w-3 h-3 text-slate-400" />
                          <span>{d.comparedDoc}: {d.comparedValue}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Dual-Use Goods */}
              <div>
                <h4 className="font-bold text-slate-800 uppercase text-[11px] mb-1.5 flex items-center gap-1">
                  <ShieldAlert className="w-3.5 h-3.5 text-rose-500" /> Controlled & Dual-Use Goods Check ({result.dualUseGoods.length})
                </h4>
                {result.dualUseGoods.length === 0 ? (
                  <p className="text-emerald-700 text-xs bg-emerald-50 p-2 rounded border border-emerald-100">
                    No dual-use export control triggers found.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {result.dualUseGoods.map((g, i) => (
                      <div key={i} className="p-2.5 bg-rose-50 border border-rose-200 rounded text-slate-800">
                        <div className="font-bold text-rose-800 flex items-center justify-between">
                          <span>HS {g.hsCode} (ECCN: {g.eccnCode || 'N/A'})</span>
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-rose-200 text-rose-900">{g.proliferationCategory}</span>
                        </div>
                        <p className="mt-0.5 text-slate-700">{g.commodityDescription}</p>
                        <p className="mt-1 text-[11px] text-rose-700 font-medium">{g.licensingRequirement}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Screened Parties */}
              <div>
                <h4 className="font-bold text-slate-800 uppercase text-[11px] mb-1.5">
                  Screened Trade Parties ({result.parties.length})
                </h4>
                <div className="space-y-1">
                  {result.parties.map((p, i) => (
                    <div key={i} className="flex items-center justify-between p-2 bg-slate-50 border border-slate-200 rounded">
                      <div>
                        <span className="font-semibold text-slate-800">{p.name}</span>
                        <span className="text-[10px] text-slate-500 ml-2">({p.role} - {p.country})</span>
                      </div>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                        p.matches.length > 0 ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'
                      }`}>
                        {p.matches.length > 0 ? 'MATCH CANDIDATE' : 'CLEAR'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Evidence Hash */}
              <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                <span className="font-mono truncate max-w-xs">SHA-256: {result.evidenceDigest}</span>
                <span className="font-medium text-emerald-700 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Tamper-Evident Evidence Anchored
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------
// 3. Maritime Workspace
// ----------------------------------------------------
export function MaritimeWorkspace() {
  const [maritimeData, setMaritimeData] = useState(MULTI_MODULE_FIXTURES.MARITIME);
  const [result, setResult] = useState<MaritimeEvaluation | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleEvaluate = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/modules/maritime/evaluate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-analyst-token': DEMO_ANALYST_TOKEN,
        },
        body: JSON.stringify(maritimeData),
      });
      const data = await res.json();
      setResult(data);
    } catch (e: any) {
      alert(`Error evaluating maritime vessel: ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
              <Anchor className="w-4 h-4 text-teal-600" /> Vessel & Voyage Profile
            </h3>
            <button
              onClick={() => setMaritimeData(MULTI_MODULE_FIXTURES.MARITIME)}
              className="text-xs text-teal-600 hover:underline flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" /> Reload Sample
            </button>
          </div>

          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">IMO Number (7 digits)</label>
                <input
                  type="text"
                  value={maritimeData.vessel.imoNumber}
                  onChange={(e) => setMaritimeData({ ...maritimeData, vessel: { ...maritimeData.vessel, imoNumber: e.target.value } })}
                  className="w-full p-1.5 border border-slate-200 rounded font-mono text-xs"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">MMSI (9 digits)</label>
                <input
                  type="text"
                  value={maritimeData.vessel.mmsi}
                  onChange={(e) => setMaritimeData({ ...maritimeData, vessel: { ...maritimeData.vessel, mmsi: e.target.value } })}
                  className="w-full p-1.5 border border-slate-200 rounded font-mono text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Vessel Name</label>
                <input
                  type="text"
                  value={maritimeData.vessel.vesselName}
                  onChange={(e) => setMaritimeData({ ...maritimeData, vessel: { ...maritimeData.vessel, vesselName: e.target.value } })}
                  className="w-full p-1.5 border border-slate-200 rounded text-xs"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Flag State</label>
                <input
                  type="text"
                  value={maritimeData.vessel.flagState}
                  onChange={(e) => setMaritimeData({ ...maritimeData, vessel: { ...maritimeData.vessel, flagState: e.target.value } })}
                  className="w-full p-1.5 border border-slate-200 rounded text-xs"
                />
              </div>
            </div>

            <div>
              <label className="font-semibold text-slate-700 block mb-1">Ownership Hierarchy</label>
              <div className="p-2 bg-slate-50 border border-slate-200 rounded text-[11px] space-y-1">
                {maritimeData.ownershipHierarchy.map((node, i) => (
                  <div key={i} className="flex justify-between">
                    <span className="font-medium">{node.role}: {node.name}</span>
                    <span className="text-slate-500">{node.country}</span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label className="font-semibold text-slate-700 block mb-1">Ports Called</label>
              <div className="p-2 bg-slate-50 border border-slate-200 rounded text-[11px] space-y-1">
                {maritimeData.portsCalled.map((p, i) => (
                  <div key={i} className="flex justify-between">
                    <span>{p.portName} ({p.unLocode})</span>
                    <span className="text-slate-500">{p.country}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <button
            onClick={handleEvaluate}
            disabled={isLoading}
            className="w-full py-2.5 bg-teal-600 hover:bg-teal-700 text-white font-semibold rounded text-xs flex items-center justify-center gap-2 shadow-xs"
          >
            {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            Screen Vessel, Ownership Chain & Route
          </button>
        </div>

        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="font-bold text-slate-900 text-sm">Maritime Sanctions & Dark AIS Dossier</h3>
            {result && (
              <span
                className={`text-xs px-2 py-0.5 rounded font-bold uppercase ${
                  result.isApprovedForCoverage
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-rose-50 text-rose-700 border border-rose-200'
                }`}
              >
                {result.isApprovedForCoverage ? 'APPROVED FOR COVERAGE' : 'COVERAGE PROHIBITED / HIGH RISK'}
              </span>
            )}
          </div>

          {!result ? (
            <div className="py-16 text-center text-slate-400 text-xs">
              <Anchor className="w-8 h-8 mx-auto text-slate-300 mb-2" />
              Click "Screen Vessel, Ownership Chain & Route" to verify IMO checksum, sanctioned ports, and dark AIS activity.
            </div>
          ) : (
            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div className={`p-3 rounded border ${result.isImoChecksumValid ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200'}`}>
                  <div className="font-bold text-slate-800">IMO 7-Digit Checksum</div>
                  <div className={`mt-1 font-semibold ${result.isImoChecksumValid ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {result.isImoChecksumValid ? '✓ Valid IMO Checksum' : '✗ Invalid IMO Number'}
                  </div>
                </div>

                <div className={`p-3 rounded border ${result.darkAisRiskLevel === 'NORMAL' ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200'}`}>
                  <div className="font-bold text-slate-800">Dark AIS & STS Risk Level</div>
                  <div className={`mt-1 font-semibold ${result.darkAisRiskLevel === 'NORMAL' ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {result.darkAisRiskLevel}
                  </div>
                </div>
              </div>

              {result.aisAnomalies.length > 0 && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded text-amber-900 space-y-1">
                  <div className="font-bold flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" /> AIS Transponder Anomalies Detected:
                  </div>
                  {result.aisAnomalies.map((a, i) => (
                    <div key={i} className="text-[11px]">• {a}</div>
                  ))}
                </div>
              )}

              <div>
                <h4 className="font-bold text-slate-800 uppercase text-[11px] mb-1.5">
                  Port Call Sanctions Assessment
                </h4>
                <div className="space-y-1">
                  {result.portRiskAnalysis.map((p, i) => (
                    <div key={i} className={`p-2 rounded border flex items-center justify-between ${
                      p.isHighRiskOrSanctioned ? 'bg-rose-50 border-rose-200 text-rose-900' : 'bg-slate-50 border-slate-200'
                    }`}>
                      <div>
                        <span className="font-semibold">{p.portName} ({p.unLocode})</span>
                        {p.riskReason && <div className="text-[11px] text-rose-700 mt-0.5">{p.riskReason}</div>}
                      </div>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                        p.isHighRiskOrSanctioned ? 'bg-rose-200 text-rose-900' : 'bg-emerald-100 text-emerald-800'
                      }`}>
                        {p.isHighRiskOrSanctioned ? 'SANCTIONED PORT' : 'CLEAR'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="font-bold text-slate-800 uppercase text-[11px] mb-1.5">
                  Ownership Hierarchy Screening
                </h4>
                <div className="space-y-1">
                  {result.ownershipHierarchy.map((o, i) => (
                    <div key={i} className="p-2 bg-slate-50 border border-slate-200 rounded flex justify-between items-center">
                      <div>
                        <span className="font-semibold text-slate-800">{o.name}</span>
                        <span className="text-[10px] text-slate-500 ml-2">({o.role})</span>
                      </div>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                        o.isSanctioned ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'
                      }`}>
                        {o.isSanctioned ? 'SANCTIONED ENTITY' : 'CLEAR'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                <span className="font-mono truncate max-w-xs">SHA-256: {result.evidenceDigest}</span>
                <span className="font-medium text-emerald-700 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Immutable Marine Audit Evidence
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------
// 4. Air Cargo Workspace
// ----------------------------------------------------
export function AirCargoWorkspace() {
  const [airData, setAirData] = useState(MULTI_MODULE_FIXTURES.AIR_CARGO);
  const [result, setResult] = useState<AirCargoEvaluation | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleEvaluate = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/modules/air-cargo/evaluate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-analyst-token': DEMO_ANALYST_TOKEN,
        },
        body: JSON.stringify(airData),
      });
      const data = await res.json();
      setResult(data);
    } catch (e: any) {
      alert(`Error evaluating air cargo: ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
              <Plane className="w-4 h-4 text-teal-600" /> Air Waybill (AWB) & Flight Manifest
            </h3>
            <button
              onClick={() => setAirData(MULTI_MODULE_FIXTURES.AIR_CARGO)}
              className="text-xs text-teal-600 hover:underline flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" /> Reload Sample
            </button>
          </div>

          <div className="space-y-3 text-xs">
            <div>
              <label className="font-semibold text-slate-700 block mb-1">IATA AWB Number (11 digits: PPP-SSSSSSSC)</label>
              <input
                type="text"
                value={airData.awbNumber}
                onChange={(e) => setAirData({ ...airData, awbNumber: e.target.value })}
                className="w-full p-1.5 border border-slate-200 rounded font-mono text-xs"
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Origin Airport</label>
                <input
                  type="text"
                  value={airData.originAirport}
                  onChange={(e) => setAirData({ ...airData, originAirport: e.target.value })}
                  className="w-full p-1.5 border border-slate-200 rounded font-mono text-xs uppercase"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Transit</label>
                <input
                  type="text"
                  value={airData.transitAirports.join(', ')}
                  onChange={(e) => setAirData({ ...airData, transitAirports: e.target.value.split(',').map((s) => s.trim()) })}
                  className="w-full p-1.5 border border-slate-200 rounded font-mono text-xs uppercase"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Destination</label>
                <input
                  type="text"
                  value={airData.destinationAirport}
                  onChange={(e) => setAirData({ ...airData, destinationAirport: e.target.value })}
                  className="w-full p-1.5 border border-slate-200 rounded font-mono text-xs uppercase"
                />
              </div>
            </div>

            <div>
              <label className="font-semibold text-slate-700 block mb-1">Cargo Commodity Description</label>
              <textarea
                rows={2}
                value={airData.cargo.description}
                onChange={(e) => setAirData({ ...airData, cargo: { ...airData.cargo, description: e.target.value } })}
                className="w-full p-1.5 border border-slate-200 rounded text-xs"
              />
            </div>
          </div>

          <button
            onClick={handleEvaluate}
            disabled={isLoading}
            className="w-full py-2.5 bg-teal-600 hover:bg-teal-700 text-white font-semibold rounded text-xs flex items-center justify-center gap-2 shadow-xs"
          >
            {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            Validate AWB Checksum & Screen Air Routing
          </button>
        </div>

        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="font-bold text-slate-900 text-sm">Air Logistics Compliance Verdict</h3>
            {result && (
              <span
                className={`text-xs px-2 py-0.5 rounded font-bold uppercase ${
                  result.cargoDetails.securityScreeningStatus === 'CLEARED'
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-rose-50 text-rose-700 border border-rose-200'
                }`}
              >
                {result.cargoDetails.securityScreeningStatus}
              </span>
            )}
          </div>

          {!result ? (
            <div className="py-16 text-center text-slate-400 text-xs">
              <Plane className="w-8 h-8 mx-auto text-slate-300 mb-2" />
              Click "Validate AWB Checksum & Screen Air Routing" to check IATA mod-7 validity and high-risk airport corridors.
            </div>
          ) : (
            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div className={`p-3 rounded border ${result.isAwbChecksumValid ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200'}`}>
                  <div className="font-bold text-slate-800">IATA AWB Checksum (Mod-7)</div>
                  <div className={`mt-1 font-semibold ${result.isAwbChecksumValid ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {result.isAwbChecksumValid ? '✓ Valid IATA AWB' : '✗ Invalid AWB Check Digit'}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">{result.airlineName}</div>
                </div>

                <div className={`p-3 rounded border ${!result.routing.hasHighRiskTransshipment ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200'}`}>
                  <div className="font-bold text-slate-800">Airport Transshipment Risk</div>
                  <div className={`mt-1 font-semibold ${!result.routing.hasHighRiskTransshipment ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {result.routing.hasHighRiskTransshipment ? 'High-Risk Transit Detected' : 'Safe Routing Corridor'}
                  </div>
                  {result.routing.highRiskTransitDetails && (
                    <div className="text-[10px] text-rose-700 mt-0.5">{result.routing.highRiskTransitDetails}</div>
                  )}
                </div>
              </div>

              <div>
                <h4 className="font-bold text-slate-800 uppercase text-[11px] mb-1.5">
                  Screened Air Waybill Parties
                </h4>
                <div className="space-y-1">
                  {result.parties.map((p, i) => (
                    <div key={i} className="p-2 bg-slate-50 border border-slate-200 rounded flex justify-between items-center">
                      <div>
                        <span className="font-semibold text-slate-800">{p.name}</span>
                        <span className="text-[10px] text-slate-500 ml-2">({p.role})</span>
                      </div>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                        p.matches.length > 0 ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'
                      }`}>
                        {p.matches.length > 0 ? 'MATCH CANDIDATE' : 'CLEAR'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                <span className="font-mono truncate max-w-xs">SHA-256: {result.evidenceDigest}</span>
                <span className="font-medium text-emerald-700 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Certified Air Cargo Audit Pack
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------
// 5. Insurance Workspace
// ----------------------------------------------------
export function InsuranceWorkspace() {
  const [insData, setInsData] = useState(MULTI_MODULE_FIXTURES.INSURANCE);
  const [result, setResult] = useState<InsuranceEvaluation | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleEvaluate = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/modules/insurance/evaluate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-analyst-token': DEMO_ANALYST_TOKEN,
        },
        body: JSON.stringify(insData),
      });
      const data = await res.json();
      setResult(data);
    } catch (e: any) {
      alert(`Error evaluating insurance policy: ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-teal-600" /> Policy Underwriting & UBO Hierarchy
            </h3>
            <button
              onClick={() => setInsData(MULTI_MODULE_FIXTURES.INSURANCE)}
              className="text-xs text-teal-600 hover:underline flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" /> Reload Sample
            </button>
          </div>

          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Policy Number</label>
                <input
                  type="text"
                  value={insData.policyNumber}
                  onChange={(e) => setInsData({ ...insData, policyNumber: e.target.value })}
                  className="w-full p-1.5 border border-slate-200 rounded font-mono text-xs"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Sum Insured ({insData.currency})</label>
                <input
                  type="number"
                  value={insData.sumInsured}
                  onChange={(e) => setInsData({ ...insData, sumInsured: parseFloat(e.target.value) })}
                  className="w-full p-1.5 border border-slate-200 rounded font-mono text-xs"
                />
              </div>
            </div>

            <div>
              <label className="font-semibold text-slate-700 block mb-1">Beneficial Ownership (UBO) Shares</label>
              <div className="p-2 bg-slate-50 border border-slate-200 rounded text-[11px] space-y-1">
                {insData.corporateEntityUbo.beneficialOwners.map((owner, i) => (
                  <div key={i} className="flex justify-between items-center">
                    <span>{owner.name}</span>
                    <span className="font-bold text-teal-700">{owner.ownershipPercentage}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <button
            onClick={handleEvaluate}
            disabled={isLoading}
            className="w-full py-2.5 bg-teal-600 hover:bg-teal-700 text-white font-semibold rounded text-xs flex items-center justify-center gap-2 shadow-xs"
          >
            {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            Enforce OFAC 50% Rule & Screen Policyholders
          </button>
        </div>

        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="font-bold text-slate-900 text-sm">Underwriting Clearance Dossier</h3>
            {result && (
              <span
                className={`text-xs px-2 py-0.5 rounded font-bold uppercase ${
                  result.underwritingDecision === 'APPROVED'
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : result.underwritingDecision === 'REFER_TO_SENIOR_COUNSEL'
                    ? 'bg-amber-50 text-amber-700 border border-amber-200'
                    : 'bg-rose-50 text-rose-700 border border-rose-200'
                }`}
              >
                {result.underwritingDecision}
              </span>
            )}
          </div>

          {!result ? (
            <div className="py-16 text-center text-slate-400 text-xs">
              <ShieldCheck className="w-8 h-8 mx-auto text-slate-300 mb-2" />
              Click "Enforce OFAC 50% Rule & Screen Policyholders" to evaluate corporate ownership shares and aggregate blocked exposure.
            </div>
          ) : (
            <div className="space-y-4 text-xs">
              <div className={`p-4 rounded border ${
                result.uboAnalysis.violatesOfac50PercentRule
                  ? 'bg-rose-50 border-rose-200 text-rose-900'
                  : 'bg-emerald-50 border-emerald-200 text-emerald-900'
              }`}>
                <div className="flex justify-between items-center font-bold">
                  <span>OFAC 50% Aggregate Blocked Ownership</span>
                  <span className="text-base">{result.uboAnalysis.aggregateSanctionedOwnershipPercentage}%</span>
                </div>
                <p className="mt-1 text-[11px]">
                  {result.uboAnalysis.violatesOfac50PercentRule
                    ? 'VIOLATION DETECTED: Aggregate blocked ownership equals or exceeds 50%. The entity is blocked by operation of law.'
                    : 'COMPLIANT: Blocked ownership is below the 50% threshold.'}
                </p>
              </div>

              <div>
                <h4 className="font-bold text-slate-800 uppercase text-[11px] mb-1.5">
                  Beneficial Ownership Breakdown
                </h4>
                <div className="space-y-1">
                  {result.uboAnalysis.beneficialOwners.map((o, i) => (
                    <div key={i} className="p-2 bg-slate-50 border border-slate-200 rounded flex justify-between items-center">
                      <div>
                        <span className="font-semibold text-slate-800">{o.name}</span>
                        <span className="text-[10px] text-slate-500 ml-2">({o.ownershipPercentage}%)</span>
                      </div>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                        o.isSanctioned ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'
                      }`}>
                        {o.isSanctioned ? 'SANCTIONED PERSON' : 'CLEAR'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                <span className="font-mono truncate max-w-xs">SHA-256: {result.evidenceDigest}</span>
                <span className="font-medium text-emerald-700 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Underwriting Certificate Verified
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------
// 6. Crypto Workspace
// ----------------------------------------------------
export function CryptoWorkspace() {
  const [cryptoData, setCryptoData] = useState(MULTI_MODULE_FIXTURES.CRYPTO);
  const [result, setResult] = useState<CryptoEvaluation | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleEvaluate = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/modules/crypto/evaluate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-analyst-token': DEMO_ANALYST_TOKEN,
        },
        body: JSON.stringify(cryptoData),
      });
      const data = await res.json();
      setResult(data);
    } catch (e: any) {
      alert(`Error evaluating crypto transfer: ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
              <Cpu className="w-4 h-4 text-teal-600" /> On-Chain Transfer & IVMS 101 Payload
            </h3>
            <button
              onClick={() => setCryptoData(MULTI_MODULE_FIXTURES.CRYPTO)}
              className="text-xs text-teal-600 hover:underline flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" /> Reload Sample
            </button>
          </div>

          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Asset</label>
                <input
                  type="text"
                  value={cryptoData.asset}
                  onChange={(e) => setCryptoData({ ...cryptoData, asset: e.target.value as any })}
                  className="w-full p-1.5 border border-slate-200 rounded font-mono text-xs uppercase"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Amount</label>
                <input
                  type="number"
                  value={cryptoData.amount}
                  onChange={(e) => setCryptoData({ ...cryptoData, amount: parseFloat(e.target.value) })}
                  className="w-full p-1.5 border border-slate-200 rounded font-mono text-xs"
                />
              </div>
            </div>

            <div>
              <label className="font-semibold text-slate-700 block mb-1">Source Address ({cryptoData.sourceNetwork})</label>
              <input
                type="text"
                value={cryptoData.sourceAddress}
                onChange={(e) => setCryptoData({ ...cryptoData, sourceAddress: e.target.value })}
                className="w-full p-1.5 border border-slate-200 rounded font-mono text-[11px]"
              />
            </div>

            <div>
              <label className="font-semibold text-slate-700 block mb-1">Destination Address ({cryptoData.destinationNetwork})</label>
              <input
                type="text"
                value={cryptoData.destinationAddress}
                onChange={(e) => setCryptoData({ ...cryptoData, destinationAddress: e.target.value })}
                className="w-full p-1.5 border border-slate-200 rounded font-mono text-[11px]"
              />
            </div>
          </div>

          <button
            onClick={handleEvaluate}
            disabled={isLoading}
            className="w-full py-2.5 bg-teal-600 hover:bg-teal-700 text-white font-semibold rounded text-xs flex items-center justify-center gap-2 shadow-xs"
          >
            {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            Validate Address, Mixer Risk & Travel Rule
          </button>
        </div>

        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="font-bold text-slate-900 text-sm">Crypto Compliance Clearance</h3>
            {result && (
              <span
                className={`text-xs px-2 py-0.5 rounded font-bold uppercase ${
                  result.clearanceStatus === 'TRANSACTION_PERMITTED'
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-rose-50 text-rose-700 border border-rose-200'
                }`}
              >
                {result.clearanceStatus}
              </span>
            )}
          </div>

          {!result ? (
            <div className="py-16 text-center text-slate-400 text-xs">
              <Cpu className="w-8 h-8 mx-auto text-slate-300 mb-2" />
              Click "Validate Address, Mixer Risk & Travel Rule" to detect sanctioned smart contract mixers and verify IVMS 101 payload completeness.
            </div>
          ) : (
            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div className={`p-3 rounded border ${result.sourceAddress.isKnownMixerOrSanctionedCluster ? 'bg-rose-50 border-rose-200 text-rose-900' : 'bg-emerald-50 border-emerald-200 text-emerald-900'}`}>
                  <div className="font-bold">Source Address Risk</div>
                  <div className="font-semibold mt-1">
                    {result.sourceAddress.isKnownMixerOrSanctionedCluster ? '⚠️ PROHIBITED SANCTIONED MIXER' : 'Clear Unhosted/Exchange'}
                  </div>
                  {result.sourceAddress.attributedEntity && (
                    <div className="text-[11px] text-rose-700 font-bold mt-0.5">{result.sourceAddress.attributedEntity}</div>
                  )}
                </div>

                <div className={`p-3 rounded border ${result.travelRule.isIvmsPayloadComplete ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-amber-50 border-amber-200 text-amber-900'}`}>
                  <div className="font-bold">IVMS 101 Travel Rule</div>
                  <div className="font-semibold mt-1">
                    {result.travelRule.isIvmsPayloadComplete ? '✓ Compliant Payload' : '⚠️ Travel Rule Deficit'}
                  </div>
                  <div className="text-[11px] text-slate-600 mt-0.5">
                    Threshold: $1,000 | Transfer: ${result.amount.toLocaleString()}
                  </div>
                </div>
              </div>

              {result.travelRule.missingMandatoryFields.length > 0 && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded text-amber-900">
                  <div className="font-bold flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" /> Missing IVMS 101 Mandatory Fields:
                  </div>
                  <div className="mt-1 space-y-0.5">
                    {result.travelRule.missingMandatoryFields.map((f, i) => (
                      <div key={i} className="text-[11px] font-mono">• {f}</div>
                    ))}
                  </div>
                </div>
              )}

              <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                <span className="font-mono truncate max-w-xs">SHA-256: {result.evidenceDigest}</span>
                <span className="font-medium text-emerald-700 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Blockchain Audit Hash Certified
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------
// 7. Healthcare Workspace
// ----------------------------------------------------
export function HealthcareWorkspace() {
  const [healthData, setHealthData] = useState(MULTI_MODULE_FIXTURES.HEALTHCARE);
  const [result, setResult] = useState<HealthcareEvaluation | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleEvaluate = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/modules/healthcare/evaluate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-analyst-token': DEMO_ANALYST_TOKEN,
        },
        body: JSON.stringify(healthData),
      });
      const data = await res.json();
      setResult(data);
    } catch (e: any) {
      alert(`Error evaluating healthcare claim: ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
              <Activity className="w-4 h-4 text-teal-600" /> Practitioner & Provider Credentials
            </h3>
            <button
              onClick={() => setHealthData(MULTI_MODULE_FIXTURES.HEALTHCARE)}
              className="text-xs text-teal-600 hover:underline flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" /> Reload Sample
            </button>
          </div>

          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Claim ID</label>
                <input
                  type="text"
                  value={healthData.claimId}
                  onChange={(e) => setHealthData({ ...healthData, claimId: e.target.value })}
                  className="w-full p-1.5 border border-slate-200 rounded font-mono text-xs"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Billed Amount ($)</label>
                <input
                  type="number"
                  value={healthData.billedAmount}
                  onChange={(e) => setHealthData({ ...healthData, billedAmount: parseFloat(e.target.value) })}
                  className="w-full p-1.5 border border-slate-200 rounded font-mono text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">10-Digit NPI Number</label>
                <input
                  type="text"
                  value={healthData.practitioner.npi}
                  onChange={(e) => setHealthData({ ...healthData, practitioner: { ...healthData.practitioner, npi: e.target.value } })}
                  className="w-full p-1.5 border border-slate-200 rounded font-mono text-xs"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">DEA Registration #</label>
                <input
                  type="text"
                  value={healthData.practitioner.deaNumber}
                  onChange={(e) => setHealthData({ ...healthData, practitioner: { ...healthData.practitioner, deaNumber: e.target.value } })}
                  className="w-full p-1.5 border border-slate-200 rounded font-mono text-xs uppercase"
                />
              </div>
            </div>

            <div>
              <label className="font-semibold text-slate-700 block mb-1">Practitioner Name</label>
              <input
                type="text"
                value={healthData.practitioner.name}
                onChange={(e) => setHealthData({ ...healthData, practitioner: { ...healthData.practitioner, name: e.target.value } })}
                className="w-full p-1.5 border border-slate-200 rounded text-xs"
              />
            </div>
          </div>

          <button
            onClick={handleEvaluate}
            disabled={isLoading}
            className="w-full py-2.5 bg-teal-600 hover:bg-teal-700 text-white font-semibold rounded text-xs flex items-center justify-center gap-2 shadow-xs"
          >
            {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            Validate NPI/DEA & Screen OIG-LEIE Exclusions
          </button>
        </div>

        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="font-bold text-slate-900 text-sm">Healthcare Exclusion & Integrity Results</h3>
            {result && (
              <span
                className={`text-xs px-2 py-0.5 rounded font-bold uppercase ${
                  result.claimIntegrityStatus === 'PAYMENT_APPROVED'
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-rose-50 text-rose-700 border border-rose-200'
                }`}
              >
                {result.claimIntegrityStatus}
              </span>
            )}
          </div>

          {!result ? (
            <div className="py-16 text-center text-slate-400 text-xs">
              <Activity className="w-8 h-8 mx-auto text-slate-300 mb-2" />
              Click "Validate NPI/DEA & Screen OIG-LEIE Exclusions" to run CMS Luhn Mod-10 checksum and check HHS-OIG exclusion records.
            </div>
          ) : (
            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div className={`p-3 rounded border ${result.practitioner?.isNpiValid ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200'}`}>
                  <div className="font-bold text-slate-800">NPI CMS Luhn Mod-10 Check</div>
                  <div className={`mt-1 font-semibold ${result.practitioner?.isNpiValid ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {result.practitioner?.isNpiValid ? '✓ Valid CMS NPI' : '✗ Invalid NPI Checksum'}
                  </div>
                </div>

                <div className={`p-3 rounded border ${result.practitioner?.isDeaValid ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200'}`}>
                  <div className="font-bold text-slate-800">DEA Number Formula</div>
                  <div className={`mt-1 font-semibold ${result.practitioner?.isDeaValid ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {result.practitioner?.isDeaValid ? '✓ Valid DEA Registrant' : '✗ Invalid DEA Checksum'}
                  </div>
                </div>
              </div>

              {result.exclusionHits.length > 0 ? (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded text-rose-900 space-y-1">
                  <div className="font-bold flex items-center gap-1">
                    <ShieldAlert className="w-4 h-4 text-rose-600" /> Mandatory Federal Exclusion Matches:
                  </div>
                  {result.exclusionHits.map((hit, i) => (
                    <div key={i} className="text-[11px]">
                      <span className="font-bold">[{hit.source}] {hit.entityName}</span>: {hit.exclusionReason}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded text-emerald-800">
                  ✓ No matches found on OIG-LEIE, SAM.gov, or global healthcare sanctions lists.
                </div>
              )}

              <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                <span className="font-mono truncate max-w-xs">SHA-256: {result.evidenceDigest}</span>
                <span className="font-medium text-emerald-700 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Healthcare Compliance Pack Retained
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------
// 8. Securities Workspace
// ----------------------------------------------------
export function SecuritiesWorkspace() {
  const [secData, setSecData] = useState(MULTI_MODULE_FIXTURES.SECURITIES);
  const [result, setResult] = useState<SecuritiesEvaluation | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleEvaluate = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/modules/securities/evaluate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-analyst-token': DEMO_ANALYST_TOKEN,
        },
        body: JSON.stringify(secData),
      });
      const data = await res.json();
      setResult(data);
    } catch (e: any) {
      alert(`Error evaluating securities order: ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4 text-teal-600" /> FIX Protocol Stream & Order
            </h3>
            <button
              onClick={() => setSecData(MULTI_MODULE_FIXTURES.SECURITIES)}
              className="text-xs text-teal-600 hover:underline flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" /> Reload Sample
            </button>
          </div>

          <div className="space-y-3 text-xs">
            <div>
              <label className="font-semibold text-slate-700 block mb-1">Raw FIX Message (Tag=Value format with | delimiter)</label>
              <textarea
                rows={4}
                value={secData.rawFixMessage}
                onChange={(e) => setSecData({ ...secData, rawFixMessage: e.target.value })}
                className="w-full p-2 border border-slate-200 rounded font-mono text-[11px]"
              />
            </div>
          </div>

          <button
            onClick={handleEvaluate}
            disabled={isLoading}
            className="w-full py-2.5 bg-teal-600 hover:bg-teal-700 text-white font-semibold rounded text-xs flex items-center justify-center gap-2 shadow-xs"
          >
            {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            Parse FIX Tags, Validate ISIN & Screen Sectoral SSI
          </button>
        </div>

        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="font-bold text-slate-900 text-sm">Pre-Trade Surveillance & Sanctions Status</h3>
            {result && (
              <span
                className={`text-xs px-2 py-0.5 rounded font-bold uppercase ${
                  result.orderStatus === 'ROUTING_ALLOWED'
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-rose-50 text-rose-700 border border-rose-200'
                }`}
              >
                {result.orderStatus}
              </span>
            )}
          </div>

          {!result ? (
            <div className="py-16 text-center text-slate-400 text-xs">
              <TrendingUp className="w-8 h-8 mx-auto text-slate-300 mb-2" />
              Click "Parse FIX Tags, Validate ISIN & Screen Sectoral SSI" to test 12-char ISIN Luhn checksums and EU/OFAC debt prohibitions.
            </div>
          ) : (
            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div className={`p-3 rounded border ${result.instrument.isIsinChecksumValid ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200'}`}>
                  <div className="font-bold text-slate-800">12-Character ISIN Checksum</div>
                  <div className={`mt-1 font-semibold ${result.instrument.isIsinChecksumValid ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {result.instrument.isIsinChecksumValid ? '✓ Valid ISIN Checksum' : '✗ Invalid ISIN'}
                  </div>
                  <div className="text-[11px] text-slate-500 font-mono mt-0.5">{result.instrument.isin}</div>
                </div>

                <div className={`p-3 rounded border ${!result.instrument.isSectoralSanctionedDebtOrEquity ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200 text-rose-900'}`}>
                  <div className="font-bold">Sectoral Sanctions (Directives 1-4)</div>
                  <div className={`mt-1 font-semibold ${!result.instrument.isSectoralSanctionedDebtOrEquity ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {result.instrument.isSectoralSanctionedDebtOrEquity ? '⚠️ PROHIBITED SECTORAL DEBT' : 'Clean Asset Class'}
                  </div>
                </div>
              </div>

              {result.surveillanceAlerts.length > 0 && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded text-amber-900 space-y-1">
                  <div className="font-bold flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" /> Surveillance & Regulatory Alerts:
                  </div>
                  {result.surveillanceAlerts.map((a, i) => (
                    <div key={i} className="text-[11px]">• {a}</div>
                  ))}
                </div>
              )}

              <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                <span className="font-mono truncate max-w-xs">SHA-256: {result.evidenceDigest}</span>
                <span className="font-medium text-emerald-700 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> FIX Trade Audit Chain Anchored
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------
// 9. Validation and Audit Workspace
// ----------------------------------------------------
export function ValidationAndAuditWorkspace() {
  const [result, setResult] = useState<ValidationAndAuditEvaluation | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleRunBenchmark = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/modules/validation/benchmark', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-analyst-token': DEMO_ANALYST_TOKEN,
        },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      setResult(data);
    } catch (e: any) {
      alert(`Error running validation benchmark: ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-teal-600" /> Synthetic Evasion Generator & Model Risk Benchmark
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Generates 8 realistic evasion typologies (Cyrillic homoglyphs, vowel dropping, inverted names, spacing, container disguise, vessel IMO scrub, missing account, narrative noise) and audits ledger integrity.
            </p>
          </div>

          <button
            onClick={handleRunBenchmark}
            disabled={isLoading}
            className="py-2.5 px-4 bg-teal-600 hover:bg-teal-700 text-white font-semibold rounded text-xs flex items-center justify-center gap-2 shadow-xs shrink-0"
          >
            {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <PlayIcon />}
            Execute Evasion Benchmark & Ledger Audit
          </button>
        </div>

        {!result ? (
          <div className="py-20 text-center text-slate-400 text-xs">
            <CheckCircle2 className="w-10 h-10 mx-auto text-slate-300 mb-2" />
            Click "Execute Evasion Benchmark & Ledger Audit" to simulate adversarial evasion attacks and test engine robustness.
          </div>
        ) : (
          <div className="space-y-6">
            {/* Top Metrics Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded text-center">
                <div className="text-[10px] font-bold text-slate-500 uppercase">Precision</div>
                <div className="text-xl font-bold text-slate-900 mt-1">{(result.benchmarkMetrics.precision * 100).toFixed(1)}%</div>
              </div>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded text-center">
                <div className="text-[10px] font-bold text-slate-500 uppercase">Recall</div>
                <div className="text-xl font-bold text-slate-900 mt-1">{(result.benchmarkMetrics.recall * 100).toFixed(1)}%</div>
              </div>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded text-center">
                <div className="text-[10px] font-bold text-slate-500 uppercase">F1-Score</div>
                <div className="text-xl font-bold text-teal-700 mt-1">{result.benchmarkMetrics.f1Score.toFixed(3)}</div>
              </div>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded text-center">
                <div className="text-[10px] font-bold text-slate-500 uppercase">False Positive Rate</div>
                <div className="text-xl font-bold text-emerald-700 mt-1">{(result.benchmarkMetrics.falsePositiveRate * 100).toFixed(1)}%</div>
              </div>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded text-center">
                <div className="text-[10px] font-bold text-slate-500 uppercase">Mean Latency</div>
                <div className="text-xl font-bold text-slate-900 mt-1">{result.benchmarkMetrics.meanLatencyMs} ms</div>
              </div>
            </div>

            {/* Test Cases Matrix */}
            <div>
              <h4 className="font-bold text-slate-800 uppercase text-xs mb-2">
                Adversarial Evasion Typology Matrix ({result.testCases.length} Test Vectors)
              </h4>
              <div className="border border-slate-200 rounded overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                    <tr>
                      <th className="p-2.5">Case ID</th>
                      <th className="p-2.5">Typology</th>
                      <th className="p-2.5">Baseline Entity</th>
                      <th className="p-2.5">Adversarial Payload</th>
                      <th className="p-2.5">Expected</th>
                      <th className="p-2.5">Detected</th>
                      <th className="p-2.5 text-right">Verdict</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                    {result.testCases.map((tc) => (
                      <tr key={tc.caseId} className={tc.passed ? 'bg-white' : 'bg-rose-50'}>
                        <td className="p-2.5 font-bold text-slate-800">{tc.caseId}</td>
                        <td className="p-2.5 font-sans text-slate-600">{tc.typology}</td>
                        <td className="p-2.5 text-slate-700">{tc.baselineEntity}</td>
                        <td className="p-2.5 text-teal-800 font-bold">{tc.evasionPayload}</td>
                        <td className="p-2.5 font-sans">{tc.expectedDetection ? 'BLOCK' : 'PASS'}</td>
                        <td className="p-2.5 font-sans font-bold">{tc.actualDetection ? 'BLOCK' : 'PASS'}</td>
                        <td className="p-2.5 text-right font-sans">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            tc.passed ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                          }`}>
                            {tc.passed ? 'PASSED' : 'FAILED'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Historical Ledger Audit */}
            <div className="p-4 bg-slate-50 border border-slate-200 rounded flex items-center justify-between">
              <div>
                <span className="font-bold text-slate-800">Historical Case Ledger Hash Verification: </span>
                <span className="text-slate-600 ml-1">
                  {result.historicalLedgerVerification.chainsIntact} of {result.historicalLedgerVerification.totalRecordsAudited} cases intact (0 breaks).
                </span>
              </div>
              <span className="text-xs px-2.5 py-1 bg-emerald-100 text-emerald-800 font-bold rounded flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> {result.historicalLedgerVerification.verificationStatus}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PlayIcon() {
  return (
    <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}
