/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import {
  AlertEvidenceGraph,
  CanonicalParty,
  CanonicalPaymentTransaction,
  CaseStatus,
  ComplianceModuleId,
  GraphEdge,
  GraphEdgeType,
  GraphNode,
  GraphNodeCategory,
  GraphNodeType,
  GraphProvenance,
  MatchDetail,
  MissingDataIssueItem,
  PaymentComplianceCase,
  PaymentScreeningResult,
  ScreeningRunRecord,
} from '../../shared/types.ts';
import { redactSensitiveDataForAgent, sha256 } from './normalizer.ts';
import { storageRepository } from './storage/storageRepository.ts';

export const MAX_GRAPH_NODES = 80;

export class EvidenceGraphService {
  /**
   * Sanitizes string values to prevent injection/XSS in labels.
   */
  public sanitizeLabel(value: string | undefined | null, fallback = 'Unknown'): string {
    if (!value) return fallback;
    return String(value)
      .replace(/[<>'"&]/g, (c) => {
        switch (c) {
          case '<': return '&lt;';
          case '>': return '&gt;';
          case "'": return '&#39;';
          case '"': return '&quot;';
          case '&': return '&amp;';
          default: return c;
        }
      })
      .trim();
  }

  /**
   * Formats a stable, scoped identifier.
   */
  public makeId(prefix: string, ...parts: string[]): string {
    const clean = parts
      .map((p) => String(p || '').toLowerCase().replace(/[^a-z0-9_-]/g, '_'))
      .filter(Boolean)
      .join(':');
    return `${prefix}:${clean || 'anon'}`;
  }

  /**
   * Maps common EntityType strings (INDIVIDUAL, ORGANIZATION, etc.) to valid GraphNodeType.
   */
  public mapEntityTypeToNodeType(entityType?: string): GraphNodeType {
    if (!entityType) return 'Organisation';
    const upper = entityType.toUpperCase();
    if (upper === 'INDIVIDUAL' || upper === 'PERSON') return 'Person';
    if (upper === 'ORGANIZATION' || upper === 'ORGANISATION') return 'Organisation';
    if (upper === 'VESSEL') return 'Vessel';
    if (upper === 'AIRCRAFT') return 'Aircraft';
    return 'Organisation';
  }

  /**
   * Builds an Alert Evidence Graph for a multi-dimensional Screening Run Record.
   */
  public buildGraphForScreeningRun(
    run: ScreeningRunRecord,
    tenantId = 'default'
  ): AlertEvidenceGraph {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const nodeMap = new Set<string>();
    const missingDataIssues: MissingDataIssueItem[] = [];

    const graphId = `graph_${run.runId}`;
    const generatedAt = run.createdAt || new Date().toISOString();
    const manifestDigest = run.manifestDigest || 'UNKNOWN_MANIFEST';

    const defaultProvenance: GraphProvenance = {
      sourceOrProvider: 'SCREENING_RUN',
      originalRecordId: run.runId,
      snapshotOrVersion: run.policyVersion || 'POL-CURRENT',
      retrievalTime: generatedAt,
      authorizedUrlOrRef: run.evidenceDigest,
    };

    // 1. Submitted Query Subject Fact (SUBMITTED_FACT)
    const subjectId = this.makeId('sub', run.queryEntity.entityType || 'entity', run.queryEntity.name);
    const subNode: GraphNode = {
      id: subjectId,
      label: this.sanitizeLabel(run.queryEntity.name, 'Submitted Entity'),
      nodeType: this.mapEntityTypeToNodeType(run.queryEntity.entityType),
      category: 'SUBMITTED_FACT',
      provenance: {
        sourceOrProvider: 'USER_QUERY_INPUT',
        originalRecordId: run.subjectId || run.runId,
        snapshotOrVersion: 'SUBMISSION_V1',
        retrievalTime: generatedAt,
        originalFieldOrTag: 'queryEntity.name',
      },
      properties: {
        rawName: run.queryEntity.name,
        entityType: run.queryEntity.entityType,
        country: run.queryEntity.country,
        defragmented: run.normalizationDetails?.defragmented,
        normalizedName: run.normalizationDetails?.normalizedName,
      },
      riskLevel: 'NONE',
    };
    this.addNode(nodes, nodeMap, subNode);

    // Submitted Country Fact
    if (run.queryEntity.country) {
      const countryId = this.makeId('loc', 'country', run.queryEntity.country);
      this.addNode(nodes, nodeMap, {
        id: countryId,
        label: this.sanitizeLabel(run.queryEntity.country),
        nodeType: 'Country',
        category: 'SUBMITTED_FACT',
        provenance: {
          sourceOrProvider: 'USER_QUERY_INPUT',
          originalRecordId: run.runId,
          snapshotOrVersion: 'SUBMISSION_V1',
          retrievalTime: generatedAt,
          originalFieldOrTag: 'queryEntity.country',
        },
        properties: { code: run.queryEntity.country },
        riskLevel: 'NONE',
      });
      // Located in edge (pure location fact, NOT causation or misconduct)
      this.addEdge(edges, {
        id: `edge:${subjectId}->${countryId}:located_in`,
        sourceNodeId: subjectId,
        targetNodeId: countryId,
        edgeType: 'located_in',
        label: 'located in (submitted fact)',
        provenance: defaultProvenance,
      });
    }

    // Submitted Typed Identifiers
    if (run.queryEntity.identifiers) {
      for (const idf of run.queryEntity.identifiers) {
        const idfNodeId = this.makeId('idf', idf.type, idf.value);
        this.addNode(nodes, nodeMap, {
          id: idfNodeId,
          label: `${idf.type}: ${idf.value}`,
          nodeType: 'Identifier',
          category: 'SUBMITTED_FACT',
          provenance: {
            sourceOrProvider: 'USER_QUERY_INPUT',
            originalRecordId: run.runId,
            snapshotOrVersion: 'SUBMISSION_V1',
            retrievalTime: generatedAt,
            originalFieldOrTag: `identifiers.${idf.type}`,
          },
          properties: { type: idf.type, value: idf.value, issuingAuthority: idf.issuer || idf.country },
          riskLevel: 'NONE',
        });
        this.addEdge(edges, {
          id: `edge:${subjectId}->${idfNodeId}:extracted_from`,
          sourceNodeId: subjectId,
          targetNodeId: idfNodeId,
          edgeType: 'extracted_from',
          label: `carries identifier ${idf.type}`,
          provenance: defaultProvenance,
        });
      }
    }

    // Missing Data separation (does NOT pollute the graph with floating MISSING nodes)
    if (run.dimensions?.inputCompleteness === 'INCOMPLETE') {
      missingDataIssues.push({
        field: 'country_or_identifier',
        affectedPartyOrDocument: run.queryEntity.name,
        severity: 'WARNING',
        description: 'Submission contains name only without jurisdiction or registered typed identifiers.',
        regulatoryBasis: 'FATF Recommendation 16 / Core Information Standard',
      });
    } else if (run.dimensions?.inputCompleteness === 'MISSING_CRITICAL') {
      missingDataIssues.push({
        field: 'primary_name',
        affectedPartyOrDocument: 'Query Target',
        severity: 'CRITICAL',
        description: 'Critical missing input: Entity name is blank or missing.',
        regulatoryBasis: 'Sanctions Screening Mandatory Input Integrity Policy',
      });
    }

    // 2. Screening Alert Node (POLICY_FINDING)
    if (run.candidateCount > 0 || run.requiresHumanReview) {
      const alertNodeId = this.makeId('alert', run.runId);
      const isHold = run.dimensions?.reviewOutcome === 'HOLD_FOR_INVESTIGATION';
      this.addNode(nodes, nodeMap, {
        id: alertNodeId,
        label: `Screening Alert: ${run.findingSeverity}`,
        nodeType: 'Alert',
        category: 'POLICY_FINDING',
        provenance: {
          sourceOrProvider: 'POLICY_ENGINE',
          originalRecordId: run.runId,
          snapshotOrVersion: run.policyVersion,
          retrievalTime: generatedAt,
          originalFieldOrTag: 'dimensions.candidateFindings',
        },
        properties: {
          severity: run.findingSeverity,
          highestScore: run.highestScore,
          reviewReasons: run.reviewReasons,
          reviewOutcome: run.dimensions?.reviewOutcome,
        },
        isAdverse: true,
        riskLevel: isHold ? 'CRITICAL' : 'HIGH',
      });

      this.addEdge(edges, {
        id: `edge:${subjectId}->${alertNodeId}:reviewed_as`,
        sourceNodeId: subjectId,
        targetNodeId: alertNodeId,
        edgeType: 'reviewed_as',
        label: `evaluated under policy -> ${run.dimensions?.reviewOutcome || 'REVIEW'}`,
        provenance: defaultProvenance,
      });

      // 3. Process Watchlist Candidates & Source Facts
      for (const cand of run.candidates) {
        this.processWatchlistCandidate(
          cand,
          subjectId,
          alertNodeId,
          nodes,
          edges,
          nodeMap,
          generatedAt,
          manifestDigest
        );
      }
    }

    return this.assembleGraph(
      graphId,
      '1.0',
      tenantId,
      'LISTS_AND_DATA_SOURCES',
      run.runId,
      undefined,
      manifestDigest,
      generatedAt,
      nodes,
      edges,
      missingDataIssues
    );
  }

  /**
   * Builds an Alert Evidence Graph for a Payment Compliance Case.
   */
  public buildGraphForPaymentCase(
    caseItem: PaymentComplianceCase,
    tenantId = 'default'
  ): AlertEvidenceGraph {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const nodeMap = new Set<string>();
    const missingDataIssues: MissingDataIssueItem[] = [];

    const graphId = `graph_case_${caseItem.caseId}`;
    const generatedAt = caseItem.updatedAt || caseItem.createdAt || new Date().toISOString();
    const tx = caseItem.transaction;
    const res = caseItem.screeningResult;
    const manifestDigest = sha256(res.listDigests || { date: generatedAt });

    const docProvenance: GraphProvenance = {
      sourceOrProvider: tx.messageFamily || 'SWIFT_MT',
      originalRecordId: tx.transactionId || caseItem.caseId,
      snapshotOrVersion: tx.messageType,
      retrievalTime: generatedAt,
      originalFieldOrTag: 'BLOCK_4',
      authorizedUrlOrRef: caseItem.evidenceHash,
    };

    // 1. Document Node (SUBMITTED_FACT)
    const docId = this.makeId('doc', tx.messageType, tx.transactionId || caseItem.caseId);
    this.addNode(nodes, nodeMap, {
      id: docId,
      label: `${tx.messageType} Payment (${tx.currency} ${tx.amount.toLocaleString()})`,
      nodeType: 'Document',
      category: 'SUBMITTED_FACT',
      provenance: docProvenance,
      properties: {
        messageType: tx.messageType,
        currency: tx.currency,
        amount: tx.amount,
        settlementDate: tx.settlementDate,
      },
      riskLevel: 'NONE',
    });

    // 2. Submitted Parties
    const partyNodeMap: Record<string, string> = {};
    for (const party of tx.parties) {
      const partyNodeId = this.makeId('sub', party.role, party.name);
      partyNodeMap[party.partyId || party.role] = partyNodeId;

      this.addNode(nodes, nodeMap, {
        id: partyNodeId,
        label: `${party.role}: ${this.sanitizeLabel(party.name)}`,
        nodeType: party.role.includes('BANK') || party.role.includes('INSTITUTION') ? 'Organisation' : 'Person',
        category: 'SUBMITTED_FACT',
        provenance: {
          ...docProvenance,
          originalRecordId: party.partyId,
          originalFieldOrTag: party.provenance?.sourceTag || party.role,
        },
        properties: {
          role: party.role,
          name: party.name,
          accountNumber: redactSensitiveDataForAgent(party.accountNumber || ''),
          country: party.country || party.address?.country,
          addressLines: party.address?.rawLines,
        },
        riskLevel: 'NONE',
      });

      this.addEdge(edges, {
        id: `edge:${docId}->${partyNodeId}:extracted_from`,
        sourceNodeId: docId,
        targetNodeId: partyNodeId,
        edgeType: 'extracted_from',
        label: `extracted as ${party.role}`,
        provenance: docProvenance,
      });

      // Party Country Fact
      const partyCountry = party.country || party.address?.country;
      if (partyCountry) {
        const countryId = this.makeId('loc', 'country', partyCountry);
        this.addNode(nodes, nodeMap, {
          id: countryId,
          label: this.sanitizeLabel(partyCountry),
          nodeType: 'Country',
          category: 'SUBMITTED_FACT',
          provenance: docProvenance,
          properties: { code: partyCountry },
          riskLevel: 'NONE',
        });
        this.addEdge(edges, {
          id: `edge:${partyNodeId}->${countryId}:located_in`,
          sourceNodeId: partyNodeId,
          targetNodeId: countryId,
          edgeType: 'located_in',
          label: 'recorded in country',
          provenance: docProvenance,
        });
      }
    }

    // 3. Separate Missing Data Audit (NO disconnected : MISSING nodes!)
    if (res.missingDataIssues && res.missingDataIssues.length > 0) {
      for (const iss of res.missingDataIssues) {
        missingDataIssues.push({
          field: iss.field,
          affectedPartyOrDocument: iss.partyRole || 'Transaction Payload',
          severity: iss.severity === 'CRITICAL_MISSING' ? 'CRITICAL' : 'WARNING',
          description: iss.ruleDescription || 'Mandatory party details missing',
          regulatoryBasis: iss.ruleId || 'FATF Rec 16',
        });
      }
    }

    // 4. Alert Node (POLICY_FINDING)
    const alertId = this.makeId('alert', caseItem.caseId);
    const hasHits = res.findingSeverity !== 'NO_MATCH_FOUND';
    this.addNode(nodes, nodeMap, {
      id: alertId,
      label: `Case Alert: ${caseItem.status} (${caseItem.priority})`,
      nodeType: 'Alert',
      category: 'POLICY_FINDING',
      provenance: {
        sourceOrProvider: 'COMPLIANCE_GATE_GATEWAY',
        originalRecordId: caseItem.caseId,
        snapshotOrVersion: caseItem.policyVersion || 'POL-CURRENT',
        retrievalTime: generatedAt,
        authorizedUrlOrRef: caseItem.evidenceHash,
      },
      properties: {
        status: caseItem.status,
        priority: caseItem.priority,
        findingSeverity: res.findingSeverity,
        highestScore: res.highestScore,
        coverageStatus: res.coverageStatus,
      },
      isAdverse: hasHits,
      riskLevel: hasHits ? (caseItem.priority === 'CRITICAL' ? 'CRITICAL' : 'HIGH') : 'NONE',
    });

    this.addEdge(edges, {
      id: `edge:${docId}->${alertId}:reviewed_as`,
      sourceNodeId: docId,
      targetNodeId: alertId,
      edgeType: 'reviewed_as',
      label: `evaluated as case ${caseItem.caseId}`,
      provenance: docProvenance,
    });

    // 5. Party Outcomes & Candidate Matches
    for (const po of res.partyOutcomes) {
      const partyNodeId = partyNodeMap[po.party.partyId || po.party.role];
      if (!partyNodeId) continue;

      for (const match of po.matches) {
        this.processWatchlistCandidate(
          match,
          partyNodeId,
          alertId,
          nodes,
          edges,
          nodeMap,
          generatedAt,
          manifestDigest
        );
      }
    }

    // 6. Review Decision Node if Adjudicated (REVIEW_DECISION)
    if (caseItem.auditTrail && caseItem.auditTrail.length > 0) {
      const latestAudit = caseItem.auditTrail[caseItem.auditTrail.length - 1];
      if (latestAudit.decision !== 'INITIAL_CREATION') {
        const decisionNodeId = this.makeId('dec', caseItem.caseId, latestAudit.actionId);
        this.addNode(nodes, nodeMap, {
          id: decisionNodeId,
          label: `Adjudication: ${latestAudit.decision}`,
          nodeType: 'Review Decision',
          category: 'REVIEW_DECISION',
          provenance: {
            sourceOrProvider: 'ADJUDICATION_OFFICER',
            originalRecordId: latestAudit.actionId,
            snapshotOrVersion: caseItem.caseId,
            retrievalTime: latestAudit.timestamp,
            originalFieldOrTag: 'auditTrail.decision',
            authorizedUrlOrRef: latestAudit.serverChecksum,
          },
          properties: {
            decision: latestAudit.decision,
            analystId: latestAudit.analystId,
            analystRole: latestAudit.analystRole,
            rationale: latestAudit.rationale,
            newStatus: latestAudit.newStatus,
          },
          riskLevel: latestAudit.decision === 'CONFIRM_ENTITY_MATCH' ? 'CRITICAL' : 'NONE',
        });

        this.addEdge(edges, {
          id: `edge:${alertId}->${decisionNodeId}:reviewed_as`,
          sourceNodeId: alertId,
          targetNodeId: decisionNodeId,
          edgeType: 'reviewed_as',
          label: `adjudicated as ${latestAudit.decision}`,
          provenance: {
            sourceOrProvider: 'AUDIT_LEDGER',
            originalRecordId: latestAudit.actionId,
            snapshotOrVersion: caseItem.caseId,
            retrievalTime: latestAudit.timestamp,
            authorizedUrlOrRef: latestAudit.serverChecksum,
          },
        });
      }
    }

    const graph = this.assembleGraph(
      graphId,
      '1.0',
      tenantId,
      'PAYMENTS',
      undefined,
      caseItem.caseId,
      manifestDigest,
      generatedAt,
      nodes,
      edges,
      missingDataIssues
    );

    // Save graph to persistent store
    storageRepository.saveEvidenceGraph(graph);

    return graph;
  }

  /**
   * Builds an Alert Evidence Graph for Payment Screening Result.
   */
  public buildGraphForPaymentScreening(
    screening: PaymentScreeningResult,
    transaction: CanonicalPaymentTransaction,
    tenantId = 'default'
  ): AlertEvidenceGraph {
    // Wrap as temporary case structure to reuse clean projection
    const tempCase: PaymentComplianceCase = {
      caseId: screening.caseId || `scr_${screening.referenceId}`,
      tenantId,
      createdAt: screening.timestamp,
      updatedAt: screening.timestamp,
      transaction,
      screeningResult: screening,
      status: screening.requiresHumanReview ? 'PENDING_REVIEW' : 'FALSE_POSITIVE_CLEARED',
      priority: screening.findingSeverity === 'EXACT_IDENTIFIER_MATCH' ? 'CRITICAL' : 'MEDIUM',
      auditTrail: [],
      evidenceHash: screening.payloadDigest,
      policyVersion: screening.policyVersion,
    };
    return this.buildGraphForPaymentCase(tempCase, tenantId);
  }

  /**
   * Builds an Alert Evidence Graph for any of the 9 specialized modules.
   */
  public buildGraphForModuleEvaluation(
    moduleId: ComplianceModuleId,
    evaluation: any,
    tenantId = 'default'
  ): AlertEvidenceGraph {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const nodeMap = new Set<string>();
    const missingDataIssues: MissingDataIssueItem[] = [];

    const graphId = `graph_${moduleId.toLowerCase()}_${evaluation.id || evaluation.referenceId || Date.now()}`;
    const generatedAt = evaluation.timestamp || new Date().toISOString();
    const manifestDigest = sha256({ moduleId, id: evaluation.id, date: generatedAt });

    const baseProvenance: GraphProvenance = {
      sourceOrProvider: moduleId,
      originalRecordId: evaluation.id || evaluation.referenceId || 'SYNTHETIC_EVAL',
      snapshotOrVersion: 'MODULE_V1',
      retrievalTime: generatedAt,
    };

    switch (moduleId) {
      case 'LISTS_AND_DATA_SOURCES': {
        return this.buildGraphForScreeningRun(evaluation, tenantId);
      }

      case 'TRADE_AND_CARGO': {
        // Trade Documents & Counterparties
        const inv = evaluation.documentsScreened;
        const docId = this.makeId('doc', 'trade', evaluation.referenceId || evaluation.id);
        this.addNode(nodes, nodeMap, {
          id: docId,
          label: `Bill of Lading: ${inv?.blNumber || 'BL-DEFAULT'}`,
          nodeType: 'Document',
          category: 'SUBMITTED_FACT',
          provenance: baseProvenance,
          properties: { ...inv },
        });

        // Counterparties
        if (Array.isArray(evaluation.parties)) {
          for (const p of evaluation.parties) {
            const pId = this.makeId('sub', p.role, p.name);
            this.addNode(nodes, nodeMap, {
              id: pId,
              label: `${p.role}: ${this.sanitizeLabel(p.name)}`,
              nodeType: 'Organisation',
              category: 'SUBMITTED_FACT',
              provenance: { ...baseProvenance, originalFieldOrTag: p.role },
              properties: { role: p.role, country: p.country, status: p.status },
            });
            this.addEdge(edges, {
              id: `edge:${docId}->${pId}:extracted_from`,
              sourceNodeId: docId,
              targetNodeId: pId,
              edgeType: 'extracted_from',
              label: `stated as ${p.role}`,
              provenance: baseProvenance,
            });

            // Matches
            if (p.matches && Array.isArray(p.matches)) {
              for (const m of p.matches) {
                this.processWatchlistCandidate(m, pId, docId, nodes, edges, nodeMap, generatedAt, manifestDigest);
              }
            }
          }
        }

        // Dual Use Hits
        if (Array.isArray(evaluation.dualUseHits)) {
          for (const hit of evaluation.dualUseHits) {
            const hitId = this.makeId('alert', 'dual_use', hit.hsCode);
            this.addNode(nodes, nodeMap, {
              id: hitId,
              label: `Dual-Use Alert: HS ${hit.hsCode} (${hit.proliferationCategory})`,
              nodeType: 'Alert',
              category: 'POLICY_FINDING',
              provenance: { ...baseProvenance, originalFieldOrTag: 'dualUseHits.hsCode' },
              properties: { ...hit },
              isAdverse: true,
              riskLevel: 'HIGH',
            });
            this.addEdge(edges, {
              id: `edge:${docId}->${hitId}:reviewed_as`,
              sourceNodeId: docId,
              targetNodeId: hitId,
              edgeType: 'reviewed_as',
              label: `dual-use flag (${hit.licensingRequirement || 'Licence Required'})`,
              provenance: baseProvenance,
            });
          }
        }

        // Discrepancies separated from graph
        if (Array.isArray(evaluation.discrepancies)) {
          for (const d of evaluation.discrepancies) {
            missingDataIssues.push({
              field: d.category,
              affectedPartyOrDocument: `${d.sourceDoc} vs ${d.comparedDoc}`,
              severity: d.severity === 'CRITICAL' ? 'CRITICAL' : 'WARNING',
              description: d.description,
              regulatoryBasis: 'Uniform Customs and Practice for Documentary Credits (UCP 600)',
            });
          }
        }
        break;
      }

      case 'MARITIME': {
        // Vessel & IMO
        const v = evaluation.vessel || {};
        const vesselId = this.makeId('sub', 'vessel', v.imoNumber || v.vesselName || 'VESSEL');
        this.addNode(nodes, nodeMap, {
          id: vesselId,
          label: `Vessel: ${this.sanitizeLabel(v.vesselName, 'Unidentified Vessel')}`,
          nodeType: 'Vessel',
          category: 'SUBMITTED_FACT',
          provenance: baseProvenance,
          properties: {
            imoNumber: v.imoNumber,
            mmsi: v.mmsi,
            flag: v.flag,
            vesselType: v.vesselType,
            builtYear: v.builtYear,
          },
        });

        // Registered Owner (documented_owner_of)
        if (v.registeredOwner) {
          const ownerId = this.makeId('sub', 'org', v.registeredOwner);
          this.addNode(nodes, nodeMap, {
            id: ownerId,
            label: `Owner: ${this.sanitizeLabel(v.registeredOwner)}`,
            nodeType: 'Organisation',
            category: 'SUBMITTED_FACT',
            provenance: { ...baseProvenance, originalFieldOrTag: 'vessel.registeredOwner' },
            properties: { role: 'REGISTERED_OWNER' },
          });
          this.addEdge(edges, {
            id: `edge:${ownerId}->${vesselId}:documented_owner_of`,
            sourceNodeId: ownerId,
            targetNodeId: vesselId,
            edgeType: 'documented_owner_of',
            label: 'documented registered owner',
            provenance: baseProvenance,
          });
        }

        // Port Calls
        if (Array.isArray(evaluation.portHistory)) {
          for (const port of evaluation.portHistory) {
            const portId = this.makeId('loc', 'city', port.portCode || port.portName);
            this.addNode(nodes, nodeMap, {
              id: portId,
              label: `Port: ${this.sanitizeLabel(port.portName)} (${port.country})`,
              nodeType: 'City',
              category: 'SUBMITTED_FACT',
              provenance: { ...baseProvenance, originalFieldOrTag: 'portHistory' },
              properties: { ...port },
            });
            this.addEdge(edges, {
              id: `edge:${vesselId}->${portId}:located_in`,
              sourceNodeId: vesselId,
              targetNodeId: portId,
              edgeType: 'located_in',
              label: `visited on ${port.departureDate || port.arrivalDate}`,
              provenance: baseProvenance,
            });
          }
        }

        // Screening Alerts
        if (Array.isArray(evaluation.screeningAlerts)) {
          for (const alert of evaluation.screeningAlerts) {
            const aId = this.makeId('alert', 'maritime', alert.alertId || alert.description);
            this.addNode(nodes, nodeMap, {
              id: aId,
              label: `Maritime Alert: ${alert.category || 'RISK'}`,
              nodeType: 'Alert',
              category: 'POLICY_FINDING',
              provenance: baseProvenance,
              properties: { ...alert },
              isAdverse: true,
              riskLevel: alert.severity === 'CRITICAL' ? 'CRITICAL' : 'HIGH',
            });
            this.addEdge(edges, {
              id: `edge:${vesselId}->${aId}:reviewed_as`,
              sourceNodeId: vesselId,
              targetNodeId: aId,
              edgeType: 'reviewed_as',
              label: `flagged for ${alert.description}`,
              provenance: baseProvenance,
            });
          }
        }

        // AIS Gaps in Missing Data panel
        if (Array.isArray(evaluation.aisGaps)) {
          for (const gap of evaluation.aisGaps) {
            missingDataIssues.push({
              field: 'AIS_TRANSPONDER_SIGNAL',
              affectedPartyOrDocument: v.vesselName || 'Vessel AIS',
              severity: gap.severity === 'CRITICAL' ? 'CRITICAL' : 'WARNING',
              description: `AIS transponder blackout detected for ${gap.durationHours} hours near ${gap.locationDescription || 'unknown waters'}.`,
              regulatoryBasis: 'IMO Resolution A.1106(29) / OFAC Maritime Advisory',
            });
          }
        }
        break;
      }

      case 'AIR_CARGO': {
        const awb = evaluation.shipment || {};
        const awbId = this.makeId('doc', 'awb', awb.awbNumber || 'AWB-DEFAULT');
        this.addNode(nodes, nodeMap, {
          id: awbId,
          label: `AWB: ${awb.awbNumber || 'Air Waybill'}`,
          nodeType: 'Document',
          category: 'SUBMITTED_FACT',
          provenance: baseProvenance,
          properties: { ...awb },
        });

        if (Array.isArray(evaluation.parties)) {
          for (const p of evaluation.parties) {
            const pId = this.makeId('sub', p.role, p.name);
            this.addNode(nodes, nodeMap, {
              id: pId,
              label: `${p.role}: ${this.sanitizeLabel(p.name)}`,
              nodeType: 'Organisation',
              category: 'SUBMITTED_FACT',
              provenance: baseProvenance,
              properties: { ...p },
            });
            this.addEdge(edges, {
              id: `edge:${awbId}->${pId}:extracted_from`,
              sourceNodeId: awbId,
              targetNodeId: pId,
              edgeType: 'extracted_from',
              label: `stated as ${p.role}`,
              provenance: baseProvenance,
            });

            if (p.matches && Array.isArray(p.matches)) {
              for (const m of p.matches) {
                this.processWatchlistCandidate(m, pId, awbId, nodes, edges, nodeMap, generatedAt, manifestDigest);
              }
            }
          }
        }
        break;
      }

      case 'INSURANCE': {
        const pol = evaluation.policy || {};
        const polId = this.makeId('doc', 'policy', pol.policyNumber || 'POL-DEFAULT');
        this.addNode(nodes, nodeMap, {
          id: polId,
          label: `Policy: ${pol.policyNumber || 'INS-DEFAULT'}`,
          nodeType: 'Document',
          category: 'SUBMITTED_FACT',
          provenance: baseProvenance,
          properties: { ...pol },
        });

        // Disclosed Corporate Owners (with exact semantics: documented_owner_of vs accounting_parent_of)
        if (Array.isArray(evaluation.ownershipChain)) {
          for (const node of evaluation.ownershipChain) {
            const oId = this.makeId('sub', 'org', node.entityName);
            this.addNode(nodes, nodeMap, {
              id: oId,
              label: `${this.sanitizeLabel(node.entityName)} (${node.percentage}%)`,
              nodeType: 'Organisation',
              category: 'SUBMITTED_FACT',
              provenance: baseProvenance,
              properties: { percentage: node.percentage, isUbo: node.isUbo, jurisdiction: node.jurisdiction },
            });

            // Check if GLEIF accounting parent
            const isGleifParent = node.source === 'GLEIF' || node.relationshipType === 'ACCOUNTING_PARENT';
            this.addEdge(edges, {
              id: `edge:${oId}->${polId}:${isGleifParent ? 'accounting_parent_of' : 'documented_owner_of'}`,
              sourceNodeId: oId,
              targetNodeId: polId,
              edgeType: isGleifParent ? 'accounting_parent_of' : 'documented_owner_of',
              label: isGleifParent
                ? 'accounting parent of (GLEIF consolidation != beneficial owner)'
                : `documented owner of (${node.percentage}%)`,
              provenance: baseProvenance,
            });
          }
        }

        if (Array.isArray(evaluation.screeningMatches)) {
          for (const m of evaluation.screeningMatches) {
            this.processWatchlistCandidate(m, polId, polId, nodes, edges, nodeMap, generatedAt, manifestDigest);
          }
        }
        break;
      }

      case 'CRYPTO': {
        const txInfo = evaluation.transaction || {};
        const txNodeId = this.makeId('doc', 'crypto', txInfo.txHash || 'CRYPTO-TX');
        this.addNode(nodes, nodeMap, {
          id: txNodeId,
          label: `Crypto Tx: ${this.sanitizeLabel((txInfo.txHash || 'TX').slice(0, 16))}...`,
          nodeType: 'Document',
          category: 'SUBMITTED_FACT',
          provenance: baseProvenance,
          properties: { ...txInfo },
        });

        if (txInfo.originatorAddress) {
          const addrId = this.makeId('idf', 'wallet', txInfo.originatorAddress);
          this.addNode(nodes, nodeMap, {
            id: addrId,
            label: `Wallet: ${txInfo.originatorAddress.slice(0, 10)}... (${txInfo.blockchain || 'ETH'})`,
            nodeType: 'Identifier',
            category: 'SUBMITTED_FACT',
            provenance: baseProvenance,
            properties: { address: txInfo.originatorAddress, chain: txInfo.blockchain },
          });
          this.addEdge(edges, {
            id: `edge:${txNodeId}->${addrId}:extracted_from`,
            sourceNodeId: txNodeId,
            targetNodeId: addrId,
            edgeType: 'extracted_from',
            label: 'originator wallet address',
            provenance: baseProvenance,
          });
        }

        if (Array.isArray(evaluation.screeningMatches)) {
          for (const m of evaluation.screeningMatches) {
            this.processWatchlistCandidate(m, txNodeId, txNodeId, nodes, edges, nodeMap, generatedAt, manifestDigest);
          }
        }
        break;
      }

      case 'HEALTHCARE': {
        const p = evaluation.practitioner || {};
        const pNodeId = this.makeId('sub', 'person', p.name || 'PRACTITIONER');
        this.addNode(nodes, nodeMap, {
          id: pNodeId,
          label: `Dr. ${this.sanitizeLabel(p.name, 'Practitioner')}`,
          nodeType: 'Person',
          category: 'SUBMITTED_FACT',
          provenance: baseProvenance,
          properties: { ...p },
        });

        if (p.npi) {
          const npiId = this.makeId('idf', 'npi', p.npi);
          this.addNode(nodes, nodeMap, {
            id: npiId,
            label: `NPI: ${p.npi}`,
            nodeType: 'Identifier',
            category: 'SUBMITTED_FACT',
            provenance: baseProvenance,
            properties: { npi: p.npi, registry: 'CMS_NPPES' },
          });
          this.addEdge(edges, {
            id: `edge:${pNodeId}->${npiId}:extracted_from`,
            sourceNodeId: pNodeId,
            targetNodeId: npiId,
            edgeType: 'extracted_from',
            label: 'enumerated provider identifier',
            provenance: baseProvenance,
          });
        }

        if (Array.isArray(evaluation.exclusions)) {
          for (const exc of evaluation.exclusions) {
            const eId = this.makeId('alert', 'oig', exc.exclusionType || exc.recordId);
            this.addNode(nodes, nodeMap, {
              id: eId,
              label: `Exclusion: OIG-LEIE (${exc.authority || 'HHS'})`,
              nodeType: 'Alert',
              category: 'POLICY_FINDING',
              provenance: baseProvenance,
              properties: { ...exc },
              isAdverse: true,
              riskLevel: 'CRITICAL',
            });
            this.addEdge(edges, {
              id: `edge:${pNodeId}->${eId}:reviewed_as`,
              sourceNodeId: pNodeId,
              targetNodeId: eId,
              edgeType: 'reviewed_as',
              label: `statutory exclusion under ${exc.legalBasis || 'Section 1128'}`,
              provenance: baseProvenance,
            });
          }
        }
        break;
      }

      case 'SECURITIES': {
        const order = evaluation.order || {};
        const oId = this.makeId('doc', 'order', order.orderId || 'FIX-ORDER');
        this.addNode(nodes, nodeMap, {
          id: oId,
          label: `FIX Order: ${order.orderId || 'ORD-DEFAULT'} (${order.side || 'BUY'} ${order.quantity || ''})`,
          nodeType: 'Document',
          category: 'SUBMITTED_FACT',
          provenance: baseProvenance,
          properties: { ...order },
        });

        if (order.isin) {
          const isinId = this.makeId('idf', 'isin', order.isin);
          this.addNode(nodes, nodeMap, {
            id: isinId,
            label: `ISIN: ${order.isin}`,
            nodeType: 'Identifier',
            category: 'SUBMITTED_FACT',
            provenance: baseProvenance,
            properties: { isin: order.isin },
          });
          this.addEdge(edges, {
            id: `edge:${oId}->${isinId}:extracted_from`,
            sourceNodeId: oId,
            targetNodeId: isinId,
            edgeType: 'extracted_from',
            label: 'instrument security code',
            provenance: baseProvenance,
          });
        }

        if (Array.isArray(evaluation.screeningMatches)) {
          for (const m of evaluation.screeningMatches) {
            this.processWatchlistCandidate(m, oId, oId, nodes, edges, nodeMap, generatedAt, manifestDigest);
          }
        }
        break;
      }

      case 'VALIDATION_AND_AUDIT': {
        const benchNodeId = this.makeId('doc', 'validation', evaluation.benchmarkId || 'BENCHMARK');
        this.addNode(nodes, nodeMap, {
          id: benchNodeId,
          label: `Validation Benchmark (${evaluation.casesEvaluated || 8} vectors)`,
          nodeType: 'Document',
          category: 'SUBMITTED_FACT',
          provenance: baseProvenance,
          properties: { ...evaluation },
        });
        break;
      }

      default: {
        // Generic fallback for any module
        const rootId = this.makeId('doc', moduleId, evaluation.id || 'EVAL');
        this.addNode(nodes, nodeMap, {
          id: rootId,
          label: `${moduleId} Evaluation`,
          nodeType: 'Document',
          category: 'SUBMITTED_FACT',
          provenance: baseProvenance,
          properties: { ...evaluation },
        });
        break;
      }
    }

    const graph = this.assembleGraph(
      graphId,
      '1.0',
      tenantId,
      moduleId,
      evaluation.screeningRunId,
      evaluation.caseId,
      manifestDigest,
      generatedAt,
      nodes,
      edges,
      missingDataIssues
    );

    storageRepository.saveEvidenceGraph(graph);
    return graph;
  }

  /**
   * Helper that processes an official Watchlist Candidate, separating:
   * 1. The submitted subject and listed candidate (MUST remain separate nodes!).
   * 2. Why the alert fired (matched name/alias/identifier, score, match method).
   * 3. What the publisher states (program, legal authority, published reason, designation date).
   */
  private processWatchlistCandidate(
    cand: MatchDetail,
    submittedSubjectId: string,
    alertNodeId: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
    nodeMap: Set<string>,
    retrievalTime: string,
    manifestDigest: string
  ): void {
    const sourceId = cand.listId || 'OFAC_SDN';
    const originalEntryId = cand.entryId || 'DEMO-CAND-001';
    const isInternal = sourceId.startsWith('INTERNAL_') || sourceId === 'BYO_PRIVATE';

    const sourceProvenance: GraphProvenance = {
      sourceOrProvider: sourceId,
      originalRecordId: originalEntryId,
      snapshotOrVersion: manifestDigest.slice(0, 16),
      retrievalTime,
      authorizedUrlOrRef: `urn:compliancegate:source:${sourceId}:${originalEntryId}`,
      isRestrictedInternal: isInternal,
    };

    // 1. Candidate Watchlist Record Node (WATCHLIST_CANDIDATE) - Stays separate from submitted subject!
    const candNodeId = this.makeId('cand', sourceId, originalEntryId);
    this.addNode(nodes, nodeMap, {
      id: candNodeId,
      label: `Listed Candidate: ${this.sanitizeLabel(cand.entryName)}`,
      nodeType: this.mapEntityTypeToNodeType(cand.entryType),
      category: 'WATCHLIST_CANDIDATE',
      provenance: sourceProvenance,
      properties: {
        listId: cand.listId,
        listName: cand.listName,
        entryId: cand.entryId,
        entryName: cand.entryName,
        matchedField: cand.matchedField,
        similarityScore: cand.similarityScore,
        matchType: cand.matchType,
        isExactIdentifier: cand.isExactIdentifier,
      },
      isAdverse: true,
      riskLevel: cand.isExactIdentifier ? 'CRITICAL' : 'HIGH',
    });

    // 2. Explicit Typed Edge from Submitted Subject -> Candidate: 'possible_match_to' or 'identifier_matches'
    const matchEdgeType: GraphEdgeType = cand.isExactIdentifier ? 'identifier_matches' : 'possible_match_to';
    this.addEdge(edges, {
      id: `edge:${submittedSubjectId}->${candNodeId}:${matchEdgeType}`,
      sourceNodeId: submittedSubjectId,
      targetNodeId: candNodeId,
      edgeType: matchEdgeType,
      label: cand.isExactIdentifier
        ? `exact identifier match (${cand.matchedField})`
        : `possible match to (${cand.matchType}: ${(cand.similarityScore * 100).toFixed(0)}%)`,
      provenance: {
        sourceOrProvider: 'MATCHING_ENGINE',
        originalRecordId: originalEntryId,
        snapshotOrVersion: 'SCORE_V1',
        retrievalTime,
      },
      isHypothesized: !cand.isExactIdentifier,
      properties: {
        matchType: cand.matchType,
        matchedField: cand.matchedField,
        similarityScore: cand.similarityScore,
        queryValue: cand.queryValue,
        listValue: cand.listValue,
      },
    });

    // Link Candidate to the Alert
    this.addEdge(edges, {
      id: `edge:${candNodeId}->${alertNodeId}:reviewed_as`,
      sourceNodeId: candNodeId,
      targetNodeId: alertNodeId,
      edgeType: 'reviewed_as',
      label: 'adverse finding recorded',
      provenance: sourceProvenance,
    });

    // 3. Source Record Node (SOURCE_ASSERTION)
    const sourceRecordNodeId = this.makeId('srcrec', sourceId, originalEntryId);
    this.addNode(nodes, nodeMap, {
      id: sourceRecordNodeId,
      label: `${cand.listName || sourceId} Record #${originalEntryId}`,
      nodeType: 'Source Record',
      category: 'SOURCE_ASSERTION',
      provenance: sourceProvenance,
      properties: {
        listId: sourceId,
        recordId: originalEntryId,
        retrievalDate: retrievalTime,
      },
      riskLevel: 'INFORMATIONAL',
    });

    this.addEdge(edges, {
      id: `edge:${candNodeId}->${sourceRecordNodeId}:listed_by`,
      sourceNodeId: candNodeId,
      targetNodeId: sourceRecordNodeId,
      edgeType: 'listed_by',
      label: 'listed on official catalogue',
      provenance: sourceProvenance,
    });

    // 4. Sanctions Programs (SOURCE_ASSERTION)
    if (cand.programs && cand.programs.length > 0) {
      for (const prog of cand.programs) {
        const progNodeId = this.makeId('prog', prog);
        this.addNode(nodes, nodeMap, {
          id: progNodeId,
          label: `Program: ${this.sanitizeLabel(prog)}`,
          nodeType: 'Sanctions Program',
          category: 'SOURCE_ASSERTION',
          provenance: sourceProvenance,
          properties: { program: prog },
          riskLevel: 'HIGH',
        });

        this.addEdge(edges, {
          id: `edge:${sourceRecordNodeId}->${progNodeId}:subject_to_program`,
          sourceNodeId: sourceRecordNodeId,
          targetNodeId: progNodeId,
          edgeType: 'subject_to_program',
          label: 'designated under sanctions program',
          provenance: sourceProvenance,
        });
      }
    }

    // 5. Published Reason Node (SOURCE_ASSERTION)
    // Rule: Show what publisher states or explicitly "Not provided by source"; DO NOT invent facts with LLM!
    const publishedReasonText = cand.notes ? this.sanitizeLabel(cand.notes) : 'Not provided by source';
    const reasonNodeId = this.makeId('reason', sourceId, originalEntryId);
    this.addNode(nodes, nodeMap, {
      id: reasonNodeId,
      label: `Published Basis: ${publishedReasonText.slice(0, 50)}${publishedReasonText.length > 50 ? '...' : ''}`,
      nodeType: 'Published Reason',
      category: 'SOURCE_ASSERTION',
      provenance: sourceProvenance,
      properties: {
        explanation: publishedReasonText,
        isExplicitlyMissing: !cand.notes,
      },
      riskLevel: cand.notes ? 'HIGH' : 'INFORMATIONAL',
    });

    this.addEdge(edges, {
      id: `edge:${sourceRecordNodeId}->${reasonNodeId}:source_states_reason`,
      sourceNodeId: sourceRecordNodeId,
      targetNodeId: reasonNodeId,
      edgeType: 'source_states_reason',
      label: 'official published statement',
      provenance: sourceProvenance,
    });
  }

  private addNode(nodes: GraphNode[], nodeMap: Set<string>, node: GraphNode): void {
    if (nodeMap.has(node.id)) return;
    if (nodes.length >= MAX_GRAPH_NODES) return;
    nodeMap.add(node.id);
    nodes.push(node);
  }

  private addEdge(edges: GraphEdge[], edge: GraphEdge): void {
    if (edges.some((e) => e.id === edge.id)) return;
    edges.push(edge);
  }

  /**
   * Finalizes and bounds graph, calculating counts, truncation and digest.
   */
  private assembleGraph(
    graphId: string,
    version: string,
    tenantId: string,
    moduleId: ComplianceModuleId,
    screeningRunId: string | undefined,
    caseId: string | undefined,
    manifestDigest: string,
    generatedAt: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
    missingDataIssues: MissingDataIssueItem[]
  ): AlertEvidenceGraph {
    const totalNodeCount = nodes.length;
    const isTruncated = totalNodeCount >= MAX_GRAPH_NODES;

    // Filter edges to only those connecting existing nodes
    const validNodeIds = new Set(nodes.map((n) => n.id));
    const validEdges = edges.filter(
      (e) => validNodeIds.has(e.sourceNodeId) && validNodeIds.has(e.targetNodeId)
    );

    const summary = {
      submittedEntityCount: nodes.filter((n) => n.category === 'SUBMITTED_FACT').length,
      candidateCount: nodes.filter((n) => n.category === 'WATCHLIST_CANDIDATE').length,
      sourceFactCount: nodes.filter((n) => n.category === 'SOURCE_ASSERTION').length,
      alertCount: nodes.filter((n) => n.category === 'POLICY_FINDING').length,
      decisionCount: nodes.filter((n) => n.category === 'REVIEW_DECISION').length,
    };

    const evidenceDigest = sha256({
      graphId,
      tenantId,
      manifestDigest,
      nodeCount: nodes.length,
      edgeCount: validEdges.length,
      nodeIds: nodes.map((n) => n.id).sort(),
      edgeIds: validEdges.map((e) => e.id).sort(),
      generatedAt,
    });

    return {
      graphId,
      version,
      tenantId,
      generatedAt,
      screeningRunId,
      caseId,
      moduleId,
      manifestDigest,
      nodes,
      edges: validEdges,
      isTruncated,
      totalNodeCount,
      totalEdgeCount: validEdges.length,
      maxNodesAllowed: MAX_GRAPH_NODES,
      missingDataIssues,
      summary,
      evidenceDigest,
    };
  }

  /**
   * Redacts sensitive PII in graph properties for AI agent / MCP consumption.
   */
  public redactGraphForAgent(graph: AlertEvidenceGraph): AlertEvidenceGraph {
    const redactedNodes: GraphNode[] = graph.nodes.map((n) => {
      const redProps = { ...n.properties };
      if (redProps.accountNumber) redProps.accountNumber = redactSensitiveDataForAgent(redProps.accountNumber);
      if (redProps.passport) redProps.passport = redactSensitiveDataForAgent(redProps.passport);
      if (redProps.taxId) redProps.taxId = redactSensitiveDataForAgent(redProps.taxId);
      if (redProps.address) redProps.address = redactSensitiveDataForAgent(String(redProps.address));
      return {
        ...n,
        properties: redProps,
      };
    });

    return {
      ...graph,
      nodes: redactedNodes,
    };
  }

  /**
   * Enforces role and tenant filtering on the evidence graph.
   * Auditor cannot see restricted internal list details or cross-tenant private records.
   */
  public filterGraphForRole(
    graph: AlertEvidenceGraph,
    role: string,
    tenantId: string
  ): AlertEvidenceGraph {
    if (graph.tenantId !== 'GLOBAL' && graph.tenantId !== tenantId) {
      throw new Error(`ACCESS_DENIED: Graph ${graph.graphId} belongs to tenant ${graph.tenantId}`);
    }

    const isAuditor = role === 'AUDITOR' || role === 'system_auditor';

    const visibleNodes = graph.nodes.filter((node) => {
      if (isAuditor && node.provenance?.isRestrictedInternal) {
        // Redact internal private list node for auditor
        return false;
      }
      return true;
    });

    const visibleIds = new Set(visibleNodes.map((n) => n.id));
    const visibleEdges = graph.edges.filter(
      (e) => visibleIds.has(e.sourceNodeId) && visibleIds.has(e.targetNodeId)
    );

    return {
      ...graph,
      nodes: visibleNodes,
      edges: visibleEdges,
      totalNodeCount: visibleNodes.length,
      totalEdgeCount: visibleEdges.length,
    };
  }
}

export const evidenceGraphService = new EvidenceGraphService();
