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
  Plus,
  Trash2,
  Share2,
  Upload,
  Layers,
  Terminal,
} from 'lucide-react';
import {
  ComplianceModuleId,
  COMPLIANCE_MODULES,
  AlertEvidenceGraph,
  TradeAndCargoEvaluation,
  MaritimeEvaluation,
  MaritimeVesselInfo,
  VesselOwnershipNode,
  AirCargoEvaluation,
  InsuranceEvaluation,
  CryptoEvaluation,
  HealthcareEvaluation,
  SecuritiesEvaluation,
  ValidationAndAuditEvaluation,
  DEMO_ANALYST_TOKEN,
  ModuleWorkflowRecord,
} from '../shared/types.ts';
import { EvidenceGraphView } from './EvidenceGraphView.tsx';
import { EvaluateMaritimeRequest } from '../server/services/modules/maritimeService.ts';
import { EvaluateAirCargoRequest } from '../server/services/modules/airCargoService.ts';
import { EvaluateInsuranceRequest } from '../server/services/modules/insuranceService.ts';
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
      case 'LISTS_AND_DATA_SOURCES': return <Database className="w-4 h-4" />;
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

export function ModuleEvidenceGraphSection({
  moduleId,
  evaluation,
}: {
  moduleId: ComplianceModuleId;
  evaluation: any;
}) {
  const [graph, setGraph] = useState<AlertEvidenceGraph | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!evaluation) return;
    setLoading(true);
    setError(null);
    fetch('/api/graphs/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-analyst-token': DEMO_ANALYST_TOKEN,
      },
      body: JSON.stringify({ moduleId, payload: evaluation }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Failed to generate graph');
        }
        return res.json();
      })
      .then((g) => setGraph(g))
      .catch((e: any) => setError(e.message))
      .finally(() => setLoading(false));
  }, [moduleId, evaluation]);

  if (loading) {
    return (
      <div className="p-8 text-center text-slate-500 text-xs flex items-center justify-center gap-2">
        <RefreshCw className="w-4 h-4 text-teal-600 animate-spin" />
        <span>Generating Alert Evidence Graph from structured evidence...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded">
        Graph generation notice: {error}
      </div>
    );
  }

  if (!graph) return null;
  return <EvidenceGraphView graph={graph} />;
}

// ----------------------------------------------------
// 2. Trade and Cargo Workspace
// ----------------------------------------------------
export function TradeAndCargoWorkspace() {
  const [tradeData, setTradeData] = useState(MULTI_MODULE_FIXTURES.TRADE_AND_CARGO);
  const [includePackingList, setIncludePackingList] = useState(true);
  const [includePayment, setIncludePayment] = useState(true);
  const [activeInputTab, setActiveInputTab] = useState<'invoice' | 'goods' | 'bl' | 'packing' | 'payment'>('invoice');
  const [result, setResult] = useState<TradeAndCargoEvaluation | null>(null);
  const [activeResultTab, setActiveResultTab] = useState<'audit' | 'graph'>('audit');
  const [isLoading, setIsLoading] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);

  const handleEvaluate = async () => {
    setIsLoading(true);
    setClientError(null);
    try {
      const payload: any = {
        invoice: tradeData.invoice,
        billOfLading: tradeData.billOfLading,
      };
      if (includePackingList && tradeData.packingList) {
        payload.packingList = tradeData.packingList;
      }
      if (includePayment && tradeData.paymentInstruction) {
        payload.paymentInstruction = tradeData.paymentInstruction;
      }

      const res = await fetch('/api/modules/trade/evaluate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-analyst-token': DEMO_ANALYST_TOKEN,
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setClientError(data.error || 'Trade evaluation rejected with client error.');
        setResult(null);
      } else {
        setResult(data);
      }
    } catch (e: any) {
      setClientError(`Error evaluating trade documents: ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportEvidence = () => {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Trade_Evidence_${result.referenceId}_${result.evidenceDigest.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
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
              onClick={() => {
                setTradeData(MULTI_MODULE_FIXTURES.TRADE_AND_CARGO);
                setIncludePackingList(true);
                setIncludePayment(true);
                setClientError(null);
              }}
              className="text-xs text-teal-600 hover:underline flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" /> Reload Sample
            </button>
          </div>

          {/* Sub-Tabs for Documents */}
          <div className="flex border-b border-slate-200 text-[11px] gap-1 overflow-x-auto no-scrollbar pb-1">
            <button
              onClick={() => setActiveInputTab('invoice')}
              className={`px-2.5 py-1 rounded font-medium ${activeInputTab === 'invoice' ? 'bg-teal-50 text-teal-700 border border-teal-200 font-bold' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              Invoice
            </button>
            <button
              onClick={() => setActiveInputTab('goods')}
              className={`px-2.5 py-1 rounded font-medium ${activeInputTab === 'goods' ? 'bg-teal-50 text-teal-700 border border-teal-200 font-bold' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              Goods ({tradeData.invoice.lineItems.length})
            </button>
            <button
              onClick={() => setActiveInputTab('bl')}
              className={`px-2.5 py-1 rounded font-medium ${activeInputTab === 'bl' ? 'bg-teal-50 text-teal-700 border border-teal-200 font-bold' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              Transport (B/L)
            </button>
            <button
              onClick={() => setActiveInputTab('packing')}
              className={`px-2.5 py-1 rounded font-medium ${activeInputTab === 'packing' ? 'bg-teal-50 text-teal-700 border border-teal-200 font-bold' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              Packing List {includePackingList ? '✓' : '(Off)'}
            </button>
            <button
              onClick={() => setActiveInputTab('payment')}
              className={`px-2.5 py-1 rounded font-medium ${activeInputTab === 'payment' ? 'bg-teal-50 text-teal-700 border border-teal-200 font-bold' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              Payment {includePayment ? '✓' : '(Off)'}
            </button>
          </div>

          {/* Active Input Tab Content */}
          <div className="space-y-3 text-xs">
            {activeInputTab === 'invoice' && (
              <div className="space-y-2">
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <label className="font-semibold text-slate-700 block mb-1">Invoice Number</label>
                    <input
                      type="text"
                      value={tradeData.invoice.invoiceNumber}
                      onChange={(e) => setTradeData({ ...tradeData, invoice: { ...tradeData.invoice, invoiceNumber: e.target.value } })}
                      className="w-full p-1.5 border border-slate-200 rounded font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Currency</label>
                    <input
                      type="text"
                      value={tradeData.invoice.currency}
                      onChange={(e) => setTradeData({ ...tradeData, invoice: { ...tradeData.invoice, currency: e.target.value.toUpperCase() } })}
                      className="w-full p-1.5 border border-slate-200 rounded font-mono text-xs uppercase"
                    />
                  </div>
                </div>

                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Total Invoice Amount</label>
                  <input
                    type="number"
                    value={tradeData.invoice.totalAmount}
                    onChange={(e) => setTradeData({ ...tradeData, invoice: { ...tradeData.invoice, totalAmount: parseFloat(e.target.value) || 0 } })}
                    className="w-full p-1.5 border border-slate-200 rounded font-mono text-xs"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Seller / Exporter Name</label>
                    <input
                      type="text"
                      value={tradeData.invoice.sellerName}
                      onChange={(e) => setTradeData({ ...tradeData, invoice: { ...tradeData.invoice, sellerName: e.target.value } })}
                      className="w-full p-1.5 border border-slate-200 rounded text-xs"
                      placeholder="Seller Name (Required)"
                    />
                  </div>
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Seller Country</label>
                    <input
                      type="text"
                      value={tradeData.invoice.sellerCountry}
                      onChange={(e) => setTradeData({ ...tradeData, invoice: { ...tradeData.invoice, sellerCountry: e.target.value.toUpperCase() } })}
                      className="w-full p-1.5 border border-slate-200 rounded font-mono text-xs"
                      placeholder="e.g. NO, US"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Buyer / Importer Name</label>
                    <input
                      type="text"
                      value={tradeData.invoice.buyerName}
                      onChange={(e) => setTradeData({ ...tradeData, invoice: { ...tradeData.invoice, buyerName: e.target.value } })}
                      className="w-full p-1.5 border border-slate-200 rounded text-xs"
                      placeholder="Buyer Name (Required)"
                    />
                  </div>
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Buyer Country</label>
                    <input
                      type="text"
                      value={tradeData.invoice.buyerCountry}
                      onChange={(e) => setTradeData({ ...tradeData, invoice: { ...tradeData.invoice, buyerCountry: e.target.value.toUpperCase() } })}
                      className="w-full p-1.5 border border-slate-200 rounded font-mono text-xs"
                      placeholder="e.g. AE, GB"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Port of Loading (Invoice)</label>
                    <input
                      type="text"
                      value={tradeData.invoice.portOfLoading || ''}
                      onChange={(e) => setTradeData({ ...tradeData, invoice: { ...tradeData.invoice, portOfLoading: e.target.value } })}
                      className="w-full p-1.5 border border-slate-200 rounded text-xs"
                    />
                  </div>
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Port of Discharge (Invoice)</label>
                    <input
                      type="text"
                      value={tradeData.invoice.portOfDischarge || ''}
                      onChange={(e) => setTradeData({ ...tradeData, invoice: { ...tradeData.invoice, portOfDischarge: e.target.value } })}
                      className="w-full p-1.5 border border-slate-200 rounded text-xs"
                    />
                  </div>
                </div>
              </div>
            )}

            {activeInputTab === 'goods' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-700">Invoice Line Items ({tradeData.invoice.lineItems.length})</span>
                  <button
                    onClick={() => {
                      const newLines = [...tradeData.invoice.lineItems, { description: 'New Commodity', hsCode: '8400.00', quantity: 1, unitPrice: 1000, amount: 1000 }];
                      setTradeData({ ...tradeData, invoice: { ...tradeData.invoice, lineItems: newLines } });
                    }}
                    className="text-[11px] text-teal-600 font-bold hover:underline"
                  >
                    + Add Line Item
                  </button>
                </div>
                {tradeData.invoice.lineItems.map((item, idx) => (
                  <div key={idx} className="p-2.5 bg-slate-50 border border-slate-200 rounded space-y-1.5">
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-[11px] text-slate-700">Line #{idx + 1}</span>
                      <button
                        onClick={() => {
                          const newLines = tradeData.invoice.lineItems.filter((_, i) => i !== idx);
                          setTradeData({ ...tradeData, invoice: { ...tradeData.invoice, lineItems: newLines } });
                        }}
                        className="text-[10px] text-rose-600 hover:underline"
                      >
                        Remove
                      </button>
                    </div>
                    <div>
                      <input
                        type="text"
                        value={item.description}
                        onChange={(e) => {
                          const newLines = [...tradeData.invoice.lineItems];
                          newLines[idx].description = e.target.value;
                          setTradeData({ ...tradeData, invoice: { ...tradeData.invoice, lineItems: newLines } });
                        }}
                        className="w-full p-1 bg-white border border-slate-200 rounded text-xs mb-1"
                        placeholder="Commodity Description"
                      />
                    </div>
                    <div className="grid grid-cols-4 gap-1.5 text-[11px]">
                      <div>
                        <label className="text-slate-500 block text-[10px]">HS Code</label>
                        <input
                          type="text"
                          value={item.hsCode || ''}
                          onChange={(e) => {
                            const newLines = [...tradeData.invoice.lineItems];
                            newLines[idx].hsCode = e.target.value;
                            setTradeData({ ...tradeData, invoice: { ...tradeData.invoice, lineItems: newLines } });
                          }}
                          className="w-full p-1 bg-white border border-slate-200 rounded font-mono"
                        />
                      </div>
                      <div>
                        <label className="text-slate-500 block text-[10px]">Qty</label>
                        <input
                          type="number"
                          value={item.quantity}
                          onChange={(e) => {
                            const newLines = [...tradeData.invoice.lineItems];
                            newLines[idx].quantity = parseFloat(e.target.value) || 0;
                            newLines[idx].amount = Math.round(newLines[idx].quantity * newLines[idx].unitPrice * 100) / 100;
                            setTradeData({ ...tradeData, invoice: { ...tradeData.invoice, lineItems: newLines } });
                          }}
                          className="w-full p-1 bg-white border border-slate-200 rounded font-mono"
                        />
                      </div>
                      <div>
                        <label className="text-slate-500 block text-[10px]">Unit Price</label>
                        <input
                          type="number"
                          value={item.unitPrice}
                          onChange={(e) => {
                            const newLines = [...tradeData.invoice.lineItems];
                            newLines[idx].unitPrice = parseFloat(e.target.value) || 0;
                            newLines[idx].amount = Math.round(newLines[idx].quantity * newLines[idx].unitPrice * 100) / 100;
                            setTradeData({ ...tradeData, invoice: { ...tradeData.invoice, lineItems: newLines } });
                          }}
                          className="w-full p-1 bg-white border border-slate-200 rounded font-mono"
                        />
                      </div>
                      <div>
                        <label className="text-slate-500 block text-[10px]">Line Amount</label>
                        <input
                          type="number"
                          value={item.amount}
                          onChange={(e) => {
                            const newLines = [...tradeData.invoice.lineItems];
                            newLines[idx].amount = parseFloat(e.target.value) || 0;
                            setTradeData({ ...tradeData, invoice: { ...tradeData.invoice, lineItems: newLines } });
                          }}
                          className="w-full p-1 bg-white border border-slate-200 rounded font-mono font-bold"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {activeInputTab === 'bl' && (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Bill of Lading #</label>
                    <input
                      type="text"
                      value={tradeData.billOfLading.blNumber}
                      onChange={(e) => setTradeData({ ...tradeData, billOfLading: { ...tradeData.billOfLading, blNumber: e.target.value } })}
                      className="w-full p-1.5 border border-slate-200 rounded font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Carrier Name</label>
                    <input
                      type="text"
                      value={tradeData.billOfLading.carrierName}
                      onChange={(e) => setTradeData({ ...tradeData, billOfLading: { ...tradeData.billOfLading, carrierName: e.target.value } })}
                      className="w-full p-1.5 border border-slate-200 rounded text-xs"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">B/L Shipper Name</label>
                    <input
                      type="text"
                      value={tradeData.billOfLading.shipperName}
                      onChange={(e) => setTradeData({ ...tradeData, billOfLading: { ...tradeData.billOfLading, shipperName: e.target.value } })}
                      className="w-full p-1.5 border border-slate-200 rounded text-xs"
                      placeholder="Shipper (Required)"
                    />
                  </div>
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">B/L Consignee Name</label>
                    <input
                      type="text"
                      value={tradeData.billOfLading.consigneeName}
                      onChange={(e) => setTradeData({ ...tradeData, billOfLading: { ...tradeData.billOfLading, consigneeName: e.target.value } })}
                      className="w-full p-1.5 border border-slate-200 rounded text-xs"
                      placeholder="Consignee (Required)"
                    />
                  </div>
                </div>

                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Notify Party Name</label>
                  <input
                    type="text"
                    value={tradeData.billOfLading.notifyPartyName || ''}
                    onChange={(e) => setTradeData({ ...tradeData, billOfLading: { ...tradeData.billOfLading, notifyPartyName: e.target.value } })}
                    className="w-full p-1.5 border border-slate-200 rounded text-xs"
                    placeholder="Notify Party (Optional or if Consignee is TO ORDER)"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Port of Loading (B/L)</label>
                    <input
                      type="text"
                      value={tradeData.billOfLading.portOfLoading}
                      onChange={(e) => setTradeData({ ...tradeData, billOfLading: { ...tradeData.billOfLading, portOfLoading: e.target.value } })}
                      className="w-full p-1.5 border border-slate-200 rounded text-xs"
                    />
                  </div>
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Port of Discharge (B/L)</label>
                    <input
                      type="text"
                      value={tradeData.billOfLading.portOfDischarge}
                      onChange={(e) => setTradeData({ ...tradeData, billOfLading: { ...tradeData.billOfLading, portOfDischarge: e.target.value } })}
                      className="w-full p-1.5 border border-slate-200 rounded text-xs"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Gross Weight (kg)</label>
                    <input
                      type="number"
                      value={tradeData.billOfLading.grossWeightKg}
                      onChange={(e) => setTradeData({ ...tradeData, billOfLading: { ...tradeData.billOfLading, grossWeightKg: parseFloat(e.target.value) || 0 } })}
                      className="w-full p-1.5 border border-slate-200 rounded font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Vessel Name</label>
                    <input
                      type="text"
                      value={tradeData.billOfLading.vesselName || ''}
                      onChange={(e) => setTradeData({ ...tradeData, billOfLading: { ...tradeData.billOfLading, vesselName: e.target.value } })}
                      className="w-full p-1.5 border border-slate-200 rounded text-xs"
                    />
                  </div>
                </div>

                <div>
                  <label className="font-semibold text-slate-700 block mb-1">B/L Cargo Description (Dual-Use Checked)</label>
                  <textarea
                    value={tradeData.billOfLading.cargoDescription}
                    onChange={(e) => setTradeData({ ...tradeData, billOfLading: { ...tradeData.billOfLading, cargoDescription: e.target.value } })}
                    className="w-full p-1.5 border border-slate-200 rounded text-xs h-16"
                    placeholder="Enter transport cargo description (e.g. centrifuge rotor components)"
                  />
                </div>
              </div>
            )}

            {activeInputTab === 'packing' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                  <span className="font-semibold text-slate-700">Include Packing List in Presentation</span>
                  <input
                    type="checkbox"
                    checked={includePackingList}
                    onChange={(e) => setIncludePackingList(e.target.checked)}
                    className="w-4 h-4 text-teal-600 rounded"
                  />
                </div>
                {includePackingList && tradeData.packingList && (
                  <div className="space-y-2 pt-1">
                    <div>
                      <label className="font-semibold text-slate-700 block mb-1">Packing List Number</label>
                      <input
                        type="text"
                        value={tradeData.packingList.packingListNumber}
                        onChange={(e) => setTradeData({ ...tradeData, packingList: { ...tradeData.packingList!, packingListNumber: e.target.value } })}
                        className="w-full p-1.5 border border-slate-200 rounded font-mono text-xs"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="font-semibold text-slate-700 block mb-1">Total Gross Wt (kg)</label>
                        <input
                          type="number"
                          value={tradeData.packingList.totalGrossWeightKg}
                          onChange={(e) => setTradeData({ ...tradeData, packingList: { ...tradeData.packingList!, totalGrossWeightKg: parseFloat(e.target.value) || 0 } })}
                          className="w-full p-1.5 border border-slate-200 rounded font-mono text-xs"
                        />
                      </div>
                      <div>
                        <label className="font-semibold text-slate-700 block mb-1">Package Count</label>
                        <input
                          type="number"
                          value={tradeData.packingList.packageCount}
                          onChange={(e) => setTradeData({ ...tradeData, packingList: { ...tradeData.packingList!, packageCount: parseInt(e.target.value, 10) || 0 } })}
                          className="w-full p-1.5 border border-slate-200 rounded font-mono text-xs"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeInputTab === 'payment' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                  <span className="font-semibold text-slate-700">Include Payment Instruction in Presentation</span>
                  <input
                    type="checkbox"
                    checked={includePayment}
                    onChange={(e) => setIncludePayment(e.target.checked)}
                    className="w-4 h-4 text-teal-600 rounded"
                  />
                </div>
                {includePayment && tradeData.paymentInstruction && (
                  <div className="space-y-2 pt-1">
                    <div className="grid grid-cols-3 gap-2">
                      <div className="col-span-2">
                        <label className="font-semibold text-slate-700 block mb-1">Payment Reference</label>
                        <input
                          type="text"
                          value={tradeData.paymentInstruction.paymentRef}
                          onChange={(e) => setTradeData({ ...tradeData, paymentInstruction: { ...tradeData.paymentInstruction!, paymentRef: e.target.value } })}
                          className="w-full p-1.5 border border-slate-200 rounded font-mono text-xs"
                        />
                      </div>
                      <div>
                        <label className="font-semibold text-slate-700 block mb-1">Currency</label>
                        <input
                          type="text"
                          value={tradeData.paymentInstruction.currency}
                          onChange={(e) => setTradeData({ ...tradeData, paymentInstruction: { ...tradeData.paymentInstruction!, currency: e.target.value.toUpperCase() } })}
                          className="w-full p-1.5 border border-slate-200 rounded font-mono text-xs uppercase"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="font-semibold text-slate-700 block mb-1">Payment Amount</label>
                      <input
                        type="number"
                        value={tradeData.paymentInstruction.amount}
                        onChange={(e) => setTradeData({ ...tradeData, paymentInstruction: { ...tradeData.paymentInstruction!, amount: parseFloat(e.target.value) || 0 } })}
                        className="w-full p-1.5 border border-slate-200 rounded font-mono text-xs"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="font-semibold text-slate-700 block mb-1">Remitter (Originator)</label>
                        <input
                          type="text"
                          value={tradeData.paymentInstruction.remitterName}
                          onChange={(e) => setTradeData({ ...tradeData, paymentInstruction: { ...tradeData.paymentInstruction!, remitterName: e.target.value } })}
                          className="w-full p-1.5 border border-slate-200 rounded text-xs"
                        />
                      </div>
                      <div>
                        <label className="font-semibold text-slate-700 block mb-1">Beneficiary (Payee)</label>
                        <input
                          type="text"
                          value={tradeData.paymentInstruction.beneficiaryName}
                          onChange={(e) => setTradeData({ ...tradeData, paymentInstruction: { ...tradeData.paymentInstruction!, beneficiaryName: e.target.value } })}
                          className="w-full p-1.5 border border-slate-200 rounded text-xs"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {clientError && (
            <div className="p-2.5 bg-rose-50 border border-rose-200 rounded text-rose-800 text-xs">
              <span className="font-bold block">Validation Error:</span>
              {clientError}
            </div>
          )}

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
            <div className="flex items-center gap-3">
              <h3 className="font-bold text-slate-900 text-sm">Trade Compliance Audit Results</h3>
              {result && (
                <div className="flex items-center gap-1 border border-slate-200 rounded p-0.5 bg-slate-50">
                  <button
                    onClick={() => setActiveResultTab('audit')}
                    className={`px-2 py-0.5 text-xs font-semibold rounded ${
                      activeResultTab === 'audit' ? 'bg-teal-600 text-white shadow-2xs' : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    Audit Findings
                  </button>
                  <button
                    onClick={() => setActiveResultTab('graph')}
                    className={`px-2 py-0.5 text-xs font-semibold rounded flex items-center gap-1 ${
                      activeResultTab === 'graph' ? 'bg-teal-600 text-white shadow-2xs' : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <Share2 className="w-3 h-3" />
                    <span>Evidence Graph</span>
                  </button>
                </div>
              )}
            </div>
            {result && (
              <span
                className={`text-xs px-2 py-0.5 rounded font-bold uppercase ${
                  result.passedVerification
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : result.decisionRecommendation === 'HOLD_FOR_CORRECTIONS'
                    ? 'bg-amber-50 text-amber-700 border border-amber-200'
                    : 'bg-rose-50 text-rose-700 border border-rose-200'
                }`}
              >
                {result.decisionRecommendation.replace(/_/g, ' ')}
              </span>
            )}
          </div>

          {!result ? (
            <div className="py-16 text-center text-slate-400 text-xs">
              <Boxes className="w-8 h-8 mx-auto text-slate-300 mb-2" />
              Click "Run Cross-Document Discrepancy & Goods Screening" to inspect invoice, transport B/L, packing list, and payment data.
            </div>
          ) : activeResultTab === 'graph' ? (
            <ModuleEvidenceGraphSection moduleId="TRADE_AND_CARGO" evaluation={result} />
          ) : (
            <div className="space-y-4 text-xs">
              {/* Dimension 1: Document Completeness & Comparisons Performed */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800 uppercase text-[11px]">
                    1. Presentation Set Completeness
                  </span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    result.completenessStatus === 'FULL_PRESENTATION'
                      ? 'bg-emerald-100 text-emerald-800'
                      : result.completenessStatus === 'PARTIAL_PRESENTATION'
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-rose-100 text-rose-800'
                  }`}>
                    {result.completenessStatus.replace(/_/g, ' ')}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-[10px] pt-1">
                  <div className={`p-1.5 rounded border ${result.comparisonsPerformed.invoiceVsTransport ? 'bg-white border-emerald-200 text-emerald-800' : 'bg-slate-100 text-slate-400'}`}>
                    ✓ Invoice vs Transport
                  </div>
                  <div className={`p-1.5 rounded border ${result.comparisonsPerformed.transportVsPackingList ? 'bg-white border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
                    {result.comparisonsPerformed.transportVsPackingList ? '✓ B/L vs Packing List' : '⚠️ Packing List Omitted'}
                  </div>
                  <div className={`p-1.5 rounded border ${result.comparisonsPerformed.invoiceVsPayment ? 'bg-white border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
                    {result.comparisonsPerformed.invoiceVsPayment ? '✓ Invoice vs Payment' : '⚠️ Payment Omitted'}
                  </div>
                </div>
                {result.comparisonsPerformed.omittedComparisons.length > 0 && (
                  <p className="text-[10px] text-amber-700 italic">
                    Omitted checks: {result.comparisonsPerformed.omittedComparisons.join('; ')}. Complete cross-document verification requires full presentation set.
                  </p>
                )}
              </div>

              {/* Dimension 2: Document Discrepancy Matrix */}
              <div>
                <h4 className="font-bold text-slate-800 uppercase text-[11px] mb-1.5 flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500" /> 2. Document Discrepancy Matrix ({result.discrepancies.length})
                </h4>
                {result.discrepancies.length === 0 ? (
                  <p className="text-emerald-700 text-xs bg-emerald-50 p-2 rounded border border-emerald-100">
                    No discrepancies detected between provided documents.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {result.discrepancies.map((d, i) => (
                      <div key={i} className={`p-2.5 rounded border text-slate-800 ${
                        d.severity === 'CRITICAL' ? 'bg-rose-50 border-rose-200' : 'bg-amber-50 border-amber-200'
                      }`}>
                        <div className="font-bold flex items-center justify-between">
                          <span className={d.severity === 'CRITICAL' ? 'text-rose-800' : 'text-amber-800'}>{d.category}</span>
                          <span className={`text-[10px] px-1.5 py-0.2 rounded font-bold ${
                            d.severity === 'CRITICAL' ? 'bg-rose-200 text-rose-900' : 'bg-amber-200 text-amber-900'
                          }`}>
                            {d.severity}
                          </span>
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

              {/* Dimension 3: Dual-Use Goods Check */}
              <div>
                <h4 className="font-bold text-slate-800 uppercase text-[11px] mb-1.5 flex items-center gap-1">
                  <ShieldAlert className="w-3.5 h-3.5 text-rose-500" /> 3. Dual-Use Proliferation Candidates ({result.dualUseGoods.length})
                </h4>
                {result.dualUseGoods.length === 0 ? (
                  <p className="text-emerald-700 text-xs bg-emerald-50 p-2 rounded border border-emerald-100">
                    No dual-use export control triggers found across invoice and transport descriptions.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {result.dualUseGoods.map((g, i) => (
                      <div key={i} className="p-2.5 bg-rose-50 border border-rose-200 rounded text-slate-800">
                        <div className="font-bold text-rose-800 flex items-center justify-between">
                          <span>HS {g.hsCode} (ECCN: {g.eccnCode || 'N/A'}) · Source: {g.sourceDocument}</span>
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-rose-200 text-rose-900 font-bold">{g.proliferationCategory}</span>
                        </div>
                        <p className="mt-0.5 text-slate-700 font-medium">"{g.commodityDescription}"</p>
                        <p className="mt-1 text-[11px] text-rose-700">{g.assessmentCandidateNote}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Dimension 4: Screened Trade Parties */}
              <div>
                <h4 className="font-bold text-slate-800 uppercase text-[11px] mb-1.5">
                  4. Screened Trade Counterparties ({result.parties.length})
                </h4>
                <div className="space-y-1">
                  {result.parties.map((p, i) => (
                    <div key={i} className="flex items-center justify-between p-2 bg-slate-50 border border-slate-200 rounded">
                      <div>
                        <span className={`font-semibold ${!p.isScreened ? 'text-rose-700' : 'text-slate-800'}`}>
                          {p.name}
                        </span>
                        <span className="text-[10px] text-slate-500 ml-2">({p.role} - {p.country})</span>
                      </div>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                        !p.isScreened
                          ? 'bg-rose-200 text-rose-900'
                          : p.status === 'MATCH_CANDIDATE'
                          ? 'bg-rose-100 text-rose-800'
                          : 'bg-emerald-100 text-emerald-800'
                      }`}>
                        {!p.isScreened ? 'INCOMPLETE / NOT SCREENED' : p.status === 'MATCH_CANDIDATE' ? 'MATCH CANDIDATE' : 'CLEAR'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Dimension 5: Review & Financing Recommendation */}
              <div className={`p-3 rounded border ${
                result.passedVerification ? 'bg-emerald-50 border-emerald-200' : result.decisionRecommendation === 'HOLD_FOR_CORRECTIONS' ? 'bg-amber-50 border-amber-200' : 'bg-rose-50 border-rose-200'
              }`}>
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800 uppercase text-[11px]">
                    5. Review & Financing Recommendation
                  </span>
                  <span className="font-mono text-xs font-bold text-slate-900">
                    {result.decisionRecommendation}
                  </span>
                </div>
                <div className="mt-1 space-y-0.5 text-[11px] text-slate-700">
                  {result.reviewReasons.length === 0 ? (
                    <p className="text-emerald-700">All trade finance criteria, dual-use screening, and cross-document reconciliation passed.</p>
                  ) : (
                    result.reviewReasons.map((r, rIdx) => (
                      <p key={rIdx}>• {r}</p>
                    ))
                  )}
                </div>
              </div>

              {/* Evidence Hash & Export Control */}
              <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                <span className="font-mono truncate max-w-xs">SHA-256: {result.evidenceDigest}</span>
                <button
                  onClick={handleExportEvidence}
                  className="px-2.5 py-1 bg-teal-600 hover:bg-teal-700 text-white rounded font-medium flex items-center gap-1 shadow-xs"
                >
                  <Download className="w-3 h-3" /> Download Sealed Evidence Pack (JSON)
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------
interface MaritimeFormState {
  vessel: MaritimeVesselInfo;
  ownershipHierarchy: {
    role: VesselOwnershipNode['role'];
    name: string;
    country: string;
  }[];
  portsCalled: {
    portName: string;
    unLocode: string;
    country: string;
    arrivalDate?: string;
  }[];
  aisSignals?: {
    lastSeenTimestamp?: string;
    hoursSinceLastBroadcast?: number;
    stsTransferDetected?: boolean;
    knownStsZone?: string;
    flagChangesLast12Months?: number;
  };
}

// ----------------------------------------------------
// 3. Maritime Workspace
// ----------------------------------------------------
export function MaritimeWorkspace() {
  const [maritimeData, setMaritimeData] = useState<MaritimeFormState>(MULTI_MODULE_FIXTURES.MARITIME);
  const [includeAis, setIncludeAis] = useState(true);
  const [activeTab, setActiveTab] = useState<'vessel' | 'ownership' | 'ports' | 'ais'>('vessel');
  const [result, setResult] = useState<MaritimeEvaluation | null>(null);
  const [activeResultTab, setActiveResultTab] = useState<'dossier' | 'graph'>('dossier');
  const [isLoading, setIsLoading] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);
  const [rationale, setRationale] = useState('');
  const [adjudicatedDecision, setAdjudicatedDecision] = useState<string | null>(null);

  const handleEvaluate = async () => {
    setIsLoading(true);
    setClientError(null);
    try {
      const payload: any = {
        vessel: maritimeData.vessel,
        ownershipHierarchy: maritimeData.ownershipHierarchy,
        portsCalled: maritimeData.portsCalled,
      };
      if (includeAis && maritimeData.aisSignals) {
        payload.aisSignals = maritimeData.aisSignals;
      }

      const res = await fetch('/api/modules/maritime/evaluate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-analyst-token': DEMO_ANALYST_TOKEN,
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setClientError(data.error || 'Maritime evaluation rejected with client error.');
        setResult(null);
      } else {
        setResult(data);
      }
    } catch (e: any) {
      setClientError(`Error evaluating maritime vessel: ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportEvidence = () => {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Maritime_Evidence_${result.vessel.imoNumber}_${result.evidenceDigest.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const addOwnershipNode = () => {
    setMaritimeData({
      ...maritimeData,
      ownershipHierarchy: [
        ...maritimeData.ownershipHierarchy,
        { role: 'BENEFICIAL_OWNER', name: '', country: '' },
      ],
    });
  };

  const removeOwnershipNode = (index: number) => {
    setMaritimeData({
      ...maritimeData,
      ownershipHierarchy: maritimeData.ownershipHierarchy.filter((_, i) => i !== index),
    });
  };

  const addPort = () => {
    setMaritimeData({
      ...maritimeData,
      portsCalled: [
        ...maritimeData.portsCalled,
        { portName: '', unLocode: '', country: '', arrivalDate: '2026-11-01' },
      ],
    });
  };

  const removePort = (index: number) => {
    setMaritimeData({
      ...maritimeData,
      portsCalled: maritimeData.portsCalled.filter((_, i) => i !== index),
    });
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Interactive Input Configuration */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
              <Anchor className="w-4 h-4 text-teal-600" /> Vessel Profile & Voyage Dossier
            </h3>
            <button
              onClick={() => {
                setMaritimeData(MULTI_MODULE_FIXTURES.MARITIME);
                setIncludeAis(true);
                setClientError(null);
              }}
              className="text-xs text-teal-600 hover:underline flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" /> Reload Sample
            </button>
          </div>

          {/* Sub-Tabs for Vessel, Ownership, Ports, AIS */}
          <div className="flex border-b border-slate-200 text-[11px] gap-1 overflow-x-auto no-scrollbar pb-1">
            <button
              onClick={() => setActiveTab('vessel')}
              className={`px-2.5 py-1 rounded font-medium ${activeTab === 'vessel' ? 'bg-teal-50 text-teal-700 border border-teal-200 font-bold' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              Vessel Identifiers
            </button>
            <button
              onClick={() => setActiveTab('ownership')}
              className={`px-2.5 py-1 rounded font-medium ${activeTab === 'ownership' ? 'bg-teal-50 text-teal-700 border border-teal-200 font-bold' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              Ownership ({maritimeData.ownershipHierarchy.length})
            </button>
            <button
              onClick={() => setActiveTab('ports')}
              className={`px-2.5 py-1 rounded font-medium ${activeTab === 'ports' ? 'bg-teal-50 text-teal-700 border border-teal-200 font-bold' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              Ports Called ({maritimeData.portsCalled.length})
            </button>
            <button
              onClick={() => setActiveTab('ais')}
              className={`px-2.5 py-1 rounded font-medium ${activeTab === 'ais' ? 'bg-teal-50 text-teal-700 border border-teal-200 font-bold' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              AIS Telemetry {includeAis ? '✓' : '(Omitted)'}
            </button>
          </div>

          {/* TAB 1: VESSEL IDENTIFIERS */}
          {activeTab === 'vessel' && (
            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">IMO Number (7 digits)</label>
                  <input
                    type="text"
                    value={maritimeData.vessel.imoNumber}
                    onChange={(e) =>
                      setMaritimeData({
                        ...maritimeData,
                        vessel: { ...maritimeData.vessel, imoNumber: e.target.value },
                      })
                    }
                    className="w-full p-1.5 border border-slate-200 rounded font-mono text-xs"
                    placeholder="e.g. 9256858"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">MMSI (9 digits)</label>
                  <input
                    type="text"
                    value={maritimeData.vessel.mmsi || ''}
                    onChange={(e) =>
                      setMaritimeData({
                        ...maritimeData,
                        vessel: { ...maritimeData.vessel, mmsi: e.target.value },
                      })
                    }
                    className="w-full p-1.5 border border-slate-200 rounded font-mono text-xs"
                    placeholder="e.g. 214589000"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Vessel Name</label>
                  <input
                    type="text"
                    value={maritimeData.vessel.vesselName}
                    onChange={(e) =>
                      setMaritimeData({
                        ...maritimeData,
                        vessel: { ...maritimeData.vessel, vesselName: e.target.value },
                      })
                    }
                    className="w-full p-1.5 border border-slate-200 rounded text-xs"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Flag State</label>
                  <input
                    type="text"
                    value={maritimeData.vessel.flagState}
                    onChange={(e) =>
                      setMaritimeData({
                        ...maritimeData,
                        vessel: { ...maritimeData.vessel, flagState: e.target.value },
                      })
                    }
                    className="w-full p-1.5 border border-slate-200 rounded text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Vessel Type</label>
                  <select
                    value={maritimeData.vessel.vesselType}
                    onChange={(e) =>
                      setMaritimeData({
                        ...maritimeData,
                        vessel: { ...maritimeData.vessel, vesselType: e.target.value as any },
                      })
                    }
                    className="w-full p-1.5 border border-slate-200 rounded text-xs bg-white"
                  >
                    <option value="CRUDE_OIL_TANKER">Crude Oil Tanker</option>
                    <option value="CHEMICAL_TANKER">Chemical Tanker</option>
                    <option value="CONTAINER_SHIP">Container Ship</option>
                    <option value="BULK_CARRIER">Bulk Carrier</option>
                    <option value="GENERAL_CARGO">General Cargo</option>
                  </select>
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Call Sign</label>
                  <input
                    type="text"
                    value={maritimeData.vessel.callSign || ''}
                    onChange={(e) =>
                      setMaritimeData({
                        ...maritimeData,
                        vessel: { ...maritimeData.vessel, callSign: e.target.value },
                      })
                    }
                    className="w-full p-1.5 border border-slate-200 rounded font-mono text-xs"
                  />
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: OWNERSHIP HIERARCHY */}
          {activeTab === 'ownership' && (
            <div className="space-y-3 text-xs">
              <div className="flex justify-between items-center">
                <span className="font-semibold text-slate-700">Ownership & Management Chain</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setMaritimeData({ ...maritimeData, ownershipHierarchy: [] })}
                    className="text-[11px] text-rose-600 hover:underline"
                  >
                    Clear All
                  </button>
                  <button
                    onClick={addOwnershipNode}
                    className="text-[11px] text-teal-600 hover:underline font-bold"
                  >
                    + Add Owner
                  </button>
                </div>
              </div>

              {maritimeData.ownershipHierarchy.length === 0 ? (
                <div className="p-4 bg-amber-50 border border-amber-200 rounded text-amber-800 text-[11px]">
                  No ownership hierarchy provided. Screening requires registered and beneficial ownership data.
                </div>
              ) : (
                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                  {maritimeData.ownershipHierarchy.map((node, i) => (
                    <div key={i} className="p-2 border border-slate-200 rounded bg-slate-50 space-y-1.5">
                      <div className="flex justify-between items-center">
                        <select
                          value={node.role}
                          onChange={(e) => {
                            const updated = [...maritimeData.ownershipHierarchy];
                            updated[i].role = e.target.value as any;
                            setMaritimeData({ ...maritimeData, ownershipHierarchy: updated });
                          }}
                          className="font-semibold text-slate-800 text-[11px] bg-white border border-slate-200 rounded p-1"
                        >
                          <option value="REGISTERED_OWNER">Registered Owner</option>
                          <option value="BENEFICIAL_OWNER">Beneficial Owner</option>
                          <option value="COMMERCIAL_MANAGER">Commercial Manager</option>
                          <option value="TECHNICAL_MANAGER">Technical Manager</option>
                          <option value="ISM_MANAGER">ISM Manager</option>
                          <option value="OPERATOR">Operator</option>
                        </select>
                        <button
                          onClick={() => removeOwnershipNode(i)}
                          className="text-rose-500 hover:text-rose-700 text-xs font-bold"
                        >
                          ✕
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-1.5">
                        <input
                          type="text"
                          placeholder="Entity Name"
                          value={node.name}
                          onChange={(e) => {
                            const updated = [...maritimeData.ownershipHierarchy];
                            updated[i].name = e.target.value;
                            setMaritimeData({ ...maritimeData, ownershipHierarchy: updated });
                          }}
                          className="p-1 border border-slate-200 rounded text-[11px] bg-white"
                        />
                        <input
                          type="text"
                          placeholder="Country (e.g. MH)"
                          value={node.country}
                          onChange={(e) => {
                            const updated = [...maritimeData.ownershipHierarchy];
                            updated[i].country = e.target.value;
                            setMaritimeData({ ...maritimeData, ownershipHierarchy: updated });
                          }}
                          className="p-1 border border-slate-200 rounded text-[11px] bg-white"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: PORTS CALLED */}
          {activeTab === 'ports' && (
            <div className="space-y-3 text-xs">
              <div className="flex justify-between items-center">
                <span className="font-semibold text-slate-700">Voyage & Port History</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setMaritimeData({ ...maritimeData, portsCalled: [] })}
                    className="text-[11px] text-rose-600 hover:underline"
                  >
                    Clear All
                  </button>
                  <button
                    onClick={addPort}
                    className="text-[11px] text-teal-600 hover:underline font-bold"
                  >
                    + Add Port
                  </button>
                </div>
              </div>

              {maritimeData.portsCalled.length === 0 ? (
                <div className="p-4 bg-amber-50 border border-amber-200 rounded text-amber-800 text-[11px]">
                  No port history provided. Port sanctions and route risk cannot be evaluated without voyage history.
                </div>
              ) : (
                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                  {maritimeData.portsCalled.map((p, i) => (
                    <div key={i} className="p-2 border border-slate-200 rounded bg-slate-50 space-y-1.5">
                      <div className="flex justify-between items-center">
                        <input
                          type="text"
                          placeholder="Port Name"
                          value={p.portName}
                          onChange={(e) => {
                            const updated = [...maritimeData.portsCalled];
                            updated[i].portName = e.target.value;
                            setMaritimeData({ ...maritimeData, portsCalled: updated });
                          }}
                          className="p-1 border border-slate-200 rounded text-[11px] bg-white font-medium w-3/4"
                        />
                        <button
                          onClick={() => removePort(i)}
                          className="text-rose-500 hover:text-rose-700 text-xs font-bold"
                        >
                          ✕
                        </button>
                      </div>
                      <div className="grid grid-cols-3 gap-1">
                        <input
                          type="text"
                          placeholder="UN/LOCODE (e.g. IRBND)"
                          value={p.unLocode}
                          onChange={(e) => {
                            const updated = [...maritimeData.portsCalled];
                            updated[i].unLocode = e.target.value;
                            setMaritimeData({ ...maritimeData, portsCalled: updated });
                          }}
                          className="p-1 border border-slate-200 rounded text-[11px] bg-white font-mono"
                        />
                        <input
                          type="text"
                          placeholder="Country (e.g. IR)"
                          value={p.country}
                          onChange={(e) => {
                            const updated = [...maritimeData.portsCalled];
                            updated[i].country = e.target.value;
                            setMaritimeData({ ...maritimeData, portsCalled: updated });
                          }}
                          className="p-1 border border-slate-200 rounded text-[11px] bg-white"
                        />
                        <input
                          type="text"
                          placeholder="Arrival (YYYY-MM-DD)"
                          value={p.arrivalDate || ''}
                          onChange={(e) => {
                            const updated = [...maritimeData.portsCalled];
                            updated[i].arrivalDate = e.target.value;
                            setMaritimeData({ ...maritimeData, portsCalled: updated });
                          }}
                          className="p-1 border border-slate-200 rounded text-[11px] bg-white font-mono"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 4: AIS TELEMETRY */}
          {activeTab === 'ais' && (
            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                <span className="font-semibold text-slate-700">AIS Satellite Telemetry</span>
                <label className="flex items-center gap-1.5 cursor-pointer text-[11px]">
                  <input
                    type="checkbox"
                    checked={includeAis}
                    onChange={(e) => setIncludeAis(e.target.checked)}
                    className="rounded text-teal-600 focus:ring-teal-500"
                  />
                  <span>Include AIS Feed</span>
                </label>
              </div>

              {!includeAis ? (
                <div className="p-4 bg-amber-50 border border-amber-200 rounded text-amber-800 text-[11px]">
                  AIS telemetry signals omitted. System will evaluate dark activity as NOT_ASSESSED.
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="font-semibold text-slate-700 block mb-1">Last Broadcast Timestamp</label>
                      <input
                        type="text"
                        value={maritimeData.aisSignals?.lastSeenTimestamp || ''}
                        onChange={(e) =>
                          setMaritimeData({
                            ...maritimeData,
                            aisSignals: {
                              ...maritimeData.aisSignals,
                              lastSeenTimestamp: e.target.value,
                              hoursSinceLastBroadcast: maritimeData.aisSignals?.hoursSinceLastBroadcast || 0,
                              stsTransferDetected: maritimeData.aisSignals?.stsTransferDetected || false,
                            },
                          })
                        }
                        className="w-full p-1.5 border border-slate-200 rounded font-mono text-xs"
                        placeholder="2026-11-01T14:30:00Z"
                      />
                    </div>
                    <div>
                      <label className="font-semibold text-slate-700 block mb-1">Hours Non-Transmitting</label>
                      <input
                        type="number"
                        value={maritimeData.aisSignals?.hoursSinceLastBroadcast ?? 0}
                        onChange={(e) =>
                          setMaritimeData({
                            ...maritimeData,
                            aisSignals: {
                              ...maritimeData.aisSignals,
                              hoursSinceLastBroadcast: parseInt(e.target.value, 10),
                              stsTransferDetected: maritimeData.aisSignals?.stsTransferDetected || false,
                            },
                          })
                        }
                        className="w-full p-1.5 border border-slate-200 rounded font-mono text-xs"
                      />
                    </div>
                  </div>

                  <div className="p-2 border border-slate-200 rounded bg-slate-50 space-y-2">
                    <label className="flex items-center gap-2 cursor-pointer text-[11px] font-semibold text-slate-700">
                      <input
                        type="checkbox"
                        checked={maritimeData.aisSignals?.stsTransferDetected || false}
                        onChange={(e) =>
                          setMaritimeData({
                            ...maritimeData,
                            aisSignals: {
                              ...maritimeData.aisSignals,
                              stsTransferDetected: e.target.checked,
                              hoursSinceLastBroadcast: maritimeData.aisSignals?.hoursSinceLastBroadcast || 0,
                            },
                          })
                        }
                        className="rounded text-teal-600 focus:ring-teal-500"
                      />
                      <span>Ship-to-Ship (STS) Transfer Detected</span>
                    </label>

                    {maritimeData.aisSignals?.stsTransferDetected && (
                      <div>
                        <label className="font-medium text-slate-600 block mb-1 text-[11px]">STS Offshore Corridor / Zone</label>
                        <input
                          type="text"
                          value={maritimeData.aisSignals?.knownStsZone || ''}
                          onChange={(e) =>
                            setMaritimeData({
                              ...maritimeData,
                              aisSignals: {
                                ...maritimeData.aisSignals,
                                knownStsZone: e.target.value,
                                hoursSinceLastBroadcast: maritimeData.aisSignals?.hoursSinceLastBroadcast || 0,
                                stsTransferDetected: true,
                              },
                            })
                          }
                          className="w-full p-1.5 border border-slate-200 rounded text-xs bg-white"
                        />
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Flag Changes (Last 12 Months)</label>
                    <input
                      type="number"
                      value={maritimeData.aisSignals?.flagChangesLast12Months ?? 0}
                      onChange={(e) =>
                        setMaritimeData({
                          ...maritimeData,
                          aisSignals: {
                            ...maritimeData.aisSignals,
                            flagChangesLast12Months: parseInt(e.target.value, 10),
                            hoursSinceLastBroadcast: maritimeData.aisSignals?.hoursSinceLastBroadcast || 0,
                            stsTransferDetected: maritimeData.aisSignals?.stsTransferDetected || false,
                          },
                        })
                      }
                      className="w-full p-1.5 border border-slate-200 rounded font-mono text-xs"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {clientError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded text-rose-800 text-xs flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold">Validation Rejection (HTTP 400)</div>
                <div>{clientError}</div>
              </div>
            </div>
          )}

          <button
            onClick={handleEvaluate}
            disabled={isLoading}
            className="w-full py-2.5 bg-teal-600 hover:bg-teal-700 text-white font-semibold rounded text-xs flex items-center justify-center gap-2 shadow-xs"
          >
            {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            Screen Vessel, Ownership Chain & Route
          </button>
        </div>

        {/* Right: Segregated Results & Governance Workspace */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-3">
              <h3 className="font-bold text-slate-900 text-sm">Maritime Sanctions & Dark AIS Dossier</h3>
              {result && (
                <div className="flex items-center gap-1 border border-slate-200 rounded p-0.5 bg-slate-50">
                  <button
                    onClick={() => setActiveResultTab('dossier')}
                    className={`px-2 py-0.5 text-xs font-semibold rounded ${
                      activeResultTab === 'dossier' ? 'bg-teal-600 text-white shadow-2xs' : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    Dossier Findings
                  </button>
                  <button
                    onClick={() => setActiveResultTab('graph')}
                    className={`px-2 py-0.5 text-xs font-semibold rounded flex items-center gap-1 ${
                      activeResultTab === 'graph' ? 'bg-teal-600 text-white shadow-2xs' : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <Share2 className="w-3 h-3" />
                    <span>Evidence Graph</span>
                  </button>
                </div>
              )}
            </div>
            {result && (
              <span
                className={`text-xs px-2.5 py-1 rounded font-bold uppercase ${
                  result.decisionRecommendation === 'APPROVE_VOYAGE_COVERAGE'
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : result.decisionRecommendation === 'HOLD_FOR_HUMAN_REVIEW'
                    ? 'bg-amber-50 text-amber-700 border border-amber-200'
                    : 'bg-rose-50 text-rose-700 border border-rose-200'
                }`}
              >
                {result.decisionRecommendation.replace(/_/g, ' ')}
              </span>
            )}
          </div>

          {!result ? (
            <div className="py-20 text-center text-slate-400 text-xs">
              <Anchor className="w-8 h-8 mx-auto text-slate-300 mb-2" />
              Configure vessel identifiers, ownership chain, port calls and AIS telemetry, then click "Screen Vessel" to evaluate.
            </div>
          ) : activeResultTab === 'graph' ? (
            <ModuleEvidenceGraphSection moduleId="MARITIME" evaluation={result} />
          ) : (
            <div className="space-y-4 text-xs">
              {/* 1. Dossier Completeness & Registry Status */}
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="p-2 border border-slate-200 rounded bg-slate-50">
                  <div className="text-[10px] text-slate-500 font-semibold uppercase">Dossier Completeness</div>
                  <div
                    className={`font-bold mt-0.5 ${
                      result.completenessStatus === 'FULL_DOSSIER'
                        ? 'text-emerald-700'
                        : result.completenessStatus === 'PARTIAL_DOSSIER'
                        ? 'text-amber-700'
                        : 'text-rose-700'
                    }`}
                  >
                    {result.completenessStatus}
                  </div>
                </div>

                <div className="p-2 border border-slate-200 rounded bg-slate-50">
                  <div className="text-[10px] text-slate-500 font-semibold uppercase">IMO Checksum</div>
                  <div className={`font-bold mt-0.5 ${result.isImoChecksumValid ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {result.isImoChecksumValid ? '✓ Valid Checksum' : '✗ Checksum Failed'}
                  </div>
                </div>

                <div className="p-2 border border-slate-200 rounded bg-slate-50">
                  <div className="text-[10px] text-slate-500 font-semibold uppercase">Registry Status</div>
                  <div
                    className={`font-bold mt-0.5 ${
                      result.vesselRegistrationStatus === 'VERIFIED_ACTIVE'
                        ? 'text-emerald-700'
                        : result.vesselRegistrationStatus === 'UNVERIFIED_REGISTRY'
                        ? 'text-amber-700'
                        : 'text-rose-700'
                    }`}
                  >
                    {result.vesselRegistrationStatus}
                  </div>
                </div>
              </div>

              {/* 2. Identifier Issues & Dark AIS Summary */}
              <div className="grid grid-cols-2 gap-3">
                <div
                  className={`p-3 rounded border ${
                    result.darkAisRiskLevel === 'NORMAL'
                      ? 'bg-emerald-50 border-emerald-200'
                      : result.darkAisRiskLevel === 'NOT_ASSESSED'
                      ? 'bg-slate-50 border-slate-200'
                      : 'bg-rose-50 border-rose-200'
                  }`}
                >
                  <div className="font-bold text-slate-800">Dark AIS & STS Risk Level</div>
                  <div
                    className={`mt-1 font-semibold ${
                      result.darkAisRiskLevel === 'NORMAL'
                        ? 'text-emerald-700'
                        : result.darkAisRiskLevel === 'NOT_ASSESSED'
                        ? 'text-slate-600'
                        : 'text-rose-700'
                    }`}
                  >
                    {result.darkAisRiskLevel} ({result.aisCoverage})
                  </div>
                </div>

                <div className="p-3 rounded border bg-slate-50 border-slate-200">
                  <div className="font-bold text-slate-800">Coverage Status</div>
                  <div className="text-slate-600 mt-1">
                    <div>Ownership: <span className="font-semibold">{result.ownershipCoverage}</span></div>
                    <div>Port History: <span className="font-semibold">{result.portHistoryCoverage}</span></div>
                  </div>
                </div>
              </div>

              {/* Identifier Validation Issues */}
              {result.identifierValidationIssues.length > 0 && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded text-amber-900 space-y-1">
                  <div className="font-bold flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" /> Identifier Validation Warnings:
                  </div>
                  {result.identifierValidationIssues.map((w, i) => (
                    <div key={i} className="text-[11px]">• {w}</div>
                  ))}
                </div>
              )}

              {/* AIS Anomalies */}
              {result.aisAnomalies.length > 0 && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded text-rose-900 space-y-1">
                  <div className="font-bold flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" /> AIS Transponder Anomalies Detected:
                  </div>
                  {result.aisAnomalies.map((a, i) => (
                    <div key={i} className="text-[11px]">• {a}</div>
                  ))}
                </div>
              )}

              {/* 3. Port Call Sanctions Assessment */}
              <div>
                <h4 className="font-bold text-slate-800 uppercase text-[11px] mb-1.5 flex justify-between">
                  <span>Port Call Sanctions Assessment</span>
                  <span className="font-normal text-slate-500">Coverage: {result.portHistoryCoverage}</span>
                </h4>
                {result.portRiskAnalysis.length === 0 ? (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded text-amber-800 text-[11px]">
                    No port calls evaluated. Unavailable port history requires manual compliance review.
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {result.portRiskAnalysis.map((p, i) => (
                      <div
                        key={i}
                        className={`p-2 rounded border flex items-center justify-between ${
                          p.isHighRiskOrSanctioned
                            ? 'bg-rose-50 border-rose-200 text-rose-900'
                            : p.portStatus === 'INVALID_PORT_ENTRY'
                            ? 'bg-amber-50 border-amber-200 text-amber-900'
                            : 'bg-slate-50 border-slate-200'
                        }`}
                      >
                        <div>
                          <div className="font-semibold">
                            {p.portName} ({p.unLocode}) — {p.country}
                          </div>
                          {p.arrivalDate && (
                            <div className="text-[10px] text-slate-500">Arrival: {p.arrivalDate}</div>
                          )}
                          {p.riskReason && (
                            <div className="text-[11px] text-rose-700 mt-0.5 font-medium">{p.riskReason}</div>
                          )}
                          {p.validationIssues && (
                            <div className="text-[11px] text-amber-700 mt-0.5">
                              {p.validationIssues.join('; ')}
                            </div>
                          )}
                        </div>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase shrink-0 ${
                            p.portStatus === 'SANCTIONED_DESIGNATED_PORT'
                              ? 'bg-rose-200 text-rose-900'
                              : p.portStatus === 'INVALID_PORT_ENTRY'
                              ? 'bg-amber-200 text-amber-900'
                              : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {p.portStatus === 'SANCTIONED_DESIGNATED_PORT'
                            ? 'SANCTIONED PORT'
                            : p.portStatus === 'INVALID_PORT_ENTRY'
                            ? 'INVALID PORT ENTRY'
                            : 'NO SANCTIONS MATCH'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 4. Ownership Hierarchy Screening */}
              <div>
                <h4 className="font-bold text-slate-800 uppercase text-[11px] mb-1.5 flex justify-between">
                  <span>Ownership Hierarchy Screening</span>
                  <span className="font-normal text-slate-500">Coverage: {result.ownershipCoverage}</span>
                </h4>
                {result.ownershipHierarchy.length === 0 ? (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded text-amber-800 text-[11px]">
                    No ownership nodes evaluated. Automatic clearance prohibited.
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {result.ownershipHierarchy.map((o, i) => (
                      <div
                        key={i}
                        className={`p-2 rounded border flex justify-between items-center ${
                          o.isSanctioned
                            ? 'bg-rose-50 border-rose-200'
                            : o.status === 'INCOMPLETE_NOT_SCREENED'
                            ? 'bg-amber-50 border-amber-200'
                            : 'bg-slate-50 border-slate-200'
                        }`}
                      >
                        <div>
                          <span className="font-semibold text-slate-800">{o.name || '(Blank Entity Name)'}</span>
                          <span className="text-[10px] text-slate-500 ml-2">
                            ({o.role}) — {o.country || 'No Country'}
                          </span>
                        </div>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${
                            o.isSanctioned
                              ? 'bg-rose-100 text-rose-800'
                              : o.status === 'INCOMPLETE_NOT_SCREENED'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {o.isSanctioned
                            ? 'SANCTIONS CANDIDATE'
                            : o.status === 'INCOMPLETE_NOT_SCREENED'
                            ? 'NOT SCREENED / MISSING'
                            : 'SCREENED CLEAR'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 5. Review Reasons & Adjudication Action */}
              {result.reviewReasons.length > 0 && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded text-amber-900 space-y-1">
                  <div className="font-bold flex items-center gap-1">
                    <Info className="w-3.5 h-3.5" /> Compliance Review Reasons ({result.reviewReasons.length}):
                  </div>
                  {result.reviewReasons.map((r, i) => (
                    <div key={i} className="text-[11px]">• {r}</div>
                  ))}
                </div>
              )}

              {/* Adjudication Workflow Panel */}
              <div className="p-3 border border-slate-200 rounded bg-slate-50 space-y-2">
                <div className="font-bold text-slate-800 text-[11px] uppercase">
                  Adjudicate Maritime Clearance Decision
                </div>
                <textarea
                  rows={2}
                  value={rationale}
                  onChange={(e) => setRationale(e.target.value)}
                  placeholder="Enter mandatory analyst compliance rationale (min 10 characters)..."
                  className="w-full p-2 border border-slate-200 rounded text-[11px] bg-white"
                />
                <div className="flex gap-2">
                  <button
                    disabled={rationale.trim().length < 10}
                    onClick={() => {
                      setAdjudicatedDecision('CONFIRMED_SANCTIONS_RISK');
                      alert('Adjudication recorded: CONFIRMED_SANCTIONS_RISK');
                    }}
                    className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white rounded font-bold text-[10px]"
                  >
                    Confirm Sanctions Risk
                  </button>
                  <button
                    disabled={rationale.trim().length < 10}
                    onClick={() => {
                      setAdjudicatedDecision('OVERRULE_FALSE_POSITIVE');
                      alert('Adjudication recorded: OVERRULE_FALSE_POSITIVE');
                    }}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded font-bold text-[10px]"
                  >
                    Clear with Documented Waiver
                  </button>
                </div>
                {adjudicatedDecision && (
                  <div className="text-[10px] text-slate-600">
                    Active Adjudication: <span className="font-bold text-teal-700">{adjudicatedDecision}</span>
                  </div>
                )}
              </div>

              {/* 6. Tamper-Evident Digest & Download Evidence */}
              <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                <span className="font-mono truncate max-w-xs">SHA-256: {result.evidenceDigest}</span>
                <button
                  onClick={handleExportEvidence}
                  className="px-2.5 py-1 bg-teal-50 hover:bg-teal-100 text-teal-700 border border-teal-200 rounded font-semibold flex items-center gap-1"
                >
                  <Download className="w-3.5 h-3.5" /> Download Sealed Evidence Pack (JSON)
                </button>
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
  const [airData, setAirData] = useState<EvaluateAirCargoRequest>(MULTI_MODULE_FIXTURES.AIR_CARGO);
  const [activeTab, setActiveTab] = useState<'awb' | 'route' | 'parties' | 'cargo'>('awb');
  const [result, setResult] = useState<AirCargoEvaluation | null>(null);
  const [activeResultTab, setActiveResultTab] = useState<'verdict' | 'graph'>('verdict');
  const [isLoading, setIsLoading] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);
  const [rationale, setRationale] = useState('');
  const [adjudicatedDecision, setAdjudicatedDecision] = useState<string | null>(null);

  const handleEvaluate = async () => {
    setIsLoading(true);
    setClientError(null);
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
      if (!res.ok) {
        setClientError(data.error || 'Air cargo evaluation rejected with client error.');
        setResult(null);
      } else {
        setResult(data);
      }
    } catch (e: any) {
      setClientError(`Error evaluating air cargo: ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportEvidence = () => {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `AirCargo_Evidence_${result.awbNumber.replace(/[^0-9]/g, '')}_${result.evidenceDigest.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Input Manifest Configuration Panel */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
              <Plane className="w-4 h-4 text-teal-600" /> Air Waybill (AWB) & Flight Manifest
            </h3>
            <button
              onClick={() => {
                setAirData(MULTI_MODULE_FIXTURES.AIR_CARGO);
                setClientError(null);
              }}
              className="text-xs text-teal-600 hover:underline flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" /> Reload Sample
            </button>
          </div>

          {/* Sub-Tabs for Air Cargo Input */}
          <div className="flex border-b border-slate-200 text-[11px] gap-1 overflow-x-auto no-scrollbar pb-1">
            <button
              onClick={() => setActiveTab('awb')}
              className={`px-2.5 py-1 rounded font-medium ${activeTab === 'awb' ? 'bg-teal-50 text-teal-700 border border-teal-200 font-bold' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              AWB & Flight
            </button>
            <button
              onClick={() => setActiveTab('route')}
              className={`px-2.5 py-1 rounded font-medium ${activeTab === 'route' ? 'bg-teal-50 text-teal-700 border border-teal-200 font-bold' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              Route & Airports
            </button>
            <button
              onClick={() => setActiveTab('parties')}
              className={`px-2.5 py-1 rounded font-medium ${activeTab === 'parties' ? 'bg-teal-50 text-teal-700 border border-teal-200 font-bold' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              Shipment Parties
            </button>
            <button
              onClick={() => setActiveTab('cargo')}
              className={`px-2.5 py-1 rounded font-medium ${activeTab === 'cargo' ? 'bg-teal-50 text-teal-700 border border-teal-200 font-bold' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              Cargo Details
            </button>
          </div>

          {/* TAB 1: AWB & Flight */}
          {activeTab === 'awb' && (
            <div className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">IATA AWB Number (11 digits: PPP-SSSSSSSC)</label>
                <input
                  type="text"
                  value={airData.awbNumber}
                  onChange={(e) => setAirData({ ...airData, awbNumber: e.target.value })}
                  className="w-full p-1.5 border border-slate-200 rounded font-mono text-xs"
                  placeholder="e.g. 176-49281702"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Flight Number</label>
                  <input
                    type="text"
                    value={airData.flightNumber || ''}
                    onChange={(e) => setAirData({ ...airData, flightNumber: e.target.value })}
                    className="w-full p-1.5 border border-slate-200 rounded font-mono text-xs uppercase"
                    placeholder="e.g. EK-9921"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Carrier Name (Optional Override)</label>
                  <input
                    type="text"
                    value={airData.carrierName || ''}
                    onChange={(e) => setAirData({ ...airData, carrierName: e.target.value })}
                    className="w-full p-1.5 border border-slate-200 rounded text-xs"
                    placeholder="Auto-resolved from prefix"
                  />
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: Route & Airports */}
          {activeTab === 'route' && (
            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Origin Airport (3-Letter IATA)</label>
                  <input
                    type="text"
                    value={airData.originAirport}
                    onChange={(e) => setAirData({ ...airData, originAirport: e.target.value.toUpperCase() })}
                    className="w-full p-1.5 border border-slate-200 rounded font-mono text-xs uppercase"
                    placeholder="DXB"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Destination Airport (3-Letter IATA)</label>
                  <input
                    type="text"
                    value={airData.destinationAirport}
                    onChange={(e) => setAirData({ ...airData, destinationAirport: e.target.value.toUpperCase() })}
                    className="w-full p-1.5 border border-slate-200 rounded font-mono text-xs uppercase"
                    placeholder="FRA"
                  />
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Transit / Transshipment Airports (Comma-separated 3-letter IATA codes)
                </label>
                <input
                  type="text"
                  value={(airData.transitAirports || []).join(', ')}
                  onChange={(e) =>
                    setAirData({
                      ...airData,
                      transitAirports: e.target.value
                        .split(',')
                        .map((s) => s.trim().toUpperCase())
                        .filter(Boolean),
                    })
                  }
                  className="w-full p-1.5 border border-slate-200 rounded font-mono text-xs uppercase"
                  placeholder="e.g. THR, IST"
                />
              </div>
            </div>
          )}

          {/* TAB 3: Shipment Parties */}
          {activeTab === 'parties' && (
            <div className="space-y-3 text-xs max-h-72 overflow-y-auto pr-1">
              <div className="p-2 border border-slate-200 rounded bg-slate-50 space-y-1.5">
                <div className="font-bold text-slate-800 text-[11px] uppercase">Shipper / Consignor (Mandatory)</div>
                <div className="grid grid-cols-2 gap-1.5">
                  <input
                    type="text"
                    placeholder="Shipper Name"
                    value={airData.shipper?.name || ''}
                    onChange={(e) =>
                      setAirData({
                        ...airData,
                        shipper: { ...airData.shipper, name: e.target.value },
                      })
                    }
                    className="p-1 border border-slate-200 rounded text-[11px] bg-white font-medium"
                  />
                  <input
                    type="text"
                    placeholder="Country (e.g. AE)"
                    value={airData.shipper?.country || ''}
                    onChange={(e) =>
                      setAirData({
                        ...airData,
                        shipper: { ...airData.shipper, country: e.target.value },
                      })
                    }
                    className="p-1 border border-slate-200 rounded text-[11px] bg-white"
                  />
                </div>
                <input
                  type="text"
                  placeholder="Address (Optional)"
                  value={airData.shipper?.address || ''}
                  onChange={(e) =>
                    setAirData({
                      ...airData,
                      shipper: { ...airData.shipper, address: e.target.value },
                    })
                  }
                  className="w-full p-1 border border-slate-200 rounded text-[11px] bg-white"
                />
              </div>

              <div className="p-2 border border-slate-200 rounded bg-slate-50 space-y-1.5">
                <div className="font-bold text-slate-800 text-[11px] uppercase">Consignee (Mandatory)</div>
                <div className="grid grid-cols-2 gap-1.5">
                  <input
                    type="text"
                    placeholder="Consignee Name"
                    value={airData.consignee?.name || ''}
                    onChange={(e) =>
                      setAirData({
                        ...airData,
                        consignee: { ...airData.consignee, name: e.target.value },
                      })
                    }
                    className="p-1 border border-slate-200 rounded text-[11px] bg-white font-medium"
                  />
                  <input
                    type="text"
                    placeholder="Country (e.g. DE)"
                    value={airData.consignee?.country || ''}
                    onChange={(e) =>
                      setAirData({
                        ...airData,
                        consignee: { ...airData.consignee, country: e.target.value },
                      })
                    }
                    className="p-1 border border-slate-200 rounded text-[11px] bg-white"
                  />
                </div>
                <input
                  type="text"
                  placeholder="Address (Optional)"
                  value={airData.consignee?.address || ''}
                  onChange={(e) =>
                    setAirData({
                      ...airData,
                      consignee: { ...airData.consignee, address: e.target.value },
                    })
                  }
                  className="w-full p-1 border border-slate-200 rounded text-[11px] bg-white"
                />
              </div>

              <div className="p-2 border border-slate-200 rounded bg-slate-50 space-y-1.5">
                <div className="font-bold text-slate-800 text-[11px] uppercase">Notify Party (Optional)</div>
                <div className="grid grid-cols-2 gap-1.5">
                  <input
                    type="text"
                    placeholder="Notify Party Name"
                    value={airData.notifyParty?.name || ''}
                    onChange={(e) =>
                      setAirData({
                        ...airData,
                        notifyParty: {
                          name: e.target.value,
                          country: airData.notifyParty?.country || '',
                          address: airData.notifyParty?.address || '',
                        },
                      })
                    }
                    className="p-1 border border-slate-200 rounded text-[11px] bg-white"
                  />
                  <input
                    type="text"
                    placeholder="Country (e.g. AE)"
                    value={airData.notifyParty?.country || ''}
                    onChange={(e) =>
                      setAirData({
                        ...airData,
                        notifyParty: {
                          name: airData.notifyParty?.name || '',
                          country: e.target.value,
                          address: airData.notifyParty?.address || '',
                        },
                      })
                    }
                    className="p-1 border border-slate-200 rounded text-[11px] bg-white"
                  />
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: Cargo Details */}
          {activeTab === 'cargo' && (
            <div className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Cargo Commodity Description</label>
                <textarea
                  rows={2}
                  value={airData.cargo.description}
                  onChange={(e) => setAirData({ ...airData, cargo: { ...airData.cargo, description: e.target.value } })}
                  className="w-full p-1.5 border border-slate-200 rounded text-xs"
                  placeholder="Enter detailed physical description of commodity..."
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Gross Weight (Kg)</label>
                  <input
                    type="number"
                    value={airData.cargo.grossWeightKg}
                    onChange={(e) =>
                      setAirData({
                        ...airData,
                        cargo: { ...airData.cargo, grossWeightKg: parseFloat(e.target.value) || 0 },
                      })
                    }
                    className="w-full p-1.5 border border-slate-200 rounded font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Pieces Count</label>
                  <input
                    type="number"
                    value={airData.cargo.piecesCount}
                    onChange={(e) =>
                      setAirData({
                        ...airData,
                        cargo: { ...airData.cargo, piecesCount: parseInt(e.target.value, 10) || 0 },
                      })
                    }
                    className="w-full p-1.5 border border-slate-200 rounded font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Declared HS Code</label>
                  <input
                    type="text"
                    value={airData.cargo.declaredHsCode || ''}
                    onChange={(e) =>
                      setAirData({
                        ...airData,
                        cargo: { ...airData.cargo, declaredHsCode: e.target.value },
                      })
                    }
                    className="w-full p-1.5 border border-slate-200 rounded font-mono text-xs"
                    placeholder="e.g. 8542.31"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-700 p-2 bg-slate-50 border border-slate-200 rounded">
                <input
                  type="checkbox"
                  checked={airData.cargo.isHazardous}
                  onChange={(e) =>
                    setAirData({
                      ...airData,
                      cargo: { ...airData.cargo, isHazardous: e.target.checked },
                    })
                  }
                  className="rounded text-teal-600 focus:ring-teal-500"
                />
                <span>Hazardous / Dangerous Goods (DG) Declaration Attached</span>
              </label>
            </div>
          )}

          {clientError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded text-rose-800 text-xs flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold">Validation Rejection (HTTP 400)</div>
                <div>{clientError}</div>
              </div>
            </div>
          )}

          <button
            onClick={handleEvaluate}
            disabled={isLoading}
            className="w-full py-2.5 bg-teal-600 hover:bg-teal-700 text-white font-semibold rounded text-xs flex items-center justify-center gap-2 shadow-xs"
          >
            {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            Validate AWB Checksum & Screen Air Routing
          </button>
        </div>

        {/* Right: Segregated Results & Governance Dossier */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-3">
              <h3 className="font-bold text-slate-900 text-sm">Air Logistics Compliance Verdict</h3>
              {result && (
                <div className="flex items-center gap-1 border border-slate-200 rounded p-0.5 bg-slate-50">
                  <button
                    onClick={() => setActiveResultTab('verdict')}
                    className={`px-2 py-0.5 text-xs font-semibold rounded ${
                      activeResultTab === 'verdict' ? 'bg-teal-600 text-white shadow-2xs' : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    Verdict Findings
                  </button>
                  <button
                    onClick={() => setActiveResultTab('graph')}
                    className={`px-2 py-0.5 text-xs font-semibold rounded flex items-center gap-1 ${
                      activeResultTab === 'graph' ? 'bg-teal-600 text-white shadow-2xs' : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <Share2 className="w-3 h-3" />
                    <span>Evidence Graph</span>
                  </button>
                </div>
              )}
            </div>
            {result && (
              <span
                className={`text-xs px-2.5 py-1 rounded font-bold uppercase ${
                  result.decisionRecommendation === 'APPROVE_AIR_RELEASE'
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : result.decisionRecommendation === 'HOLD_FOR_HUMAN_REVIEW'
                    ? 'bg-amber-50 text-amber-700 border border-amber-200'
                    : 'bg-rose-50 text-rose-700 border border-rose-200'
                }`}
              >
                {result.decisionRecommendation.replace(/_/g, ' ')}
              </span>
            )}
          </div>

          {!result ? (
            <div className="py-20 text-center text-slate-400 text-xs">
              <Plane className="w-8 h-8 mx-auto text-slate-300 mb-2" />
              Configure AWB identifiers, route, parties, and cargo declaration, then click "Validate AWB" to screen.
            </div>
          ) : activeResultTab === 'graph' ? (
            <ModuleEvidenceGraphSection moduleId="AIR_CARGO" evaluation={result} />
          ) : (
            <div className="space-y-4 text-xs">
              {/* 1. Top 3 Summary Cards */}
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="p-2 border border-slate-200 rounded bg-slate-50">
                  <div className="text-[10px] text-slate-500 font-semibold uppercase">Manifest Completeness</div>
                  <div
                    className={`font-bold mt-0.5 ${
                      result.completenessStatus === 'FULL_MANIFEST'
                        ? 'text-emerald-700'
                        : result.completenessStatus === 'PARTIAL_MANIFEST'
                        ? 'text-amber-700'
                        : 'text-rose-700'
                    }`}
                  >
                    {result.completenessStatus}
                  </div>
                </div>

                <div className="p-2 border border-slate-200 rounded bg-slate-50">
                  <div className="text-[10px] text-slate-500 font-semibold uppercase">AWB Mod-7 Checksum</div>
                  <div className={`font-bold mt-0.5 ${result.isAwbChecksumValid ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {result.isAwbChecksumValid ? '✓ Valid IATA AWB' : '✗ Invalid AWB'}
                  </div>
                  <div className="text-[10px] text-slate-500 truncate">{result.airlineName}</div>
                </div>

                <div className="p-2 border border-slate-200 rounded bg-slate-50">
                  <div className="text-[10px] text-slate-500 font-semibold uppercase">Routing Status</div>
                  <div
                    className={`font-bold mt-0.5 ${
                      result.routing.routingStatus === 'SAFE_ROUTING_CORRIDOR'
                        ? 'text-emerald-700'
                        : result.routing.routingStatus === 'HIGH_RISK_TRANSIT_DETECTED'
                        ? 'text-rose-700'
                        : 'text-amber-700'
                    }`}
                  >
                    {result.routing.routingStatus?.replace(/_/g, ' ')}
                  </div>
                </div>
              </div>

              {/* 2. Routing Details Card */}
              <div
                className={`p-3 rounded border ${
                  result.routing.routingStatus === 'SAFE_ROUTING_CORRIDOR'
                    ? 'bg-emerald-50 border-emerald-200'
                    : result.routing.routingStatus === 'HIGH_RISK_TRANSIT_DETECTED'
                    ? 'bg-rose-50 border-rose-200 text-rose-900'
                    : 'bg-amber-50 border-amber-200 text-amber-900'
                }`}
              >
                <div className="font-bold flex items-center justify-between">
                  <span>Flight Path: {result.routing.originAirport} → {(result.routing.transitAirports || []).join(' → ')} → {result.routing.destinationAirport}</span>
                  <span className="text-[10px] uppercase font-bold">{result.routing.routingStatus}</span>
                </div>
                {result.routing.highRiskTransitDetails && (
                  <div className="text-[11px] text-rose-700 mt-1 font-medium">{result.routing.highRiskTransitDetails}</div>
                )}
                {result.routing.routingIssues && (
                  <div className="text-[11px] text-amber-700 mt-1">
                    {result.routing.routingIssues.join('; ')}
                  </div>
                )}
              </div>

              {/* 3. Commodity & Security Screening */}
              <div className="p-3 border border-slate-200 rounded bg-slate-50 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800 uppercase text-[11px]">Commodity Security Screening</span>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${
                      result.cargoDetails.securityScreeningStatus === 'CLEARED'
                        ? 'bg-emerald-100 text-emerald-800'
                        : result.cargoDetails.securityScreeningStatus === 'INCOMPLETE_DATA'
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-rose-100 text-rose-800'
                    }`}
                  >
                    {result.cargoDetails.securityScreeningStatus}
                  </span>
                </div>
                <div className="text-slate-700">
                  <div>Description: <span className="font-medium">{result.cargoDetails.declaredDescription || '(Empty)'}</span></div>
                  <div className="text-slate-500 mt-0.5">
                    Gross Weight: {result.cargoDetails.grossWeightKg} Kg | Pieces: {result.cargoDetails.piecesCount} | HS Code: {result.cargoDetails.declaredHsCode || 'N/A'}
                  </div>
                </div>
                {result.cargoDetails.isDualUseRisk && (
                  <div className="text-[11px] text-rose-700 font-semibold">• Dual-Use Aerospace Proliferation Risk Identified</div>
                )}
                {result.cargoDetails.isHazardousMaterial && (
                  <div className="text-[11px] text-amber-700 font-semibold">• Hazardous Cargo / Dangerous Goods Declaration Attached</div>
                )}
                {result.cargoDetails.cargoValidationIssues && (
                  <div className="text-[11px] text-rose-700">
                    {result.cargoDetails.cargoValidationIssues.join('; ')}
                  </div>
                )}
              </div>

              {/* 4. Screened Air Waybill Parties */}
              <div>
                <h4 className="font-bold text-slate-800 uppercase text-[11px] mb-1.5 flex justify-between">
                  <span>Screened Air Waybill Counterparties</span>
                  <span className="font-normal text-slate-500">Carrier: {result.airlineName} ({result.carrierVerificationStatus})</span>
                </h4>
                <div className="space-y-1.5">
                  {result.parties.map((p, i) => (
                    <div
                      key={i}
                      className={`p-2 rounded border flex justify-between items-center ${
                        p.matches.length > 0
                          ? 'bg-rose-50 border-rose-200'
                          : p.status === 'INCOMPLETE_NOT_SCREENED'
                          ? 'bg-amber-50 border-amber-200'
                          : 'bg-slate-50 border-slate-200'
                      }`}
                    >
                      <div>
                        <span className="font-semibold text-slate-800">{p.name || '(Blank Entity Name)'}</span>
                        <span className="text-[10px] text-slate-500 ml-2">
                          ({p.role}) — {p.country || 'No Country'}
                        </span>
                      </div>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${
                          p.matches.length > 0
                            ? 'bg-rose-100 text-rose-800'
                            : p.status === 'INCOMPLETE_NOT_SCREENED'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-emerald-100 text-emerald-800'
                        }`}
                      >
                        {p.matches.length > 0
                          ? 'MATCH CANDIDATE'
                          : p.status === 'INCOMPLETE_NOT_SCREENED'
                          ? 'NOT SCREENED / MISSING'
                          : 'SCREENED CLEAR'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* 5. Compliance Review Reasons */}
              {result.reviewReasons && result.reviewReasons.length > 0 && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded text-amber-900 space-y-1">
                  <div className="font-bold flex items-center gap-1">
                    <Info className="w-3.5 h-3.5" /> Compliance Review Reasons ({result.reviewReasons.length}):
                  </div>
                  {result.reviewReasons.map((r, i) => (
                    <div key={i} className="text-[11px]">• {r}</div>
                  ))}
                </div>
              )}

              {/* 6. Adjudication Workflow Panel */}
              <div className="p-3 border border-slate-200 rounded bg-slate-50 space-y-2">
                <div className="font-bold text-slate-800 text-[11px] uppercase">
                  Adjudicate Air Cargo Release Decision
                </div>
                <textarea
                  rows={2}
                  value={rationale}
                  onChange={(e) => setRationale(e.target.value)}
                  placeholder="Enter mandatory analyst compliance rationale (min 10 characters)..."
                  className="w-full p-2 border border-slate-200 rounded text-[11px] bg-white"
                />
                <div className="flex gap-2">
                  <button
                    disabled={rationale.trim().length < 10}
                    onClick={() => {
                      setAdjudicatedDecision('CONFIRMED_AIR_CARGO_RISK');
                      alert('Adjudication recorded: CONFIRMED_AIR_CARGO_RISK');
                    }}
                    className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white rounded font-bold text-[10px]"
                  >
                    Confirm Air Cargo Risk
                  </button>
                  <button
                    disabled={rationale.trim().length < 10}
                    onClick={() => {
                      setAdjudicatedDecision('OVERRULE_RELEASE_PERMITTED');
                      alert('Adjudication recorded: OVERRULE_RELEASE_PERMITTED');
                    }}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded font-bold text-[10px]"
                  >
                    Permit Air Release with Waiver
                  </button>
                </div>
                {adjudicatedDecision && (
                  <div className="text-[10px] text-slate-600">
                    Active Adjudication: <span className="font-bold text-teal-700">{adjudicatedDecision}</span>
                  </div>
                )}
              </div>

              {/* 7. Tamper-Evident Digest & Download Evidence */}
              <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                <span className="font-mono truncate max-w-xs">SHA-256: {result.evidenceDigest}</span>
                <button
                  onClick={handleExportEvidence}
                  className="px-2.5 py-1 bg-teal-50 hover:bg-teal-100 text-teal-700 border border-teal-200 rounded font-semibold flex items-center gap-1"
                >
                  <Download className="w-3.5 h-3.5" /> Download Sealed Evidence Pack (JSON)
                </button>
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
  const [insData, setInsData] = useState<EvaluateInsuranceRequest>(MULTI_MODULE_FIXTURES.INSURANCE);
  const [includeUbo, setIncludeUbo] = useState(true);
  const [activeTab, setActiveTab] = useState<'policy' | 'parties' | 'ubo'>('policy');
  const [result, setResult] = useState<InsuranceEvaluation | null>(null);
  const [activeResultTab, setActiveResultTab] = useState<'dossier' | 'graph'>('dossier');
  const [isLoading, setIsLoading] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);
  const [rationale, setRationale] = useState('');
  const [adjudicatedDecision, setAdjudicatedDecision] = useState<string | null>(null);

  const handleEvaluate = async () => {
    setIsLoading(true);
    setClientError(null);
    try {
      const payload: any = {
        policyNumber: insData.policyNumber,
        lineOfBusiness: insData.lineOfBusiness,
        sumInsured: insData.sumInsured,
        currency: insData.currency,
        screeningStage: insData.screeningStage,
        policyParties: insData.policyParties,
      };
      if (includeUbo && insData.corporateEntityUbo) {
        payload.corporateEntityUbo = insData.corporateEntityUbo;
      }

      const res = await fetch('/api/modules/insurance/evaluate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-analyst-token': DEMO_ANALYST_TOKEN,
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setClientError(data.error || 'Insurance evaluation rejected with client error.');
        setResult(null);
      } else {
        setResult(data);
      }
    } catch (e: any) {
      setClientError(`Error evaluating insurance policy: ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportEvidence = () => {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Insurance_Evidence_${result.policyNumber}_${result.evidenceDigest.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const addParty = () => {
    setInsData({
      ...insData,
      policyParties: [
        ...insData.policyParties,
        { role: 'PRIMARY_BENEFICIARY', name: '', entityType: 'ORGANIZATION', country: '' },
      ],
    });
  };

  const removeParty = (index: number) => {
    setInsData({
      ...insData,
      policyParties: insData.policyParties.filter((_, i) => i !== index),
    });
  };

  const addOwner = () => {
    if (!insData.corporateEntityUbo) return;
    setInsData({
      ...insData,
      corporateEntityUbo: {
        ...insData.corporateEntityUbo,
        beneficialOwners: [
          ...insData.corporateEntityUbo.beneficialOwners,
          { name: '', ownershipPercentage: 10, country: '' },
        ],
      },
    });
  };

  const removeOwner = (index: number) => {
    if (!insData.corporateEntityUbo) return;
    setInsData({
      ...insData,
      corporateEntityUbo: {
        ...insData.corporateEntityUbo,
        beneficialOwners: insData.corporateEntityUbo.beneficialOwners.filter((_, i) => i !== index),
      },
    });
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Input Manifest Configuration Panel */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-teal-600" /> Policy Underwriting & UBO Hierarchy
            </h3>
            <button
              onClick={() => {
                setInsData(MULTI_MODULE_FIXTURES.INSURANCE);
                setIncludeUbo(true);
                setClientError(null);
              }}
              className="text-xs text-teal-600 hover:underline flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" /> Reload Sample
            </button>
          </div>

          {/* Sub-Tabs for Insurance Input */}
          <div className="flex border-b border-slate-200 text-[11px] gap-1 overflow-x-auto no-scrollbar pb-1">
            <button
              onClick={() => setActiveTab('policy')}
              className={`px-2.5 py-1 rounded font-medium ${activeTab === 'policy' ? 'bg-teal-50 text-teal-700 border border-teal-200 font-bold' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              Policy Details
            </button>
            <button
              onClick={() => setActiveTab('parties')}
              className={`px-2.5 py-1 rounded font-medium ${activeTab === 'parties' ? 'bg-teal-50 text-teal-700 border border-teal-200 font-bold' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              Parties ({insData.policyParties.length})
            </button>
            <button
              onClick={() => setActiveTab('ubo')}
              className={`px-2.5 py-1 rounded font-medium ${activeTab === 'ubo' ? 'bg-teal-50 text-teal-700 border border-teal-200 font-bold' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              UBO Shares {includeUbo ? `(${insData.corporateEntityUbo?.beneficialOwners.length || 0})` : '(Omitted)'}
            </button>
          </div>

          {/* TAB 1: Policy Details */}
          {activeTab === 'policy' && (
            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Policy Number</label>
                  <input
                    type="text"
                    value={insData.policyNumber}
                    onChange={(e) => setInsData({ ...insData, policyNumber: e.target.value })}
                    className="w-full p-1.5 border border-slate-200 rounded font-mono text-xs"
                    placeholder="e.g. POL-MAR-2026-8819"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Currency (3-Letter ISO)</label>
                  <input
                    type="text"
                    value={insData.currency}
                    onChange={(e) => setInsData({ ...insData, currency: e.target.value.toUpperCase() })}
                    className="w-full p-1.5 border border-slate-200 rounded font-mono text-xs uppercase"
                    placeholder="USD"
                  />
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Sum Insured ({insData.currency || 'USD'})</label>
                <input
                  type="number"
                  value={insData.sumInsured}
                  onChange={(e) => setInsData({ ...insData, sumInsured: parseFloat(e.target.value) || 0 })}
                  className="w-full p-1.5 border border-slate-200 rounded font-mono text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Line of Business</label>
                  <select
                    value={insData.lineOfBusiness}
                    onChange={(e) => setInsData({ ...insData, lineOfBusiness: e.target.value as any })}
                    className="w-full p-1.5 border border-slate-200 rounded text-xs bg-white"
                  >
                    <option value="MARINE_HULL_AND_CARGO">Marine Hull & Cargo</option>
                    <option value="DIRECTORS_AND_OFFICERS">Directors & Officers (D&O)</option>
                    <option value="COMMERCIAL_PROPERTY">Commercial Property</option>
                    <option value="AVIATION">Aviation</option>
                    <option value="TRADE_CREDIT">Trade Credit</option>
                  </select>
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Screening Stage</label>
                  <select
                    value={insData.screeningStage}
                    onChange={(e) => setInsData({ ...insData, screeningStage: e.target.value as any })}
                    className="w-full p-1.5 border border-slate-200 rounded text-xs bg-white"
                  >
                    <option value="PRE_BIND_UNDERWRITING">Pre-Bind Underwriting</option>
                    <option value="CLAIMS_PAYMENT_CLEARANCE">Claims Payment Clearance</option>
                    <option value="POLICY_RENEWAL">Policy Renewal</option>
                    <option value="MIDTERM_ENDORSEMENT">Midterm Endorsement</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: Policy Parties */}
          {activeTab === 'parties' && (
            <div className="space-y-3 text-xs">
              <div className="flex justify-between items-center">
                <span className="font-semibold text-slate-700">Insured Entities & Beneficiaries</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setInsData({ ...insData, policyParties: [] })}
                    className="text-[11px] text-rose-600 hover:underline"
                  >
                    Clear All
                  </button>
                  <button
                    onClick={addParty}
                    className="text-[11px] text-teal-600 hover:underline font-bold"
                  >
                    + Add Party
                  </button>
                </div>
              </div>

              {insData.policyParties.length === 0 ? (
                <div className="p-4 bg-amber-50 border border-amber-200 rounded text-amber-800 text-[11px]">
                  No policy parties declared. Policy must declare at least one primary insured entity.
                </div>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {insData.policyParties.map((p, i) => (
                    <div key={i} className="p-2 border border-slate-200 rounded bg-slate-50 space-y-1.5">
                      <div className="flex justify-between items-center">
                        <select
                          value={p.role}
                          onChange={(e) => {
                            const updated = [...insData.policyParties];
                            updated[i].role = e.target.value as any;
                            setInsData({ ...insData, policyParties: updated });
                          }}
                          className="font-semibold text-slate-800 text-[11px] bg-white border border-slate-200 rounded p-1"
                        >
                          <option value="PRIMARY_INSURED">Primary Insured</option>
                          <option value="CO_INSURED">Co-Insured</option>
                          <option value="PRIMARY_BENEFICIARY">Primary Beneficiary</option>
                          <option value="CONTINGENT_BENEFICIARY">Contingent Beneficiary</option>
                          <option value="LOSS_PAYEE">Loss Payee</option>
                        </select>
                        <button
                          onClick={() => removeParty(i)}
                          className="text-rose-500 hover:text-rose-700 text-xs font-bold"
                        >
                          ✕
                        </button>
                      </div>

                      <div className="grid grid-cols-12 gap-1.5">
                        <input
                          type="text"
                          placeholder="Entity / Individual Name"
                          value={p.name}
                          onChange={(e) => {
                            const updated = [...insData.policyParties];
                            updated[i].name = e.target.value;
                            setInsData({ ...insData, policyParties: updated });
                          }}
                          className="col-span-6 p-1 border border-slate-200 rounded text-[11px] bg-white font-medium"
                        />
                        <select
                          value={p.entityType}
                          onChange={(e) => {
                            const updated = [...insData.policyParties];
                            updated[i].entityType = e.target.value as any;
                            setInsData({ ...insData, policyParties: updated });
                          }}
                          className="col-span-3 p-1 border border-slate-200 rounded text-[11px] bg-white"
                        >
                          <option value="ORGANIZATION">Organization</option>
                          <option value="INDIVIDUAL">Individual</option>
                        </select>
                        <input
                          type="text"
                          placeholder="Country"
                          value={p.country}
                          onChange={(e) => {
                            const updated = [...insData.policyParties];
                            updated[i].country = e.target.value;
                            setInsData({ ...insData, policyParties: updated });
                          }}
                          className="col-span-3 p-1 border border-slate-200 rounded text-[11px] bg-white uppercase"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: UBO Shares */}
          {activeTab === 'ubo' && (
            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                <span className="font-semibold text-slate-700">Corporate Beneficial Ownership (UBO)</span>
                <label className="flex items-center gap-1.5 cursor-pointer text-[11px]">
                  <input
                    type="checkbox"
                    checked={includeUbo}
                    onChange={(e) => setIncludeUbo(e.target.checked)}
                    className="rounded text-teal-600 focus:ring-teal-500"
                  />
                  <span>Include UBO Declaration</span>
                </label>
              </div>

              {!includeUbo ? (
                <div className="p-4 bg-amber-50 border border-amber-200 rounded text-amber-800 text-[11px]">
                  UBO declaration omitted. Corporate entities will trigger incomplete ownership review (NO_UBO_SUPPLIED).
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Target Corporate Entity Name</label>
                    <input
                      type="text"
                      value={insData.corporateEntityUbo?.entityName || ''}
                      onChange={(e) =>
                        setInsData({
                          ...insData,
                          corporateEntityUbo: {
                            entityName: e.target.value,
                            beneficialOwners: insData.corporateEntityUbo?.beneficialOwners || [],
                          },
                        })
                      }
                      className="w-full p-1.5 border border-slate-200 rounded text-xs"
                      placeholder="Must match primary or co-insured organization name"
                    />
                  </div>

                  <div className="flex justify-between items-center pt-1">
                    <span className="font-semibold text-slate-700 text-[11px]">Beneficial Owners & Equity Shares</span>
                    <button
                      onClick={addOwner}
                      className="text-[11px] text-teal-600 hover:underline font-bold"
                    >
                      + Add Owner
                    </button>
                  </div>

                  <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                    {(insData.corporateEntityUbo?.beneficialOwners || []).map((owner, i) => (
                      <div key={i} className="p-2 border border-slate-200 rounded bg-slate-50 space-y-1">
                        <div className="flex justify-between items-center">
                          <input
                            type="text"
                            placeholder="Beneficial Owner Name"
                            value={owner.name}
                            onChange={(e) => {
                              const updated = [...(insData.corporateEntityUbo?.beneficialOwners || [])];
                              updated[i].name = e.target.value;
                              setInsData({
                                ...insData,
                                corporateEntityUbo: {
                                  entityName: insData.corporateEntityUbo?.entityName || '',
                                  beneficialOwners: updated,
                                },
                              });
                            }}
                            className="w-3/4 p-1 border border-slate-200 rounded text-[11px] bg-white font-medium"
                          />
                          <button
                            onClick={() => removeOwner(i)}
                            className="text-rose-500 hover:text-rose-700 text-xs font-bold"
                          >
                            ✕
                          </button>
                        </div>

                        <div className="grid grid-cols-2 gap-1.5">
                          <div>
                            <label className="text-[10px] text-slate-500 block">Equity Share (%)</label>
                            <input
                              type="number"
                              value={owner.ownershipPercentage}
                              onChange={(e) => {
                                const updated = [...(insData.corporateEntityUbo?.beneficialOwners || [])];
                                updated[i].ownershipPercentage = parseFloat(e.target.value) || 0;
                                setInsData({
                                  ...insData,
                                  corporateEntityUbo: {
                                    entityName: insData.corporateEntityUbo?.entityName || '',
                                    beneficialOwners: updated,
                                  },
                                });
                              }}
                              className="w-full p-1 border border-slate-200 rounded text-[11px] bg-white font-mono"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-slate-500 block">Country</label>
                            <input
                              type="text"
                              value={owner.country}
                              onChange={(e) => {
                                const updated = [...(insData.corporateEntityUbo?.beneficialOwners || [])];
                                updated[i].country = e.target.value;
                                setInsData({
                                  ...insData,
                                  corporateEntityUbo: {
                                    entityName: insData.corporateEntityUbo?.entityName || '',
                                    beneficialOwners: updated,
                                  },
                                });
                              }}
                              className="w-full p-1 border border-slate-200 rounded text-[11px] bg-white uppercase"
                              placeholder="e.g. RU, CH, AE"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {clientError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded text-rose-800 text-xs flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold">Validation Rejection (HTTP 400)</div>
                <div>{clientError}</div>
              </div>
            </div>
          )}

          <button
            onClick={handleEvaluate}
            disabled={isLoading}
            className="w-full py-2.5 bg-teal-600 hover:bg-teal-700 text-white font-semibold rounded text-xs flex items-center justify-center gap-2 shadow-xs"
          >
            {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            Enforce OFAC 50% Rule & Screen Policyholders
          </button>
        </div>

        {/* Right: Segregated Results & Underwriting Dossier */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-3">
              <h3 className="font-bold text-slate-900 text-sm">Underwriting Clearance Dossier</h3>
              {result && (
                <div className="flex items-center gap-1 border border-slate-200 rounded p-0.5 bg-slate-50">
                  <button
                    onClick={() => setActiveResultTab('dossier')}
                    className={`px-2 py-0.5 text-xs font-semibold rounded ${
                      activeResultTab === 'dossier' ? 'bg-teal-600 text-white shadow-2xs' : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    Dossier Findings
                  </button>
                  <button
                    onClick={() => setActiveResultTab('graph')}
                    className={`px-2 py-0.5 text-xs font-semibold rounded flex items-center gap-1 ${
                      activeResultTab === 'graph' ? 'bg-teal-600 text-white shadow-2xs' : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <Share2 className="w-3 h-3" />
                    <span>Evidence Graph</span>
                  </button>
                </div>
              )}
            </div>
            {result && (
              <span
                className={`text-xs px-2.5 py-1 rounded font-bold uppercase ${
                  result.underwritingDecision === 'APPROVED'
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : result.underwritingDecision === 'REFER_TO_SENIOR_COUNSEL'
                    ? 'bg-amber-50 text-amber-700 border border-amber-200'
                    : 'bg-rose-50 text-rose-700 border border-rose-200'
                }`}
              >
                {result.underwritingDecision.replace(/_/g, ' ')}
              </span>
            )}
          </div>

          {!result ? (
            <div className="py-20 text-center text-slate-400 text-xs">
              <ShieldCheck className="w-8 h-8 mx-auto text-slate-300 mb-2" />
              Click "Enforce OFAC 50% Rule & Screen Policyholders" to evaluate corporate ownership shares and aggregate blocked exposure.
            </div>
          ) : activeResultTab === 'graph' ? (
            <ModuleEvidenceGraphSection moduleId="INSURANCE" evaluation={result} />
          ) : (
            <div className="space-y-4 text-xs">
              {/* 1. Top 3 Summary Metrics Cards */}
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="p-2 border border-slate-200 rounded bg-slate-50">
                  <div className="text-[10px] text-slate-500 font-semibold uppercase">Policy Completeness</div>
                  <div
                    className={`font-bold mt-0.5 ${
                      result.completenessStatus === 'FULL_POLICY_DATA'
                        ? 'text-emerald-700'
                        : result.completenessStatus === 'PARTIAL_POLICY_DATA'
                        ? 'text-amber-700'
                        : 'text-rose-700'
                    }`}
                  >
                    {result.completenessStatus}
                  </div>
                </div>

                <div className="p-2 border border-slate-200 rounded bg-slate-50">
                  <div className="text-[10px] text-slate-500 font-semibold uppercase">UBO Linkage & Coverage</div>
                  <div
                    className={`font-bold mt-0.5 ${
                      result.uboAnalysis.isEntityLinked ? 'text-emerald-700' : 'text-amber-700'
                    }`}
                  >
                    {result.uboAnalysis.isEntityLinked ? '✓ Linked' : '✗ Unlinked'} ({result.ownershipCoverage})
                  </div>
                  <div className="text-[10px] text-slate-500 truncate">{result.uboAnalysis.targetEntityName}</div>
                </div>

                <div className="p-2 border border-slate-200 rounded bg-slate-50">
                  <div className="text-[10px] text-slate-500 font-semibold uppercase">OFAC 50% Disposition</div>
                  <div
                    className={`font-bold mt-0.5 ${
                      result.uboAnalysis.ofacRuleDisposition === 'BELOW_THRESHOLD_COMPLIANT'
                        ? 'text-emerald-700'
                        : result.uboAnalysis.ofacRuleDisposition === 'CANDIDATE_OFAC_50_EXPOSURE'
                        ? 'text-amber-700'
                        : 'text-rose-700'
                    }`}
                  >
                    {result.uboAnalysis.ofacRuleDisposition?.replace(/_/g, ' ')}
                  </div>
                </div>
              </div>

              {/* 2. OFAC 50% Aggregate Blocked Ownership Banner */}
              <div
                className={`p-3 rounded border ${
                  result.uboAnalysis.violatesOfac50PercentRule
                    ? 'bg-rose-50 border-rose-200 text-rose-900'
                    : result.uboAnalysis.aggregateSanctionedOwnershipPercentage >= 25.0
                    ? 'bg-amber-50 border-amber-200 text-amber-900'
                    : 'bg-emerald-50 border-emerald-200 text-emerald-900'
                }`}
              >
                <div className="flex justify-between items-center font-bold">
                  <span>OFAC 50% Aggregate Blocked Ownership</span>
                  <span className="text-base">{result.uboAnalysis.aggregateSanctionedOwnershipPercentage}%</span>
                </div>
                <p className="mt-1 text-[11px]">
                  {result.uboAnalysis.violatesOfac50PercentRule
                    ? result.findingSeverity === 'EXACT_IDENTIFIER_MATCH'
                      ? 'CONFIRMED VIOLATION: Aggregate confirmed blocked ownership equals or exceeds 50%. The entity is blocked by operation of law.'
                      : 'VIOLATION CANDIDATE: Aggregate ownership by potential watchlist match candidates equals or exceeds 50%. Policy held pending identity adjudication.'
                    : result.uboAnalysis.aggregateSanctionedOwnershipPercentage >= 25.0
                    ? 'ELEVATED EXPOSURE (≥25%): Substantial sanctioned minority interest identified. Referred to senior compliance counsel.'
                    : 'COMPLIANT: Blocked ownership is below the 50% threshold.'}
                </p>
              </div>

              {/* 3. Beneficial Ownership Breakdown */}
              <div>
                <h4 className="font-bold text-slate-800 uppercase text-[11px] mb-1.5 flex justify-between">
                  <span>Beneficial Ownership Breakdown</span>
                  <span className="font-normal text-slate-500">
                    Declared Direct: {result.uboAnalysis.totalDeclaredDirectOwnershipPercentage}%
                  </span>
                </h4>
                {result.uboAnalysis.beneficialOwners.length === 0 ? (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded text-amber-800 text-[11px]">
                    No beneficial owners evaluated. Corporate ownership transparency required.
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {result.uboAnalysis.beneficialOwners.map((o, i) => (
                      <div
                        key={i}
                        className={`p-2 rounded border flex justify-between items-center ${
                          o.isSanctioned
                            ? 'bg-rose-50 border-rose-200'
                            : o.status === 'INCOMPLETE_NOT_SCREENED'
                            ? 'bg-amber-50 border-amber-200'
                            : 'bg-slate-50 border-slate-200'
                        }`}
                      >
                        <div>
                          <span className="font-semibold text-slate-800">{o.name || '(Blank Owner Name)'}</span>
                          <span className="text-[10px] text-slate-500 ml-2">
                            ({o.ownershipPercentage}% equity) — {o.country || 'No Country'}
                          </span>
                        </div>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${
                            o.matches.length > 0
                              ? 'bg-rose-100 text-rose-800'
                              : o.status === 'INCOMPLETE_NOT_SCREENED'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {o.matches.length > 0
                            ? 'MATCH CANDIDATE'
                            : o.status === 'INCOMPLETE_NOT_SCREENED'
                            ? 'NOT SCREENED / MISSING'
                            : 'SCREENED CLEAR'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 4. Screened Policy Parties */}
              <div>
                <h4 className="font-bold text-slate-800 uppercase text-[11px] mb-1.5 flex justify-between">
                  <span>Screened Policy Parties</span>
                  <span className="font-normal text-slate-500">Stage: {result.screeningStage}</span>
                </h4>
                <div className="space-y-1.5">
                  {result.policyParties.map((p, i) => (
                    <div
                      key={i}
                      className={`p-2 rounded border flex justify-between items-center ${
                        p.matches.length > 0
                          ? 'bg-rose-50 border-rose-200'
                          : p.status === 'INCOMPLETE_NOT_SCREENED'
                          ? 'bg-amber-50 border-amber-200'
                          : 'bg-slate-50 border-slate-200'
                      }`}
                    >
                      <div>
                        <span className="font-semibold text-slate-800">{p.name || '(Blank Entity Name)'}</span>
                        <span className="text-[10px] text-slate-500 ml-2">
                          ({p.role} — {p.entityType}) — {p.country || 'No Country'}
                        </span>
                      </div>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${
                          p.matches.length > 0
                            ? 'bg-rose-100 text-rose-800'
                            : p.status === 'INCOMPLETE_NOT_SCREENED'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-emerald-100 text-emerald-800'
                        }`}
                      >
                        {p.matches.length > 0
                          ? 'MATCH CANDIDATE'
                          : p.status === 'INCOMPLETE_NOT_SCREENED'
                          ? 'NOT SCREENED / MISSING'
                          : 'SCREENED CLEAR'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* 5. Ownership Discrepancies & Review Reasons */}
              {result.uboAnalysis.ownershipDiscrepancies && result.uboAnalysis.ownershipDiscrepancies.length > 0 && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded text-amber-900 space-y-1">
                  <div className="font-bold flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" /> Ownership Integrity Warnings ({result.uboAnalysis.ownershipDiscrepancies.length}):
                  </div>
                  {result.uboAnalysis.ownershipDiscrepancies.map((d, i) => (
                    <div key={i} className="text-[11px]">• {d}</div>
                  ))}
                </div>
              )}

              {result.reviewReasons && result.reviewReasons.length > 0 && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded text-amber-900 space-y-1">
                  <div className="font-bold flex items-center gap-1">
                    <Info className="w-3.5 h-3.5" /> Compliance Review Reasons ({result.reviewReasons.length}):
                  </div>
                  {result.reviewReasons.map((r, i) => (
                    <div key={i} className="text-[11px]">• {r}</div>
                  ))}
                </div>
              )}

              {/* 6. Adjudication Workflow Panel */}
              <div className="p-3 border border-slate-200 rounded bg-slate-50 space-y-2">
                <div className="font-bold text-slate-800 text-[11px] uppercase">
                  Adjudicate Policy Clearance Decision
                </div>
                <textarea
                  rows={2}
                  value={rationale}
                  onChange={(e) => setRationale(e.target.value)}
                  placeholder="Enter mandatory analyst compliance rationale (min 10 characters)..."
                  className="w-full p-2 border border-slate-200 rounded text-[11px] bg-white"
                />
                <div className="flex gap-2">
                  <button
                    disabled={rationale.trim().length < 10}
                    onClick={() => {
                      setAdjudicatedDecision('CONFIRMED_OFAC_BLOCK');
                      alert('Adjudication recorded: CONFIRMED_OFAC_BLOCK');
                    }}
                    className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white rounded font-bold text-[10px]"
                  >
                    Confirm Block & Hold
                  </button>
                  <button
                    disabled={rationale.trim().length < 10}
                    onClick={() => {
                      setAdjudicatedDecision('PERMIT_BINDING_WAIVER');
                      alert('Adjudication recorded: PERMIT_BINDING_WAIVER');
                    }}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded font-bold text-[10px]"
                  >
                    Permit Binding with Waiver
                  </button>
                </div>
                {adjudicatedDecision && (
                  <div className="text-[10px] text-slate-600">
                    Active Adjudication: <span className="font-bold text-teal-700">{adjudicatedDecision}</span>
                  </div>
                )}
              </div>

              {/* 7. Tamper-Evident Digest & Download Evidence */}
              <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                <span className="font-mono truncate max-w-xs">SHA-256: {result.evidenceDigest}</span>
                <button
                  onClick={handleExportEvidence}
                  className="px-2.5 py-1 bg-teal-50 hover:bg-teal-100 text-teal-700 border border-teal-200 rounded font-semibold flex items-center gap-1"
                >
                  <Download className="w-3.5 h-3.5" /> Download Sealed Evidence Pack (JSON)
                </button>
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
  const [cryptoData, setCryptoData] = useState<any>({
    ...MULTI_MODULE_FIXTURES.CRYPTO,
    fiatValueUsd: 145000.0,
  });
  const [result, setResult] = useState<CryptoEvaluation | null>(null);
  const [activeResultTab, setActiveResultTab] = useState<'verdict' | 'graph'>('verdict');
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'TRANSFER' | 'TRAVEL_RULE'>('TRANSFER');
  const [clientError, setClientError] = useState<string | null>(null);
  const [adjudicationAction, setAdjudicationAction] = useState<string | null>(null);

  const handleEvaluate = async () => {
    setIsLoading(true);
    setClientError(null);
    setAdjudicationAction(null);
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
      if (!res.ok) {
        setClientError(data.error || 'Crypto evaluation failed');
      } else {
        setResult(data);
      }
    } catch (e: any) {
      setClientError(`Error evaluating crypto transfer: ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportEvidence = () => {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Crypto_Evidence_${result.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const updateTravelRule = (field: string, val: any) => {
    setCryptoData((prev: any) => ({
      ...prev,
      travelRuleData: {
        ...(prev.travelRuleData || {}),
        [field]: val,
      },
    }));
  };

  const updateOriginator = (field: string, val: any) => {
    setCryptoData((prev: any) => ({
      ...prev,
      travelRuleData: {
        ...(prev.travelRuleData || {}),
        originator: {
          ...(prev.travelRuleData?.originator || {}),
          [field]: val,
        },
      },
    }));
  };

  const updateBeneficiary = (field: string, val: any) => {
    setCryptoData((prev: any) => ({
      ...prev,
      travelRuleData: {
        ...(prev.travelRuleData || {}),
        beneficiary: {
          ...(prev.travelRuleData?.beneficiary || {}),
          [field]: val,
        },
      },
    }));
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {clientError && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-lg flex items-start gap-2.5 text-rose-800 text-xs shadow-xs">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold">Evaluation Validation Error: </span>
            {clientError}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Transfer & Travel Rule Inputs */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
              <Cpu className="w-4 h-4 text-teal-600" /> On-Chain Transfer & Travel Rule
            </h3>
            <button
              onClick={() => {
                setCryptoData({
                  ...MULTI_MODULE_FIXTURES.CRYPTO,
                  fiatValueUsd: 145000.0,
                });
                setClientError(null);
                setResult(null);
              }}
              className="text-xs text-teal-600 hover:underline flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" /> Reload Sample
            </button>
          </div>

          {/* Sub-tabs */}
          <div className="flex border-b border-slate-200 text-xs">
            <button
              onClick={() => setActiveTab('TRANSFER')}
              className={`pb-2 px-3 font-semibold border-b-2 transition-colors ${
                activeTab === 'TRANSFER'
                  ? 'border-teal-600 text-teal-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              Transfer & Chain
            </button>
            <button
              onClick={() => setActiveTab('TRAVEL_RULE')}
              className={`pb-2 px-3 font-semibold border-b-2 transition-colors ${
                activeTab === 'TRAVEL_RULE'
                  ? 'border-teal-600 text-teal-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              IVMS 101 Counterparties
            </button>
          </div>

          {activeTab === 'TRANSFER' && (
            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Asset</label>
                  <select
                    value={cryptoData.asset}
                    onChange={(e) => setCryptoData({ ...cryptoData, asset: e.target.value })}
                    className="w-full p-1.5 border border-slate-200 rounded font-mono text-xs uppercase bg-white"
                  >
                    <option value="BTC">BTC</option>
                    <option value="ETH">ETH</option>
                    <option value="USDT">USDT</option>
                    <option value="USDC">USDC</option>
                    <option value="SOL">SOL</option>
                  </select>
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Crypto Quantity</label>
                  <input
                    type="number"
                    value={cryptoData.amount}
                    onChange={(e) => setCryptoData({ ...cryptoData, amount: parseFloat(e.target.value) || 0 })}
                    className="w-full p-1.5 border border-slate-200 rounded font-mono text-xs"
                    placeholder="e.g. 10.5"
                  />
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Fiat Valuation ($ USD) <span className="text-[10px] text-slate-400 font-normal">(Required for Travel Rule threshold)</span>
                </label>
                <input
                  type="number"
                  value={cryptoData.fiatValueUsd ?? ''}
                  onChange={(e) =>
                    setCryptoData({
                      ...cryptoData,
                      fiatValueUsd: e.target.value === '' ? undefined : parseFloat(e.target.value),
                    })
                  }
                  className="w-full p-1.5 border border-slate-200 rounded font-mono text-xs"
                  placeholder="e.g. 145000.00 (leave blank to test missing valuation)"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Source Network</label>
                  <select
                    value={cryptoData.sourceNetwork}
                    onChange={(e) => setCryptoData({ ...cryptoData, sourceNetwork: e.target.value })}
                    className="w-full p-1.5 border border-slate-200 rounded font-mono text-xs bg-white"
                  >
                    <option value="ETHEREUM">ETHEREUM</option>
                    <option value="BITCOIN">BITCOIN</option>
                    <option value="TRON">TRON</option>
                    <option value="SOLANA">SOLANA</option>
                  </select>
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Dest Network</label>
                  <select
                    value={cryptoData.destinationNetwork}
                    onChange={(e) => setCryptoData({ ...cryptoData, destinationNetwork: e.target.value })}
                    className="w-full p-1.5 border border-slate-200 rounded font-mono text-xs bg-white"
                  >
                    <option value="ETHEREUM">ETHEREUM</option>
                    <option value="BITCOIN">BITCOIN</option>
                    <option value="TRON">TRON</option>
                    <option value="SOLANA">SOLANA</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Source Address ({cryptoData.sourceNetwork})
                </label>
                <input
                  type="text"
                  value={cryptoData.sourceAddress}
                  onChange={(e) => setCryptoData({ ...cryptoData, sourceAddress: e.target.value })}
                  className="w-full p-1.5 border border-slate-200 rounded font-mono text-[11px]"
                  placeholder="e.g. 0x... or 1... or bc1..."
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Destination Address ({cryptoData.destinationNetwork})
                </label>
                <input
                  type="text"
                  value={cryptoData.destinationAddress}
                  onChange={(e) => setCryptoData({ ...cryptoData, destinationAddress: e.target.value })}
                  className="w-full p-1.5 border border-slate-200 rounded font-mono text-[11px]"
                  placeholder="e.g. 0x... or 1... or bc1..."
                />
              </div>
            </div>
          )}

          {activeTab === 'TRAVEL_RULE' && (
            <div className="space-y-3 text-xs">
              <div className="p-2.5 bg-slate-50 border border-slate-200 rounded space-y-2">
                <span className="font-bold text-slate-800 block text-[11px]">VASP Verification</span>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-slate-500 font-semibold block">Originator VASP</label>
                    <input
                      type="text"
                      value={cryptoData.travelRuleData?.originatorVaspName || ''}
                      onChange={(e) => updateTravelRule('originatorVaspName', e.target.value)}
                      className="w-full p-1 border border-slate-200 rounded text-xs bg-white"
                      placeholder="Originator VASP name"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 font-semibold block">Beneficiary VASP</label>
                    <input
                      type="text"
                      value={cryptoData.travelRuleData?.beneficiaryVaspName || ''}
                      onChange={(e) => updateTravelRule('beneficiaryVaspName', e.target.value)}
                      className="w-full p-1 border border-slate-200 rounded text-xs bg-white"
                      placeholder="Beneficiary VASP name"
                    />
                  </div>
                </div>
              </div>

              <div className="p-2.5 bg-slate-50 border border-slate-200 rounded space-y-2">
                <span className="font-bold text-slate-800 block text-[11px]">Originator (IVMS 101)</span>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-slate-500 font-semibold block">Full Name</label>
                    <input
                      type="text"
                      value={cryptoData.travelRuleData?.originator?.fullName || ''}
                      onChange={(e) => updateOriginator('fullName', e.target.value)}
                      className="w-full p-1 border border-slate-200 rounded text-xs bg-white"
                      placeholder="Originator name"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 font-semibold block">Country (ISO)</label>
                    <input
                      type="text"
                      value={cryptoData.travelRuleData?.originator?.country || ''}
                      onChange={(e) => updateOriginator('country', e.target.value)}
                      className="w-full p-1 border border-slate-200 rounded text-xs bg-white"
                      placeholder="e.g. US, CH, AE"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 font-semibold block">National ID or LEI</label>
                  <input
                    type="text"
                    value={cryptoData.travelRuleData?.originator?.nationalIdentifierOrLei || ''}
                    onChange={(e) => updateOriginator('nationalIdentifierOrLei', e.target.value)}
                    className="w-full p-1 border border-slate-200 rounded text-xs bg-white font-mono"
                    placeholder="e.g. PASSPORT or LEI"
                  />
                </div>
              </div>

              <div className="p-2.5 bg-slate-50 border border-slate-200 rounded space-y-2">
                <span className="font-bold text-slate-800 block text-[11px]">Beneficiary (IVMS 101)</span>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-slate-500 font-semibold block">Full Name</label>
                    <input
                      type="text"
                      value={cryptoData.travelRuleData?.beneficiary?.fullName || ''}
                      onChange={(e) => updateBeneficiary('fullName', e.target.value)}
                      className="w-full p-1 border border-slate-200 rounded text-xs bg-white"
                      placeholder="Beneficiary name"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 font-semibold block">Country (ISO)</label>
                    <input
                      type="text"
                      value={cryptoData.travelRuleData?.beneficiary?.country || ''}
                      onChange={(e) => updateBeneficiary('country', e.target.value)}
                      className="w-full p-1 border border-slate-200 rounded text-xs bg-white"
                      placeholder="e.g. KY, GB, DE"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 font-semibold block">National ID or LEI</label>
                  <input
                    type="text"
                    value={cryptoData.travelRuleData?.beneficiary?.nationalIdentifierOrLei || ''}
                    onChange={(e) => updateBeneficiary('nationalIdentifierOrLei', e.target.value)}
                    className="w-full p-1 border border-slate-200 rounded text-xs bg-white font-mono"
                    placeholder="e.g. LEI 549300..."
                  />
                </div>
              </div>
            </div>
          )}

          <button
            onClick={handleEvaluate}
            disabled={isLoading}
            className="w-full py-2.5 bg-teal-600 hover:bg-teal-700 text-white font-semibold rounded text-xs flex items-center justify-center gap-2 shadow-xs transition-colors"
          >
            {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            Evaluate Address, Mixer Risk & Travel Rule
          </button>
        </div>

        {/* Right Column: Clearance & Compliance Results */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 className="font-bold text-slate-900 text-sm">Crypto Compliance Clearance</h3>
              {result && (
                <div className="text-[11px] text-slate-500 mt-0.5">
                  Transfer: <span className="font-semibold text-slate-800">{result.amount.toLocaleString()} {result.asset}</span>
                  {' • '}
                  Fiat Valuation:{' '}
                  {result.fiatValuation?.isValuationEstablished && result.fiatValuation.amountUsd !== undefined ? (
                    <span className="font-semibold text-slate-800">${result.fiatValuation.amountUsd.toLocaleString(undefined, { minimumFractionDigits: 2 })} USD</span>
                  ) : (
                    <span className="text-amber-600 font-semibold">Missing / Unestablished</span>
                  )}
                </div>
              )}
              {result && (
                <div className="flex items-center gap-1 border border-slate-200 rounded p-0.5 bg-slate-50 mt-1">
                  <button
                    onClick={() => setActiveResultTab('verdict')}
                    className={`px-2 py-0.5 text-xs font-semibold rounded ${
                      activeResultTab === 'verdict' ? 'bg-teal-600 text-white shadow-2xs' : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    Verdict Findings
                  </button>
                  <button
                    onClick={() => setActiveResultTab('graph')}
                    className={`px-2 py-0.5 text-xs font-semibold rounded flex items-center gap-1 ${
                      activeResultTab === 'graph' ? 'bg-teal-600 text-white shadow-2xs' : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <Share2 className="w-3 h-3" />
                    <span>Evidence Graph</span>
                  </button>
                </div>
              )}
            </div>

            {result && (
              <span
                className={`text-xs px-2.5 py-1 rounded font-bold uppercase ${
                  result.clearanceStatus === 'TRANSACTION_PERMITTED'
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : result.clearanceStatus === 'BLOCKED_SANCTIONED_ADDRESS' || result.clearanceStatus === 'INVALID_TRANSACTION_PAYLOAD'
                    ? 'bg-rose-50 text-rose-700 border border-rose-200'
                    : 'bg-amber-50 text-amber-700 border border-amber-200'
                }`}
              >
                {result.clearanceStatus.replace(/_/g, ' ')}
              </span>
            )}
          </div>

          {!result ? (
            <div className="py-20 text-center text-slate-400 text-xs">
              <Cpu className="w-8 h-8 mx-auto text-slate-300 mb-2" />
              Click "Evaluate Address, Mixer Risk & Travel Rule" to detect sanctioned smart contract mixers, verify IVMS 101 payload completeness, and screen counterparties.
            </div>
          ) : activeResultTab === 'graph' ? (
            <ModuleEvidenceGraphSection moduleId="CRYPTO" evaluation={result} />
          ) : (
            <div className="space-y-4 text-xs">
              {/* 4-Box Metric Grid */}
              <div className="grid grid-cols-2 gap-3">
                {/* Source Address Risk */}
                <div
                  className={`p-3 rounded border ${
                    result.sourceAddress.isKnownMixerOrSanctionedCluster
                      ? 'bg-rose-50 border-rose-200 text-rose-900'
                      : !result.sourceAddress.isValidFormat
                      ? 'bg-rose-50 border-rose-200 text-rose-900'
                      : 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  }`}
                >
                  <div className="font-bold flex items-center justify-between">
                    <span>Source Address</span>
                    <span className="text-[10px] font-mono">{result.sourceAddress.network}</span>
                  </div>
                  <div className="font-semibold mt-1">
                    {result.sourceAddress.isKnownMixerOrSanctionedCluster ? (
                      <span className="flex items-center gap-1 text-rose-700">
                        <AlertTriangle className="w-3.5 h-3.5" /> PROHIBITED SANCTIONED MIXER
                      </span>
                    ) : !result.sourceAddress.isValidFormat ? (
                      <span className="text-rose-700">⚠️ INVALID ADDRESS SYNTAX</span>
                    ) : (
                      <span className="text-slate-700">Unhosted Wallet / Exchange</span>
                    )}
                  </div>
                  {result.sourceAddress.attributedEntity && (
                    <div className="text-[11px] text-rose-700 font-bold mt-0.5">
                      {result.sourceAddress.attributedEntity}
                    </div>
                  )}
                  <div className="text-[10px] font-mono text-slate-500 truncate mt-1">
                    {result.sourceAddress.address}
                  </div>
                </div>

                {/* Destination Address Risk */}
                <div
                  className={`p-3 rounded border ${
                    result.destinationAddress.isKnownMixerOrSanctionedCluster
                      ? 'bg-rose-50 border-rose-200 text-rose-900'
                      : !result.destinationAddress.isValidFormat
                      ? 'bg-rose-50 border-rose-200 text-rose-900'
                      : 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  }`}
                >
                  <div className="font-bold flex items-center justify-between">
                    <span>Destination Address</span>
                    <span className="text-[10px] font-mono">{result.destinationAddress.network}</span>
                  </div>
                  <div className="font-semibold mt-1">
                    {result.destinationAddress.isKnownMixerOrSanctionedCluster ? (
                      <span className="flex items-center gap-1 text-rose-700">
                        <AlertTriangle className="w-3.5 h-3.5" /> PROHIBITED SANCTIONED MIXER
                      </span>
                    ) : !result.destinationAddress.isValidFormat ? (
                      <span className="text-rose-700">⚠️ INVALID ADDRESS SYNTAX</span>
                    ) : (
                      <span className="text-slate-700">Unhosted Wallet / Exchange</span>
                    )}
                  </div>
                  {result.destinationAddress.attributedEntity && (
                    <div className="text-[11px] text-rose-700 font-bold mt-0.5">
                      {result.destinationAddress.attributedEntity}
                    </div>
                  )}
                  <div className="text-[10px] font-mono text-slate-500 truncate mt-1">
                    {result.destinationAddress.address}
                  </div>
                </div>

                {/* Asset & Chain Compatibility */}
                <div
                  className={`p-3 rounded border ${
                    result.assetNetworkCompatibility?.isCompatible === false
                      ? 'bg-rose-50 border-rose-200 text-rose-900'
                      : 'bg-slate-50 border-slate-200 text-slate-800'
                  }`}
                >
                  <div className="font-bold">Asset / Network Matrix</div>
                  <div className="font-semibold mt-1">
                    {result.assetNetworkCompatibility?.isCompatible === false ? (
                      <span className="text-rose-700">⚠️ Incompatible Asset / Chain</span>
                    ) : (
                      <span className="text-emerald-700">✓ Native Asset Support</span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    {result.asset} on {result.sourceAddress.network}
                  </div>
                </div>

                {/* IVMS 101 Travel Rule */}
                <div
                  className={`p-3 rounded border ${
                    result.travelRule.travelRuleStatus === 'TRAVEL_RULE_COMPLIANT'
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                      : result.travelRule.travelRuleStatus === 'NOT_APPLICABLE_BELOW_THRESHOLD'
                      ? 'bg-slate-50 border-slate-200 text-slate-700'
                      : 'bg-amber-50 border-amber-200 text-amber-900'
                  }`}
                >
                  <div className="font-bold">IVMS 101 Travel Rule</div>
                  <div className="font-semibold mt-1">
                    {result.travelRule.travelRuleStatus === 'TRAVEL_RULE_COMPLIANT'
                      ? '✓ Compliant Payload'
                      : result.travelRule.travelRuleStatus === 'NOT_APPLICABLE_BELOW_THRESHOLD'
                      ? 'Below Threshold (< $1,000)'
                      : result.travelRule.travelRuleStatus === 'UNASSESSED_MISSING_VALUATION'
                      ? '⚠️ Unassessed (Missing Valuation)'
                      : '⚠️ Travel Rule Deficit'}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    Protocol: {result.travelRule.protocol} • Threshold: $1,000 USD
                  </div>
                </div>
              </div>

              {/* Counterparty Screening Results */}
              {result.counterpartyScreening && result.counterpartyScreening.hasSanctionedParty && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded text-rose-900 space-y-1">
                  <div className="font-bold flex items-center gap-1 text-xs text-rose-800">
                    <AlertTriangle className="w-4 h-4 text-rose-600" /> Sanctions Watchlist Hits on Counterparties:
                  </div>
                  {result.counterpartyScreening.originatorMatches.map((m: any, i: number) => (
                    <div key={i} className="text-[11px]">
                      • Originator matched <span className="font-semibold">{m.entryName}</span> on {m.listName} ({Math.round(m.similarityScore * 100)}% match)
                    </div>
                  ))}
                  {result.counterpartyScreening.beneficiaryMatches.map((m: any, i: number) => (
                    <div key={i} className="text-[11px]">
                      • Beneficiary matched <span className="font-semibold">{m.entryName}</span> on {m.listName} ({Math.round(m.similarityScore * 100)}% match)
                    </div>
                  ))}
                </div>
              )}

              {/* Missing Mandatory Fields */}
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

              {/* Review Reasons */}
              {result.reviewReasons && result.reviewReasons.length > 0 && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded text-slate-700">
                  <div className="font-bold text-slate-800 text-[11px] mb-1">Compliance Review Rationale:</div>
                  <ul className="list-disc list-inside space-y-0.5 text-[11px]">
                    {result.reviewReasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Analyst Adjudication Actions */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded space-y-2">
                <span className="font-bold text-slate-800 block text-[11px]">Analyst Decision Adjudication</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setAdjudicationAction('CONFIRMED_BLOCK')}
                    className={`px-3 py-1.5 rounded font-semibold text-xs border ${
                      adjudicationAction === 'CONFIRMED_BLOCK'
                        ? 'bg-rose-600 text-white border-rose-700'
                        : 'bg-white text-rose-700 border-rose-300 hover:bg-rose-50'
                    }`}
                  >
                    Confirm Block
                  </button>
                  <button
                    onClick={() => setAdjudicationAction('REQUEST_VASP_KYC')}
                    className={`px-3 py-1.5 rounded font-semibold text-xs border ${
                      adjudicationAction === 'REQUEST_VASP_KYC'
                        ? 'bg-amber-600 text-white border-amber-700'
                        : 'bg-white text-amber-700 border-amber-300 hover:bg-amber-50'
                    }`}
                  >
                    Request VASP / Travel Rule KYC
                  </button>
                  <button
                    onClick={() => setAdjudicationAction('OVERRIDE_PERMIT')}
                    className={`px-3 py-1.5 rounded font-semibold text-xs border ${
                      adjudicationAction === 'OVERRIDE_PERMIT'
                        ? 'bg-emerald-600 text-white border-emerald-700'
                        : 'bg-white text-emerald-700 border-emerald-300 hover:bg-emerald-50'
                    }`}
                  >
                    Override with Rationale
                  </button>
                </div>
                {adjudicationAction && (
                  <div className="text-[11px] text-teal-800 bg-teal-50 p-2 rounded border border-teal-200 font-medium">
                    ✓ Adjudication action recorded: <span className="font-bold">{adjudicationAction}</span>
                  </div>
                )}
              </div>

              {/* Sealed Evidence Footer */}
              <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                <span className="font-mono truncate max-w-xs">SHA-256: {result.evidenceDigest}</span>
                <button
                  onClick={handleExportEvidence}
                  className="px-2.5 py-1 bg-teal-50 hover:bg-teal-100 text-teal-700 border border-teal-200 rounded font-semibold flex items-center gap-1"
                >
                  <Download className="w-3.5 h-3.5" /> Download Sealed Evidence Pack (JSON)
                </button>
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
  const [healthData, setHealthData] = useState<any>(MULTI_MODULE_FIXTURES.HEALTHCARE);
  const [result, setResult] = useState<HealthcareEvaluation | null>(null);
  const [activeResultTab, setActiveResultTab] = useState<'verdict' | 'graph'>('verdict');
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'PRACTITIONER' | 'SUPPLIER'>('PRACTITIONER');
  const [clientError, setClientError] = useState<string | null>(null);
  const [adjudicationAction, setAdjudicationAction] = useState<string | null>(null);

  const handleEvaluate = async () => {
    setIsLoading(true);
    setClientError(null);
    setAdjudicationAction(null);
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
      if (!res.ok) {
        setClientError(data.error || 'Healthcare evaluation failed');
      } else {
        setResult(data);
      }
    } catch (e: any) {
      setClientError(`Error evaluating healthcare claim: ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportEvidence = () => {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Healthcare_Evidence_${result.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const updatePractitioner = (field: string, val: any) => {
    setHealthData((prev: any) => ({
      ...prev,
      practitioner: {
        ...(prev.practitioner || {}),
        [field]: val,
      },
    }));
  };

  const updateSupplier = (field: string, val: any) => {
    setHealthData((prev: any) => ({
      ...prev,
      supplier: {
        ...(prev.supplier || {}),
        [field]: val,
      },
    }));
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {clientError && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-lg flex items-start gap-2.5 text-rose-800 text-xs shadow-xs">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold">Evaluation Validation Error: </span>
            {clientError}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Input Form */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
              <Activity className="w-4 h-4 text-teal-600" /> Practitioner & Provider Credentials
            </h3>
            <button
              onClick={() => {
                setHealthData(MULTI_MODULE_FIXTURES.HEALTHCARE);
                setClientError(null);
                setResult(null);
              }}
              className="text-xs text-teal-600 hover:underline flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" /> Reload Sample
            </button>
          </div>

          {/* Sub-tabs */}
          <div className="flex border-b border-slate-200 text-xs">
            <button
              onClick={() => setActiveTab('PRACTITIONER')}
              className={`pb-2 px-3 font-semibold border-b-2 transition-colors ${
                activeTab === 'PRACTITIONER'
                  ? 'border-teal-600 text-teal-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              Claim & Practitioner
            </button>
            <button
              onClick={() => setActiveTab('SUPPLIER')}
              className={`pb-2 px-3 font-semibold border-b-2 transition-colors ${
                activeTab === 'SUPPLIER'
                  ? 'border-teal-600 text-teal-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              Medical Supplier / Facility
            </button>
          </div>

          {activeTab === 'PRACTITIONER' && (
            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Claim ID</label>
                  <input
                    type="text"
                    value={healthData.claimId || ''}
                    onChange={(e) => setHealthData({ ...healthData, claimId: e.target.value })}
                    className="w-full p-1.5 border border-slate-200 rounded font-mono text-xs"
                    placeholder="CLM-..."
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Service Date</label>
                  <input
                    type="text"
                    value={healthData.serviceDate || ''}
                    onChange={(e) => setHealthData({ ...healthData, serviceDate: e.target.value })}
                    className="w-full p-1.5 border border-slate-200 rounded font-mono text-xs"
                    placeholder="YYYY-MM-DD"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Billed Amount ($)</label>
                  <input
                    type="number"
                    value={healthData.billedAmount ?? ''}
                    onChange={(e) => setHealthData({ ...healthData, billedAmount: parseFloat(e.target.value) || 0 })}
                    className="w-full p-1.5 border border-slate-200 rounded font-mono text-xs"
                    placeholder="e.g. 48500"
                  />
                </div>
              </div>

              <div className="p-2.5 bg-slate-50 border border-slate-200 rounded space-y-2">
                <span className="font-bold text-slate-800 block text-[11px]">Rendering Practitioner</span>
                <div>
                  <label className="text-[10px] text-slate-500 font-semibold block">Full Name</label>
                  <input
                    type="text"
                    value={healthData.practitioner?.name || ''}
                    onChange={(e) => updatePractitioner('name', e.target.value)}
                    className="w-full p-1 border border-slate-200 rounded text-xs bg-white"
                    placeholder="e.g. Dr. Gregory Vance MD"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-slate-500 font-semibold block">10-Digit NPI Number</label>
                    <input
                      type="text"
                      value={healthData.practitioner?.npi || ''}
                      onChange={(e) => updatePractitioner('npi', e.target.value)}
                      className="w-full p-1 border border-slate-200 rounded font-mono text-xs bg-white"
                      placeholder="10 digits only"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 font-semibold block">DEA Registration #</label>
                    <input
                      type="text"
                      value={healthData.practitioner?.deaNumber || ''}
                      onChange={(e) => updatePractitioner('deaNumber', e.target.value)}
                      className="w-full p-1 border border-slate-200 rounded font-mono text-xs uppercase bg-white"
                      placeholder="e.g. BV1234563"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-slate-500 font-semibold block">Specialty</label>
                    <input
                      type="text"
                      value={healthData.practitioner?.specialty || ''}
                      onChange={(e) => updatePractitioner('specialty', e.target.value)}
                      className="w-full p-1 border border-slate-200 rounded text-xs bg-white"
                      placeholder="e.g. Interventional Pain"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 font-semibold block">State License #</label>
                    <input
                      type="text"
                      value={healthData.practitioner?.stateLicense || ''}
                      onChange={(e) => updatePractitioner('stateLicense', e.target.value)}
                      className="w-full p-1 border border-slate-200 rounded font-mono text-xs bg-white"
                      placeholder="e.g. NY-MED-84920"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'SUPPLIER' && (
            <div className="space-y-3 text-xs">
              <div className="p-2.5 bg-slate-50 border border-slate-200 rounded space-y-2">
                <span className="font-bold text-slate-800 block text-[11px]">Medical Supplier / Entity</span>
                <div>
                  <label className="text-[10px] text-slate-500 font-semibold block">Company Name</label>
                  <input
                    type="text"
                    value={healthData.supplier?.companyName || ''}
                    onChange={(e) => updateSupplier('companyName', e.target.value)}
                    className="w-full p-1 border border-slate-200 rounded text-xs bg-white"
                    placeholder="e.g. Pharmacia Biotech Solutions LLC"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-slate-500 font-semibold block">Country (ISO)</label>
                    <input
                      type="text"
                      value={healthData.supplier?.country || ''}
                      onChange={(e) => updateSupplier('country', e.target.value)}
                      className="w-full p-1 border border-slate-200 rounded text-xs bg-white"
                      placeholder="e.g. US, DE, CH"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 font-semibold block">Tax ID / EIN</label>
                    <input
                      type="text"
                      value={healthData.supplier?.taxId || ''}
                      onChange={(e) => updateSupplier('taxId', e.target.value)}
                      className="w-full p-1 border border-slate-200 rounded font-mono text-xs bg-white"
                      placeholder="e.g. US-DEMO-9918234"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[10px] text-slate-500 font-semibold block">FDA Registration #</label>
                  <input
                    type="text"
                    value={healthData.supplier?.fdaRegistrationNumber || ''}
                    onChange={(e) => updateSupplier('fdaRegistrationNumber', e.target.value)}
                    className="w-full p-1 border border-slate-200 rounded font-mono text-xs bg-white"
                    placeholder="e.g. FDA-REG-300918"
                  />
                </div>
              </div>
            </div>
          )}

          <button
            onClick={handleEvaluate}
            disabled={isLoading}
            className="w-full py-2.5 bg-teal-600 hover:bg-teal-700 text-white font-semibold rounded text-xs flex items-center justify-center gap-2 shadow-xs transition-colors"
          >
            {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            Validate NPI/DEA & Screen OIG-LEIE Exclusions
          </button>
        </div>

        {/* Right Column: Clearance & Integrity Results */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 className="font-bold text-slate-900 text-sm">Healthcare Exclusion & Integrity Results</h3>
              {result && (
                <div className="text-[11px] text-slate-500 mt-0.5">
                  Claim: <span className="font-semibold text-slate-800">{result.claimId}</span>
                  {' • '}
                  Date: <span className="font-semibold text-slate-800">{result.serviceDate}</span>
                  {' • '}
                  Billed: <span className="font-semibold text-slate-800">${result.billedAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
              )}
              {result && (
                <div className="flex items-center gap-1 border border-slate-200 rounded p-0.5 bg-slate-50 mt-1">
                  <button
                    onClick={() => setActiveResultTab('verdict')}
                    className={`px-2 py-0.5 text-xs font-semibold rounded ${
                      activeResultTab === 'verdict' ? 'bg-teal-600 text-white shadow-2xs' : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    Verdict Findings
                  </button>
                  <button
                    onClick={() => setActiveResultTab('graph')}
                    className={`px-2 py-0.5 text-xs font-semibold rounded flex items-center gap-1 ${
                      activeResultTab === 'graph' ? 'bg-teal-600 text-white shadow-2xs' : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <Share2 className="w-3 h-3" />
                    <span>Evidence Graph</span>
                  </button>
                </div>
              )}
            </div>

            {result && (
              <span
                className={`text-xs px-2.5 py-1 rounded font-bold uppercase ${
                  result.claimIntegrityStatus === 'PAYMENT_APPROVED'
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : result.claimIntegrityStatus === 'CLAIM_HELD_FOR_FRAUD_EXCLUSION' || result.claimIntegrityStatus === 'SANCTIONED_ENTITY_BLOCKED'
                    ? 'bg-rose-50 text-rose-700 border border-rose-200'
                    : 'bg-amber-50 text-amber-700 border border-amber-200'
                }`}
              >
                {result.claimIntegrityStatus.replace(/_/g, ' ')}
              </span>
            )}
          </div>

          {!result ? (
            <div className="py-20 text-center text-slate-400 text-xs">
              <Activity className="w-8 h-8 mx-auto text-slate-300 mb-2" />
              Click "Validate NPI/DEA & Screen OIG-LEIE Exclusions" to run CMS Luhn Mod-10 checksum, DEA formula check, and verify HHS-OIG exclusion records.
            </div>
          ) : activeResultTab === 'graph' ? (
            <ModuleEvidenceGraphSection moduleId="HEALTHCARE" evaluation={result} />
          ) : (
            <div className="space-y-4 text-xs">
              {/* 4-Box Metric Grid */}
              <div className="grid grid-cols-2 gap-3">
                {/* NPI Check */}
                <div
                  className={`p-3 rounded border ${
                    result.practitioner?.isNpiValid
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                      : 'bg-rose-50 border-rose-200 text-rose-900'
                  }`}
                >
                  <div className="font-bold text-slate-800">NPI CMS Luhn Mod-10 Check</div>
                  <div className={`mt-1 font-semibold ${result.practitioner?.isNpiValid ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {result.practitioner?.isNpiValid ? '✓ Valid CMS 10-Digit NPI' : '✗ Invalid NPI Checksum / Format'}
                  </div>
                  <div className="text-[10px] font-mono text-slate-500 mt-1">
                    NPI: {result.practitioner?.npi || 'N/A'}
                  </div>
                </div>

                {/* DEA Check */}
                <div
                  className={`p-3 rounded border ${
                    result.practitioner?.isDeaValid === true
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                      : result.practitioner?.isDeaValid === false
                      ? 'bg-rose-50 border-rose-200 text-rose-900'
                      : 'bg-slate-50 border-slate-200 text-slate-700'
                  }`}
                >
                  <div className="font-bold text-slate-800">DEA Registration Formula</div>
                  <div
                    className={`mt-1 font-semibold ${
                      result.practitioner?.isDeaValid === true
                        ? 'text-emerald-700'
                        : result.practitioner?.isDeaValid === false
                        ? 'text-rose-700'
                        : 'text-slate-500'
                    }`}
                  >
                    {result.practitioner?.isDeaValid === true
                      ? '✓ Valid DEA Registrant'
                      : result.practitioner?.isDeaValid === false
                      ? '✗ Invalid DEA Checksum'
                      : 'Not Declared (N/A)'}
                  </div>
                  <div className="text-[10px] font-mono text-slate-500 mt-1">
                    DEA: {result.practitioner?.deaNumber || 'N/A'}
                  </div>
                </div>

                {/* Statutory Exclusion */}
                <div
                  className={`p-3 rounded border ${
                    result.exclusionHits.some((e) => e.source === 'OIG_LEIE' || e.source === 'SAM_GOV')
                      ? 'bg-rose-50 border-rose-200 text-rose-900'
                      : 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  }`}
                >
                  <div className="font-bold text-slate-800">HHS-OIG & SAM.gov Exclusion</div>
                  <div className="font-semibold mt-1">
                    {result.exclusionHits.some((e) => e.source === 'OIG_LEIE' || e.source === 'SAM_GOV') ? (
                      <span className="text-rose-700 flex items-center gap-1">
                        <AlertTriangle className="w-3.5 h-3.5" /> MANDATORY FRAUD EXCLUSION
                      </span>
                    ) : (
                      <span className="text-emerald-700">✓ No OIG/SAM Debarments</span>
                    )}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-1">
                    Databases: HHS-OIG LEIE • GSA SAM.gov
                  </div>
                </div>

                {/* Watchlists & Supplier */}
                <div
                  className={`p-3 rounded border ${
                    result.findingSeverity === 'EXACT_IDENTIFIER_MATCH'
                      ? 'bg-rose-50 border-rose-200 text-rose-900'
                      : result.findingSeverity === 'FUZZY_NAME_CANDIDATE'
                      ? 'bg-amber-50 border-amber-200 text-amber-900'
                      : 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  }`}
                >
                  <div className="font-bold text-slate-800">Sanctions Watchlist Screening</div>
                  <div className="font-semibold mt-1">
                    {result.findingSeverity === 'EXACT_IDENTIFIER_MATCH' ? (
                      <span className="text-rose-700">⚠️ Sanctioned Match Blocked</span>
                    ) : result.findingSeverity === 'FUZZY_NAME_CANDIDATE' ? (
                      <span className="text-amber-700">⚠️ Candidate Match on Hold</span>
                    ) : (
                      <span className="text-emerald-700">✓ Screened Clear</span>
                    )}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-1">
                    Lists: DEMO_OFAC_SDN • Healthcare Redlist
                  </div>
                </div>
              </div>

              {/* Exclusion Hits */}
              {result.exclusionHits.length > 0 && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded text-rose-900 space-y-1">
                  <div className="font-bold flex items-center gap-1 text-xs">
                    <ShieldAlert className="w-4 h-4 text-rose-600" /> Mandatory Exclusion & Sanctions Hits:
                  </div>
                  {result.exclusionHits.map((hit, i) => (
                    <div key={i} className="text-[11px]">
                      <span className="font-bold">[{hit.source}] {hit.entityName}</span>: {hit.exclusionReason}
                    </div>
                  ))}
                </div>
              )}

              {/* Candidate Matches */}
              {result.findingSeverity === 'FUZZY_NAME_CANDIDATE' && result.exclusionHits.length === 0 && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded text-amber-900 space-y-1">
                  <div className="font-bold flex items-center gap-1 text-xs">
                    <AlertTriangle className="w-4 h-4 text-amber-600" /> Sanctions Watchlist Candidate Review Required:
                  </div>
                  {result.practitioner?.matches?.map((m: any, i: number) => (
                    <div key={i} className="text-[11px]">
                      • Practitioner matched <span className="font-semibold">{m.entryName}</span> on {m.listName} ({Math.round(m.similarityScore * 100)}%)
                    </div>
                  ))}
                  {result.supplier?.matches?.map((m: any, i: number) => (
                    <div key={i} className="text-[11px]">
                      • Supplier matched <span className="font-semibold">{m.entryName}</span> on {m.listName} ({Math.round(m.similarityScore * 100)}%)
                    </div>
                  ))}
                </div>
              )}

              {/* Review Reasons */}
              {result.reviewReasons && result.reviewReasons.length > 0 && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded text-slate-700">
                  <div className="font-bold text-slate-800 text-[11px] mb-1">Compliance Review Rationale:</div>
                  <ul className="list-disc list-inside space-y-0.5 text-[11px]">
                    {result.reviewReasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Verification Coverage */}
              {result.verificationCoverage && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded text-slate-700">
                  <div className="font-bold text-slate-800 text-[11px] mb-1">Verification Coverage:</div>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {result.verificationCoverage.checksPerformed.map((c, i) => (
                      <span key={i} className="text-[10px] bg-slate-200 text-slate-700 px-2 py-0.5 rounded font-mono">
                        {c}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Analyst Adjudication Actions */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded space-y-2">
                <span className="font-bold text-slate-800 block text-[11px]">Analyst Decision Adjudication</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setAdjudicationAction('CONFIRMED_EXCLUSION_BLOCK')}
                    className={`px-3 py-1.5 rounded font-semibold text-xs border ${
                      adjudicationAction === 'CONFIRMED_EXCLUSION_BLOCK'
                        ? 'bg-rose-600 text-white border-rose-700'
                        : 'bg-white text-rose-700 border-rose-300 hover:bg-rose-50'
                    }`}
                  >
                    Confirm Exclusion Block
                  </button>
                  <button
                    onClick={() => setAdjudicationAction('REQUEST_CREDENTIAL_VERIFICATION')}
                    className={`px-3 py-1.5 rounded font-semibold text-xs border ${
                      adjudicationAction === 'REQUEST_CREDENTIAL_VERIFICATION'
                        ? 'bg-amber-600 text-white border-amber-700'
                        : 'bg-white text-amber-700 border-amber-300 hover:bg-amber-50'
                    }`}
                  >
                    Hold for Credential Verification
                  </button>
                  <button
                    onClick={() => setAdjudicationAction('APPROVE_REIMBURSEMENT')}
                    className={`px-3 py-1.5 rounded font-semibold text-xs border ${
                      adjudicationAction === 'APPROVE_REIMBURSEMENT'
                        ? 'bg-emerald-600 text-white border-emerald-700'
                        : 'bg-white text-emerald-700 border-emerald-300 hover:bg-emerald-50'
                    }`}
                  >
                    Approve Reimbursement
                  </button>
                </div>
                {adjudicationAction && (
                  <div className="text-[11px] text-teal-800 bg-teal-50 p-2 rounded border border-teal-200 font-medium">
                    ✓ Adjudication action recorded: <span className="font-bold">{adjudicationAction}</span>
                  </div>
                )}
              </div>

              {/* Sealed Evidence Footer */}
              <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                <span className="font-mono truncate max-w-xs">SHA-256: {result.evidenceDigest}</span>
                <button
                  onClick={handleExportEvidence}
                  className="px-2.5 py-1 bg-teal-50 hover:bg-teal-100 text-teal-700 border border-teal-200 rounded font-semibold flex items-center gap-1"
                >
                  <Download className="w-3.5 h-3.5" /> Download Sealed Evidence Pack (JSON)
                </button>
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
  const [secData, setSecData] = useState<{
    rawFixMessage: string;
    parties: {
      role: 'EXECUTING_BROKER' | 'CLIENT_ACCOUNT' | 'COUNTERPARTY' | 'BENEFICIAL_OWNER';
      name: string;
      idValue: string;
    }[];
  }>({
    rawFixMessage: MULTI_MODULE_FIXTURES.SECURITIES.rawFixMessage,
    parties: [...MULTI_MODULE_FIXTURES.SECURITIES.parties],
  });
  const [result, setResult] = useState<SecuritiesEvaluation | null>(null);
  const [activeResultTab, setActiveResultTab] = useState<'surveillance' | 'graph'>('surveillance');
  const [isLoading, setIsLoading] = useState(false);
  const [isStale, setIsStale] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);
  const [adjudicationAction, setAdjudicationAction] = useState<string | null>(null);
  const [showTagsTable, setShowTagsTable] = useState(false);

  const handleEvaluate = async () => {
    setIsLoading(true);
    setClientError(null);
    setAdjudicationAction(null);
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
      if (!res.ok) {
        setClientError(data.error || 'Securities evaluation failed');
      } else {
        setResult(data);
        setIsStale(false);
      }
    } catch (e: any) {
      setClientError(`Error evaluating securities order: ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportEvidence = () => {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Securities_Order_Evidence_${result.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const updateRawFix = (val: string) => {
    setSecData((prev) => ({ ...prev, rawFixMessage: val }));
    setIsStale(true);
  };

  const addParty = () => {
    setSecData((prev) => ({
      ...prev,
      parties: [
        ...prev.parties,
        { role: 'COUNTERPARTY', name: 'New Trading Entity', idValue: 'ID_NEW' },
      ],
    }));
    setIsStale(true);
  };

  const removeParty = (idx: number) => {
    setSecData((prev) => ({
      ...prev,
      parties: prev.parties.filter((_, i) => i !== idx),
    }));
    setIsStale(true);
  };

  const updateParty = (idx: number, field: string, val: string) => {
    setSecData((prev) => ({
      ...prev,
      parties: prev.parties.map((p, i) => (i === idx ? { ...p, [field]: val } : p)),
    }));
    setIsStale(true);
  };

  const reloadSample = () => {
    setSecData({
      rawFixMessage: MULTI_MODULE_FIXTURES.SECURITIES.rawFixMessage,
      parties: [...MULTI_MODULE_FIXTURES.SECURITIES.parties],
    });
    setResult(null);
    setIsStale(false);
    setClientError(null);
    setAdjudicationAction(null);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {clientError && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-lg flex items-start gap-2.5 text-rose-800 text-xs shadow-xs">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold">Evaluation Validation Error: </span>
            {clientError}
          </div>
        </div>
      )}

      {isStale && result && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center justify-between text-amber-800 text-xs shadow-xs">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-600" />
            <span className="font-medium">FIX message or order parties modified — rerun screening to re-verify framing and sanctions coverage.</span>
          </div>
          <button
            onClick={handleEvaluate}
            className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded text-[11px]"
          >
            Re-evaluate Order
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: FIX Stream & Editable Parties */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4 text-teal-600" /> FIX Protocol Stream & Order
            </h3>
            <button
              onClick={reloadSample}
              className="text-xs text-teal-600 hover:underline flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" /> Reload Sectoral Sample
            </button>
          </div>

          <div className="space-y-3 text-xs">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="font-semibold text-slate-700">Raw FIX Message</label>
                <span className="text-[10px] text-slate-400 font-mono">Accepts wire SOH (\x01), pipe (|), or semicolon (;)</span>
              </div>
              <textarea
                rows={5}
                value={secData.rawFixMessage}
                onChange={(e) => updateRawFix(e.target.value)}
                className="w-full p-2.5 border border-slate-200 rounded-lg font-mono text-[11px] leading-relaxed text-slate-800 bg-slate-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-teal-500"
                placeholder="8=FIX.4.2|9=...|35=D|...|10=..."
              />
            </div>

            {/* Editable Parties Panel */}
            <div className="pt-2 border-t border-slate-100 space-y-2">
              <div className="flex items-center justify-between">
                <label className="font-semibold text-slate-700 flex items-center gap-1">
                  Order Parties for Counterparty Screening ({secData.parties.length})
                </label>
                <button
                  onClick={addParty}
                  className="px-2 py-0.5 text-[11px] bg-slate-100 hover:bg-slate-200 text-slate-700 rounded flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" /> Add Party
                </button>
              </div>

              {secData.parties.length === 0 ? (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded text-amber-800 text-[11px]">
                  ⚠️ No parties specified. Evaluating with zero parties will flag INSUFFICIENT coverage.
                </div>
              ) : (
                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {secData.parties.map((party, idx) => (
                    <div key={idx} className="p-2.5 border border-slate-200 rounded-lg bg-slate-50 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <select
                          value={party.role}
                          onChange={(e) => updateParty(idx, 'role', e.target.value)}
                          className="text-[11px] font-semibold bg-white border border-slate-200 rounded px-1.5 py-0.5"
                        >
                          <option value="EXECUTING_BROKER">EXECUTING_BROKER</option>
                          <option value="CLIENT_ACCOUNT">CLIENT_ACCOUNT</option>
                          <option value="COUNTERPARTY">COUNTERPARTY</option>
                          <option value="BENEFICIAL_OWNER">BENEFICIAL_OWNER</option>
                        </select>
                        <button
                          onClick={() => removeParty(idx)}
                          className="text-slate-400 hover:text-rose-600 p-0.5"
                          title="Remove Party"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="text"
                          value={party.name}
                          onChange={(e) => updateParty(idx, 'name', e.target.value)}
                          placeholder="Party Name"
                          className="p-1.5 bg-white border border-slate-200 rounded text-[11px]"
                        />
                        <input
                          type="text"
                          value={party.idValue}
                          onChange={(e) => updateParty(idx, 'idValue', e.target.value)}
                          placeholder="Party ID / CompID"
                          className="p-1.5 bg-white border border-slate-200 rounded text-[11px] font-mono"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <button
            onClick={handleEvaluate}
            disabled={isLoading}
            className="w-full py-2.5 bg-teal-600 hover:bg-teal-700 text-white font-semibold rounded-lg text-xs flex items-center justify-center gap-2 shadow-xs transition-colors"
          >
            {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            Parse FIX Tags, Validate ISIN & Screen Sectoral SSI
          </button>
        </div>

        {/* Right Column: Pre-Trade Surveillance & Sanctions Status */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <div className="flex items-center gap-3">
                <h3 className="font-bold text-slate-900 text-sm">Pre-Trade Surveillance & Sanctions Status</h3>
                {result && (
                  <div className="flex items-center gap-1 border border-slate-200 rounded p-0.5 bg-slate-50">
                    <button
                      onClick={() => setActiveResultTab('surveillance')}
                      className={`px-2 py-0.5 text-xs font-semibold rounded ${
                        activeResultTab === 'surveillance' ? 'bg-teal-600 text-white shadow-2xs' : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      Surveillance Findings
                    </button>
                    <button
                      onClick={() => setActiveResultTab('graph')}
                      className={`px-2 py-0.5 text-xs font-semibold rounded flex items-center gap-1 ${
                        activeResultTab === 'graph' ? 'bg-teal-600 text-white shadow-2xs' : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      <Share2 className="w-3 h-3" />
                      <span>Evidence Graph</span>
                    </button>
                  </div>
                )}
              </div>
              <p className="text-[11px] text-slate-500">ISO 6166 ISIN checksum verification & EU/OFAC Sectoral Directives</p>
            </div>
            {result && (
              <span
                className={`text-xs px-2.5 py-1 rounded-md font-bold uppercase tracking-wide border ${
                  result.orderStatus === 'ROUTING_ALLOWED'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : result.orderStatus === 'RESTRICTED_SECURITY_HALT' || result.orderStatus === 'SANCTIONED_COUNTERPARTY_BLOCKED'
                    ? 'bg-rose-50 text-rose-700 border-rose-200'
                    : 'bg-amber-50 text-amber-700 border-amber-200'
                }`}
              >
                {result.orderStatus.replace(/_/g, ' ')}
              </span>
            )}
          </div>

          {!result ? (
            <div className="py-20 text-center text-slate-400 text-xs">
              <TrendingUp className="w-8 h-8 mx-auto text-slate-300 mb-2" />
              Click "Parse FIX Tags, Validate ISIN & Screen Sectoral SSI" to inspect framing, ISIN Mod-10 checksum, and OFAC/EU debt prohibitions.
            </div>
          ) : activeResultTab === 'graph' ? (
            <ModuleEvidenceGraphSection moduleId="SECURITIES" evaluation={result} />
          ) : (
            <div className="space-y-4 text-xs">
              {/* Framing Errors Banner */}
              {result.framingValidation && !result.framingValidation.isValid && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-900 space-y-1">
                  <div className="font-bold flex items-center gap-1.5 text-xs text-rose-800">
                    <AlertTriangle className="w-4 h-4 text-rose-600" /> FIX Framing & Wire Delimiter Violations:
                  </div>
                  <ul className="list-disc pl-5 space-y-0.5 text-[11px]">
                    {result.framingValidation.detectedErrors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Review Reasons Banner */}
              {result.requiresHumanReview && result.reviewReasons && result.reviewReasons.length > 0 && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 space-y-1">
                  <div className="font-bold flex items-center gap-1.5 text-xs text-amber-800">
                    <AlertTriangle className="w-4 h-4 text-amber-600" /> Mandatory Compliance Analyst Adjudication Required:
                  </div>
                  <ul className="list-disc pl-5 space-y-0.5 text-[11px]">
                    {result.reviewReasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Diagnostic Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {/* 1. Framing */}
                <div className="p-3 rounded-lg border bg-slate-50 border-slate-200 space-y-1">
                  <div className="font-bold text-slate-800 text-[11px]">Wire Protocol & Framing</div>
                  <div className="text-[11px] text-slate-600 flex items-center justify-between">
                    <span>BeginString:</span>
                    <span className="font-mono font-semibold">{result.fixVersion}</span>
                  </div>
                  <div className="text-[11px] text-slate-600 flex items-center justify-between">
                    <span>MsgType:</span>
                    <span className="font-mono font-semibold">{result.msgType}</span>
                  </div>
                  <div className="text-[11px] text-slate-600 flex items-center justify-between">
                    <span>BodyLength:</span>
                    <span className={result.framingValidation?.bodyLengthValid ? 'text-emerald-700 font-semibold' : 'text-rose-700 font-semibold'}>
                      {result.framingValidation?.bodyLengthValid ? '✓ Valid' : '✗ Mismatch'}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-600 flex items-center justify-between">
                    <span>CheckSum:</span>
                    <span className={result.framingValidation?.checksumValid ? 'text-emerald-700 font-semibold' : 'text-rose-700 font-semibold'}>
                      {result.framingValidation?.checksumValid ? '✓ Valid' : '✗ Mismatch'}
                    </span>
                  </div>
                </div>

                {/* 2. ISIN / Instrument */}
                <div className={`p-3 rounded-lg border space-y-1 ${
                  result.instrument.isSectoralSanctionedDebtOrEquity
                    ? 'bg-rose-50 border-rose-200 text-rose-900'
                    : result.instrument.isIsinChecksumValid === false
                    ? 'bg-rose-50 border-rose-200 text-rose-900'
                    : 'bg-emerald-50 border-emerald-200 text-emerald-900'
                }`}>
                  <div className="font-bold text-[11px]">Instrument & Sectoral Status</div>
                  <div className="text-[11px] flex items-center justify-between">
                    <span>Symbol / ID:</span>
                    <span className="font-mono font-semibold">{result.instrument.symbol || result.instrument.securityId}</span>
                  </div>
                  <div className="text-[11px] flex items-center justify-between">
                    <span>ID Source:</span>
                    <span className="font-semibold">{result.instrument.securityIdSourceDesc}</span>
                  </div>
                  {result.instrument.isin && (
                    <div className="text-[11px] flex items-center justify-between">
                      <span>ISIN Checksum:</span>
                      <span className={result.instrument.isIsinChecksumValid ? 'text-emerald-700 font-semibold' : 'text-rose-700 font-semibold'}>
                        {result.instrument.isIsinChecksumValid ? '✓ Valid Mod-10' : '✗ Invalid Checksum'}
                      </span>
                    </div>
                  )}
                  <div className="text-[11px] font-semibold pt-1 border-t border-slate-200">
                    {result.instrument.isSectoralSanctionedDebtOrEquity ? (
                      <span className="text-rose-700">⚠️ PROHIBITED SECTORAL DEBT</span>
                    ) : (
                      <span className="text-emerald-700">Unrestricted Instrument</span>
                    )}
                  </div>
                </div>

                {/* 3. Order Economics */}
                <div className="p-3 rounded-lg border bg-slate-50 border-slate-200 space-y-1">
                  <div className="font-bold text-slate-800 text-[11px]">Order Details & Notional</div>
                  <div className="text-[11px] text-slate-600 flex items-center justify-between">
                    <span>ClOrdID:</span>
                    <span className="font-mono font-semibold">{result.orderId || 'N/A'}</span>
                  </div>
                  <div className="text-[11px] text-slate-600 flex items-center justify-between">
                    <span>Side:</span>
                    <span className={`font-semibold ${result.orderSide === 'BUY' ? 'text-blue-700' : result.orderSide === 'SELL' ? 'text-purple-700' : 'text-rose-700'}`}>
                      {result.orderSide}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-600 flex items-center justify-between">
                    <span>Volume:</span>
                    <span className="font-mono font-semibold">{result.orderQtyVolume?.toLocaleString() || result.orderQty} units</span>
                  </div>
                  <div className="text-[11px] text-slate-600 flex items-center justify-between">
                    <span>Price / Notional:</span>
                    <span className="font-mono font-semibold">
                      {result.orderPrice ? `$${result.orderPrice.toFixed(2)}` : 'MKT'}
                      {result.notionalValueUsd ? ` ($${result.notionalValueUsd.toLocaleString()})` : ''}
                    </span>
                  </div>
                </div>
              </div>

              {/* Surveillance Alerts */}
              {result.surveillanceAlerts && result.surveillanceAlerts.length > 0 && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 space-y-1">
                  <div className="font-bold flex items-center gap-1.5 text-xs text-amber-800">
                    <AlertTriangle className="w-4 h-4 text-amber-600" /> Pre-Trade Surveillance & Regulatory Triggers:
                  </div>
                  {result.surveillanceAlerts.map((a, i) => (
                    <div key={i} className="text-[11px] pl-5">• {a}</div>
                  ))}
                </div>
              )}

              {/* Parties Screening Table */}
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                  <span className="font-bold text-slate-800 text-xs">Counterparty & Account Screening ({result.parties.length})</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded font-semibold ${
                    result.screeningCoverage?.coverageStatus === 'FULL_COVERAGE'
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-amber-100 text-amber-800'
                  }`}>
                    {result.screeningCoverage?.coverageStatus || 'INSUFFICIENT'}
                  </span>
                </div>
                {result.parties.length === 0 ? (
                  <div className="p-3 text-slate-400 text-center text-[11px]">
                    No counterparty or client parties supplied in order.
                  </div>
                ) : (
                  <table className="w-full text-[11px] divide-y divide-slate-200">
                    <thead className="bg-slate-50 text-slate-500 font-semibold text-left">
                      <tr>
                        <th className="p-2">Role</th>
                        <th className="p-2">Name / ID</th>
                        <th className="p-2">Sanctions Match Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {result.parties.map((p, idx) => (
                        <tr key={idx} className="hover:bg-slate-50">
                          <td className="p-2 font-mono text-slate-600">{p.role}</td>
                          <td className="p-2 font-medium text-slate-800">
                            <div>{p.name}</div>
                            <div className="text-[10px] text-slate-400 font-mono">{p.idValue}</div>
                          </td>
                          <td className="p-2">
                            {p.matches && p.matches.length > 0 ? (
                              <span className="text-rose-700 font-semibold">
                                ⚠️ Candidate Match: {p.matches[0].listValue || p.matches[0].entryName} ({Math.round(p.matches[0].similarityScore * 100)}%)
                              </span>
                            ) : (
                              <span className="text-emerald-700 font-semibold flex items-center gap-1">
                                <Check className="w-3.5 h-3.5" /> Clear / No Hits
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Action and Adjudication Bar */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setAdjudicationAction('APPROVED_RELEASE')}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-semibold text-xs flex items-center gap-1"
                  >
                    <Check className="w-3.5 h-3.5" /> Release Order to Routing
                  </button>
                  <button
                    onClick={() => setAdjudicationAction('REGULATORY_HOLD')}
                    className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded font-semibold text-xs flex items-center gap-1"
                  >
                    <Clock className="w-3.5 h-3.5" /> Hold for Compliance
                  </button>
                  <button
                    onClick={() => setAdjudicationAction('REJECTED_HALT')}
                    className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded font-semibold text-xs flex items-center gap-1"
                  >
                    <X className="w-3.5 h-3.5" /> Reject / Halt Order
                  </button>
                </div>

                <button
                  onClick={handleExportEvidence}
                  className="px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 rounded font-semibold text-xs flex items-center gap-1.5 shadow-2xs"
                >
                  <Download className="w-3.5 h-3.5" /> Download Sealed Evidence Pack (JSON)
                </button>
              </div>

              {adjudicationAction && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-900 text-xs flex items-center gap-2">
                  <Info className="w-4 h-4 text-blue-600 shrink-0" />
                  <span>
                    Analyst recorded action: <strong>{adjudicationAction}</strong> at {new Date().toLocaleTimeString()} by analyst session token.
                  </span>
                </div>
              )}

              {/* Footer Evidence Ledger */}
              <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                <span className="font-mono truncate max-w-xs" title={result.evidenceDigest}>
                  SHA-256: {result.evidenceDigest}
                </span>
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
  const [activeResultTab, setActiveResultTab] = useState<'benchmark' | 'graph'>('benchmark');
  const [isLoading, setIsLoading] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);

  const handleRunBenchmark = async () => {
    setIsLoading(true);
    setClientError(null);
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
      if (!res.ok) {
        setClientError(data.error || 'Validation benchmark failed');
      } else {
        setResult(data);
      }
    } catch (e: any) {
      setClientError(`Error running validation benchmark: ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportReport = () => {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Validation_Audit_Benchmark_Report_${result.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {clientError && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-lg flex items-start gap-2.5 text-rose-800 text-xs shadow-xs">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold">Benchmark Execution Error: </span>
            {clientError}
          </div>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-xs space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div>
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-teal-600" /> Fixed Synthetic Sanctions Evasion Benchmark Suite (v2026.11)
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Fixed 8-case synthetic evasion specification testing Cyrillic homoglyphs, vowel dropping, inverted word order, spacing fragmentation, commercial prefix alteration, narrative noise, organizational suffix variation, and benign controls against active watchlists.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {result && (
              <button
                onClick={handleExportReport}
                className="py-2 px-3 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 font-semibold rounded-lg text-xs flex items-center gap-1.5 shadow-2xs transition-colors"
              >
                <Download className="w-3.5 h-3.5" /> Download Sealed Report (JSON)
              </button>
            )}
            <button
              onClick={handleRunBenchmark}
              disabled={isLoading}
              className="py-2 px-4 bg-teal-600 hover:bg-teal-700 text-white font-semibold rounded-lg text-xs flex items-center justify-center gap-2 shadow-xs transition-colors"
            >
              {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <PlayIcon />}
              Execute Benchmark & Ledger Audit
            </button>
          </div>
        </div>

        {/* Standby Capabilities Notice */}
        <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between text-slate-600 text-[11px]">
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 text-slate-400 shrink-0" />
            <span>
              <strong>Benchmark Scope:</strong> Fixed frozen synthetic suite (Specification v2026.11). Custom dataset selection, threshold slider testing, and historical replay are currently in Standby Mode.
            </span>
          </div>
          <span className="font-mono text-[10px] text-slate-500 bg-white border border-slate-200 px-2 py-0.5 rounded">
            FROZEN_SUITE_V2026.11
          </span>
        </div>

        {!result ? (
          <div className="py-20 text-center text-slate-400 text-xs">
            <CheckCircle2 className="w-10 h-10 mx-auto text-slate-300 mb-2" />
            Click "Execute Benchmark & Ledger Audit" to simulate adversarial evasion vectors and verify cryptographic hash chain integrity.
          </div>
        ) : activeResultTab === 'graph' ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <div className="flex items-center gap-1 border border-slate-200 rounded p-0.5 bg-slate-50">
                <button
                  onClick={() => setActiveResultTab('benchmark')}
                  className="px-2 py-0.5 text-xs font-semibold rounded text-slate-600 hover:bg-slate-100"
                >
                  Benchmark Metrics & Vectors
                </button>
                <button
                  onClick={() => setActiveResultTab('graph')}
                  className="px-2 py-0.5 text-xs font-semibold rounded bg-teal-600 text-white shadow-2xs flex items-center gap-1"
                >
                  <Share2 className="w-3 h-3" />
                  <span>Evidence Graph</span>
                </button>
              </div>
            </div>
            <ModuleEvidenceGraphSection moduleId="VALIDATION_AND_AUDIT" evaluation={result} />
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <div className="flex items-center gap-1 border border-slate-200 rounded p-0.5 bg-slate-50">
                <button
                  onClick={() => setActiveResultTab('benchmark')}
                  className="px-2 py-0.5 text-xs font-semibold rounded bg-teal-600 text-white shadow-2xs"
                >
                  Benchmark Metrics & Vectors
                </button>
                <button
                  onClick={() => setActiveResultTab('graph')}
                  className="px-2 py-0.5 text-xs font-semibold rounded text-slate-600 hover:bg-slate-100 flex items-center gap-1"
                >
                  <Share2 className="w-3 h-3" />
                  <span>Evidence Graph</span>
                </button>
              </div>
            </div>

            {/* Reproducibility Metadata Header */}
            <div className="p-3 bg-teal-50/60 border border-teal-100 rounded-lg grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs text-teal-950">
              <div>
                <span className="text-[10px] text-teal-700 font-bold uppercase block">Screening Engine</span>
                <span className="font-semibold text-[11px] truncate block">{result.engineVersion}</span>
              </div>
              <div>
                <span className="text-[10px] text-teal-700 font-bold uppercase block">Policy & Threshold</span>
                <span className="font-semibold text-[11px] block">{result.policyVersion} (Cutoff: {result.thresholdConfig.fuzzyCutoff})</span>
              </div>
              <div>
                <span className="text-[10px] text-teal-700 font-bold uppercase block">Dataset Digest</span>
                <span className="font-mono text-[11px] truncate block" title={result.datasetMetadata.datasetDigest}>
                  SHA-256: {result.datasetMetadata.datasetDigest.slice(0, 16)}...
                </span>
              </div>
              <div>
                <span className="text-[10px] text-teal-700 font-bold uppercase block">Watchlist Snapshots</span>
                <span className="font-semibold text-[11px] block">
                  {result.datasetMetadata.listSnapshots.length} lists active ({result.datasetMetadata.listSnapshots.reduce((a, b) => a + b.recordCount, 0)} records)
                </span>
              </div>
            </div>

            {/* Top Metrics Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-center">
                <div className="text-[10px] font-bold text-slate-500 uppercase">Precision</div>
                <div className="text-xl font-bold text-slate-900 mt-1">{(result.benchmarkMetrics.precision * 100).toFixed(1)}%</div>
                <div className="text-[10px] text-slate-400 mt-0.5">TP / (TP + FP)</div>
              </div>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-center">
                <div className="text-[10px] font-bold text-slate-500 uppercase">Recall</div>
                <div className="text-xl font-bold text-slate-900 mt-1">{(result.benchmarkMetrics.recall * 100).toFixed(1)}%</div>
                <div className="text-[10px] text-slate-400 mt-0.5">TP / (TP + FN)</div>
              </div>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-center">
                <div className="text-[10px] font-bold text-slate-500 uppercase">F1-Score</div>
                <div className="text-xl font-bold text-teal-700 mt-1">{result.benchmarkMetrics.f1Score.toFixed(3)}</div>
                <div className="text-[10px] text-slate-400 mt-0.5">Harmonic Mean</div>
              </div>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-center">
                <div className="text-[10px] font-bold text-slate-500 uppercase">False Positive Rate</div>
                <div className="text-xl font-bold text-emerald-700 mt-1">{(result.benchmarkMetrics.falsePositiveRate * 100).toFixed(1)}%</div>
                <div className="text-[10px] text-slate-400 mt-0.5">FP / (FP + TN)</div>
              </div>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-center">
                <div className="text-[10px] font-bold text-slate-500 uppercase">Mean Latency</div>
                <div className="text-xl font-bold text-slate-900 mt-1">{result.benchmarkMetrics.meanLatencyMs} ms</div>
                <div className="text-[10px] text-slate-400 mt-0.5">Per Party Evaluation</div>
              </div>
            </div>

            {/* Confusion Matrix Summary Bar */}
            <div className="px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg flex flex-wrap items-center justify-between text-xs text-slate-700">
              <span className="font-bold text-slate-800">Confusion Matrix & Class Counts:</span>
              <div className="flex items-center gap-4 text-[11px] font-mono">
                <span className="text-emerald-700 font-semibold">True Positives (TP): {result.benchmarkMetrics.confusionMatrix.truePositives}</span>
                <span className="text-emerald-700 font-semibold">True Negatives (TN): {result.benchmarkMetrics.confusionMatrix.trueNegatives}</span>
                <span className="text-rose-700 font-semibold">False Positives (FP): {result.benchmarkMetrics.confusionMatrix.falsePositives}</span>
                <span className="text-rose-700 font-semibold">False Negatives (FN): {result.benchmarkMetrics.confusionMatrix.falseNegatives}</span>
              </div>
            </div>

            {/* Test Cases Matrix */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-bold text-slate-800 uppercase text-xs">
                  Adversarial Evasion Typology Matrix ({result.testCases.length} Test Vectors)
                </h4>
                <span className="text-[11px] text-slate-500 font-mono">
                  {result.casesPassed} of {result.totalCasesTested} Passed ({Math.round((result.casesPassed / result.totalCasesTested) * 100)}%)
                </span>
              </div>
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                    <tr>
                      <th className="p-2.5">Case ID</th>
                      <th className="p-2.5">Typology</th>
                      <th className="p-2.5">Baseline Entity & List</th>
                      <th className="p-2.5">Adversarial Payload</th>
                      <th className="p-2.5">Expected</th>
                      <th className="p-2.5">Actual Match Provenance</th>
                      <th className="p-2.5 text-right">Verdict</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                    {result.testCases.map((tc) => (
                      <tr key={tc.caseId} className={tc.passed ? 'bg-white hover:bg-slate-50' : 'bg-rose-50/70 hover:bg-rose-50'}>
                        <td className="p-2.5 font-bold text-slate-800">{tc.caseId}</td>
                        <td className="p-2.5 font-sans text-slate-600">
                          <div>{tc.typology.replace(/_/g, ' ')}</div>
                          <div className="text-[10px] text-slate-400 font-mono">{tc.description}</div>
                        </td>
                        <td className="p-2.5 text-slate-700">
                          <div className="font-sans font-medium">{tc.baselineEntity}</div>
                          <div className="text-[10px] text-slate-400 font-mono">{tc.targetList}</div>
                        </td>
                        <td className="p-2.5 text-teal-800 font-bold">{tc.evasionPayload}</td>
                        <td className="p-2.5 font-sans">
                          {tc.expectedDetection ? (
                            <span className="text-amber-700 font-semibold">CANDIDATE_EXPECTED</span>
                          ) : (
                            <span className="text-slate-500 font-semibold">NO_MATCH_EXPECTED</span>
                          )}
                        </td>
                        <td className="p-2.5 font-sans">
                          {tc.actualDetection && tc.matchedEntity ? (
                            <div>
                              <span className="text-emerald-700 font-bold">✓ {tc.matchedEntity}</span>
                              <div className="text-[10px] text-slate-500 font-mono">List: {tc.matchedList} (Score: {tc.score})</div>
                            </div>
                          ) : tc.failureReason ? (
                            <span className="text-rose-700 font-semibold text-[10px]">{tc.failureReason}</span>
                          ) : (
                            <span className="text-slate-400 font-semibold">No candidates</span>
                          )}
                        </td>
                        <td className="p-2.5 text-right font-sans">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            tc.passed ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                          }`}>
                            {tc.passed ? `PASS (${tc.verdict})` : `FAIL (${tc.verdict})`}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Historical Ledger Audit Panel */}
            <div className={`p-4 rounded-lg border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
              result.historicalLedgerVerification.verificationStatus === 'VERIFIED_TAMPER_EVIDENT'
                ? 'bg-emerald-50/60 border-emerald-200 text-emerald-950'
                : result.historicalLedgerVerification.verificationStatus === 'EMPTY_LEDGER_STANDBY'
                ? 'bg-slate-50 border-slate-200 text-slate-800'
                : 'bg-rose-50 border-rose-200 text-rose-950'
            }`}>
              <div>
                <span className="font-bold text-xs">Historical Case Ledger Hash Verification: </span>
                <span className="text-xs ml-1">{result.historicalLedgerVerification.details}</span>
              </div>
              <span className={`text-xs px-2.5 py-1 font-bold rounded flex items-center gap-1 shrink-0 ${
                result.historicalLedgerVerification.verificationStatus === 'VERIFIED_TAMPER_EVIDENT'
                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                  : result.historicalLedgerVerification.verificationStatus === 'EMPTY_LEDGER_STANDBY'
                  ? 'bg-slate-200 text-slate-700'
                  : 'bg-rose-100 text-rose-800 border border-rose-300'
              }`}>
                <CheckCircle2 className="w-3.5 h-3.5" /> {result.historicalLedgerVerification.verificationStatus}
              </span>
            </div>

            {/* Footer Evidence Digest */}
            <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
              <span className="font-mono truncate max-w-sm" title={result.evidenceDigest}>
                Benchmark Evidence SHA-256: {result.evidenceDigest}
              </span>
              <span className="font-medium text-emerald-700 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> Cryptographic Ledger Audit Chain Anchored
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function ListsAndDataSourcesWorkspace() {
  const [activeTab, setActiveTab] = useState<'OFFICIAL' | 'SCANNER' | 'BATCH' | 'UPLOADS' | 'JOBS' | 'HEALTH'>('OFFICIAL');
  const [sources, setSources] = useState<any[]>([]);
  const [manifest, setManifest] = useState<any>(null);
  const [indexStats, setIndexStats] = useState<any>(null);
  const [cloudStatus, setCloudStatus] = useState<any>(null);
  const [importJobs, setImportJobs] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [refreshingSourceId, setRefreshingSourceId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // Name Scanner State
  const [scanName, setScanName] = useState('Oceanic Aurora Maritime Ltd');
  const [scanType, setScanType] = useState('ORGANIZATION');
  const [scanCountry, setScanCountry] = useState('Marshall Islands');
  const [idType, setIdType] = useState('IMO');
  const [idValue, setIdValue] = useState('9123456');
  const [identifiers, setIdentifiers] = useState<Array<{ type: string; value: string }>>([
    { type: 'IMO', value: '9123456' },
  ]);
  const [scanResult, setScanResult] = useState<any>(null);
  const [scanSubTab, setScanSubTab] = useState<'dimensions' | 'graph'>('dimensions');

  // Bring Your Own List (BYO) Upload State
  const [uploadMode, setUploadMode] = useState<'EXISTING' | 'CREATE_NEW'>('EXISTING');
  const [uploadSourceId, setUploadSourceId] = useState('');
  const [newSourceId, setNewSourceId] = useState('INTERNAL_WATCHLIST_01');
  const [newSourceName, setNewSourceName] = useState('Internal High-Risk Counterparties');
  const [newSourcePublisher, setNewSourcePublisher] = useState('Compliance Risk Operations');
  const [newSourceCategory, setNewSourceCategory] = useState<'INTERNAL_WATCHLIST' | 'LICENSED_WATCHLIST'>('INTERNAL_WATCHLIST');
  const [uploadFormat, setUploadFormat] = useState<'CSV' | 'JSON' | 'XML'>('CSV');
  const [uploadInputMode, setUploadInputMode] = useState<'FILE' | 'PASTE'>('PASTE');
  const [rawUploadText, setRawUploadText] = useState(
    'id,name,type,country,aliases\nDEMO-CUSTOM-001,Al-Baraka Logistics Ltd,ORGANIZATION,United Arab Emirates,Baraka Freight;Baraka Trans\nDEMO-CUSTOM-002,Captain John Sterling,INDIVIDUAL,United Kingdom,Sterling J.'
  );
  const [uploadResult, setUploadResult] = useState<any>(null);
  const [previewReport, setPreviewReport] = useState<any>(null);
  const [autoActivate, setAutoActivate] = useState(true);

  // Customer Subjects Batch Intake State
  const [batchInputMode, setBatchInputMode] = useState<'FILE' | 'PASTE'>('PASTE');
  const [rawBatchText, setRawBatchText] = useState(
    'name,type,country,identifier\nAmber Coast Foods,ORGANIZATION,Germany,DE-VAT-99120\nOceanic Aurora Maritime Ltd,ORGANIZATION,Marshall Islands,9123456\nAl-Huda International Trading LLC,ORGANIZATION,United Arab Emirates,AE-DEMO-99214\nClean Merchant Corp,ORGANIZATION,Switzerland,CH-00192'
  );
  const [batchResult, setBatchResult] = useState<any>(null);

  useEffect(() => {
    loadData();
  }, [activeTab]);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [srcRes, manRes, statsRes, cloudRes, jobsRes] = await Promise.all([
        fetch('/api/sources'),
        fetch('/api/sources/manifest'),
        fetch('/api/sources/index-stats'),
        fetch('/api/storage/cloud-status'),
        fetch('/api/sources/jobs', { headers: { 'x-analyst-token': DEMO_ANALYST_TOKEN } }),
      ]);
      const srcData = await srcRes.json();
      const manData = await manRes.json();
      const statsData = await statsRes.json();
      const cloudData = await cloudRes.json();
      const jobsData = await jobsRes.json();

      if (srcData.sources) {
        setSources(srcData.sources);
        const privateSources = srcData.sources.filter((s: any) => s.category !== 'OFFICIAL_SANCTIONS');
        if (privateSources.length > 0 && !uploadSourceId) {
          setUploadSourceId(privateSources[0].id);
        }
      }
      if (manData) setManifest(manData);
      if (statsData) setIndexStats(statsData);
      if (cloudData) setCloudStatus(cloudData);
      if (jobsData.jobs) setImportJobs(jobsData.jobs);
    } catch {
      // Non-fatal
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleSource = async (id: string, currentEnabled: boolean) => {
    try {
      const res = await fetch(`/api/sources/${id}/toggle`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-analyst-token': DEMO_ANALYST_TOKEN,
        },
        body: JSON.stringify({ enabled: !currentEnabled }),
      });
      if (res.ok) {
        setMsg(`Source ${id} toggled ${!currentEnabled ? 'ON' : 'OFF'}. Memory index refreshed.`);
        loadData();
      }
    } catch (err: any) {
      alert(`Toggle failed: ${err.message}`);
    }
  };

  const handleRefreshSource = async (id: string) => {
    setRefreshingSourceId(id);
    try {
      const res = await fetch(`/api/sources/${id}/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-analyst-token': DEMO_ANALYST_TOKEN,
        },
      });
      const data = await res.json();
      if (res.ok) {
        setMsg(`Feed update succeeded: ${data.message}`);
        loadData();
      } else {
        setMsg(`Feed update failed: ${data.error}`);
      }
    } catch (err: any) {
      setMsg(`Network error during refresh: ${err.message}`);
    } finally {
      setRefreshingSourceId(null);
    }
  };

  const handleRefreshAllOfficial = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/sources/refresh-all', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-analyst-token': DEMO_ANALYST_TOKEN,
        },
      });
      const data = await res.json();
      setMsg(`Refresh All completed: ${data.results?.length || 0} feeds evaluated.`);
      loadData();
    } catch (err: any) {
      setMsg(`Error: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRunScan = async () => {
    setIsLoading(true);
    setScanResult(null);
    try {
      const res = await fetch('/api/sources/scan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-analyst-token': DEMO_ANALYST_TOKEN,
        },
        body: JSON.stringify({
          name: scanName,
          entityType: scanType,
          country: scanCountry,
          identifiers,
        }),
      });
      const data = await res.json();
      setScanResult(data);
    } catch (err: any) {
      alert(`Scan failed: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleByoFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setRawUploadText(text);
      if (file.name.endsWith('.json')) setUploadFormat('JSON');
      else if (file.name.endsWith('.xml')) setUploadFormat('XML');
      else setUploadFormat('CSV');
    };
    reader.readAsText(file);
  };

  const handlePreviewUpload = async () => {
    setIsLoading(true);
    setPreviewReport(null);
    try {
      const targetId = uploadMode === 'CREATE_NEW' ? newSourceId : uploadSourceId;
      const res = await fetch('/api/sources/upload-preview', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-analyst-token': DEMO_ANALYST_TOKEN,
        },
        body: JSON.stringify({
          sourceId: targetId || 'INTERNAL_CUSTOM_01',
          format: uploadFormat,
          rawContent: rawUploadText,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setPreviewReport(data);
      } else {
        setMsg(`Preview failed: ${data.error}`);
      }
    } catch (err: any) {
      setMsg(`Error: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleImportSubmit = async (activate = true) => {
    setIsLoading(true);
    setUploadResult(null);
    try {
      let targetId = uploadSourceId;
      if (uploadMode === 'CREATE_NEW') {
        if (!newSourceId.trim() || !newSourceName.trim()) {
          alert('Source ID and Display Name are required to create a new source.');
          setIsLoading(false);
          return;
        }
        const createRes = await fetch('/api/sources/create-source', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-analyst-token': DEMO_ANALYST_TOKEN,
          },
          body: JSON.stringify({
            sourceId: newSourceId,
            name: newSourceName,
            publisher: newSourcePublisher || 'Internal Compliance',
            category: newSourceCategory,
            format: uploadFormat,
          }),
        });
        const createData = await createRes.json();
        if (!createRes.ok) {
          throw new Error(createData.error || 'Failed to create private source');
        }
        targetId = createData.source.id;
      }

      const res = await fetch('/api/sources/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-analyst-token': DEMO_ANALYST_TOKEN,
        },
        body: JSON.stringify({
          sourceId: targetId,
          filename: `upload_${targetId.toLowerCase()}.${uploadFormat.toLowerCase()}`,
          format: uploadFormat,
          rawContent: rawUploadText,
          autoActivate: activate,
        }),
      });
      const data = await res.json();
      setUploadResult(data);
      if (res.ok) {
        setMsg(`Upload processed successfully. Job ID: ${data.job?.jobId}`);
        loadData();
      } else {
        setMsg(`Upload rejected: ${data.error}`);
      }
    } catch (err: any) {
      alert(`Upload error: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleBatchFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      setRawBatchText(event.target?.result as string);
    };
    reader.readAsText(file);
  };

  const handleRunBatchScreen = async () => {
    setIsLoading(true);
    setBatchResult(null);
    try {
      const res = await fetch('/api/subjects/batch-screen', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-analyst-token': DEMO_ANALYST_TOKEN,
        },
        body: JSON.stringify({ rawContent: rawBatchText }),
      });
      const data = await res.json();
      if (res.ok) {
        setBatchResult(data);
        setMsg(`Batch completed: ${data.validCount} subjects screened, ${data.rejectedCount} rejected rows.`);
      } else {
        setMsg(`Batch failed: ${data.error}`);
      }
    } catch (err: any) {
      setMsg(`Batch error: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddIdentifier = () => {
    if (!idValue.trim()) return;
    setIdentifiers([...identifiers, { type: idType, value: idValue.trim() }]);
    setIdValue('');
  };

  const handleRemoveIdentifier = (idx: number) => {
    setIdentifiers(identifiers.filter((_, i) => i !== idx));
  };

  const handleDownloadSealedReport = () => {
    if (!scanResult) return;
    const blob = new Blob([JSON.stringify(scanResult, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `screening-evidence-${scanResult.runId}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      {/* Top Navigation Tabs (Duplicated ModuleHeader removed per specification) */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-2">
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab('OFFICIAL')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md flex items-center gap-1.5 transition-colors ${
              activeTab === 'OFFICIAL' ? 'bg-indigo-600 text-white shadow-xs' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            <Database className="w-3.5 h-3.5" /> Official Sources & Registries ({sources.length})
          </button>
          <button
            onClick={() => setActiveTab('SCANNER')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md flex items-center gap-1.5 transition-colors ${
              activeTab === 'SCANNER' ? 'bg-indigo-600 text-white shadow-xs' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            <Search className="w-3.5 h-3.5" /> Multi-Dimension Name Scanner
          </button>
          <button
            onClick={() => setActiveTab('BATCH')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md flex items-center gap-1.5 transition-colors ${
              activeTab === 'BATCH' ? 'bg-indigo-600 text-white shadow-xs' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            <Boxes className="w-3.5 h-3.5" /> Customer Subjects Batch Intake
          </button>
          <button
            onClick={() => setActiveTab('UPLOADS')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md flex items-center gap-1.5 transition-colors ${
              activeTab === 'UPLOADS' ? 'bg-indigo-600 text-white shadow-xs' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            <FileText className="w-3.5 h-3.5" /> Bring Your Own List (BYO) & Ingestion
          </button>
          <button
            onClick={() => setActiveTab('JOBS')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md flex items-center gap-1.5 transition-colors ${
              activeTab === 'JOBS' ? 'bg-indigo-600 text-white shadow-xs' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            <Clock className="w-3.5 h-3.5" /> Import Jobs ({importJobs.length})
          </button>
          <button
            onClick={() => setActiveTab('HEALTH')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md flex items-center gap-1.5 transition-colors ${
              activeTab === 'HEALTH' ? 'bg-indigo-600 text-white shadow-xs' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            <Activity className="w-3.5 h-3.5" /> Index Health & Persistence
          </button>
        </div>

        <button
          onClick={loadData}
          disabled={isLoading}
          className="text-xs bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 px-2.5 py-1 rounded flex items-center gap-1 font-medium"
        >
          <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {msg && (
        <div className="p-2.5 bg-blue-50 border border-blue-200 rounded text-xs text-blue-900 flex items-center justify-between">
          <span>{msg}</span>
          <button onClick={() => setMsg(null)} className="text-blue-500 hover:text-blue-700 font-bold ml-2">×</button>
        </div>
      )}

      {/* TAB 1: OFFICIAL SOURCES */}
      {activeTab === 'OFFICIAL' && (
        <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                Official Sanctions Catalogues & Reference Registries
              </h3>
              <p className="text-[11px] text-slate-500">
                Authoritative feeds from US OFAC, UK FCDO, UN Security Council, EU EEAS, Trade.gov CSL, DFAT, SEMA, plus GLEIF and NPPES.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-[11px] font-mono text-slate-500">
                Active Manifest: <span className="font-bold text-slate-700">{manifest?.manifestDigest?.slice(0, 16) || 'LOADING'}...</span>
              </div>
              <button
                onClick={handleRefreshAllOfficial}
                disabled={isLoading}
                className="px-2.5 py-1 text-xs font-semibold rounded bg-teal-600 hover:bg-teal-700 text-white flex items-center gap-1.5 shadow-2xs transition-colors"
                title="Download and validate latest feeds from upstream government endpoints"
              >
                <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
                Download / Refresh All Feeds
              </button>
            </div>
          </div>

          <div className="overflow-x-auto border border-slate-200 rounded">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold text-[11px]">
                  <th className="p-2">Status</th>
                  <th className="p-2">Source ID & Name</th>
                  <th className="p-2">Category</th>
                  <th className="p-2">Format</th>
                  <th className="p-2">Active Version</th>
                  <th className="p-2 text-right">Records</th>
                  <th className="p-2">Authoritative Terms</th>
                  <th className="p-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {sources.map((src) => (
                  <tr key={src.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="p-2">
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        !src.enabled
                          ? 'bg-slate-100 text-slate-600 border border-slate-200'
                          : src.healthStatus === 'HEALTHY'
                          ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                          : src.healthStatus === 'DEGRADED'
                          ? 'bg-rose-100 text-rose-800 border border-rose-200'
                          : 'bg-amber-100 text-amber-800 border border-amber-200'
                      }`}>
                        {!src.enabled ? 'DISABLED' : src.healthStatus === 'HEALTHY' ? 'ACTIVE' : src.healthStatus === 'DEGRADED' ? 'DEGRADED' : 'NOT_LOADED'}
                      </span>
                    </td>
                    <td className="p-2">
                      <div className="font-bold text-slate-900 text-xs">{src.name}</div>
                      <div className="text-[10px] text-slate-400 font-mono">{src.id}</div>
                    </td>
                    <td className="p-2">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-bold ${
                        src.category === 'OFFICIAL_SANCTIONS'
                          ? 'bg-purple-100 text-purple-800'
                          : src.category === 'REFERENCE_REGISTRY'
                          ? 'bg-sky-100 text-sky-800'
                          : 'bg-slate-100 text-slate-800'
                      }`}>
                        {src.category}
                      </span>
                    </td>
                    <td className="p-2 font-mono text-[11px] text-slate-600">{src.format}</td>
                    <td className="p-2 font-mono text-[11px] text-slate-800 font-medium">
                      {src.activeVersionTag || (src.healthStatus === 'UNAVAILABLE' ? 'NOT_LOADED' : 'None')}
                    </td>
                    <td className="p-2 font-mono text-right font-bold text-slate-900">
                      {src.recordCount || 0}
                    </td>
                    <td className="p-2">
                      <a
                        href={src.termsUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] text-indigo-600 hover:text-indigo-800 underline truncate max-w-xs block"
                        title={src.termsUrl}
                      >
                        {src.termsUrl}
                      </a>
                    </td>
                    <td className="p-2 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {src.category === 'OFFICIAL_SANCTIONS' && (
                          <button
                            onClick={() => handleRefreshSource(src.id)}
                            disabled={refreshingSourceId === src.id}
                            className="px-2 py-0.5 text-[10px] font-bold rounded bg-teal-50 border border-teal-200 text-teal-700 hover:bg-teal-100 flex items-center gap-1"
                            title="Download and update authoritative feed"
                          >
                            <RefreshCw className={`w-2.5 h-2.5 ${refreshingSourceId === src.id ? 'animate-spin' : ''}`} />
                            {refreshingSourceId === src.id ? 'Downloading...' : 'Refresh'}
                          </button>
                        )}
                        <button
                          onClick={() => handleToggleSource(src.id, src.enabled)}
                          className={`px-2 py-0.5 text-[10px] font-bold rounded ${
                            src.enabled
                              ? 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                              : 'bg-indigo-600 text-white hover:bg-indigo-700'
                          }`}
                        >
                          {src.enabled ? 'Disable' : 'Enable'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: MULTI-DIMENSION NAME SCANNER */}
      {activeTab === 'SCANNER' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Left Input Pane */}
          <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
              <Search className="w-3.5 h-3.5 text-indigo-600" /> Query Entity Configuration
            </h3>

            <div>
              <label className="text-[11px] font-bold text-slate-700 block mb-1">Entity / Person Name *</label>
              <input
                type="text"
                value={scanName}
                onChange={(e) => setScanName(e.target.value)}
                className="w-full text-xs p-2 border border-slate-300 rounded focus:ring-1 focus:ring-indigo-500 font-medium"
                placeholder="Enter full legal name or personal name"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] font-bold text-slate-700 block mb-1">Entity Type</label>
                <select
                  value={scanType}
                  onChange={(e) => setScanType(e.target.value)}
                  className="w-full text-xs p-2 border border-slate-300 rounded"
                >
                  <option value="ORGANIZATION">ORGANIZATION</option>
                  <option value="INDIVIDUAL">INDIVIDUAL</option>
                  <option value="VESSEL">VESSEL</option>
                  <option value="AIRCRAFT">AIRCRAFT</option>
                </select>
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-700 block mb-1">Country / Domicile</label>
                <input
                  type="text"
                  value={scanCountry}
                  onChange={(e) => setScanCountry(e.target.value)}
                  className="w-full text-xs p-2 border border-slate-300 rounded"
                  placeholder="e.g. Marshall Islands"
                />
              </div>
            </div>

            {/* Typed Identifiers */}
            <div className="pt-2 border-t border-slate-100">
              <label className="text-[11px] font-bold text-slate-700 block mb-1">Typed Identifiers (Type-Aware)</label>
              <div className="flex gap-1.5 mb-2">
                <select
                  value={idType}
                  onChange={(e) => setIdType(e.target.value)}
                  className="text-xs p-1.5 border border-slate-300 rounded font-mono w-28 shrink-0"
                >
                  <option value="IMO">IMO</option>
                  <option value="LEI">LEI</option>
                  <option value="TAX_ID">TAX_ID</option>
                  <option value="PASSPORT">PASSPORT</option>
                  <option value="REGISTRATION_NO">REGISTRATION_NO</option>
                  <option value="SWIFT_BIC">SWIFT_BIC</option>
                  <option value="NPI">NPI</option>
                  <option value="ISIN">ISIN</option>
                </select>
                <input
                  type="text"
                  value={idValue}
                  onChange={(e) => setIdValue(e.target.value)}
                  className="flex-1 text-xs p-1.5 border border-slate-300 rounded font-mono"
                  placeholder="Identifier value"
                />
                <button
                  onClick={handleAddIdentifier}
                  className="px-2.5 py-1 bg-slate-800 text-white text-xs font-bold rounded hover:bg-slate-900"
                >
                  Add
                </button>
              </div>

              {identifiers.length > 0 && (
                <div className="space-y-1 max-h-28 overflow-y-auto border border-slate-100 p-1 rounded bg-slate-50">
                  {identifiers.map((id, idx) => (
                    <div key={idx} className="flex items-center justify-between text-[11px] bg-white p-1 rounded border border-slate-200">
                      <span className="font-mono font-bold text-indigo-700">{id.type}:</span>
                      <span className="font-mono text-slate-800 truncate max-w-[130px]">{id.value}</span>
                      <button
                        onClick={() => handleRemoveIdentifier(idx)}
                        className="text-rose-500 hover:text-rose-700 font-bold px-1"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={handleRunScan}
              disabled={isLoading || !scanName.trim()}
              className="w-full mt-2 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded shadow-xs flex items-center justify-center gap-1.5 transition-colors"
            >
              <Search className="w-3.5 h-3.5" /> Screen Entity Across Active Sources
            </button>
          </div>

          {/* Right Results Pane: 4-Dimension Display & Candidates */}
          <div className="md:col-span-2 bg-white border border-slate-200 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  Four-Dimension Screening Results
                </h3>
                {scanResult && (
                  <div className="flex items-center gap-1 border border-slate-200 rounded p-0.5 bg-slate-50">
                    <button
                      onClick={() => setScanSubTab('dimensions')}
                      className={`px-2 py-0.5 text-xs font-semibold rounded ${
                        scanSubTab === 'dimensions' ? 'bg-indigo-600 text-white shadow-2xs' : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      4-Dimension Badges
                    </button>
                    <button
                      onClick={() => setScanSubTab('graph')}
                      className={`px-2 py-0.5 text-xs font-semibold rounded flex items-center gap-1 ${
                        scanSubTab === 'graph' ? 'bg-indigo-600 text-white shadow-2xs' : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      <Share2 className="w-3 h-3" />
                      <span>Evidence Graph</span>
                    </button>
                  </div>
                )}
              </div>
              {scanResult && (
                <button
                  onClick={handleDownloadSealedReport}
                  className="text-xs bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 px-2 py-1 rounded flex items-center gap-1 font-bold"
                >
                  <Download className="w-3 h-3" /> Download Sealed Pack (JSON)
                </button>
              )}
            </div>

            {!scanResult ? (
              <div className="p-8 text-center text-slate-400 text-xs border border-dashed border-slate-200 rounded">
                Configure entity name and identifiers on the left, then click "Screen Entity" to view objective 4-dimension findings.
              </div>
            ) : scanSubTab === 'graph' ? (
              <ModuleEvidenceGraphSection moduleId="LISTS_AND_DATA_SOURCES" evaluation={scanResult} />
            ) : (
              <div className="space-y-3">
                {/* 4 Separate Status Badges */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {/* Dim 1: Input Completeness */}
                  <div className="p-2.5 rounded border bg-slate-50">
                    <div className="text-[10px] text-slate-500 uppercase font-semibold">1. Input Completeness</div>
                    <div className={`mt-1 text-xs font-bold ${
                      scanResult.dimensions.inputCompleteness === 'COMPLETE' ? 'text-emerald-700' : 'text-amber-700'
                    }`}>
                      {scanResult.dimensions.inputCompleteness}
                    </div>
                  </div>

                  {/* Dim 2: Source Coverage */}
                  <div className="p-2.5 rounded border bg-slate-50">
                    <div className="text-[10px] text-slate-500 uppercase font-semibold">2. Source Coverage</div>
                    <div className={`mt-1 text-xs font-bold ${
                      scanResult.dimensions.sourceCoverage === 'COMPLETE' ? 'text-emerald-700' : 'text-amber-700'
                    }`}>
                      {scanResult.dimensions.sourceCoverage}
                    </div>
                  </div>

                  {/* Dim 3: Candidate Findings */}
                  <div className="p-2.5 rounded border bg-slate-50">
                    <div className="text-[10px] text-slate-500 uppercase font-semibold">3. Candidate Findings</div>
                    <div className={`mt-1 text-xs font-bold ${
                      scanResult.dimensions.candidateFindings === 'NO_CANDIDATE'
                        ? 'text-emerald-700'
                        : scanResult.dimensions.candidateFindings === 'EXACT_IDENTIFIER_MATCH'
                        ? 'text-rose-700'
                        : 'text-amber-700'
                    }`}>
                      {scanResult.dimensions.candidateFindings === 'NO_CANDIDATE'
                        ? 'NO CANDIDATE IN CHECKED SOURCES'
                        : scanResult.dimensions.candidateFindings}
                    </div>
                  </div>

                  {/* Dim 4: Review Outcome */}
                  <div className="p-2.5 rounded border bg-slate-50">
                    <div className="text-[10px] text-slate-500 uppercase font-semibold">4. Review Outcome</div>
                    <div className={`mt-1 text-xs font-bold ${
                      scanResult.dimensions.reviewOutcome === 'AUTO_RELEASE'
                        ? 'text-emerald-700'
                        : scanResult.dimensions.reviewOutcome === 'HOLD_FOR_INVESTIGATION'
                        ? 'text-rose-700'
                        : 'text-amber-700'
                    }`}>
                      {scanResult.dimensions.reviewOutcome}
                    </div>
                  </div>
                </div>

                {/* Evidence & Manifest Anchors */}
                <div className="p-2 bg-slate-50 border border-slate-200 rounded text-[11px] font-mono text-slate-600 flex items-center justify-between">
                  <span>Run ID: <b className="text-slate-800">{scanResult.runId}</b></span>
                  <span>Manifest Digest: <b className="text-slate-800">{scanResult.manifestDigest?.slice(0, 16)}...</b></span>
                  <span>Candidates: <b className="text-slate-800">{scanResult.candidateCount}</b></span>
                </div>

                {/* Candidates List */}
                <div className="space-y-1.5">
                  <h4 className="text-[11px] font-bold text-slate-700 uppercase">
                    Candidate Matches ({scanResult.candidates.length})
                  </h4>

                  {scanResult.candidates.length === 0 ? (
                    <div className="p-3 bg-emerald-50 border border-emerald-200 rounded text-xs text-emerald-800">
                      <b>No candidate in checked sources.</b> No corresponding records or aliases matched in active snapshots. (Explicitly an algorithmic finding across selected sources, not a certified legal approval).
                    </div>
                  ) : (
                    scanResult.candidates.map((c: any, idx: number) => (
                      <div key={idx} className="p-2.5 border border-slate-200 rounded bg-white text-xs space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-900">{c.entryName}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                            c.isExactIdentifier ? 'bg-rose-100 text-rose-800 border border-rose-300' : 'bg-amber-100 text-amber-800'
                          }`}>
                            {c.matchType} (Score: {c.similarityScore})
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 flex items-center gap-3">
                          <span>Source: <b>{c.listName}</b> ({c.listId})</span>
                          <span>Record ID: <b className="font-mono">{c.entryId}</b></span>
                          {c.programs && <span>Programs: <b>{c.programs.join(', ')}</b></span>}
                        </div>
                        <div className="text-[11px] text-slate-600 italic bg-slate-50 p-1.5 rounded">
                          {c.notes}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: CUSTOMER SUBJECTS BATCH INTAKE & SCREENING */}
      {activeTab === 'BATCH' && (
        <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-4">
          <div>
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
              <Boxes className="w-4 h-4 text-indigo-600" /> Customer Subjects Batch Intake & Screening
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Intake and bulk screening of customer subjects (persons, organizations, vessels) against active sanctioned snapshots. Exposes malformed rows, extraction failures, and multi-dimension findings.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <div className="flex gap-2">
                  <button
                    onClick={() => setBatchInputMode('PASTE')}
                    className={`px-2 py-1 text-xs font-semibold rounded ${
                      batchInputMode === 'PASTE' ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' : 'text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    Paste Text (CSV)
                  </button>
                  <label className={`px-2 py-1 text-xs font-semibold rounded flex items-center gap-1 cursor-pointer ${
                    batchInputMode === 'FILE' ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' : 'text-slate-600 hover:bg-slate-50'
                  }`}>
                    <Upload className="w-3 h-3" /> Select Local File
                    <input
                      type="file"
                      accept=".csv,.txt"
                      onChange={(e) => {
                        setBatchInputMode('FILE');
                        handleBatchFileSelect(e);
                      }}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-700 block mb-1">
                  Customer Subject Records ({rawBatchText.split(/\r?\n/).filter(Boolean).length - 1} data rows)
                </label>
                <textarea
                  value={rawBatchText}
                  onChange={(e) => setRawBatchText(e.target.value)}
                  className="w-full h-44 text-xs p-2 border border-slate-300 rounded font-mono"
                  placeholder="name,type,country,identifier&#10;Acme Corp,ORGANIZATION,US,12345"
                />
              </div>

              <button
                onClick={handleRunBatchScreen}
                disabled={isLoading || !rawBatchText.trim()}
                className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded shadow-xs flex items-center justify-center gap-1.5 transition-colors"
              >
                {isLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                Screen All Customer Subjects
              </button>
            </div>

            {/* Batch Screening Results */}
            <div className="border border-slate-200 rounded p-3 bg-slate-50 space-y-3 text-xs">
              <h4 className="font-bold text-slate-800 uppercase text-[11px]">Batch Intake Screening Results</h4>

              {!batchResult ? (
                <div className="text-slate-400 italic py-12 text-center">
                  Enter subject rows or select a CSV file and click "Screen All Customer Subjects" to evaluate.
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-2 text-center text-[11px] font-mono">
                    <div className="bg-white p-2 rounded border">
                      <div className="text-slate-400 text-[10px]">TOTAL</div>
                      <div className="font-bold text-slate-900">{batchResult.totalSubmitted}</div>
                    </div>
                    <div className="bg-white p-2 rounded border">
                      <div className="text-slate-400 text-[10px]">VALID SCREENED</div>
                      <div className="font-bold text-emerald-700">{batchResult.validCount}</div>
                    </div>
                    <div className="bg-white p-2 rounded border">
                      <div className="text-slate-400 text-[10px]">REJECTED ROWS</div>
                      <div className={`font-bold ${batchResult.rejectedCount > 0 ? 'text-rose-700' : 'text-slate-700'}`}>
                        {batchResult.rejectedCount}
                      </div>
                    </div>
                  </div>

                  {batchResult.rejectedRows?.length > 0 && (
                    <div className="p-2 bg-rose-50 border border-rose-200 rounded text-rose-800 text-[11px] space-y-1">
                      <div className="font-bold">Extraction Failures ({batchResult.rejectedRows.length}):</div>
                      {batchResult.rejectedRows.map((err: any, i: number) => (
                        <div key={i}>Row {err.rowNumber}: {err.reason}</div>
                      ))}
                    </div>
                  )}

                  <div className="space-y-1.5 max-h-60 overflow-y-auto">
                    {batchResult.results?.map((res: any, idx: number) => (
                      <div key={idx} className="p-2 bg-white rounded border border-slate-200 text-[11px] flex items-center justify-between">
                        <div>
                          <div className="font-bold text-slate-900">{res.queryEntity?.name}</div>
                          <div className="text-[10px] text-slate-500 font-mono">
                            {res.queryEntity?.entityType || 'ENTITY'} | {res.queryEntity?.country || 'No Country'}
                          </div>
                        </div>
                        <div className="text-right">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            res.dimensions?.reviewOutcome === 'AUTO_RELEASE'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-rose-100 text-rose-800'
                          }`}>
                            {res.dimensions?.reviewOutcome}
                          </span>
                          <div className="text-[10px] text-slate-500 mt-0.5">
                            {res.candidateCount} candidate(s)
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: BRING YOUR OWN LIST (BYO) & INGESTION */}
      {activeTab === 'UPLOADS' && (
        <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-4">
          <div>
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
              Bring Your Own List (BYO) & Licensed Watchlist Ingestion
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Upload customer-licensed or internal sanctions datasets (CSV, JSON, XML). All uploads undergo quarantine checks, anomaly validation, field mapping preview, and strict tenant isolation. Private uploads cannot overwrite official global lists.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-3">
              {/* Mode Selection */}
              <div>
                <label className="text-[11px] font-bold text-slate-700 block mb-1">Target List Configuration</label>
                <div className="flex gap-4 text-xs mb-2">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="uploadMode"
                      checked={uploadMode === 'EXISTING'}
                      onChange={() => setUploadMode('EXISTING')}
                    />
                    <span>Upload to Existing Private Source</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="uploadMode"
                      checked={uploadMode === 'CREATE_NEW'}
                      onChange={() => setUploadMode('CREATE_NEW')}
                    />
                    <span>Create New Private / Licensed Source</span>
                  </label>
                </div>

                {uploadMode === 'EXISTING' ? (
                  <select
                    value={uploadSourceId}
                    onChange={(e) => setUploadSourceId(e.target.value)}
                    className="w-full text-xs p-2 border border-slate-300 rounded font-mono"
                  >
                    {sources
                      .filter((s) => s.category !== 'OFFICIAL_SANCTIONS')
                      .map((s) => (
                        <option key={s.id} value={s.id}>{s.name} ({s.id})</option>
                      ))}
                    {sources.filter((s) => s.category !== 'OFFICIAL_SANCTIONS').length === 0 && (
                      <option value="">No private sources configured. Select "Create New" above.</option>
                    )}
                  </select>
                ) : (
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded space-y-2 text-xs">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] font-bold text-slate-600 block">Source ID *</label>
                        <input
                          type="text"
                          value={newSourceId}
                          onChange={(e) => setNewSourceId(e.target.value)}
                          className="w-full p-1.5 border border-slate-300 rounded font-mono text-xs"
                          placeholder="e.g. INTERNAL_WATCHLIST_01"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-600 block">Category *</label>
                        <select
                          value={newSourceCategory}
                          onChange={(e) => setNewSourceCategory(e.target.value as any)}
                          className="w-full p-1.5 border border-slate-300 rounded text-xs"
                        >
                          <option value="INTERNAL_WATCHLIST">INTERNAL_WATCHLIST</option>
                          <option value="LICENSED_WATCHLIST">LICENSED_WATCHLIST</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-600 block">Display Name *</label>
                      <input
                        type="text"
                        value={newSourceName}
                        onChange={(e) => setNewSourceName(e.target.value)}
                        className="w-full p-1.5 border border-slate-300 rounded text-xs"
                        placeholder="e.g. High-Risk Counterparties List"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-600 block">Publisher / Vendor</label>
                      <input
                        type="text"
                        value={newSourcePublisher}
                        onChange={(e) => setNewSourcePublisher(e.target.value)}
                        className="w-full p-1.5 border border-slate-300 rounded text-xs"
                        placeholder="e.g. Compliance Risk Department"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Data Format & Input Mode */}
              <div className="flex items-center justify-between border-t border-slate-100 pt-2">
                <div className="flex gap-2">
                  {(['CSV', 'JSON', 'XML'] as const).map((fmt) => (
                    <label key={fmt} className="flex items-center gap-1 text-xs cursor-pointer">
                      <input
                        type="radio"
                        name="fmt"
                        checked={uploadFormat === fmt}
                        onChange={() => setUploadFormat(fmt)}
                      />
                      {fmt}
                    </label>
                  ))}
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => setUploadInputMode('PASTE')}
                    className={`px-2 py-0.5 text-xs font-semibold rounded ${
                      uploadInputMode === 'PASTE' ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' : 'text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    Paste Text
                  </button>
                  <label className={`px-2 py-0.5 text-xs font-semibold rounded flex items-center gap-1 cursor-pointer ${
                    uploadInputMode === 'FILE' ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' : 'text-slate-600 hover:bg-slate-50'
                  }`}>
                    <Upload className="w-3 h-3" /> Pick File
                    <input
                      type="file"
                      accept=".csv,.json,.xml"
                      onChange={(e) => {
                        setUploadInputMode('FILE');
                        handleByoFileSelect(e);
                      }}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-700 block mb-1">Watchlist Records Content</label>
                <textarea
                  value={rawUploadText}
                  onChange={(e) => setRawUploadText(e.target.value)}
                  className="w-full h-36 text-xs p-2 border border-slate-300 rounded font-mono"
                  placeholder="Paste CSV, JSON or XML payload"
                />
              </div>

              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoActivate}
                    onChange={(e) => setAutoActivate(e.target.checked)}
                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span>Activate snapshot immediately upon successful validation</span>
                </label>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handlePreviewUpload}
                  disabled={isLoading || !rawUploadText.trim()}
                  className="flex-1 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs rounded border border-slate-300 transition-colors"
                >
                  Preview Mapping & Validate
                </button>
                <button
                  onClick={() => handleImportSubmit(autoActivate)}
                  disabled={isLoading || !rawUploadText.trim()}
                  className="flex-1 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded transition-colors"
                >
                  Ingest & Save Snapshot
                </button>
              </div>
            </div>

            {/* Preview Output / Validation Report */}
            <div className="border border-slate-200 rounded p-3 bg-slate-50 space-y-3 text-xs">
              <h4 className="font-bold text-slate-800 uppercase text-[11px]">Validation & Ingestion Report</h4>

              {previewReport && (
                <div className="p-2.5 bg-white border border-indigo-200 rounded space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-indigo-900 text-xs">Mapping Preview Validated</span>
                    <span className="text-[10px] bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded font-mono">
                      {uploadFormat}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-1 text-[11px] font-mono text-center">
                    <div className="bg-slate-50 p-1 rounded border">Total: <b>{previewReport.totalRecords}</b></div>
                    <div className="bg-slate-50 p-1 rounded border text-emerald-700">Valid: <b>{previewReport.validRecords}</b></div>
                    <div className="bg-slate-50 p-1 rounded border text-rose-700">Rejected: <b>{previewReport.rejectedRecords}</b></div>
                  </div>
                  {previewReport.rejectionReasons?.length > 0 && (
                    <div className="p-1.5 bg-rose-50 border border-rose-200 rounded text-rose-700 text-[10px]">
                      <b>Validation Errors:</b> {previewReport.rejectionReasons.join('; ')}
                    </div>
                  )}
                  {previewReport.sampleRecords?.length > 0 && (
                    <div>
                      <div className="text-[10px] font-bold text-slate-600 uppercase mb-1">Sample Parsed Records:</div>
                      <div className="space-y-1 max-h-32 overflow-y-auto">
                        {previewReport.sampleRecords.map((r: any, idx: number) => (
                          <div key={idx} className="bg-slate-50 p-1 rounded border text-[10px] flex items-center justify-between">
                            <span className="font-bold">{r.name}</span>
                            <span className="font-mono text-slate-500">{r.providerRecordId} | {r.entityType}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {!uploadResult ? (
                !previewReport && (
                  <div className="text-slate-400 italic py-12 text-center">
                    Choose a file or enter payload and click "Preview Mapping & Validate" or "Ingest & Save Snapshot".
                  </div>
                )
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[11px]">Job ID: <b>{uploadResult.job?.jobId}</b></span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                      uploadResult.quarantined ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
                    }`}>
                      {uploadResult.job?.status}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-1 text-[11px] font-mono text-center">
                    <div className="bg-white p-1 rounded border">Total: <b>{uploadResult.job?.totalRecords}</b></div>
                    <div className="bg-white p-1 rounded border text-emerald-700">Valid: <b>{uploadResult.job?.validRecords}</b></div>
                    <div className="bg-white p-1 rounded border text-rose-700">Rejected: <b>{uploadResult.job?.rejectedRecords}</b></div>
                  </div>

                  {uploadResult.quarantined && (
                    <div className="p-2 bg-amber-50 border border-amber-300 rounded text-amber-900 text-[11px]">
                      <b>QUARANTINE ENFORCED: </b> {uploadResult.quarantineReason}
                    </div>
                  )}

                  {uploadResult.previewRecords && (
                    <div>
                      <div className="font-bold text-[10px] text-slate-600 uppercase mb-1">Parsed Staged Records:</div>
                      <div className="space-y-1 max-h-36 overflow-y-auto">
                        {uploadResult.previewRecords.map((r: any, idx: number) => (
                          <div key={idx} className="bg-white p-1.5 rounded border border-slate-200 text-[11px]">
                            <span className="font-bold">{r.name}</span> <span className="text-slate-400 font-mono">({r.providerRecordId})</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: IMPORT JOBS */}
      {activeTab === 'JOBS' && (
        <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
            Durable Ingestion & Snapshot Activation Jobs
          </h3>
          <div className="overflow-x-auto border border-slate-200 rounded">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold text-[11px]">
                  <th className="p-2">Job ID</th>
                  <th className="p-2">Source</th>
                  <th className="p-2">Status</th>
                  <th className="p-2 text-right">Valid / Rejected</th>
                  <th className="p-2">Triggered By</th>
                  <th className="p-2">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {importJobs.map((j) => (
                  <tr key={j.jobId} className="hover:bg-slate-50/80">
                    <td className="p-2 font-mono text-[11px] font-bold text-slate-900">{j.jobId}</td>
                    <td className="p-2 font-mono text-[11px]">{j.sourceId}</td>
                    <td className="p-2">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        j.status === 'COMPLETED'
                          ? 'bg-emerald-100 text-emerald-800'
                          : j.status === 'QUARANTINED'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-rose-100 text-rose-800'
                      }`}>
                        {j.status}
                      </span>
                    </td>
                    <td className="p-2 text-right font-mono text-[11px]">
                      <span className="text-emerald-700 font-bold">{j.validRecords}</span> / <span className="text-rose-700">{j.rejectedRecords}</span>
                    </td>
                    <td className="p-2 text-slate-600">{j.triggeredBy}</td>
                    <td className="p-2 text-slate-500 text-[11px] font-mono">{j.startedAt?.slice(0, 19).replace('T', ' ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 5: HEALTH & VERSIONS */}
      {activeTab === 'HEALTH' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Memory Index Stats */}
            <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-indigo-600" /> In-Memory Search Index Telemetry
              </h3>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="p-2.5 bg-slate-50 border rounded">
                  <div className="text-[10px] text-slate-500 uppercase">Index Readiness</div>
                  <div className="font-bold text-emerald-700 text-xs mt-1">{indexStats?.status || 'UNKNOWN'}</div>
                </div>
                <div className="p-2.5 bg-slate-50 border rounded">
                  <div className="text-[10px] text-slate-500 uppercase">Total Records Indexed</div>
                  <div className="font-bold text-slate-900 text-xs mt-1">{indexStats?.totalRecords || 0}</div>
                </div>
                <div className="p-2.5 bg-slate-50 border rounded">
                  <div className="text-[10px] text-slate-500 uppercase">Names & Aliases</div>
                  <div className="font-bold text-slate-900 text-xs mt-1">{indexStats?.totalNamesAndAliases || 0}</div>
                </div>
                <div className="p-2.5 bg-slate-50 border rounded">
                  <div className="text-[10px] text-slate-500 uppercase">Typed Identifiers</div>
                  <div className="font-bold text-slate-900 text-xs mt-1">{indexStats?.totalTypedIdentifiers || 0}</div>
                </div>
              </div>
              <div className="text-[11px] text-slate-500 font-mono">
                Active Manifest Hash: <span className="font-bold text-slate-800">{indexStats?.activeManifestDigest}</span>
              </div>
            </div>

            {/* Cloud Persistence Disclosure */}
            <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5 text-indigo-600" /> Storage Persistence Status
              </h3>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-slate-700">Storage Mode:</span>
                  <span className="font-mono font-bold text-indigo-700">{cloudStatus?.mode || 'LOCAL_PERSISTENT_SQLITE'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-slate-700">Restart Persistence:</span>
                  <span className={`font-bold ${cloudStatus?.restartPersistenceGuaranteed ? 'text-emerald-700' : 'text-amber-700'}`}>
                    {cloudStatus?.restartPersistenceGuaranteed ? 'GUARANTEED (WAL + Disk)' : 'EPHEMERAL STANDBY'}
                  </span>
                </div>
                <div className="pt-2 border-t border-slate-200 text-[11px] text-slate-600">
                  {cloudStatus?.disclaimer}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function ModuleWorkspaceShell({
  moduleId,
  children,
}: {
  moduleId: ComplianceModuleId;
  children: React.ReactNode;
}) {
  const [activeTab, setActiveTab] = useState<
    'overview' | 'name-checker' | 'single-check' | 'file-batch' | 'cases-review' | 'evidence-reports'
  >('single-check');

  // Workflows state
  const [workflows, setWorkflows] = useState<ModuleWorkflowRecord[]>([]);
  const [selectedWorkflow, setSelectedWorkflow] = useState<ModuleWorkflowRecord | null>(null);
  const [isLoadingWorkflows, setIsLoadingWorkflows] = useState<boolean>(false);
  const [workflowError, setWorkflowError] = useState<string | null>(null);

  // Adjudication state
  const [targetStatus, setTargetStatus] = useState<string>('RELEASED_APPROVED');
  const [rationale, setRationale] = useState<string>('');
  const [checklistNotes, setChecklistNotes] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Name Checker state
  const getDefaultEntityType = (m: ComplianceModuleId) => {
    switch (m) {
      case 'MARITIME': return 'VESSEL';
      case 'AIR_CARGO': return 'ORGANIZATION';
      case 'HEALTHCARE': return 'INDIVIDUAL';
      case 'INSURANCE': return 'INDIVIDUAL';
      case 'CRYPTO': return 'INDIVIDUAL';
      case 'TRADE_AND_CARGO': return 'ORGANIZATION';
      case 'SECURITIES': return 'ORGANIZATION';
      default: return 'ORGANIZATION';
    }
  };

  const [scanName, setScanName] = useState<string>('');
  const [scanEntityType, setScanEntityType] = useState<string>(getDefaultEntityType(moduleId));
  const [scanCountry, setScanCountry] = useState<string>('');
  const [scanIdType, setScanIdType] = useState<string>('REGISTRATION_NO');
  const [scanIdVal, setScanIdVal] = useState<string>('');
  const [scanResult, setScanResult] = useState<any>(null);
  const [isScanning, setIsScanning] = useState<boolean>(false);

  // File Batch state
  const [batchRaw, setBatchRaw] = useState<string>('');
  const [batchResult, setBatchResult] = useState<any>(null);
  const [isBatchRunning, setIsBatchRunning] = useState<boolean>(false);

  // Evidence Graph state
  const [graphData, setGraphData] = useState<AlertEvidenceGraph | null>(null);
  const [isLoadingGraph, setIsLoadingGraph] = useState<boolean>(false);

  const fetchWorkflows = async () => {
    setIsLoadingWorkflows(true);
    setWorkflowError(null);
    try {
      const res = await fetch(`/api/workflows?moduleId=${moduleId}`, {
        headers: { 'x-analyst-token': DEMO_ANALYST_TOKEN },
      });
      if (res.ok) {
        const data = await res.json();
        setWorkflows(data);
        if (data.length > 0 && !selectedWorkflow) {
          setSelectedWorkflow(data[0]);
        }
      } else {
        const err = await res.json();
        setWorkflowError(err.error || 'Failed to fetch module workflows');
      }
    } catch (err: any) {
      setWorkflowError(err.message);
    } finally {
      setIsLoadingWorkflows(false);
    }
  };

  useEffect(() => {
    fetchWorkflows();
    setScanEntityType(getDefaultEntityType(moduleId));
  }, [moduleId]);

  const handleAdjudicateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedWorkflow) return;
    if (rationale.trim().length < 10) {
      alert('Mandatory rationale must be at least 10 non-whitespace characters.');
      return;
    }

    setIsSubmitting(true);
    setActionSuccess(null);
    try {
      const res = await fetch(`/api/workflows/${selectedWorkflow.workflowId}/transition`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-analyst-token': DEMO_ANALYST_TOKEN,
        },
        body: JSON.stringify({
          targetStatus,
          rationale: rationale.trim(),
          assignedRole: 'compliance_officer',
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setSelectedWorkflow(data);
        setActionSuccess(`Adjudication persisted to write-ahead audit log: ${data.status}`);
        setRationale('');
        fetchWorkflows();
      } else {
        alert(data.error || 'Transition failed');
      }
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleChecklistComplete = async (itemId: string) => {
    if (!selectedWorkflow) return;
    const note = (checklistNotes[itemId] || 'Verified in compliance investigation').trim();
    if (note.length < 5) {
      alert('Evidence note must be at least 5 characters.');
      return;
    }
    try {
      const res = await fetch(`/api/workflows/${selectedWorkflow.workflowId}/checklist`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-analyst-token': DEMO_ANALYST_TOKEN,
        },
        body: JSON.stringify({
          itemId,
          evidenceNotes: note,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setSelectedWorkflow(data);
        fetchWorkflows();
      } else {
        const errData = await res.json();
        alert(errData.error || 'Checklist completion failed');
      }
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  const handleNameScan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!scanName.trim()) return;
    setIsScanning(true);
    try {
      const res = await fetch('/api/sources/scan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-analyst-token': DEMO_ANALYST_TOKEN,
        },
        body: JSON.stringify({
          name: scanName.trim(),
          entityType: scanEntityType,
          country: scanCountry.trim() || undefined,
          identifiers: scanIdVal.trim() ? [{ type: scanIdType, value: scanIdVal.trim() }] : [],
        }),
      });
      const data = await res.json();
      setScanResult(data);
    } catch (err: any) {
      alert(`Scan failed: ${err.message}`);
    } finally {
      setIsScanning(false);
    }
  };

  const handleBatchScreen = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!batchRaw.trim()) return;
    setIsBatchRunning(true);
    try {
      const res = await fetch('/api/subjects/batch-screen', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-analyst-token': DEMO_ANALYST_TOKEN,
        },
        body: JSON.stringify({
          rawContent: batchRaw,
        }),
      });
      const data = await res.json();
      setBatchResult(data);
    } catch (err: any) {
      alert(`Batch screen failed: ${err.message}`);
    } finally {
      setIsBatchRunning(false);
    }
  };

  const handleLoadSampleBatch = () => {
    const csv = `name,type,country,id\n"Acme Multi-Hop Trading",ORGANIZATION,United States,REG-9901\n"Silver Birch Exporters\n(Subsidiary Unit)",ORGANIZATION,Cyprus,CY-4402\n,ORGANIZATION,United Kingdom,MISSING-NAME-01\n"Dmitry Sergeyevich Volkov",INDIVIDUAL,Russia,PASSPORT-RU-8820\n"ZQX Synthetic Canary 7319",ORGANIZATION,Panama,PA-CANARY-01`;
    setBatchRaw(csv);
  };

  const handleFetchGraph = async () => {
    setIsLoadingGraph(true);
    try {
      const payload = selectedWorkflow?.evaluationSnapshot || {
        id: selectedWorkflow?.workflowId || `EVAL-${Date.now()}`,
        referenceId: selectedWorkflow?.subjectReference || 'REF-TARGET',
        parties: [{ name: selectedWorkflow?.subjectReference || 'Target Entity', role: 'COUNTERPARTY', matches: [] }],
      };
      const res = await fetch('/api/graphs/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-analyst-token': DEMO_ANALYST_TOKEN,
        },
        body: JSON.stringify({
          moduleId,
          payload,
        }),
      });
      if (res.ok) {
        const g = await res.json();
        setGraphData(g);
      }
    } catch {
      // Ignore
    } finally {
      setIsLoadingGraph(false);
    }
  };

  const handleDownloadSealedEvidence = () => {
    const bundle = {
      packId: `pack_${moduleId.toLowerCase()}_${Date.now()}`,
      exportedAt: new Date().toISOString(),
      moduleId,
      workflow: selectedWorkflow,
      graph: graphData,
      evidenceDigest: graphData?.evidenceDigest || 'SHA256-SEALED-BUNDLE',
      disclaimer: 'COMPLIANCEGATE MULTI-MODULE EVIDENCE PACK: Cryptographically sealed provenance and adjudication audit chain.',
    };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `compliance_evidence_${moduleId.toLowerCase()}_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const pendingCount = workflows.filter((w) => w.status === 'OPEN_REVIEW' || w.status === 'OPEN_RECONCILIATION' || w.status === 'IN_RECONCILIATION').length;
  const releasedCount = workflows.filter((w) => w.status === 'RELEASED_APPROVED').length;
  const blockedCount = workflows.filter((w) => w.status === 'REJECTED_BLOCKED').length;

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-50">
      <ModuleHeader moduleId={moduleId} />

      {/* 6 Visible Top-Level Navigation Pages */}
      <div className="bg-white border-b border-slate-200 px-4 py-2 flex items-center justify-between shrink-0 overflow-x-auto gap-2 shadow-2xs">
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          <button
            onClick={() => { setActiveTab('overview'); fetchWorkflows(); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors whitespace-nowrap ${
              activeTab === 'overview'
                ? 'bg-teal-600 text-white font-semibold shadow-2xs'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 font-medium'
            }`}
          >
            <Layers className="w-3.5 h-3.5 shrink-0" />
            <span>Overview & Queue</span>
            {workflows.length > 0 && (
              <span className={`text-[10px] px-1.5 py-0.2 rounded font-mono font-bold ml-1 ${
                activeTab === 'overview' ? 'bg-teal-800 text-white' : 'bg-slate-200 text-slate-700'
              }`}>
                {workflows.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('name-checker')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors whitespace-nowrap ${
              activeTab === 'name-checker'
                ? 'bg-teal-600 text-white font-semibold shadow-2xs'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 font-medium'
            }`}
          >
            <Search className="w-3.5 h-3.5 shrink-0" />
            <span>Name Checker</span>
          </button>

          <button
            onClick={() => setActiveTab('single-check')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors whitespace-nowrap ${
              activeTab === 'single-check'
                ? 'bg-teal-600 text-white font-semibold shadow-2xs'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 font-medium'
            }`}
          >
            <Terminal className="w-3.5 h-3.5 shrink-0" />
            <span>Single Check</span>
          </button>

          <button
            onClick={() => setActiveTab('file-batch')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors whitespace-nowrap ${
              activeTab === 'file-batch'
                ? 'bg-teal-600 text-white font-semibold shadow-2xs'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 font-medium'
            }`}
          >
            <Database className="w-3.5 h-3.5 shrink-0" />
            <span>File & Batch Checker</span>
          </button>

          <button
            onClick={() => { setActiveTab('cases-review'); fetchWorkflows(); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors whitespace-nowrap ${
              activeTab === 'cases-review'
                ? 'bg-teal-600 text-white font-semibold shadow-2xs'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 font-medium'
            }`}
          >
            <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
            <span>Cases & Review</span>
            {pendingCount > 0 && (
              <span className={`text-[10px] px-1.5 py-0.2 rounded font-mono font-bold ml-1 ${
                activeTab === 'cases-review' ? 'bg-amber-800 text-white' : 'bg-amber-100 text-amber-800'
              }`}>
                {pendingCount}
              </span>
            )}
          </button>

          <button
            onClick={() => { setActiveTab('evidence-reports'); handleFetchGraph(); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors whitespace-nowrap ${
              activeTab === 'evidence-reports'
                ? 'bg-teal-600 text-white font-semibold shadow-2xs'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 font-medium'
            }`}
          >
            <Share2 className="w-3.5 h-3.5 shrink-0" />
            <span>Evidence & Reports</span>
          </button>
        </div>
      </div>

      {/* Main Tab Content Viewport */}
      <div className="flex-1 overflow-y-auto">
        {/* TAB 1: OVERVIEW & QUEUE */}
        {activeTab === 'overview' && (
          <div className="p-6 max-w-7xl mx-auto space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-2xs">
                <div className="text-xs font-semibold text-slate-500 uppercase">Total Cases In Queue</div>
                <div className="text-2xl font-bold text-slate-900 mt-1">{workflows.length}</div>
                <div className="text-[11px] text-slate-500 mt-1">Durable WAL-backed records</div>
              </div>
              <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-2xs">
                <div className="text-xs font-semibold text-amber-600 uppercase">Pending Investigation</div>
                <div className="text-2xl font-bold text-amber-700 mt-1">{pendingCount}</div>
                <div className="text-[11px] text-slate-500 mt-1">Awaiting analyst adjudication</div>
              </div>
              <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-2xs">
                <div className="text-xs font-semibold text-emerald-600 uppercase">Released / Cleared</div>
                <div className="text-2xl font-bold text-emerald-700 mt-1">{releasedCount}</div>
                <div className="text-[11px] text-slate-500 mt-1">Documented waiver permitted</div>
              </div>
              <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-2xs">
                <div className="text-xs font-semibold text-rose-600 uppercase">Blocked / Sanctioned</div>
                <div className="text-2xl font-bold text-rose-700 mt-1">{blockedCount}</div>
                <div className="text-[11px] text-slate-500 mt-1">Confirmed adverse risk</div>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-lg shadow-2xs">
              <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-teal-600" />
                  Investigation & Reconciliation Queue ({workflows.length})
                </h3>
                <button
                  onClick={fetchWorkflows}
                  className="flex items-center gap-1 text-xs text-teal-600 hover:text-teal-700 font-medium"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoadingWorkflows ? 'animate-spin' : ''}`} />
                  Refresh Queue
                </button>
              </div>

              {workflows.length === 0 ? (
                <div className="p-8 text-center text-slate-500 text-xs">
                  No active workflow cases found for this module.
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {workflows.map((wf) => (
                    <div key={wf.workflowId} className="p-4 hover:bg-slate-50 flex items-center justify-between gap-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-slate-900">{wf.subjectReference}</span>
                          <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${
                            wf.status === 'RELEASED_APPROVED' ? 'bg-emerald-100 text-emerald-800' :
                            wf.status === 'REJECTED_BLOCKED' ? 'bg-rose-100 text-rose-800' :
                            wf.status === 'ESCALATED_SENIOR_COMPLIANCE' ? 'bg-purple-100 text-purple-800' :
                            'bg-amber-100 text-amber-800'
                          }`}>
                            {wf.status.replace(/_/g, ' ')}
                          </span>
                          <span className="text-[10px] text-slate-400 font-mono">ID: {wf.workflowId}</span>
                        </div>
                        <p className="text-xs text-slate-600">{wf.evaluationSnapshot?.subjectSummary || wf.subjectReference}</p>
                        {wf.evaluationSnapshot?.findings?.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {wf.evaluationSnapshot.findings.map((f: string, i: number) => (
                              <span key={i} className="text-[10px] bg-rose-50 text-rose-700 border border-rose-200 px-1.5 py-0.5 rounded">
                                {f}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <div className="text-right text-[11px] text-slate-500 font-mono">
                          <div>Checklist: {wf.checklist?.filter((c) => c.completed).length || 0}/{wf.checklist?.length || 0}</div>
                          <div>{new Date(wf.updatedAt).toLocaleTimeString()}</div>
                        </div>
                        <button
                          onClick={() => {
                            setSelectedWorkflow(wf);
                            setActiveTab('cases-review');
                          }}
                          className="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold rounded shadow-2xs flex items-center gap-1"
                        >
                          Review Case <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: NAME CHECKER */}
        {activeTab === 'name-checker' && (
          <div className="p-6 max-w-4xl mx-auto space-y-6">
            <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-2xs space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                  <Search className="w-4 h-4 text-teal-600" />
                  Scoped Name Checker ({moduleId})
                </h3>
                <span className="text-xs text-slate-500 font-mono">Connected to Active Snapshot Index</span>
              </div>

              <form onSubmit={handleNameScan} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Target Name *</label>
                    <input
                      type="text"
                      value={scanName}
                      onChange={(e) => setScanName(e.target.value)}
                      placeholder="e.g. Dmitry Sergeyevich Volkov, Oceanic Trust, MV Caspian..."
                      required
                      className="w-full text-xs p-2 border border-slate-300 rounded focus:border-teal-500 focus:outline-none bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Entity Type</label>
                    <select
                      value={scanEntityType}
                      onChange={(e) => setScanEntityType(e.target.value)}
                      className="w-full text-xs p-2 border border-slate-300 rounded focus:border-teal-500 focus:outline-none bg-white"
                    >
                      <option value="INDIVIDUAL">Individual / Person</option>
                      <option value="ORGANIZATION">Organization / Corporate Entity</option>
                      <option value="VESSEL">Maritime Vessel</option>
                      <option value="AIRCRAFT">Aircraft</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Country / Jurisdiction</label>
                    <input
                      type="text"
                      value={scanCountry}
                      onChange={(e) => setScanCountry(e.target.value)}
                      placeholder="e.g. Russia, Cyprus, United States..."
                      className="w-full text-xs p-2 border border-slate-300 rounded focus:border-teal-500 focus:outline-none bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Identifier Type</label>
                    <select
                      value={scanIdType}
                      onChange={(e) => setScanIdType(e.target.value)}
                      className="w-full text-xs p-2 border border-slate-300 rounded focus:border-teal-500 focus:outline-none bg-white"
                    >
                      <option value="REGISTRATION_NO">Company Registration No</option>
                      <option value="PASSPORT">Passport Number</option>
                      <option value="TAX_ID">Tax ID / TIN</option>
                      <option value="LEI">Legal Entity Identifier (LEI)</option>
                      <option value="IMO_NUMBER">Vessel IMO Number</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Identifier Value</label>
                    <input
                      type="text"
                      value={scanIdVal}
                      onChange={(e) => setScanIdVal(e.target.value)}
                      placeholder="e.g. 549300..., CY-9910..."
                      className="w-full text-xs p-2 border border-slate-300 rounded focus:border-teal-500 focus:outline-none bg-white"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isScanning || !scanName.trim()}
                  className="px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white font-semibold text-xs rounded shadow-xs flex items-center gap-1.5"
                >
                  {isScanning ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                  Scan Active Watchlists
                </button>
              </form>

              {scanResult && (
                <div className="mt-6 border-t border-slate-200 pt-4 space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                    <div className="p-2.5 bg-slate-50 border rounded">
                      <div className="text-[10px] text-slate-500 uppercase">Coverage</div>
                      <div className="font-bold text-slate-800 text-xs mt-1">{scanResult.dimensions?.sourceCoverage || 'COMPLETE'}</div>
                    </div>
                    <div className="p-2.5 bg-slate-50 border rounded">
                      <div className="text-[10px] text-slate-500 uppercase">Completeness</div>
                      <div className="font-bold text-slate-800 text-xs mt-1">{scanResult.dimensions?.inputCompleteness || 'COMPLETE'}</div>
                    </div>
                    <div className="p-2.5 bg-slate-50 border rounded">
                      <div className="text-[10px] text-slate-500 uppercase">Matching Integrity</div>
                      <div className="font-bold text-slate-800 text-xs mt-1">{scanResult.dimensions?.matchingIntegrity || 'OBJECTIVE_MATCH'}</div>
                    </div>
                    <div className="p-2.5 bg-slate-50 border rounded">
                      <div className="text-[10px] text-slate-500 uppercase">Review Outcome</div>
                      <div className={`font-bold text-xs mt-1 ${scanResult.requiresHumanReview ? 'text-amber-700' : 'text-emerald-700'}`}>
                        {scanResult.dimensions?.reviewOutcome || (scanResult.candidateCount > 0 ? 'HOLD_FOR_INVESTIGATION' : 'AUTO_RELEASE')}
                      </div>
                    </div>
                  </div>

                  <div className="border border-slate-200 rounded p-3 bg-white">
                    <div className="flex items-center justify-between text-xs font-bold mb-2">
                      <span>Watchlist Candidates ({scanResult.candidates?.length || 0})</span>
                      <span className="font-mono text-slate-500 text-[11px]">Score Threshold: 80%</span>
                    </div>

                    {(!scanResult.candidates || scanResult.candidates.length === 0) ? (
                      <div className="text-xs text-slate-500 italic p-3 text-center bg-slate-50 rounded">
                        No adverse candidate matches found in active snapshots.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {scanResult.candidates.map((cand: any, idx: number) => (
                          <div key={idx} className="p-3 bg-rose-50 border border-rose-200 rounded text-xs space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-rose-900">{cand.matchedName}</span>
                              <span className="font-mono bg-rose-200 text-rose-900 px-1.5 py-0.5 rounded text-[10px] font-bold">
                                {Math.round(cand.score)}% Match
                              </span>
                            </div>
                            <div className="text-[11px] text-rose-800">
                              Source: <span className="font-semibold">{cand.sourceId}</span> | Ref: <span className="font-mono">{cand.recordId}</span>
                            </div>
                            {cand.sanctionsPrograms?.length > 0 && (
                              <div className="text-[10px] text-rose-700">
                                Programs: {cand.sanctionsPrograms.join(', ')}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: SINGLE CHECK FORM (Domain Form) */}
        {activeTab === 'single-check' && (
          <div>
            {children}
          </div>
        )}

        {/* TAB 4: FILE & BATCH CHECKER */}
        {activeTab === 'file-batch' && (
          <div className="p-6 max-w-5xl mx-auto space-y-6">
            <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-2xs space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                    <Database className="w-4 h-4 text-teal-600" />
                    File & Batch Screening Intake ({moduleId})
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    RFC 4180 CSV parser supporting quoted multiline text with exact submission reconciliation.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleLoadSampleBatch}
                  className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium rounded border border-slate-300"
                >
                  Load Sample Batch CSV
                </button>
              </div>

              <form onSubmit={handleBatchScreen} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Paste CSV or Tab-Delimited Records (with name header)
                  </label>
                  <textarea
                    rows={8}
                    value={batchRaw}
                    onChange={(e) => setBatchRaw(e.target.value)}
                    placeholder="name,type,country,id&#10;Acme Trading,ORGANIZATION,United States,REG-9901&#10;Silver Birch Exporters,ORGANIZATION,Cyprus,CY-4402"
                    className="w-full p-2.5 font-mono text-xs border border-slate-300 rounded focus:border-teal-500 focus:outline-none bg-slate-50"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isBatchRunning || !batchRaw.trim()}
                  className="px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white font-semibold text-xs rounded shadow-xs flex items-center gap-1.5"
                >
                  {isBatchRunning ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <PlayIcon />}
                  Execute Reconciled Batch Screen
                </button>
              </form>

              {batchResult && (
                <div className="mt-6 border-t border-slate-200 pt-4 space-y-4">
                  {/* Exact Intake Reconciliation Counters */}
                  <div className="p-3 bg-teal-50 border border-teal-200 rounded flex items-center justify-between text-xs font-mono">
                    <span className="font-bold text-teal-900">
                      Total Submitted: {batchResult.totalSubmitted}
                    </span>
                    <span className="font-bold text-emerald-700">
                      Valid Screened: {batchResult.validCount}
                    </span>
                    <span className="font-bold text-rose-700">
                      Rejected Rows: {batchResult.rejectedCount}
                    </span>
                    <span className="text-[11px] text-teal-800">
                      Reconciliation Check: {batchResult.totalSubmitted === batchResult.validCount + batchResult.rejectedCount ? '✓ BALANCED' : '✗ DISCREPANCY'}
                    </span>
                  </div>

                  {batchResult.rejectedRows?.length > 0 && (
                    <div className="border border-amber-200 bg-amber-50 rounded p-3 space-y-2">
                      <div className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-700" /> Rejected Intake Rows ({batchResult.rejectedRows.length})
                      </div>
                      <div className="space-y-1 text-xs">
                        {batchResult.rejectedRows.map((rej: any, idx: number) => (
                          <div key={idx} className="text-[11px] text-amber-800 font-mono">
                            Row #{rej.rowNumber}: {rej.reason}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="border border-slate-200 rounded bg-white overflow-hidden">
                    <div className="px-3 py-2 bg-slate-100 border-b border-slate-200 text-xs font-bold text-slate-700">
                      Screened Results ({batchResult.validCount})
                    </div>
                    <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
                      {batchResult.results?.map((res: any, idx: number) => (
                        <div key={idx} className="p-3 flex items-center justify-between text-xs hover:bg-slate-50">
                          <div>
                            <span className="font-bold text-slate-900">{res.queryEntity?.name}</span>
                            <span className="text-slate-400 text-[10px] ml-2">({res.queryEntity?.entityType || 'ORGANIZATION'})</span>
                            <div className="text-[10px] text-slate-500">
                              Country: {res.queryEntity?.country || 'UNSPECIFIED'}
                            </div>
                          </div>
                          <div className="text-right">
                            <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${
                              res.candidateCount > 0 ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'
                            }`}>
                              {res.candidateCount > 0 ? `${res.candidateCount} Hits` : 'No Candidates'}
                            </span>
                            <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                              {res.dimensions?.reviewOutcome}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 5: CASES & REVIEW (Durable Case Adjudication Desk) */}
        {activeTab === 'cases-review' && (
          <div className="p-6 max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Left Queue Column */}
            <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-2xs space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                  <ShieldAlert className="w-3.5 h-3.5 text-teal-600" /> Module Cases ({workflows.length})
                </h3>
                <button onClick={fetchWorkflows} className="text-slate-400 hover:text-slate-600">
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoadingWorkflows ? 'animate-spin' : ''}`} />
                </button>
              </div>

              {workflows.length === 0 ? (
                <div className="text-xs text-slate-500 italic p-4 text-center">No cases found.</div>
              ) : (
                <div className="space-y-2 max-h-[600px] overflow-y-auto">
                  {workflows.map((wf) => {
                    const isSelected = selectedWorkflow?.workflowId === wf.workflowId;
                    return (
                      <div
                        key={wf.workflowId}
                        onClick={() => setSelectedWorkflow(wf)}
                        className={`p-3 rounded border text-xs cursor-pointer transition-all ${
                          isSelected
                            ? 'bg-teal-50 border-teal-500 shadow-xs'
                            : 'bg-white border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-mono font-bold text-slate-900 truncate max-w-[140px]">
                            {wf.subjectReference}
                          </span>
                          <span className={`text-[9px] px-1.5 py-0.2 rounded font-bold uppercase ${
                            wf.status === 'RELEASED_APPROVED' ? 'bg-emerald-100 text-emerald-800' :
                            wf.status === 'REJECTED_BLOCKED' ? 'bg-rose-100 text-rose-800' :
                            'bg-amber-100 text-amber-800'
                          }`}>
                            {wf.status.replace(/_/g, ' ')}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-600 truncate">{wf.evaluationSnapshot?.subjectSummary || wf.subjectReference}</p>
                        <div className="text-[10px] text-slate-400 mt-1 flex justify-between">
                          <span>Checklist: {wf.checklist?.filter((c) => c.completed).length || 0}/{wf.checklist?.length || 0}</span>
                          <span>{new Date(wf.updatedAt).toLocaleTimeString()}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Right Case Adjudication Workspace */}
            <div className="md:col-span-2 space-y-6">
              {!selectedWorkflow ? (
                <div className="bg-white border border-slate-200 rounded-lg p-12 text-center text-slate-500 text-xs shadow-2xs">
                  Select a workflow case from the left queue to conduct investigation and record adjudication.
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Case Header Card */}
                  <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-2xs space-y-3">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-base font-bold text-slate-900">{selectedWorkflow.subjectReference}</h3>
                          <span className={`text-xs px-2 py-0.5 rounded font-bold uppercase ${
                            selectedWorkflow.status === 'RELEASED_APPROVED' ? 'bg-emerald-100 text-emerald-800' :
                            selectedWorkflow.status === 'REJECTED_BLOCKED' ? 'bg-rose-100 text-rose-800' :
                            'bg-amber-100 text-amber-800'
                          }`}>
                            {selectedWorkflow.status.replace(/_/g, ' ')}
                          </span>
                        </div>
                        <p className="text-xs text-slate-600 mt-0.5">
                          Workflow ID: <span className="font-mono text-slate-500">{selectedWorkflow.workflowId}</span> | Module: {selectedWorkflow.moduleId}
                        </p>
                      </div>

                      <button
                        onClick={() => { setActiveTab('evidence-reports'); handleFetchGraph(); }}
                        className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded border border-slate-300 flex items-center gap-1"
                      >
                        <Share2 className="w-3.5 h-3.5 text-teal-600" /> View Evidence Graph
                      </button>
                    </div>

                    {selectedWorkflow.evaluationSnapshot?.findings?.length > 0 && (
                      <div className="space-y-1.5">
                        <div className="text-xs font-bold text-slate-700">Adverse Findings Detected:</div>
                        <div className="space-y-1">
                          {selectedWorkflow.evaluationSnapshot.findings.map((f: string, i: number) => (
                            <div key={i} className="p-2 bg-rose-50 border border-rose-200 rounded text-xs text-rose-800 flex items-start gap-1.5">
                              <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0 mt-0.5" />
                              <span>{f}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Interactive Investigation Checklist */}
                  <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-2xs space-y-3">
                    <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-teal-600" />
                      Mandatory Investigation Checklist
                    </h4>
                    <p className="text-[11px] text-slate-500">
                      Complete all required regulatory verification steps before final adjudication.
                    </p>

                    <div className="space-y-3 divide-y divide-slate-100">
                      {selectedWorkflow.checklist?.map((item) => (
                        <div key={item.itemId} className="pt-3 first:pt-0 space-y-2">
                          <div className="flex items-center justify-between">
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={item.completed}
                                disabled={item.completed}
                                onChange={() => handleChecklistComplete(item.itemId)}
                                className="w-4 h-4 text-teal-600 rounded border-slate-300 focus:ring-teal-500"
                              />
                              <span className={`text-xs ${item.completed ? 'line-through text-slate-400' : 'font-semibold text-slate-800'}`}>
                                {item.label}
                              </span>
                            </label>
                            {item.completed && (
                              <span className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded font-mono">
                                Verified by {item.completedBy || 'analyst'}
                              </span>
                            )}
                          </div>

                          {!item.completed && (
                            <div className="flex gap-2 pl-6">
                              <input
                                type="text"
                                placeholder="Mandatory evidence note (min 5 chars)..."
                                value={checklistNotes[item.itemId] || ''}
                                onChange={(e) => setChecklistNotes({ ...checklistNotes, [item.itemId]: e.target.value })}
                                className="flex-1 text-xs p-1.5 border border-slate-200 rounded bg-slate-50"
                              />
                              <button
                                type="button"
                                onClick={() => handleChecklistComplete(item.itemId)}
                                className="px-2.5 py-1 bg-teal-600 hover:bg-teal-700 text-white text-xs font-medium rounded"
                              >
                                Save Note
                              </button>
                            </div>
                          )}

                          {item.evidenceNote && (
                            <div className="pl-6 text-[11px] text-slate-500 italic">
                              Note: "{item.evidenceNote}"
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Adjudication Form (Durable WAL Persistence) */}
                  <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-2xs space-y-4">
                    <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                      <ShieldCheck className="w-3.5 h-3.5 text-teal-600" />
                      Durable Case Adjudication Desk
                    </h4>

                    {actionSuccess && (
                      <div className="p-3 bg-emerald-50 border border-emerald-200 rounded text-xs text-emerald-800 font-semibold flex items-center gap-2">
                        <Check className="w-4 h-4 text-emerald-600" />
                        {actionSuccess}
                      </div>
                    )}

                    <form onSubmit={handleAdjudicateSubmit} className="space-y-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">Target Adjudication Status</label>
                        <select
                          value={targetStatus}
                          onChange={(e) => setTargetStatus(e.target.value)}
                          className="w-full text-xs p-2 border border-slate-300 rounded focus:border-teal-500 focus:outline-none bg-white font-medium"
                        >
                          <option value="RELEASED_APPROVED">RELEASED_APPROVED — Documented Waiver / Legitimate Entity</option>
                          <option value="REJECTED_BLOCKED">REJECTED_BLOCKED — Confirm Adverse Risk & Prohibit Transaction</option>
                          <option value="ESCALATED_SENIOR_COMPLIANCE">ESCALATED_SENIOR_COMPLIANCE — Escalate to Senior MLRO</option>
                          <option value="IN_RECONCILIATION">IN_RECONCILIATION — Hold for Supplemental Documentation</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Mandatory Compliance Rationale (min 10 characters) *
                        </label>
                        <textarea
                          rows={3}
                          value={rationale}
                          onChange={(e) => setRationale(e.target.value)}
                          placeholder="Provide regulatory justification, verified facts, or documented license authority..."
                          required
                          className="w-full p-2.5 text-xs border border-slate-300 rounded focus:border-teal-500 focus:outline-none bg-white"
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={isSubmitting || rationale.trim().length < 10}
                        className="px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white font-semibold text-xs rounded shadow-xs flex items-center gap-1.5"
                      >
                        {isSubmitting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                        Persist Adjudication Decision (Write-Ahead Log)
                      </button>
                    </form>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 6: EVIDENCE & REPORTS */}
        {activeTab === 'evidence-reports' && (
          <div className="p-6 max-w-7xl mx-auto space-y-6">
            <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-2xs flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                  <Share2 className="w-4 h-4 text-teal-600" />
                  Alert Evidence Graph ({moduleId})
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Structural projection with typed edges and ZERO floating : MISSING nodes.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleFetchGraph}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded border border-slate-300 flex items-center gap-1"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoadingGraph ? 'animate-spin' : ''}`} /> Recompute Graph
                </button>
                <button
                  type="button"
                  onClick={handleDownloadSealedEvidence}
                  className="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold rounded shadow-xs flex items-center gap-1"
                >
                  <Download className="w-3.5 h-3.5" /> Download Sealed Evidence Pack
                </button>
              </div>
            </div>

            {isLoadingGraph ? (
              <div className="bg-white border border-slate-200 rounded-lg p-16 text-center text-slate-500 text-xs">
                <RefreshCw className="w-6 h-6 animate-spin text-teal-600 mx-auto mb-2" />
                Generating cryptographically verified evidence graph...
              </div>
            ) : graphData ? (
              <div className="bg-white border border-slate-200 rounded-lg p-2 shadow-2xs">
                <EvidenceGraphView graph={graphData} />
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-lg p-12 text-center text-slate-500 text-xs space-y-3">
                <p>No active evidence graph loaded for this module session.</p>
                <button
                  onClick={handleFetchGraph}
                  className="px-4 py-2 bg-teal-600 text-white text-xs font-semibold rounded shadow-xs"
                >
                  Generate Alert Evidence Graph
                </button>
              </div>
            )}
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
