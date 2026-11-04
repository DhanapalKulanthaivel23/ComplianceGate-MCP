/**
 * @license
 * SPDX-License-Identifier: MIT
 */

export const DEMO_ANALYST_TOKEN = 'token_compliance_analyst_2026';

export type EntityType = 'INDIVIDUAL' | 'ORGANIZATION' | 'VESSEL' | 'AIRCRAFT' | 'FINANCIAL_INSTITUTION';

export type IdentifierType =
  | 'BIC'
  | 'SWIFT_BIC'
  | 'LEI'
  | 'TAX_ID'
  | 'REGISTRATION_NO'
  | 'PASSPORT'
  | 'NATIONAL_ID'
  | 'IMO'
  | 'IATA_PREFIX'
  | 'LOCAL_ACCOUNT'
  | 'CRYPTO_ADDRESS'
  | 'NPI'
  | 'ISIN'
  | 'CUSIP'
  | 'SEDOL'
  | 'OTHER';

export interface ExternalAdapterInfo {
  id: string;
  name: string;
  provider: string;
  status: 'DISABLED_PENDING_LICENSE' | 'ACTIVE';
  reason: string;
  sampleEndpoint: string;
}

export interface Identifier {
  type: IdentifierType;
  value: string;
  country?: string;
  issuer?: string;
}

export type PartyRole =
  | 'DEBTOR'
  | 'ULTIMATE_DEBTOR'
  | 'ORDERING_INSTITUTION'
  | 'SENDER'
  | 'INSTRUCTING_AGENT'
  | 'INTERMEDIARY_AGENT'
  | 'CREDITOR_AGENT'
  | 'CREDITOR'
  | 'ULTIMATE_CREDITOR'
  | 'ORIGINAL_DEBTOR'
  | 'ORIGINAL_CREDITOR'
  | 'RETURNING_INSTITUTION'
  | 'RECEIVER'
  | 'CHARGES_PARTY';

export interface PartyAddress {
  street?: string;
  buildingNumber?: string;
  postalCode?: string;
  town?: string;
  countrySubDivision?: string;
  country?: string;
  rawLines?: string[];
}

export interface PartyProvenance {
  sourceTag?: string;
  fieldPath?: string;
  rawSnippet?: string;
  sequence?: 'A' | 'B' | 'ROOT';
  lineNumber?: number;
}

export interface CanonicalParty {
  partyId: string;
  role: PartyRole;
  name: string;
  originalName?: string;
  accountNumber?: string;
  accountType?: 'IBAN' | 'BBAN' | 'PROPRIETARY';
  identifiers: Identifier[];
  address?: PartyAddress;
  country?: string;
  provenance: PartyProvenance;
}

export type MessageFamily = 'SWIFT_MT' | 'ISO20022_MX' | 'JSON_PAYMENT';

export const SUPPORTED_SWIFT_MT_TYPES = [
  // Category 1: Customer Payments and Cheques
  'MT101', 'MT102', 'MT102_STP', 'MT103', 'MT103_STP', 'MT103_REMIT',
  'MT104', 'MT105', 'MT107', 'MT110', 'MT111', 'MT112',
  'MT190', 'MT191', 'MT192', 'MT195', 'MT196', 'MT198', 'MT199',
  // Category 2: Financial Institution Transfers
  'MT200', 'MT201', 'MT202', 'MT202_COV', 'MT203', 'MT204', 'MT205', 'MT205_COV',
  'MT207', 'MT210', 'MT290', 'MT291', 'MT292', 'MT295', 'MT296', 'MT298', 'MT299',
  // Category 3: Treasury Markets - Foreign Exchange, Money Markets and Derivatives
  'MT300', 'MT304', 'MT305', 'MT306', 'MT320', 'MT330', 'MT340', 'MT341',
  'MT350', 'MT360', 'MT361', 'MT362', 'MT370', 'MT380', 'MT381',
  'MT390', 'MT391', 'MT392', 'MT395', 'MT396', 'MT398', 'MT399',
  // Category 4: Collections and Cash Letters
  'MT400', 'MT410', 'MT412', 'MT416', 'MT420', 'MT422', 'MT430',
  'MT450', 'MT455', 'MT456', 'MT490', 'MT491', 'MT492', 'MT495', 'MT496', 'MT498', 'MT499',
  // Category 5: Securities Markets
  'MT500', 'MT501', 'MT502', 'MT508', 'MT509', 'MT513', 'MT514', 'MT515', 'MT518',
  'MT527', 'MT530', 'MT535', 'MT536', 'MT537', 'MT538',
  'MT540', 'MT541', 'MT542', 'MT543', 'MT544', 'MT545', 'MT546', 'MT547', 'MT548',
  'MT564', 'MT565', 'MT566', 'MT567', 'MT568',
  'MT590', 'MT591', 'MT592', 'MT595', 'MT596', 'MT598', 'MT599',
  // Category 6: Treasury Markets - Commodities and Syndications
  'MT600', 'MT601', 'MT604', 'MT605', 'MT606', 'MT607', 'MT608', 'MT609',
  'MT620', 'MT670', 'MT671', 'MT690', 'MT691', 'MT692', 'MT695', 'MT696', 'MT698', 'MT699',
  // Category 7: Documentary Credits and Guarantees / Standby Letters of Credit
  'MT700', 'MT701', 'MT705', 'MT707', 'MT708', 'MT710', 'MT711', 'MT720', 'MT721',
  'MT730', 'MT732', 'MT734', 'MT740', 'MT742', 'MT744', 'MT747',
  'MT750', 'MT752', 'MT754', 'MT756', 'MT759',
  'MT760', 'MT761', 'MT765', 'MT767', 'MT768', 'MT769',
  'MT790', 'MT791', 'MT792', 'MT795', 'MT796', 'MT798', 'MT799',
  // Category 8: Travellers Cheques
  'MT800', 'MT801', 'MT802', 'MT824', 'MT890', 'MT891', 'MT892', 'MT895', 'MT896', 'MT898', 'MT899',
  // Category 9: Cash Management and Customer Status
  'MT900', 'MT910', 'MT920', 'MT935', 'MT940', 'MT941', 'MT942', 'MT950',
  'MT970', 'MT971', 'MT972', 'MT973', 'MT985', 'MT986',
  'MT990', 'MT991', 'MT992', 'MT995', 'MT996', 'MT998', 'MT999',
] as const;

export const SUPPORTED_ISO20022_MX_TYPES = [
  // Payments Clearing and Settlement (pacs)
  'PACS_002', 'PACS_003', 'PACS_004', 'PACS_007', 'PACS_008', 'PACS_008_STP',
  'PACS_009', 'PACS_009_COV', 'PACS_009_ADV', 'PACS_010', 'PACS_028',
  // Payments Initiation (pain)
  'PAIN_001', 'PAIN_002', 'PAIN_007', 'PAIN_008', 'PAIN_009', 'PAIN_010',
  'PAIN_011', 'PAIN_012', 'PAIN_013', 'PAIN_014', 'PAIN_017', 'PAIN_018',
  // Cash Management (camt)
  'CAMT_003', 'CAMT_004', 'CAMT_005', 'CAMT_006', 'CAMT_007', 'CAMT_008',
  'CAMT_018', 'CAMT_019', 'CAMT_021', 'CAMT_025', 'CAMT_026', 'CAMT_027',
  'CAMT_028', 'CAMT_029', 'CAMT_030', 'CAMT_031', 'CAMT_033', 'CAMT_034',
  'CAMT_050', 'CAMT_052', 'CAMT_053', 'CAMT_054', 'CAMT_055', 'CAMT_056',
  'CAMT_057', 'CAMT_058', 'CAMT_059', 'CAMT_060', 'CAMT_086', 'CAMT_087',
  // Business Application Header (head) & Administration (admi)
  'HEAD_001', 'ADMI_002', 'ADMI_004', 'ADMI_009', 'ADMI_011',
  // Account Management (acmt) & Remittance (remt)
  'ACMT_001', 'ACMT_002', 'ACMT_003', 'ACMT_005', 'ACMT_006', 'ACMT_007',
  'ACMT_010', 'ACMT_014', 'ACMT_015', 'ACMT_022', 'ACMT_023', 'ACMT_024',
  'REMT_001', 'REMT_002',
  // Securities Events, Settlement, Management, Trade (seev, sese, semt, setr, secl)
  'SEEV_001', 'SEEV_031', 'SEEV_035', 'SEEV_036',
  'SESE_020', 'SESE_023', 'SESE_024', 'SESE_025', 'SESE_030', 'SESE_032', 'SESE_033',
  'SEMT_002', 'SEMT_003', 'SEMT_015', 'SEMT_017', 'SEMT_018',
  'SETR_004', 'SETR_006', 'SETR_010', 'SETR_012', 'SETR_015',
  'SECL_001', 'SECL_002', 'SECL_004', 'SECL_010',
  // Foreign Exchange, Treasury, Collateral, Reference Data (fxtr, trea, colr, reda, auth)
  'FXTR_014', 'FXTR_015', 'FXTR_017', 'FXTR_030',
  'TREA_001', 'TREA_005', 'TREA_008',
  'COLR_003', 'COLR_004', 'COLR_016',
  'REDA_001', 'REDA_002', 'REDA_014',
  'AUTH_001', 'AUTH_016', 'AUTH_030',
  // Trade Services & Supply Chain (tsmt, tsrv, tsin)
  'TSMT_009', 'TSMT_014', 'TSMT_015', 'TSMT_018', 'TSMT_019', 'TSMT_021',
  'TSRV_001', 'TSRV_005', 'TSRV_008', 'TSRV_013',
  'TSIN_001', 'TSIN_004', 'TSIN_006',
  // Cards & Acquiring (caaa, caad, caam, cafc, cafm, cafr, cain, canm, casr, catm, catp)
  'CAAA_001', 'CAAA_002', 'CAAD_001', 'CAAM_001', 'CAFC_001', 'CAFM_001', 'CAFR_001',
  'CAIN_001', 'CANM_001', 'CASR_001', 'CATM_001', 'CATP_001',
  // Derivatives & System Notifications (deri, xsys)
  'DERI_001', 'XSYS_001',
] as const;

export type PaymentMessageType =
  | (typeof SUPPORTED_SWIFT_MT_TYPES)[number]
  | (typeof SUPPORTED_ISO20022_MX_TYPES)[number]
  | 'GENERIC_SWIFT_MT'
  | 'GENERIC_ISO20022_MX'
  | `MT${string}`
  | `${string}_${string}`;

/**
 * Authoritative server-side allowlist of message profiles with dedicated
 * field-level validation, sequence separation, and golden test coverage.
 * Universal envelope routing for any other MT/MX type is best-effort extraction
 * and is never treated as a verified tested profile.
 */
export const VERIFIED_TESTED_PROFILES = [
  'MT103',
  'MT103_STP',
  'MT103_REMIT',
  'MT202_COV',
  'MT205_COV',
  'PACS_008',
  'PACS_009_COV',
  'PACS_004',
  'PAIN_001',
] as const;

export function isVerifiedTestedProfile(messageType: string, suppliedFlag?: boolean): boolean {
  if (suppliedFlag === false) {
    return false;
  }
  return (VERIFIED_TESTED_PROFILES as readonly string[]).includes(messageType);
}

export type MissingDataSeverity = 'CRITICAL_MISSING' | 'WARNING_ENRICHMENT' | 'INFORMATIONAL';

export interface MissingDataIssue {
  field: string;
  partyRole?: PartyRole;
  severity: MissingDataSeverity;
  ruleId: string;
  ruleDescription: string;
  recommendation: string;
}

export interface CanonicalPaymentTransaction {
  transactionId: string;
  tenantId?: string;
  uetr?: string;
  endToEndId?: string;
  instructionId?: string;
  messageFamily: MessageFamily;
  messageType: PaymentMessageType;
  schemaVersion?: string;
  isProfileTested: boolean;
  settlementDate: string;
  currency: string;
  amount: number;
  originalAmount?: number;
  originalCurrency?: string;
  returnReasonCode?: string;
  chargeBearer?: 'DEBT' | 'CRED' | 'SHAR' | 'OUR' | 'BEN' | 'SHA';
  remittanceInformation?: string;
  parties: CanonicalParty[];
  missingDataIssues: MissingDataIssue[];
  rawMessageSnippet?: string;
  provenanceSummary: {
    totalPartiesExtracted: number;
    expectedPartyMarkersInRaw?: number;
    parsedSequences?: string[];
    parserProfile: string;
  };
}

export type CoverageStatus = 'COMPLETE' | 'PARTIAL_STALE' | 'INSUFFICIENT' | 'DEGRADED' | 'UNAVAILABLE';

export type FindingSeverity =
  | 'EXACT_IDENTIFIER_MATCH'
  | 'FUZZY_NAME_CANDIDATE'
  | 'NO_MATCH_FOUND';

export interface ScreeningTarget {
  id?: string;
  name: string;
  aliases?: string[];
  entityType: EntityType;
  identifiers?: Identifier[];
  country?: string;
  address?: string;
  role?: PartyRole;
}

export interface MatchDetail {
  listId: string;
  listName: string;
  entryId: string;
  entryName: string;
  entryType: EntityType;
  matchType: 'EXACT_IDENTIFIER' | 'FUZZY_NAME' | 'FUZZY_ALIAS' | 'EXACT_NAME';
  matchedField: string;
  queryValue: string;
  listValue: string;
  similarityScore: number;
  isExactIdentifier: boolean;
  programs?: string[];
  notes?: string;
}

export interface PartyScreeningOutcome {
  party: CanonicalParty;
  findingSeverity: FindingSeverity;
  highestScore: number;
  matches: MatchDetail[];
  policyNotes?: string;
}

export interface PaymentScreeningResult {
  referenceId: string;
  timestamp: string;
  transactionId: string;
  messageType: PaymentMessageType;
  coverageStatus: CoverageStatus;
  findingSeverity: FindingSeverity;
  highestScore: number;
  staleLists: string[];
  missingLists: string[];
  partyOutcomes: PartyScreeningOutcome[];
  missingDataIssues: MissingDataIssue[];
  policyVersion: string;
  listDigests: Record<string, string>;
  disclaimer: string;
  requiresHumanReview: boolean;
  isRedactedForAgent: boolean;
  payloadDigest: string;
  expiresAt: string;
  caseId?: string;
}

export interface WatchlistEntry {
  id: string;
  name: string;
  aliases: string[];
  entityType: EntityType;
  identifiers: Identifier[];
  listId: string;
  country?: string;
  programs?: string[];
  remarks?: string;
}

export interface WatchlistInfo {
  id: string;
  name: string;
  provider: string;
  description: string;
  recordCount: number;
  lastUpdated: string;
  freshnessTtlHours: number;
  sha256Digest: string;
  isSimulatedStale: boolean;
  isStale: boolean;
  isRequired: boolean;
}

export type CaseAdjudicationDecision =
  | 'CONFIRM_ENTITY_MATCH'
  | 'FALSE_POSITIVE'
  | 'CLEAR_FALSE_POSITIVE'
  | 'REQUEST_INFORMATION';

export type CaseStatus =
  | 'PENDING_REVIEW'
  | 'ALERT_CONFIRMED'
  | 'FALSE_POSITIVE_CLEARED'
  | 'INFORMATION_REQUESTED'
  | 'REOPENED';

export type AnalystRole = 'compliance_officer' | 'senior_sanctions_analyst' | 'system_auditor';

export interface AuditAction {
  actionId: string;
  timestamp: string;
  analystId: string;
  analystRole: AnalystRole;
  previousStatus: CaseStatus;
  newStatus: CaseStatus;
  decision: CaseAdjudicationDecision | 'INITIAL_CREATION' | 'REOPEN' | 'RESCREENED_UPDATED';
  rationale: string;
  serverChecksum: string;
  previousHash?: string;
}

export interface PaymentComplianceCase {
  caseId: string;
  tenantId?: string;
  createdAt: string;
  updatedAt: string;
  transaction: CanonicalPaymentTransaction;
  screeningResult: PaymentScreeningResult;
  status: CaseStatus;
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  assignedOfficer?: string;
  auditTrail: AuditAction[];
  evidenceHash: string;
  policyVersion: string;
}

export interface EngineHealth {
  engineId: string;
  engineName: string;
  mode: 'EMBEDDED_SYNTHETIC' | 'CLIENT_REMOTE_ADAPTER';
  status: 'ONLINE' | 'STANDBY_UNCONFIGURED' | 'ERROR';
  details: string;
  supportedIdentifiers: IdentifierType[];
  latencyMs: number;
}

// ==========================================
// Multi-Module Compliance Framework Types
// ==========================================

export type ComplianceModuleId =
  | 'PAYMENTS'
  | 'TRADE_AND_CARGO'
  | 'MARITIME'
  | 'AIR_CARGO'
  | 'INSURANCE'
  | 'CRYPTO'
  | 'HEALTHCARE'
  | 'SECURITIES'
  | 'VALIDATION_AND_AUDIT'
  | 'LISTS_AND_DATA_SOURCES';

export interface ComplianceModuleMeta {
  id: ComplianceModuleId;
  name: string;
  tagline: string;
  usefulCapabilities: string;
  potentialClients: string;
  icon: string;
  badge: string;
}

export const COMPLIANCE_MODULES: ComplianceModuleMeta[] = [
  {
    id: 'PAYMENTS',
    name: 'Payments Compliance',
    tagline: 'SWIFT MT/ISO 20022 Screening & FATF Rec 16 Auditing',
    usefulCapabilities: 'Extract MT/MX parties, screen through an existing engine, identify missing fields, route findings and retain evidence',
    potentialClients: 'Banks, PSPs, payment integrators / sanctions and payments leaders',
    icon: 'credit-card',
    badge: 'Core Banking',
  },
  {
    id: 'TRADE_AND_CARGO',
    name: 'Trade and Cargo',
    tagline: 'Multi-Document Discrepancy & Dual-Use Goods Screening',
    usefulCapabilities: 'Compare invoice, transport document, packing list and payment; screen parties; connect goods and route findings',
    potentialClients: 'Trade-finance banks, commodity traders, forwarders / trade compliance and operations',
    icon: 'file-text',
    badge: 'Trade Finance',
  },
  {
    id: 'MARITIME',
    name: 'Maritime Compliance',
    tagline: 'Vessel Tracking, Flag-Hopping & Ownership Screening',
    usefulCapabilities: 'Connect vessel identifiers, owners, operators, ports and shipment documents using approved data providers',
    potentialClients: 'Shipping companies, marine insurers, P&I clubs / compliance and underwriting',
    icon: 'anchor',
    badge: 'Maritime & P&I',
  },
  {
    id: 'AIR_CARGO',
    name: 'Air Cargo Security',
    tagline: 'IATA AWB Validation, Flight Manifests & Routing Risk',
    usefulCapabilities: 'Compare air waybills and manifests; connect shipper, consignee, carrier and routing',
    potentialClients: 'Airlines, cargo handlers, forwarders / cargo security and compliance',
    icon: 'plane',
    badge: 'Air Logistics',
  },
  {
    id: 'INSURANCE',
    name: 'Insurance & UBO',
    tagline: 'Policy Underwriting, Beneficiaries & OFAC 50% Rule Screening',
    usefulCapabilities: 'Screen policyholders, beneficiaries and corporate owners; assemble review evidence',
    potentialClients: 'Insurers, brokers, insurance software vendors / financial-crime and compliance teams',
    icon: 'shield',
    badge: 'Underwriting',
  },
  {
    id: 'CRYPTO',
    name: 'Crypto & Travel Rule',
    tagline: 'IVMS 101 Standard, Mixer Attribution & Address Risk',
    usefulCapabilities: 'Connect licensed blockchain analytics, counterparty checks and Travel Rule workflows',
    potentialClients: 'Exchanges, custodians, VASPs / compliance and product teams',
    icon: 'cpu',
    badge: 'VASPs & Web3',
  },
  {
    id: 'HEALTHCARE',
    name: 'Healthcare Integrity',
    tagline: 'NPI/DEA Verification, OIG-LEIE Exclusions & Claims Auditing',
    usefulCapabilities: 'Connect supplier screening, practitioner verification and claims-review evidence',
    potentialClients: 'Healthcare suppliers, payers, provider groups / procurement integrity and fraud teams',
    icon: 'activity',
    badge: 'Healthcare & Pharma',
  },
  {
    id: 'SECURITIES',
    name: 'Securities & FIX',
    tagline: 'FIX Protocol Extraction, ISIN Validation & Sectoral Sanctions',
    usefulCapabilities: 'Extract relevant FIX events and connect specialist surveillance and ownership systems',
    potentialClients: 'Brokers, investment firms, surveillance vendors / market surveillance teams',
    icon: 'trending-up',
    badge: 'Capital Markets',
  },
  {
    id: 'VALIDATION_AND_AUDIT',
    name: 'Validation and Audit',
    tagline: 'Synthetic Evasion Generation, Engine Benchmarking & Ledger Audits',
    usefulCapabilities: 'Generate synthetic evasion cases, compare engine results and reconstruct historical decisions',
    potentialClients: 'Consultancies, internal validation teams, screening vendors / practice and validation leads',
    icon: 'check-circle',
    badge: 'Model Risk & Audit',
  },
  {
    id: 'LISTS_AND_DATA_SOURCES',
    name: 'Lists & Data Sources',
    tagline: 'Official, Licensed & Internal Source Catalogue, Versioning & Memory Index',
    usefulCapabilities: 'One shared catalogue for official downloads, licensed uploads, internal lists, snapshot rollback, persistent subjects and in-memory index',
    potentialClients: 'Compliance operations, data engineers, sanctions officers / financial crime operations',
    icon: 'database',
    badge: 'Core Data Engine',
  },
];

// --- 2. Trade and Cargo Types ---
export interface TradeDiscrepancy {
  category: 'PARTY_MISMATCH' | 'PRICE_OR_VALUE' | 'PORT_INCONSISTENCY' | 'WEIGHT_DISCREPANCY' | 'MISSING_MANDATORY_DOC';
  severity: 'CRITICAL' | 'WARNING' | 'INFORMATIONAL';
  description: string;
  sourceDoc: string;
  comparedDoc: string;
  sourceValue: string;
  comparedValue: string;
}

export interface DualUseGoodHit {
  hsCode: string;
  eccnCode?: string;
  commodityDescription: string;
  sourceDocument: 'Commercial Invoice' | 'Bill of Lading' | 'Packing List';
  proliferationCategory: 'NUCLEAR' | 'CHEMICAL_BIOLOGICAL' | 'MISSILE_TECH' | 'ELECTRONICS_DUAL_USE' | 'MILITARY_EQUIPMENT';
  isControlled: boolean;
  assessmentCandidateNote: string;
  licensingRequirement?: string;
}

export interface TradeScreenedParty {
  role:
    | 'EXPORTER_SELLER'
    | 'IMPORTER_BUYER'
    | 'SHIPPER'
    | 'CONSIGNEE'
    | 'NOTIFY_PARTY'
    | 'ISSUING_BANK'
    | 'CARRIER'
    | 'PAYMENT_REMITTER'
    | 'PAYMENT_BENEFICIARY';
  name: string;
  country: string;
  status: 'SCREENED_CLEAR' | 'MATCH_CANDIDATE' | 'INCOMPLETE_NOT_SCREENED';
  isScreened: boolean;
  matches: MatchDetail[];
  notes?: string;
}

export interface TradeAndCargoEvaluation {
  id: string;
  referenceId: string;
  timestamp: string;
  documentsScreened: {
    invoiceNumber: string;
    invoiceAmount: number;
    invoiceCurrency: string;
    blNumber: string;
    blType: 'OCEAN_BILL_OF_LADING' | 'SEA_WAYBILL' | 'MULTIMODAL_BL';
    packingListNumber: string;
    paymentRef?: string;
    paymentCurrency?: string;
    paymentAmount?: number;
  };
  completenessStatus: 'FULL_PRESENTATION' | 'PARTIAL_PRESENTATION' | 'INCOMPLETE_REJECTED';
  comparisonsPerformed: {
    invoiceVsTransport: boolean;
    transportVsPackingList: boolean;
    invoiceVsPayment: boolean;
    omittedComparisons: string[];
  };
  parties: TradeScreenedParty[];
  discrepancies: TradeDiscrepancy[];
  dualUseGoods: DualUseGoodHit[];
  findingSeverity: FindingSeverity;
  highestScore: number;
  passedVerification: boolean;
  requiresHumanReview: boolean;
  reviewReasons: string[];
  decisionRecommendation: 'APPROVE_FINANCING' | 'HOLD_FOR_CORRECTIONS' | 'REJECT_TRADE_CRIME_RISK';
  evidenceDigest: string;
  workflowId?: string;
}

// --- 3. Maritime Types ---
export interface MaritimeVesselInfo {
  imoNumber: string; // 7 digits
  mmsi?: string; // 9 digits
  vesselName: string;
  flagState: string;
  callSign?: string;
  vesselType: 'CRUDE_OIL_TANKER' | 'CHEMICAL_TANKER' | 'CONTAINER_SHIP' | 'BULK_CARRIER' | 'GENERAL_CARGO';
  grossTonnage?: number;
  buildYear?: number;
}

export interface VesselOwnershipNode {
  role: 'REGISTERED_OWNER' | 'BENEFICIAL_OWNER' | 'COMMERCIAL_MANAGER' | 'TECHNICAL_MANAGER' | 'ISM_MANAGER' | 'OPERATOR';
  name: string;
  country: string;
  isSanctioned: boolean;
  matches: MatchDetail[];
  status?: 'SCREENED_CLEAR' | 'MATCH_CANDIDATE' | 'INCOMPLETE_NOT_SCREENED';
  isScreened?: boolean;
}

export interface PortRiskAssessment {
  portName: string;
  unLocode: string;
  country: string;
  isHighRiskOrSanctioned: boolean;
  riskReason?: string;
  arrivalDate?: string;
  portStatus?: 'SANCTIONED_DESIGNATED_PORT' | 'HIGH_RISK_SURVEILLANCE' | 'NOT_DESIGNATED_HIGH_RISK' | 'INVALID_PORT_ENTRY';
  validationIssues?: string[];
}

export interface MaritimeEvaluation {
  id: string;
  vessel: MaritimeVesselInfo;
  isImoChecksumValid: boolean;
  isVesselRegistrationVerified: boolean;
  vesselRegistrationStatus: 'VERIFIED_ACTIVE' | 'UNVERIFIED_REGISTRY' | 'INVALID_IDENTIFIER';
  identifierValidationIssues: string[];
  ownershipHierarchy: VesselOwnershipNode[];
  ownershipCoverage: 'COMPLETE_OWNERSHIP' | 'PARTIAL_OWNERSHIP' | 'NO_OWNERSHIP_SUPPLIED';
  portRiskAnalysis: PortRiskAssessment[];
  portHistoryCoverage: 'HISTORY_EVALUATED' | 'NO_PORT_HISTORY_SUPPLIED' | 'INVALID_PORT_HISTORY';
  aisAnomalies: string[];
  aisCoverage: 'TELEMETRY_EVALUATED' | 'NO_SIGNALS_PROVIDED' | 'INVALID_TELEMETRY';
  darkAisRiskLevel: 'HIGH_RISK_SUSPECTED' | 'ELEVATED' | 'NORMAL' | 'NOT_ASSESSED';
  findingSeverity: FindingSeverity;
  highestScore: number;
  completenessStatus: 'FULL_DOSSIER' | 'PARTIAL_DOSSIER' | 'INCOMPLETE_REJECTED';
  decisionRecommendation: 'APPROVE_VOYAGE_COVERAGE' | 'HOLD_FOR_HUMAN_REVIEW' | 'REJECT_SANCTIONS_RISK';
  requiresHumanReview: boolean;
  reviewReasons: string[];
  isApprovedForCoverage: boolean;
  evidenceDigest: string;
  timestamp?: string;
}

// --- 4. Air Cargo Types ---
export interface AirWaybillParty {
  role: 'SHIPPER' | 'CONSIGNEE' | 'NOTIFY_PARTY' | 'CARRIER_AGENT' | 'CARRIER';
  name: string;
  address?: string;
  country?: string;
  matches: MatchDetail[];
  status?: 'SCREENED_CLEAR' | 'MATCH_CANDIDATE' | 'INCOMPLETE_NOT_SCREENED';
  isScreened?: boolean;
}

export interface AirCargoEvaluation {
  id: string;
  awbNumber: string; // 11-digit IATA AWB
  isAwbChecksumValid: boolean; // IATA mod-7 check digit
  isAwbRegistrationVerified: boolean;
  awbVerificationStatus: 'VERIFIED_ACTIVE' | 'UNVERIFIED_CARRIER' | 'INVALID_AWB';
  identifierValidationIssues: string[];
  airlinePrefix: string;
  airlineName: string;
  carrierVerificationStatus: 'VERIFIED_AIRLINE' | 'UNRESOLVED_CARRIER';
  flightNumber?: string;
  routing: {
    originAirport: string; // IATA code
    destinationAirport: string;
    transitAirports: string[];
    hasHighRiskTransshipment: boolean;
    highRiskTransitDetails?: string;
    routingStatus: 'HIGH_RISK_TRANSIT_DETECTED' | 'SAFE_ROUTING_CORRIDOR' | 'INVALID_ROUTING' | 'UNASSESSED_ROUTING';
    routingIssues?: string[];
  };
  parties: AirWaybillParty[];
  cargoDetails: {
    declaredDescription: string;
    grossWeightKg: number;
    piecesCount: number;
    declaredHsCode?: string;
    isHazardousMaterial: boolean;
    isDualUseRisk: boolean;
    securityScreeningStatus: 'CLEARED' | 'SUSPICIOUS_CONTENT' | 'FLAGGED' | 'INCOMPLETE_DATA';
    cargoValidationIssues?: string[];
  };
  completenessStatus: 'FULL_MANIFEST' | 'PARTIAL_MANIFEST' | 'INCOMPLETE_REJECTED';
  decisionRecommendation: 'APPROVE_AIR_RELEASE' | 'HOLD_FOR_HUMAN_REVIEW' | 'REJECT_AIR_SANCTIONS_RISK';
  requiresHumanReview: boolean;
  reviewReasons: string[];
  findingSeverity: FindingSeverity;
  highestScore: number;
  evidenceDigest: string;
  timestamp?: string;
}

// --- 5. Insurance Types ---
export interface BeneficialOwnerShare {
  name: string;
  ownershipPercentage: number;
  ownershipType?: 'DIRECT' | 'INDIRECT';
  isSanctioned: boolean;
  isMatchCandidate?: boolean;
  country: string;
  matches: MatchDetail[];
  status?: 'SCREENED_CLEAR' | 'MATCH_CANDIDATE' | 'INCOMPLETE_NOT_SCREENED';
  isScreened?: boolean;
}

export interface InsurancePolicyholder {
  role: 'PRIMARY_INSURED' | 'CO_INSURED' | 'PRIMARY_BENEFICIARY' | 'CONTINGENT_BENEFICIARY' | 'LOSS_PAYEE';
  name: string;
  entityType: EntityType;
  country: string;
  matches: MatchDetail[];
  status?: 'SCREENED_CLEAR' | 'MATCH_CANDIDATE' | 'INCOMPLETE_NOT_SCREENED';
  isScreened?: boolean;
}

export interface InsuranceEvaluation {
  id: string;
  policyNumber: string;
  lineOfBusiness: 'MARINE_HULL_AND_CARGO' | 'DIRECTORS_AND_OFFICERS' | 'COMMERCIAL_PROPERTY' | 'AVIATION' | 'TRADE_CREDIT';
  sumInsured: number;
  currency: string;
  screeningStage: 'PRE_BIND_UNDERWRITING' | 'CLAIMS_PAYMENT_CLEARANCE' | 'POLICY_RENEWAL' | 'MIDTERM_ENDORSEMENT';
  policyParties: InsurancePolicyholder[];
  ownershipCoverage: 'FULL_OWNERSHIP_DECLARED' | 'PARTIAL_OWNERSHIP' | 'NO_UBO_SUPPLIED' | 'NOT_APPLICABLE_INDIVIDUAL';
  uboAnalysis: {
    targetEntityName: string;
    isEntityLinked: boolean;
    totalDeclaredDirectOwnershipPercentage: number;
    beneficialOwners: BeneficialOwnerShare[];
    aggregateSanctionedOwnershipPercentage: number;
    aggregateCandidateOwnershipPercentage: number;
    violatesOfac50PercentRule: boolean; // 50% or more aggregate owned by blocked persons
    ofacRuleDisposition: 'CONFIRMED_OFAC_50_VIOLATION' | 'CANDIDATE_OFAC_50_EXPOSURE' | 'BELOW_THRESHOLD_COMPLIANT';
    ownershipDiscrepancies: string[];
  };
  completenessStatus: 'FULL_POLICY_DATA' | 'PARTIAL_POLICY_DATA' | 'INCOMPLETE_REJECTED';
  decisionRecommendation: 'APPROVE_POLICY_BINDING' | 'HOLD_FOR_HUMAN_REVIEW' | 'REJECT_SANCTIONS_RISK';
  requiresHumanReview: boolean;
  reviewReasons: string[];
  findingSeverity: FindingSeverity;
  highestScore: number;
  underwritingDecision: 'APPROVED' | 'BLOCK_AND_HOLD' | 'REFER_TO_SENIOR_COUNSEL';
  evidenceDigest: string;
  timestamp?: string;
}

// --- 6. Crypto Types ---
export interface CryptoAddressDetails {
  network: 'BITCOIN' | 'ETHEREUM' | 'TRON' | 'SOLANA';
  address: string;
  rawAddress?: string;
  isValidFormat: boolean;
  isKnownMixerOrSanctionedCluster: boolean;
  attributedEntity?: string;
  riskCategory: 'PROHIBITED_SANCTIONED_MIXER' | 'EXCHANGE_TIER_1' | 'UNHOSTED_WALLET' | 'DARKNET_EXPOSURE';
  addressLookupStatus?: 'FOUND_SANCTIONED_MIXER' | 'UNLISTED_UNHOSTED_WALLET' | 'INVALID_ADDRESS_SYNTAX';
}

export interface Ivms101Person {
  isLegalPerson: boolean;
  fullName: string;
  nationalIdentifierOrLei?: string;
  country: string;
  addressLines?: string[];
  walletAddress: string;
  matches?: MatchDetail[];
  status?: 'SCREENED_CLEAR' | 'MATCH_CANDIDATE' | 'INCOMPLETE_NOT_SCREENED';
}

export interface CryptoEvaluation {
  id: string;
  transactionHash?: string;
  asset: 'BTC' | 'ETH' | 'USDT' | 'USDC' | 'SOL';
  amount: number;
  fiatValuation?: {
    amountUsd?: number;
    valuationSource: string;
    valuationTimestamp?: string;
    isValuationEstablished: boolean;
  };
  assetNetworkCompatibility?: {
    isCompatible: boolean;
    discrepancy?: string;
  };
  sourceAddress: CryptoAddressDetails;
  destinationAddress: CryptoAddressDetails;
  travelRule: {
    protocol: 'IVMS_101';
    isTravelRuleApplicable: boolean; // Over Travel Rule threshold ($1,000 / EUR 1,000)
    travelRuleStatus?: 'TRAVEL_RULE_COMPLIANT' | 'TRAVEL_RULE_DEFICIT' | 'NOT_APPLICABLE_BELOW_THRESHOLD' | 'NOT_APPLICABLE_UNHOSTED_PEER_TO_PEER' | 'UNASSESSED_MISSING_VALUATION';
    originatorVasp: { name: string; vaspLei?: string; isVerified?: boolean };
    beneficiaryVasp: { name: string; vaspLei?: string; isVerified?: boolean };
    originator: Ivms101Person;
    beneficiary: Ivms101Person;
    isIvmsPayloadComplete: boolean;
    missingMandatoryFields: string[];
  };
  counterpartyScreening?: {
    originatorMatches: MatchDetail[];
    beneficiaryMatches: MatchDetail[];
    hasSanctionedParty: boolean;
  };
  vaspVerification?: {
    isOriginatorVaspVerified: boolean;
    isBeneficiaryVaspVerified: boolean;
    originatorVaspSource: 'SUBMITTED_PAYLOAD' | 'INDEPENDENTLY_VERIFIED';
    beneficiaryVaspSource: 'SUBMITTED_PAYLOAD' | 'INDEPENDENTLY_VERIFIED';
  };
  screeningCoverage?: {
    sourcesChecked: string[];
    checksPerformed: string[];
    coverageStatus: 'FULL_COVERAGE' | 'PARTIAL_COVERAGE' | 'INSUFFICIENT';
  };
  findingSeverity: FindingSeverity;
  highestScore: number;
  clearanceStatus: 'TRANSACTION_PERMITTED' | 'TRAVEL_RULE_DEFICIT' | 'BLOCKED_SANCTIONED_ADDRESS' | 'INVALID_TRANSACTION_PAYLOAD' | 'HELD_FOR_HUMAN_REVIEW';
  decisionRecommendation?: 'APPROVE_CRYPTO_TRANSFER' | 'HOLD_FOR_TRAVEL_RULE_REVIEW' | 'HOLD_FOR_HUMAN_REVIEW' | 'REJECT_SANCTIONS_RISK' | 'REJECT_INVALID_PAYLOAD';
  requiresHumanReview?: boolean;
  reviewReasons?: string[];
  evidenceDigest: string;
  timestamp?: string;
}

// --- 7. Healthcare Types ---
export interface HealthcarePractitioner {
  npi: string; // 10 digits
  isNpiValid: boolean; // Luhn Mod-10 with prefix 80840
  deaNumber?: string; // 2 alpha + 7 digits
  isDeaValid?: boolean; // DEA verification formula
  name: string;
  specialty: string;
  stateLicense?: string;
  isOigLeieExcluded: boolean;
  isSamGovExcluded: boolean;
  matches: MatchDetail[];
  status?: 'SCREENED_CLEAR' | 'MATCH_CANDIDATE' | 'EXCLUDED_FRAUD' | 'INVALID_CREDENTIALS';
}

export interface HealthcareSupplier {
  companyName: string;
  taxId?: string;
  fdaRegistrationNumber?: string;
  country: string;
  matches: MatchDetail[];
  status?: 'SCREENED_CLEAR' | 'MATCH_CANDIDATE' | 'SANCTIONED_BLOCKED';
}

export interface HealthcareEvaluation {
  id: string;
  claimId: string;
  serviceDate: string;
  billedAmount: number;
  practitioner?: HealthcarePractitioner;
  supplier?: HealthcareSupplier;
  exclusionHits: {
    source: 'OIG_LEIE' | 'SAM_GOV' | 'SDN_HEALTHCARE';
    entityName: string;
    exclusionReason: string;
    waiverExists: boolean;
  }[];
  findingSeverity: FindingSeverity;
  highestScore?: number;
  claimIntegrityStatus:
    | 'PAYMENT_APPROVED'
    | 'CLAIM_HELD_FOR_FRAUD_EXCLUSION'
    | 'SANCTIONED_ENTITY_BLOCKED'
    | 'CLAIM_HELD_FOR_CREDENTIAL_DEFICIT'
    | 'HOLD_FOR_SANCTIONS_REVIEW'
    | 'INCOMPLETE_CLAIM_DATA';
  decisionRecommendation?:
    | 'APPROVE_HEALTHCARE_CLAIM'
    | 'HOLD_FOR_HUMAN_REVIEW'
    | 'REJECT_FRAUD_EXCLUSION'
    | 'REJECT_SANCTIONS_RISK'
    | 'REJECT_INVALID_CLAIM';
  requiresHumanReview?: boolean;
  reviewReasons?: string[];
  verificationCoverage?: {
    checksPerformed: string[];
    sourcesChecked: string[];
    practitionerNpiChecked: boolean;
    practitionerDeaChecked: boolean;
    oigLeieChecked: boolean;
    samGovChecked: boolean;
    sanctionsChecked: boolean;
  };
  evidenceDigest: string;
  timestamp?: string;
}

// --- 8. Securities Types ---
export interface FixTagValue {
  tag: number;
  name: string;
  value: string;
}

export interface SecuritiesEvaluation {
  id: string;
  rawFixMessage: string;
  fixVersion: string;
  msgType: 'NEW_ORDER_SINGLE' | 'EXECUTION_REPORT' | 'ORDER_CANCEL_REPLACE' | 'UNKNOWN';
  orderId?: string;
  instrument: {
    symbol: string;
    securityId?: string;
    securityIdSource?: string;
    securityIdSourceDesc?: string;
    isin?: string;
    isIsinChecksumValid?: boolean;
    cusip?: string;
    securityName: string;
    issuerCountry: string;
    isSectoralSanctionedDebtOrEquity: boolean; // EU/OFAC Sectoral Directives
  };
  orderSide: 'BUY' | 'SELL' | 'INVALID_SIDE';
  orderQty: number;
  orderPrice?: number;
  orderQtyVolume?: number;
  notionalValueUsd?: number;
  parties: {
    role: 'EXECUTING_BROKER' | 'CLIENT_ACCOUNT' | 'COUNTERPARTY' | 'BENEFICIAL_OWNER';
    name: string;
    idValue: string;
    matches: MatchDetail[];
  }[];
  surveillanceAlerts: string[];
  findingSeverity: FindingSeverity;
  highestScore: number;
  orderStatus:
    | 'ROUTING_ALLOWED'
    | 'RESTRICTED_SECURITY_HALT'
    | 'SANCTIONED_COUNTERPARTY_BLOCKED'
    | 'INVALID_FIX_FRAMING'
    | 'MISSING_MANDATORY_TAGS'
    | 'HOLD_FOR_SANCTIONS_REVIEW'
    | 'UNSUPPORTED_MESSAGE_TYPE';
  decisionRecommendation?:
    | 'APPROVE_ORDER_ROUTING'
    | 'REJECT_SANCTIONS_RISK'
    | 'HOLD_FOR_HUMAN_REVIEW'
    | 'REJECT_INVALID_ORDER'
    | 'HALT_RESTRICTED_SECURITY';
  requiresHumanReview?: boolean;
  reviewReasons?: string[];
  framingValidation?: {
    isValid: boolean;
    beginString?: string;
    bodyLengthValid?: boolean;
    checksumValid?: boolean;
    delimiterUsed: 'SOH' | 'PIPE' | 'SEMICOLON' | 'NONE';
    detectedErrors: string[];
  };
  screeningCoverage?: {
    checksPerformed: string[];
    partiesScreenedCount: number;
    coverageStatus: 'FULL_COVERAGE' | 'INSUFFICIENT';
  };
  evidenceDigest: string;
  timestamp?: string;
}

// --- 9. Validation and Audit Types ---
export type EvasionTypology =
  | 'CYRILLIC_HOMOGLYPH_SUBSTITUTION'
  | 'VOWEL_DROPPING'
  | 'INVERTED_WORD_ORDER'
  | 'SPACING_INSERTION'
  | 'COMMERCIAL_PREFIX_ALTERATION'
  | 'ORGANIZATIONAL_SUFFIX_VARIATION'
  | 'BENIGN_NEGATIVE_CONTROL'
  | 'CONTAINER_PREFIX_DISGUISE'
  | 'VESSEL_IMO_SCRUBBING'
  | 'MISSING_ORIGINATOR_ACCOUNT'
  | 'NARRATIVE_NOISE_INJECTION'
  | 'WRONG_ENTITY_TARGET_REGRESSION';

export interface SyntheticEvasionTestCase {
  caseId: string;
  typology: EvasionTypology;
  description: string;
  baselineEntity: string;
  evasionPayload: string;
  targetList: string;
  expectedDetection: boolean;
  actualDetection: boolean;
  score: number;
  matchedEntity?: string;
  matchedList?: string;
  matchedScore?: number;
  verdict?: 'TRUE_POSITIVE' | 'TRUE_NEGATIVE' | 'FALSE_POSITIVE' | 'FALSE_NEGATIVE';
  passed: boolean;
  failureReason?: string;
}

export interface ValidationAndAuditEvaluation {
  id: string;
  timestamp: string;
  engineVersion: string;
  policyVersion: string;
  thresholdConfig: {
    exactCutoff: number;
    fuzzyCutoff: number;
    tokenSortWeight: number;
    jaroWinklerWeight: number;
  };
  datasetMetadata: {
    suiteName: string;
    suiteVersion: string;
    datasetDigest: string;
    isDynamicGenerator: boolean;
    listSnapshots: Array<{
      listId: string;
      name: string;
      recordCount: number;
      sha256Digest: string;
      isStale: boolean;
    }>;
  };
  totalCasesTested: number;
  casesPassed: number;
  casesFailed: number;
  testCases: SyntheticEvasionTestCase[];
  benchmarkMetrics: {
    precision: number;
    recall: number;
    f1Score: number;
    falsePositiveRate: number;
    meanLatencyMs: number;
    latencyMeasurementScope: string;
    classCounts: {
      totalCases: number;
      positiveConditionCount: number;
      negativeConditionCount: number;
    };
    confusionMatrix: {
      truePositives: number;
      falsePositives: number;
      trueNegatives: number;
      falseNegatives: number;
    };
  };
  historicalLedgerVerification: {
    totalRecordsAudited: number;
    chainsIntact: number;
    brokenChains: number;
    tamperDetected: boolean;
    verificationStatus: 'VERIFIED_TAMPER_EVIDENT' | 'TAMPER_ALERT' | 'EMPTY_LEDGER_STANDBY';
    details: string;
  };
  evidenceDigest: string;
}

// ==========================================
// 10. Shared Data, Screening & Persistence Types
// (BUILD-SPEC-LISTS-SCREENING-PERSISTENCE)
// ==========================================

export type SourceCategory =
  | 'OFFICIAL_SANCTIONS'
  | 'LICENSED_WATCHLIST'
  | 'INTERNAL_LIST'
  | 'INTERNAL_WATCHLIST'
  | 'REFERENCE_REGISTRY';

export type SnapshotStatus =
  | 'ACTIVE'
  | 'ARCHIVED'
  | 'QUARANTINED'
  | 'ROLLED_BACK'
  | 'STAGED';

export type SourceHealthStatus =
  | 'HEALTHY'
  | 'STALE'
  | 'DEGRADED'
  | 'QUARANTINED'
  | 'UNCONFIGURED'
  | 'UNAVAILABLE';

export interface SourceDefinition {
  id: string;
  name: string;
  publisher: string;
  category: SourceCategory;
  authoritativeUrl: string;
  termsUrl: string;
  termsReviewedDate: string;
  format: 'XML' | 'CSV' | 'JSON' | 'API';
  refreshScheduleHours: number;
  freshnessTtlHours: number;
  isRequired: boolean;
  enabled: boolean;
  tenantId?: string; // If tenant-scoped (e.g. licensed upload or internal list); undefined if global official
  description: string;
  activeSnapshotId?: string;
  activeVersionTag?: string;
  recordCount?: number;
  aliasCount?: number;
  lastAttemptedFetch?: string;
  lastSuccessfulFetch?: string;
  upstreamPublicationTimestamp?: string;
  nextScheduledCheck?: string;
  healthStatus?: SourceHealthStatus;
  ingestErrors?: string[];
}

export interface SourceRecord {
  id: string; // Composite key: `${sourceId}:${providerRecordId}`
  sourceId: string;
  providerRecordId: string;
  name: string;
  aliases: string[];
  entityType: EntityType;
  identifiers: Identifier[];
  country?: string;
  programs?: string[];
  remarks?: string;
  rawPayload?: any;
}

export interface SourceSnapshot {
  snapshotId: string;
  sourceId: string;
  versionTag: string;
  schemaVersion: string;
  sha256Digest: string;
  recordCount: number;
  aliasCount: number;
  publicationTimestamp?: string;
  fetchedAt: string;
  activatedAt?: string;
  status: SnapshotStatus;
  storagePath?: string;
  tenantId?: string; // If tenant-scoped, otherwise 'GLOBAL'
  metadata?: Record<string, any>;
  quarantineReason?: string;
}

export interface ActiveSnapshotManifest {
  manifestId: string;
  generatedAt: string;
  tenantId: string;
  snapshots: Record<string, {
    snapshotId: string;
    sourceId: string;
    versionTag: string;
    sha256Digest: string;
    recordCount: number;
  }>;
  manifestDigest: string;
}

export interface CustomerSubject {
  subjectId: string;
  tenantId: string;
  entityType: EntityType;
  primaryName: string;
  aliases: string[];
  typedIdentifiers: Identifier[];
  jurisdiction?: string;
  contextData?: Record<string, any>;
  provenance: string; // e.g. "CUSTOMER_REGISTER_API", "BATCH_IMPORT", "MANUAL_ENTRY"
  createdAt: string;
  updatedAt: string;
  retentionPolicy: 'PERMANENT' | 'ONE_OFF_EPHEMERAL' | 'RE_SCREEN_ACTIVE';
  lastScreenedAt?: string;
  lastScreeningRunId?: string;
  lastReviewOutcome?: string;
}

export type InputCompleteness = 'COMPLETE' | 'INCOMPLETE' | 'MISSING_CRITICAL';
export type CandidateFindingStatus = 'NO_CANDIDATE' | 'CANDIDATE_MATCH' | 'EXACT_IDENTIFIER_MATCH';
export type ReviewOutcome = 'AUTO_RELEASE' | 'REQUIRES_HUMAN_REVIEW' | 'HOLD_FOR_INVESTIGATION';

export interface FourDimensionScreeningResult {
  inputCompleteness: InputCompleteness;
  sourceCoverage: CoverageStatus;
  candidateFindings: CandidateFindingStatus;
  reviewOutcome: ReviewOutcome;
}

export interface ScreeningRunRecord {
  runId: string;
  tenantId: string;
  subjectId?: string;
  subjectRevision?: number;
  inputDigest: string;
  queryEntity: {
    name: string;
    entityType?: EntityType;
    country?: string;
    identifiers?: Identifier[];
  };
  engineVersion: string;
  policyVersion: string;
  manifestDigest: string;
  manifestSnapshotCount: number;
  candidateCount: number;
  candidates: MatchDetail[];
  isTruncated: boolean;
  dimensions: FourDimensionScreeningResult;
  findingSeverity: FindingSeverity;
  highestScore: number;
  requiresHumanReview: boolean;
  reviewReasons: string[];
  normalizationDetails: {
    normalizedName: string;
    defragmented: boolean;
    script: string;
  };
  evidenceDigest: string;
  createdAt: string;
}

export type ImportJobType = 'OFFICIAL_SYNC' | 'USER_UPLOAD' | 'INTERNAL_SYNC' | 'ROLLBACK';
export type ImportJobStatus =
  | 'QUEUED'
  | 'ACQUIRING'
  | 'PARSING'
  | 'VALIDATING'
  | 'QUARANTINED'
  | 'ACTIVATING'
  | 'COMPLETED'
  | 'FAILED'
  | 'ROLLED_BACK';

export interface ImportJobRecord {
  jobId: string;
  tenantId: string;
  sourceId: string;
  jobType: ImportJobType;
  status: ImportJobStatus;
  progressPercent: number;
  totalRecords: number;
  validRecords: number;
  rejectedRecords: number;
  rejectionReasons: string[];
  previousSnapshotId?: string;
  activatedSnapshotId?: string;
  startedAt: string;
  completedAt?: string;
  errorMessage?: string;
  triggeredBy: string;
  rawFilename?: string;
  rawFileDigest?: string;
}

export interface ReferenceLookupResult {
  sourceId: 'GLEIF_LEI' | 'COMPANIES_HOUSE' | 'NPPES_NPI';
  queryId: string;
  isFound: boolean;
  recordDetails?: any;
  adverseFinding: false;
  legalNotice: string;
  timestamp: string;
}

// ==========================================
// Alert Evidence Graph Types (§Shared Across All Modules)
// ==========================================

export type GraphNodeType =
  | 'Person'
  | 'Organisation'
  | 'Vessel'
  | 'Aircraft'
  | 'Address'
  | 'City'
  | 'Country'
  | 'Identifier'
  | 'Source Record'
  | 'Source Snapshot'
  | 'Sanctions Program'
  | 'Legal Authority'
  | 'Published Reason'
  | 'Document'
  | 'Alert'
  | 'Review Decision';

export type GraphNodeCategory =
  | 'SUBMITTED_FACT'
  | 'WATCHLIST_CANDIDATE'
  | 'SOURCE_ASSERTION'
  | 'POLICY_FINDING'
  | 'REVIEW_DECISION';

export type GraphEdgeType =
  | 'possible_match_to'
  | 'identifier_matches'
  | 'alias_of'
  | 'listed_by'
  | 'subject_to_program'
  | 'cites_authority'
  | 'source_states_reason'
  | 'has_recorded_address'
  | 'located_in'
  | 'documented_owner_of'
  | 'accounting_parent_of'
  | 'extracted_from'
  | 'reviewed_as';

export interface GraphProvenance {
  sourceOrProvider: string;
  originalRecordId: string;
  snapshotOrVersion: string;
  retrievalTime: string;
  publishedDate?: string;
  originalFieldOrTag?: string;
  authorizedUrlOrRef?: string;
  isRestrictedInternal?: boolean;
}

export interface GraphNode {
  id: string; // stable scoped ID (e.g. "sub:person:1", "cand:ofac:1234", "prog:sdgt")
  label: string;
  nodeType: GraphNodeType;
  category: GraphNodeCategory;
  provenance: GraphProvenance;
  properties: Record<string, any>;
  isAdverse?: boolean;
  riskLevel?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFORMATIONAL' | 'NONE';
}

export interface GraphEdge {
  id: string; // stable scoped ID (e.g. "edge:sub:1->cand:123:possible_match_to")
  sourceNodeId: string;
  targetNodeId: string;
  edgeType: GraphEdgeType;
  label: string;
  provenance: GraphProvenance;
  properties?: Record<string, any>;
  isHypothesized?: boolean;
}

export interface MissingDataIssueItem {
  field: string;
  affectedPartyOrDocument: string;
  severity: 'CRITICAL' | 'WARNING' | 'INFORMATIONAL';
  description: string;
  regulatoryBasis?: string;
}

export interface AlertEvidenceGraph {
  graphId: string;
  version: string;
  tenantId: string;
  generatedAt: string;
  screeningRunId?: string;
  caseId?: string;
  moduleId: ComplianceModuleId;
  manifestDigest?: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  isTruncated: boolean;
  totalNodeCount: number;
  totalEdgeCount: number;
  maxNodesAllowed: number;
  missingDataIssues: MissingDataIssueItem[];
  summary: {
    submittedEntityCount: number;
    candidateCount: number;
    sourceFactCount: number;
    alertCount: number;
    decisionCount: number;
  };
  evidenceDigest: string;
}

export type WorkflowStatus =
  | 'OPEN_REVIEW'
  | 'OPEN_RECONCILIATION'
  | 'IN_RECONCILIATION'
  | 'PENDING_DOCUMENTATION'
  | 'RELEASED_APPROVED'
  | 'REJECTED_BLOCKED'
  | 'ESCALATED_SENIOR_COMPLIANCE';

export type ModuleWorkflowType =
  | 'TRADE_DISCREPANCY_RECONCILIATION'
  | 'MARITIME_AIS_INVESTIGATION'
  | 'AIR_CARGO_ROUTE_ANOMALY'
  | 'INSURANCE_UBO_VERIFICATION'
  | 'CRYPTO_TRAVEL_RULE_DEFICIT'
  | 'HEALTHCARE_EXCLUSION_CLEARANCE'
  | 'SECURITIES_SSI_RESTRICTION'
  | 'VALIDATION_BENCHMARK_RECOVERY';

export interface WorkflowChecklistItem {
  itemId: string;
  label: string;
  category: string;
  required: boolean;
  completed: boolean;
  completedBy?: string;
  completedAt?: string;
  evidenceNote?: string;
}

export interface WorkflowAuditStep {
  stepId: string;
  timestamp: string;
  actorId: string;
  actorRole: string;
  previousStatus: WorkflowStatus;
  newStatus: WorkflowStatus;
  action: string;
  rationale: string;
  previousHash: string;
  stepHash: string;
}

export interface ModuleWorkflowRecord {
  workflowId: string;
  tenantId: string;
  moduleId: ComplianceModuleId;
  workflowType: ModuleWorkflowType;
  status: WorkflowStatus;
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  subjectReference: string;
  createdAt: string;
  updatedAt: string;
  assignedAnalyst?: string;
  evaluationSnapshot: any;
  checklist: WorkflowChecklistItem[];
  auditTrail: WorkflowAuditStep[];
  evidenceHash: string;
}


