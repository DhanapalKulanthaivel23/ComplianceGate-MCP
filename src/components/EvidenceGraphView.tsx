/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import React, { useState, useMemo, useRef } from 'react';
import {
  AlertEvidenceGraph,
  GraphEdge,
  GraphNode,
  GraphNodeCategory,
  MissingDataIssueItem,
} from '../shared/types.ts';
import {
  ShieldAlert,
  Search,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Filter,
  Download,
  Info,
  Layers,
  Table as TableIcon,
  Share2,
  CheckCircle2,
  AlertTriangle,
  FileText,
  User,
  Building,
  Anchor,
  Plane,
  MapPin,
  Tag,
  Scale,
  Award,
  HelpCircle,
  X,
  ExternalLink,
} from 'lucide-react';

interface EvidenceGraphViewProps {
  graph: AlertEvidenceGraph;
  onExportJson?: () => void;
  className?: string;
}

export function EvidenceGraphView({
  graph,
  onExportJson,
  className = '',
}: EvidenceGraphViewProps) {
  const [viewMode, setViewMode] = useState<'graph' | 'table'>('graph');
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdge | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const dragStart = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Filter states
  const [selectedCategories, setSelectedCategories] = useState<Set<GraphNodeCategory>>(
    new Set<GraphNodeCategory>([
      'SUBMITTED_FACT',
      'WATCHLIST_CANDIDATE',
      'SOURCE_ASSERTION',
      'POLICY_FINDING',
      'REVIEW_DECISION',
    ])
  );

  const toggleCategory = (cat: GraphNodeCategory) => {
    const next = new Set(selectedCategories);
    if (next.has(cat)) {
      if (next.size > 1) next.delete(cat);
    } else {
      next.add(cat);
    }
    setSelectedCategories(next);
  };

  // Filtered nodes & edges
  const filteredNodes = useMemo(() => {
    return graph.nodes.filter((node) => {
      if (!selectedCategories.has(node.category)) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesLabel = node.label.toLowerCase().includes(q);
        const matchesId = node.id.toLowerCase().includes(q);
        const matchesType = node.nodeType.toLowerCase().includes(q);
        const matchesSource = (node.provenance?.sourceOrProvider || '').toLowerCase().includes(q);
        if (!matchesLabel && !matchesId && !matchesType && !matchesSource) return false;
      }
      return true;
    });
  }, [graph.nodes, selectedCategories, searchQuery]);

  const filteredNodeIds = useMemo(() => new Set(filteredNodes.map((n) => n.id)), [filteredNodes]);

  const filteredEdges = useMemo(() => {
    return graph.edges.filter(
      (e) => filteredNodeIds.has(e.sourceNodeId) && filteredNodeIds.has(e.targetNodeId)
    );
  }, [graph.edges, filteredNodeIds]);

  // Compute clean tiered layout positions
  const { nodePositions, canvasWidth, canvasHeight } = useMemo(() => {
    const columns: Record<GraphNodeCategory, GraphNode[]> = {
      SUBMITTED_FACT: [],
      POLICY_FINDING: [],
      WATCHLIST_CANDIDATE: [],
      SOURCE_ASSERTION: [],
      REVIEW_DECISION: [],
    };

    for (const node of filteredNodes) {
      columns[node.category].push(node);
    }

    const colX: Record<GraphNodeCategory, number> = {
      SUBMITTED_FACT: 120,
      POLICY_FINDING: 400,
      WATCHLIST_CANDIDATE: 680,
      SOURCE_ASSERTION: 960,
      REVIEW_DECISION: 1240,
    };

    const positions: Record<string, { x: number; y: number }> = {};
    let maxColHeight = 500;

    (Object.keys(columns) as GraphNodeCategory[]).forEach((cat) => {
      const nodesInCol = columns[cat];
      const startY = 80;
      const spacingY = 95;
      nodesInCol.forEach((node, idx) => {
        positions[node.id] = {
          x: colX[cat],
          y: startY + idx * spacingY,
        };
      });
      const colHeight = startY + nodesInCol.length * spacingY + 80;
      if (colHeight > maxColHeight) maxColHeight = colHeight;
    });

    return {
      nodePositions: positions,
      canvasWidth: 1400,
      canvasHeight: Math.max(600, maxColHeight),
    };
  }, [filteredNodes]);

  // Mouse pan handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).tagName === 'svg' || (e.target as HTMLElement).id === 'graph-canvas-bg') {
      setIsDragging(true);
      dragStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPan({
      x: e.clientX - dragStart.current.x,
      y: e.clientY - dragStart.current.y,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  // Node styles and icons based on category and nodeType
  const getNodeVisuals = (node: GraphNode) => {
    switch (node.category) {
      case 'SUBMITTED_FACT':
        return {
          fill: '#f8fafc',
          stroke: '#64748b',
          strokeDasharray: 'none',
          shape: 'rect',
          textColor: '#0f172a',
          badgeBg: '#e2e8f0',
          badgeText: '#334155',
          borderWidth: 2,
        };
      case 'WATCHLIST_CANDIDATE':
        return {
          fill: '#fff1f2',
          stroke: '#e11d48',
          strokeDasharray: '5,3',
          shape: 'rect',
          textColor: '#881337',
          badgeBg: '#ffe4e6',
          badgeText: '#be123c',
          borderWidth: 2.5,
        };
      case 'SOURCE_ASSERTION':
        return {
          fill: '#fffbeb',
          stroke: '#d97706',
          strokeDasharray: 'none',
          shape: 'rect',
          textColor: '#78350f',
          badgeBg: '#fef3c7',
          badgeText: '#b45309',
          borderWidth: 2,
        };
      case 'POLICY_FINDING':
        return {
          fill: '#f5f3ff',
          stroke: '#7c3aed',
          strokeDasharray: 'none',
          shape: 'diamond',
          textColor: '#4c1d95',
          badgeBg: '#ede9fe',
          badgeText: '#6d28d9',
          borderWidth: 2,
        };
      case 'REVIEW_DECISION':
        return {
          fill: '#f0fdf4',
          stroke: '#059669',
          strokeDasharray: 'none',
          shape: 'rect',
          textColor: '#064e3b',
          badgeBg: '#dcfce7',
          badgeText: '#047857',
          borderWidth: 2.5,
        };
    }
  };

  const getNodeIcon = (type: string) => {
    switch (type) {
      case 'Person': return <User className="w-3.5 h-3.5" />;
      case 'Organisation': return <Building className="w-3.5 h-3.5" />;
      case 'Vessel': return <Anchor className="w-3.5 h-3.5" />;
      case 'Aircraft': return <Plane className="w-3.5 h-3.5" />;
      case 'Address':
      case 'City':
      case 'Country': return <MapPin className="w-3.5 h-3.5" />;
      case 'Identifier': return <Tag className="w-3.5 h-3.5" />;
      case 'Document': return <FileText className="w-3.5 h-3.5" />;
      case 'Alert': return <AlertTriangle className="w-3.5 h-3.5" />;
      case 'Review Decision': return <CheckCircle2 className="w-3.5 h-3.5" />;
      case 'Sanctions Program': return <Award className="w-3.5 h-3.5" />;
      case 'Legal Authority': return <Scale className="w-3.5 h-3.5" />;
      default: return <Info className="w-3.5 h-3.5" />;
    }
  };

  const handleExportClick = () => {
    if (onExportJson) {
      onExportJson();
      return;
    }
    const blob = new Blob([JSON.stringify(graph, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `evidence_graph_${graph.graphId}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className={`bg-white border border-slate-200 rounded-lg shadow-xs flex flex-col ${className}`}>
      {/* Top Header / Control Toolbar */}
      <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-slate-50 rounded-t-lg">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded bg-teal-100 text-teal-800 flex items-center justify-center font-bold">
            <Share2 className="w-4 h-4 text-teal-700" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                Alert Evidence Graph
              </h3>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 font-semibold">
                v{graph.version} · {graph.moduleId}
              </span>
              {graph.isTruncated && (
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-bold border border-amber-300">
                  Bounded: {graph.totalNodeCount}/{graph.maxNodesAllowed} Nodes
                </span>
              )}
            </div>
            <div className="text-[11px] text-slate-500 font-mono mt-0.5">
              Digest: {graph.evidenceDigest.slice(0, 16)}... · {graph.nodes.length} nodes · {graph.edges.length} edges
            </div>
          </div>
        </div>

        {/* View Mode Toggle & Actions */}
        <div className="flex items-center gap-2">
          {/* Search Bar */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
            <input
              type="text"
              placeholder="Search nodes or IDs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="text-xs pl-8 pr-3 py-1.5 border border-slate-300 rounded bg-white text-slate-800 placeholder-slate-400 focus:outline-hidden focus:ring-1 focus:ring-teal-500 w-48"
            />
          </div>

          {/* Toggle Graph vs Table View */}
          <div className="flex items-center border border-slate-300 rounded overflow-hidden bg-white">
            <button
              onClick={() => setViewMode('graph')}
              className={`px-2.5 py-1 text-xs font-medium flex items-center gap-1 transition-colors ${
                viewMode === 'graph' ? 'bg-teal-600 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Share2 className="w-3.5 h-3.5" />
              <span>Graph View</span>
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={`px-2.5 py-1 text-xs font-medium flex items-center gap-1 transition-colors ${
                viewMode === 'table' ? 'bg-teal-600 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <TableIcon className="w-3.5 h-3.5" />
              <span>Accessible Table</span>
            </button>
          </div>

          {/* Zoom controls (only in graph mode) */}
          {viewMode === 'graph' && (
            <div className="flex items-center border border-slate-300 rounded bg-white overflow-hidden">
              <button
                onClick={() => setZoom((z) => Math.min(z + 0.15, 2.5))}
                className="p-1.5 text-slate-600 hover:bg-slate-100"
                title="Zoom In"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setZoom((z) => Math.max(z - 0.15, 0.4))}
                className="p-1.5 text-slate-600 hover:bg-slate-100"
                title="Zoom Out"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={resetView}
                className="p-1.5 text-slate-600 hover:bg-slate-100 border-l border-slate-200"
                title="Fit to Screen"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Export JSON Button */}
          <button
            onClick={handleExportClick}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 transition-colors shadow-2xs"
            title="Export Sealed Evidence Graph"
          >
            <Download className="w-3.5 h-3.5 text-teal-600" />
            <span>Export Graph (JSON)</span>
          </button>
        </div>
      </div>

      {/* Category Filter Pills & Tiered Column Legend */}
      <div className="px-4 py-2 border-b border-slate-200 bg-slate-50/70 flex flex-wrap items-center justify-between text-xs gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] font-semibold text-slate-500 uppercase mr-1 flex items-center gap-1">
            <Filter className="w-3 h-3 text-slate-400" /> Filters:
          </span>
          <button
            onClick={() => toggleCategory('SUBMITTED_FACT')}
            className={`px-2 py-0.5 rounded text-[11px] font-medium border flex items-center gap-1 transition-all ${
              selectedCategories.has('SUBMITTED_FACT')
                ? 'bg-slate-200 border-slate-400 text-slate-800'
                : 'bg-white border-slate-200 text-slate-400 opacity-60'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-slate-600"></span>
            <span>1. Submitted Facts ({graph.summary?.submittedEntityCount || 0})</span>
          </button>
          <button
            onClick={() => toggleCategory('POLICY_FINDING')}
            className={`px-2 py-0.5 rounded text-[11px] font-medium border flex items-center gap-1 transition-all ${
              selectedCategories.has('POLICY_FINDING')
                ? 'bg-purple-100 border-purple-400 text-purple-900'
                : 'bg-white border-slate-200 text-slate-400 opacity-60'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-purple-600"></span>
            <span>2. Policy Findings ({graph.summary?.alertCount || 0})</span>
          </button>
          <button
            onClick={() => toggleCategory('WATCHLIST_CANDIDATE')}
            className={`px-2 py-0.5 rounded text-[11px] font-medium border flex items-center gap-1 transition-all ${
              selectedCategories.has('WATCHLIST_CANDIDATE')
                ? 'bg-rose-100 border-rose-400 text-rose-900'
                : 'bg-white border-slate-200 text-slate-400 opacity-60'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-rose-600"></span>
            <span>3. Candidates ({graph.summary?.candidateCount || 0})</span>
          </button>
          <button
            onClick={() => toggleCategory('SOURCE_ASSERTION')}
            className={`px-2 py-0.5 rounded text-[11px] font-medium border flex items-center gap-1 transition-all ${
              selectedCategories.has('SOURCE_ASSERTION')
                ? 'bg-amber-100 border-amber-400 text-amber-900'
                : 'bg-white border-slate-200 text-slate-400 opacity-60'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-amber-600"></span>
            <span>4. Source Facts ({graph.summary?.sourceFactCount || 0})</span>
          </button>
          <button
            onClick={() => toggleCategory('REVIEW_DECISION')}
            className={`px-2 py-0.5 rounded text-[11px] font-medium border flex items-center gap-1 transition-all ${
              selectedCategories.has('REVIEW_DECISION')
                ? 'bg-emerald-100 border-emerald-400 text-emerald-900'
                : 'bg-white border-slate-200 text-slate-400 opacity-60'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-emerald-600"></span>
            <span>5. Review Decisions ({graph.summary?.decisionCount || 0})</span>
          </button>
        </div>

        <div className="text-[10px] text-slate-500 font-mono">
          * Solid edges: Recorded assertions · Dashed edges: Hypothesized matches
        </div>
      </div>

      {/* Main Canvas / Table Container */}
      <div className="relative flex-1 min-h-[460px] max-h-[580px] overflow-hidden bg-slate-900/5">
        {viewMode === 'graph' ? (
          <div
            id="graph-canvas-container"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            className="w-full h-full cursor-grab active:cursor-grabbing overflow-auto relative select-none"
          >
            <svg
              id="graph-canvas-bg"
              width={canvasWidth * zoom}
              height={canvasHeight * zoom}
              viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px)`,
                transformOrigin: '0 0',
              }}
              className="transition-transform duration-75"
            >
              <defs>
                {/* Arrow markers */}
                <marker
                  id="arrow-solid"
                  viewBox="0 0 10 10"
                  refX="18"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 1 L 10 5 L 0 9 z" fill="#64748b" />
                </marker>
                <marker
                  id="arrow-dashed"
                  viewBox="0 0 10 10"
                  refX="18"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 1 L 10 5 L 0 9 z" fill="#e11d48" />
                </marker>
                <marker
                  id="arrow-green"
                  viewBox="0 0 10 10"
                  refX="18"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 1 L 10 5 L 0 9 z" fill="#059669" />
                </marker>
              </defs>

              {/* Grid background markers */}
              <pattern id="grid-dots" width="40" height="40" patternUnits="userSpaceOnUse">
                <circle cx="20" cy="20" r="1" fill="#cbd5e1" opacity="0.4" />
              </pattern>
              <rect width="100%" height="100%" fill="url(#grid-dots)" />

              {/* Tier Column Headers */}
              <g className="tier-headers text-[11px] font-bold fill-slate-400 uppercase font-mono">
                <text x="120" y="35" textAnchor="middle">1. Submitted Facts</text>
                <text x="400" y="35" textAnchor="middle">2. Policy Findings</text>
                <text x="680" y="35" textAnchor="middle">3. Watchlist Candidate</text>
                <text x="960" y="35" textAnchor="middle">4. Source Facts</text>
                <text x="1240" y="35" textAnchor="middle">5. Review Decision</text>
              </g>

              {/* Column Separator lines */}
              <line x1="260" y1="20" x2="260" y2={canvasHeight - 20} stroke="#e2e8f0" strokeDasharray="3,3" />
              <line x1="540" y1="20" x2="540" y2={canvasHeight - 20} stroke="#e2e8f0" strokeDasharray="3,3" />
              <line x1="820" y1="20" x2="820" y2={canvasHeight - 20} stroke="#e2e8f0" strokeDasharray="3,3" />
              <line x1="1100" y1="20" x2="1100" y2={canvasHeight - 20} stroke="#e2e8f0" strokeDasharray="3,3" />

              {/* Edges */}
              {filteredEdges.map((edge) => {
                const s = nodePositions[edge.sourceNodeId];
                const t = nodePositions[edge.targetNodeId];
                if (!s || !t) return null;

                const isSelected = selectedEdge?.id === edge.id;
                const isHypothesized = edge.isHypothesized || edge.edgeType === 'possible_match_to';

                // Curved bezier path
                const dx = t.x - s.x;
                const dy = t.y - s.y;
                const cx1 = s.x + dx * 0.5;
                const cy1 = s.y;
                const cx2 = s.x + dx * 0.5;
                const cy2 = t.y;
                const pathD = `M ${s.x} ${s.y} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${t.x} ${t.y}`;
                const midX = (s.x + t.x) / 2;
                const midY = (s.y + t.y) / 2;

                const strokeColor = isSelected
                  ? '#0284c7'
                  : isHypothesized
                  ? '#e11d48'
                  : edge.edgeType === 'reviewed_as'
                  ? '#059669'
                  : '#94a3b8';

                return (
                  <g key={edge.id} className="cursor-pointer" onClick={() => setSelectedEdge(edge)}>
                    <path
                      d={pathD}
                      fill="none"
                      stroke={strokeColor}
                      strokeWidth={isSelected ? 3.5 : isHypothesized ? 2.5 : 1.8}
                      strokeDasharray={isHypothesized ? '6,4' : 'none'}
                      markerEnd={
                        isHypothesized
                          ? 'url(#arrow-dashed)'
                          : edge.edgeType === 'reviewed_as'
                          ? 'url(#arrow-green)'
                          : 'url(#arrow-solid)'
                      }
                      className="hover:stroke-teal-600 transition-colors"
                    />
                    {/* Edge Label Pill */}
                    <g transform={`translate(${midX}, ${midY})`}>
                      <rect
                        x="-45"
                        y="-9"
                        width="90"
                        height="18"
                        rx="9"
                        fill="#ffffff"
                        stroke={strokeColor}
                        strokeWidth="1"
                        className="shadow-xs"
                      />
                      <text
                        x="0"
                        y="3"
                        textAnchor="middle"
                        className="text-[9px] font-mono fill-slate-700 font-semibold select-none pointer-events-none"
                      >
                        {edge.edgeType.slice(0, 14)}
                      </text>
                    </g>
                  </g>
                );
              })}

              {/* Nodes */}
              {filteredNodes.map((node) => {
                const pos = nodePositions[node.id];
                if (!pos) return null;

                const isSelected = selectedNode?.id === node.id;
                const visual = getNodeVisuals(node);

                return (
                  <g
                    key={node.id}
                    transform={`translate(${pos.x}, ${pos.y})`}
                    className="cursor-pointer transition-transform hover:scale-105"
                    onClick={() => {
                      setSelectedNode(node);
                      setSelectedEdge(null);
                    }}
                  >
                    {/* Card container */}
                    <rect
                      x="-85"
                      y="-32"
                      width="170"
                      height="64"
                      rx="8"
                      fill={visual.fill}
                      stroke={isSelected ? '#0284c7' : visual.stroke}
                      strokeWidth={isSelected ? 3.5 : visual.borderWidth}
                      strokeDasharray={visual.strokeDasharray}
                      className="filter drop-shadow-xs"
                    />

                    {/* Category pill */}
                    <rect
                      x="-80"
                      y="-28"
                      width="60"
                      height="14"
                      rx="4"
                      fill={visual.badgeBg}
                    />
                    <text
                      x="-50"
                      y="-18"
                      textAnchor="middle"
                      className="text-[8px] font-mono font-bold uppercase"
                      fill={visual.badgeText}
                    >
                      {node.nodeType.slice(0, 10)}
                    </text>

                    {/* Node Label (Truncated in visual, full in panel) */}
                    <text
                      x="0"
                      y="4"
                      textAnchor="middle"
                      className="text-[11px] font-bold select-none"
                      fill={visual.textColor}
                    >
                      {node.label.length > 22 ? `${node.label.slice(0, 20)}...` : node.label}
                    </text>

                    {/* Scoped ID subtitle */}
                    <text
                      x="0"
                      y="18"
                      textAnchor="middle"
                      className="text-[9px] font-mono fill-slate-500 select-none"
                    >
                      {node.id.length > 25 ? `${node.id.slice(0, 23)}...` : node.id}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        ) : (
          /* Accessible Table/List View */
          <div className="p-4 space-y-6 overflow-y-auto max-h-[560px]">
            {/* Nodes Table */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                  <Layers className="w-4 h-4 text-teal-600" />
                  <span>Graph Nodes Register ({filteredNodes.length})</span>
                </h4>
                <span className="text-[11px] text-slate-500 font-mono">
                  All submitted entities, candidates, and published facts
                </span>
              </div>
              <div className="border border-slate-200 rounded overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-100 border-b border-slate-200 text-slate-700 font-semibold font-mono text-[11px]">
                    <tr>
                      <th className="p-2">Node Type</th>
                      <th className="p-2">Category</th>
                      <th className="p-2">Label / Name</th>
                      <th className="p-2">Scoped ID</th>
                      <th className="p-2">Source / Provider</th>
                      <th className="p-2">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white font-mono text-[11px]">
                    {filteredNodes.map((n) => (
                      <tr
                        key={n.id}
                        className={`hover:bg-slate-50 ${selectedNode?.id === n.id ? 'bg-teal-50 font-semibold' : ''}`}
                      >
                        <td className="p-2 font-bold text-slate-900">{n.nodeType}</td>
                        <td className="p-2">
                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-100 text-slate-700 border border-slate-200">
                            {n.category}
                          </span>
                        </td>
                        <td className="p-2 font-sans font-medium text-slate-800">{n.label}</td>
                        <td className="p-2 text-slate-500">{n.id}</td>
                        <td className="p-2 text-slate-600">{n.provenance?.sourceOrProvider || 'N/A'}</td>
                        <td className="p-2">
                          <button
                            onClick={() => setSelectedNode(n)}
                            className="text-teal-600 hover:text-teal-800 underline font-semibold text-[10px]"
                          >
                            Inspect
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Edges Table */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                  <Share2 className="w-4 h-4 text-teal-600" />
                  <span>Typed Relationships & Directed Edges ({filteredEdges.length})</span>
                </h4>
                <span className="text-[11px] text-slate-500 font-mono">
                  Explicit typed relationships with provenance
                </span>
              </div>
              <div className="border border-slate-200 rounded overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-100 border-b border-slate-200 text-slate-700 font-semibold font-mono text-[11px]">
                    <tr>
                      <th className="p-2">Source Node</th>
                      <th className="p-2">Relationship Type</th>
                      <th className="p-2">Target Node</th>
                      <th className="p-2">Label Description</th>
                      <th className="p-2">Hypothesized?</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white font-mono text-[11px]">
                    {filteredEdges.map((e) => (
                      <tr key={e.id} className="hover:bg-slate-50">
                        <td className="p-2 text-slate-700">{e.sourceNodeId}</td>
                        <td className="p-2 font-bold text-indigo-700 font-mono">{e.edgeType}</td>
                        <td className="p-2 text-slate-700">{e.targetNodeId}</td>
                        <td className="p-2 font-sans text-slate-600">{e.label}</td>
                        <td className="p-2">
                          {e.isHypothesized ? (
                            <span className="text-[10px] text-rose-700 font-bold">YES (Match)</span>
                          ) : (
                            <span className="text-[10px] text-emerald-700">NO (Factual)</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Selected Node Details Drawer */}
        {selectedNode && (
          <div className="absolute top-3 right-3 w-80 bg-white/95 backdrop-blur-xs border border-slate-300 rounded-lg shadow-xl p-4 text-xs space-y-3 z-20 max-h-[90%] overflow-y-auto">
            <div className="flex items-start justify-between border-b border-slate-200 pb-2">
              <div>
                <span className="text-[10px] font-mono uppercase font-bold text-teal-700">
                  {selectedNode.category} · {selectedNode.nodeType}
                </span>
                <h4 className="text-sm font-bold text-slate-900 mt-0.5 leading-snug">
                  {selectedNode.label}
                </h4>
              </div>
              <button
                onClick={() => setSelectedNode(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Match vs Designation Explanation */}
            {selectedNode.category === 'WATCHLIST_CANDIDATE' && (
              <div className="p-2.5 bg-rose-50 border border-rose-200 rounded text-rose-900 space-y-1">
                <div className="font-bold text-[11px] flex items-center gap-1">
                  <ShieldAlert className="w-3.5 h-3.5 text-rose-600" />
                  <span>Why Alert Fired: Screening Match</span>
                </div>
                <div className="text-[10px] leading-relaxed">
                  Method: <strong>{selectedNode.properties.matchType}</strong> on field{' '}
                  <strong>{selectedNode.properties.matchedField}</strong>. Similarity score:{' '}
                  <strong>{((selectedNode.properties.similarityScore || 0) * 100).toFixed(0)}%</strong>.
                </div>
                <div className="text-[9px] text-rose-700 font-mono italic">
                  * Note: Submitted subject and listed candidate remain separate until identity review.
                </div>
              </div>
            )}

            {/* GLEIF Specific Notice */}
            {selectedNode.id.includes('gleif') || selectedNode.properties.isGleif && (
              <div className="p-2 bg-amber-50 border border-amber-200 rounded text-[10px] text-amber-900">
                <strong>Legal Registry Notice:</strong> Accounting parent consolidation reflects financial reporting relationships and is strictly separate from verified Beneficial Ownership (UBO).
              </div>
            )}

            {/* Scoped Properties */}
            <div className="space-y-1.5">
              <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block">
                Node Properties & Details
              </span>
              <div className="p-2 bg-slate-50 rounded border border-slate-200 font-mono text-[10px] space-y-1">
                <div><strong>ID:</strong> {selectedNode.id}</div>
                {Object.entries(selectedNode.properties || {}).map(([k, v]) => (
                  <div key={k} className="truncate">
                    <strong>{k}:</strong> {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                  </div>
                ))}
              </div>
            </div>

            {/* Provenance Audit */}
            <div className="space-y-1.5">
              <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block">
                Audit Provenance
              </span>
              <div className="p-2 bg-slate-50 rounded border border-slate-200 text-[10px] font-mono space-y-1 text-slate-600">
                <div>Source: {selectedNode.provenance?.sourceOrProvider || 'N/A'}</div>
                <div>Record ID: {selectedNode.provenance?.originalRecordId || 'N/A'}</div>
                <div>Snapshot: {selectedNode.provenance?.snapshotOrVersion || 'N/A'}</div>
                <div>Retrieved: {new Date(selectedNode.provenance?.retrievalTime || Date.now()).toLocaleTimeString()}</div>
                {selectedNode.provenance?.originalFieldOrTag && (
                  <div>Original Tag/Field: {selectedNode.provenance.originalFieldOrTag}</div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Selected Edge Details Drawer */}
        {selectedEdge && (
          <div className="absolute top-3 right-3 w-80 bg-white/95 backdrop-blur-xs border border-slate-300 rounded-lg shadow-xl p-4 text-xs space-y-3 z-20">
            <div className="flex items-start justify-between border-b border-slate-200 pb-2">
              <div>
                <span className="text-[10px] font-mono uppercase font-bold text-indigo-700">
                  Directed Relationship
                </span>
                <h4 className="text-sm font-bold text-slate-900 mt-0.5">
                  {selectedEdge.edgeType}
                </h4>
              </div>
              <button
                onClick={() => setSelectedEdge(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-2 bg-indigo-50 border border-indigo-200 rounded text-indigo-900 text-[11px]">
              {selectedEdge.label}
            </div>

            <div className="p-2 bg-slate-50 rounded border border-slate-200 text-[10px] font-mono space-y-1 text-slate-600">
              <div>From: {selectedEdge.sourceNodeId}</div>
              <div>To: {selectedEdge.targetNodeId}</div>
              <div>Hypothesized: {selectedEdge.isHypothesized ? 'YES' : 'NO'}</div>
              <div>Source: {selectedEdge.provenance?.sourceOrProvider}</div>
            </div>
          </div>
        )}
      </div>

      {/* Separate Missing-Data & Information Quality Panel (Addressing the defect from the screenshot!) */}
      {graph.missingDataIssues && graph.missingDataIssues.length > 0 && (
        <div className="border-t border-slate-200 bg-amber-50/60 p-3 rounded-b-lg">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5 text-xs font-bold text-amber-900 uppercase tracking-wider">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              <span>Data Quality & Missing Information Panel ({graph.missingDataIssues.length} Items)</span>
            </div>
            <span className="text-[10px] font-mono text-amber-800 bg-amber-100 px-2 py-0.5 rounded border border-amber-300">
              Separated from graph canvas to prevent visual pollution
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
            {graph.missingDataIssues.map((issue, idx) => (
              <div
                key={idx}
                className="p-2 rounded border border-amber-200 bg-white shadow-2xs flex items-start gap-2"
              >
                <span
                  className={`text-[9px] font-mono px-1 py-0.5 rounded font-bold shrink-0 mt-0.5 ${
                    issue.severity === 'CRITICAL'
                      ? 'bg-rose-100 text-rose-800 border border-rose-300'
                      : 'bg-amber-100 text-amber-800 border border-amber-300'
                  }`}
                >
                  {issue.severity}
                </span>
                <div className="space-y-0.5 min-w-0">
                  <div className="font-bold text-slate-900 text-[11px] truncate">
                    Field: <code className="font-mono text-amber-900">{issue.field}</code> ({issue.affectedPartyOrDocument})
                  </div>
                  <div className="text-[10px] text-slate-600 leading-snug">
                    {issue.description}
                  </div>
                  {issue.regulatoryBasis && (
                    <div className="text-[9px] text-slate-400 font-mono">
                      Ref: {issue.regulatoryBasis}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

