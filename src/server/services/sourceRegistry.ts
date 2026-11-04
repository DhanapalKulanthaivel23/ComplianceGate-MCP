/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  ActiveSnapshotManifest,
  EntityType,
  Identifier,
  ImportJobRecord,
  SnapshotStatus,
  SourceDefinition,
  SourceRecord,
  SourceSnapshot,
} from '../../shared/types.ts';
import { memorySearchIndex } from './memoryIndex.ts';
import { normalizeEntityName, sha256 } from './normalizer.ts';
import { storageRepository } from './storage/storageRepository.ts';
import {
  parseDfatCsv,
  parseEuFsfXml,
  parseOfacSdnXml,
  parseSemaCsv,
  parseUkSanctionsXml,
  parseUnSanctionsXml,
  sanitizeString,
} from './sources/officialParsers.ts';
import { downloadOfficialFeed } from './sources/officialDownloader.ts';

export const INITIAL_OFFICIAL_SOURCES: SourceDefinition[] = [
  {
    id: 'OFAC_SDN',
    name: 'US OFAC Specially Designated Nationals (SDN)',
    publisher: 'US Department of the Treasury — Office of Foreign Assets Control',
    category: 'OFFICIAL_SANCTIONS',
    authoritativeUrl: 'https://www.treasury.gov/ofac/downloads/sdn.xml',
    termsUrl: 'https://home.treasury.gov/policy-issues/financial-sanctions/specially-designated-nationals-and-blocked-persons-list-sdn-human-readable-lists',
    termsReviewedDate: '2026-11-01',
    format: 'XML',
    refreshScheduleHours: 24,
    freshnessTtlHours: 36,
    isRequired: true,
    enabled: true,
    description: 'Specially Designated Nationals and Blocked Persons list including individuals, banks, and vessels. Official feed; status is NOT_LOADED until first ingestion.',
    healthStatus: 'UNAVAILABLE',
  },
  {
    id: 'OFAC_NON_SDN',
    name: 'US OFAC Consolidated Non-SDN Sanctions',
    publisher: 'US Department of the Treasury — Office of Foreign Assets Control',
    category: 'OFFICIAL_SANCTIONS',
    authoritativeUrl: 'https://www.treasury.gov/ofac/downloads/consolidated/consolidated.xml',
    termsUrl: 'https://home.treasury.gov/policy-issues/financial-sanctions/consolidated-sanctions-list-non-sdn-lists',
    termsReviewedDate: '2026-11-01',
    format: 'XML',
    refreshScheduleHours: 24,
    freshnessTtlHours: 48,
    isRequired: true,
    enabled: true,
    description: 'Consolidated non-SDN sanctions lists (Sectoral Sanctions Identifications, CAPTA, NS-MBS). Official feed; status is NOT_LOADED until first ingestion.',
    healthStatus: 'UNAVAILABLE',
  },
  {
    id: 'UK_SANCTIONS_LIST',
    name: 'UK Consolidated Sanctions List',
    publisher: 'UK Foreign, Commonwealth & Development Office (FCDO) / OFSI',
    category: 'OFFICIAL_SANCTIONS',
    authoritativeUrl: 'https://assets.publishing.service.gov.uk/government/uploads/system/uploads/attachment_data/file/uk-sanctions-list.xml',
    termsUrl: 'https://www.gov.uk/government/publications/the-uk-sanctions-list',
    termsReviewedDate: '2026-11-01',
    format: 'XML',
    refreshScheduleHours: 24,
    freshnessTtlHours: 48,
    isRequired: true,
    enabled: true,
    description: 'Consolidated list of financial sanctions targets designated under SAMLA 2018. Official feed; status is NOT_LOADED until first ingestion.',
    healthStatus: 'UNAVAILABLE',
  },
  {
    id: 'UN_CONSOLIDATED',
    name: 'UN Security Council Consolidated Sanctions List',
    publisher: 'United Nations Security Council Subsidiary Organs',
    category: 'OFFICIAL_SANCTIONS',
    authoritativeUrl: 'https://scsanctions.un.org/resources/xml/en/consolidated.xml',
    termsUrl: 'https://www.un.org/securitycouncil/content/un-sc-consolidated-list',
    termsReviewedDate: '2026-11-01',
    format: 'XML',
    refreshScheduleHours: 24,
    freshnessTtlHours: 72,
    isRequired: true,
    enabled: true,
    description: 'Consolidated list of individuals and entities subject to UN Security Council measures. Official feed; status is NOT_LOADED until first ingestion.',
    healthStatus: 'UNAVAILABLE',
  },
  {
    id: 'EU_FSF',
    name: 'EU Financial Sanctions Files (EEAS)',
    publisher: 'European External Action Service (EEAS) / European Commission',
    category: 'OFFICIAL_SANCTIONS',
    authoritativeUrl: 'https://webgate.ec.europa.eu/europeaid/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content?token=n000000',
    termsUrl: 'https://data.europa.eu/data/datasets/consolidated-list-of-persons-groups-and-entities-subject-to-eu-financial-sanctions',
    termsReviewedDate: '2026-11-01',
    format: 'XML',
    refreshScheduleHours: 24,
    freshnessTtlHours: 48,
    isRequired: true,
    enabled: true,
    description: 'Consolidated list of persons, groups and entities subject to EU CFSP sanctions. Official feed; status is NOT_LOADED until first ingestion.',
    healthStatus: 'UNAVAILABLE',
  },
  {
    id: 'US_CSL',
    name: 'US Consolidated Screening List (Trade.gov)',
    publisher: 'US International Trade Administration / Department of Commerce',
    category: 'OFFICIAL_SANCTIONS',
    authoritativeUrl: 'https://data.trade.gov/consolidated_screening_list/v1/search',
    termsUrl: 'https://www.trade.gov/consolidated-screening-list',
    termsReviewedDate: '2026-11-01',
    format: 'JSON',
    refreshScheduleHours: 24,
    freshnessTtlHours: 48,
    isRequired: false,
    enabled: true,
    description: 'Consolidated Screening List from Departments of Commerce, State, and Treasury with constituent-list provenance. Official feed; status is NOT_LOADED until first ingestion.',
    healthStatus: 'UNAVAILABLE',
  },
  {
    id: 'AU_DFAT',
    name: 'Australia DFAT Consolidated Sanctions List',
    publisher: 'Australian Government Department of Foreign Affairs and Trade',
    category: 'OFFICIAL_SANCTIONS',
    authoritativeUrl: 'https://www.dfat.gov.au/sites/default/files/regulation8_consolidated.csv',
    termsUrl: 'https://www.dfat.gov.au/international-relations/security/sanctions/consolidated-list',
    termsReviewedDate: '2026-11-01',
    format: 'CSV',
    refreshScheduleHours: 24,
    freshnessTtlHours: 72,
    isRequired: false,
    enabled: true,
    description: 'Consolidated list of persons and entities subject to Australian autonomous sanctions. Official feed; status is NOT_LOADED until first ingestion.',
    healthStatus: 'UNAVAILABLE',
  },
  {
    id: 'CA_SEMA',
    name: 'Canada Autonomous Sanctions (SEMA / FACFOA)',
    publisher: 'Global Affairs Canada',
    category: 'OFFICIAL_SANCTIONS',
    authoritativeUrl: 'https://www.international.gc.ca/world-monde/assets/office_docs/international_relations-relations_internationales/sanctions/sema-lmes.csv',
    termsUrl: 'https://www.international.gc.ca/world-monde/international_relations-relations_internationales/sanctions/consolidated-consolide.aspx',
    termsReviewedDate: '2026-11-01',
    format: 'CSV',
    refreshScheduleHours: 24,
    freshnessTtlHours: 72,
    isRequired: false,
    enabled: true,
    description: 'Canadian sanctions list under Special Economic Measures Act. Official feed; status is NOT_LOADED until first ingestion.',
    healthStatus: 'UNAVAILABLE',
  },
  // Reference Registries (Identity & Registration References — Not Adverse Findings)
  {
    id: 'GLEIF_LEI',
    name: 'Global Legal Entity Identifier Foundation (GLEIF)',
    publisher: 'GLEIF (Global LEI Foundation)',
    category: 'REFERENCE_REGISTRY',
    authoritativeUrl: 'https://www.gleif.org/en/lei-data/gleif-golden-copy/download-golden-copy',
    termsUrl: 'https://www.gleif.org/en/about/open-data',
    termsReviewedDate: '2026-11-01',
    format: 'JSON',
    refreshScheduleHours: 168,
    freshnessTtlHours: 336,
    isRequired: false,
    enabled: true,
    description: 'Corporate legal entity reference and consolidating parent hierarchy. Strictly NOT beneficial ownership verification.',
    healthStatus: 'HEALTHY',
  },
  {
    id: 'COMPANIES_HOUSE',
    name: 'UK Companies House Registry & PSC',
    publisher: 'UK Companies House',
    category: 'REFERENCE_REGISTRY',
    authoritativeUrl: 'https://api.company-information.service.gov.uk',
    termsUrl: 'https://www.gov.uk/guidance/companies-house-api-terms-and-conditions',
    termsReviewedDate: '2026-11-01',
    format: 'API',
    refreshScheduleHours: 168,
    freshnessTtlHours: 336,
    isRequired: false,
    enabled: true,
    description: 'UK corporate registry, company officers and Persons with Significant Control (PSC) registry.',
    healthStatus: 'HEALTHY',
  },
  {
    id: 'NPPES_NPI',
    name: 'CMS NPPES Healthcare Provider Directory',
    publisher: 'US Centers for Medicare & Medicaid Services (CMS)',
    category: 'REFERENCE_REGISTRY',
    authoritativeUrl: 'https://download.cms.gov/nppes/NPI_Files.html',
    termsUrl: 'https://nppes.cms.hhs.gov/#/terms',
    termsReviewedDate: '2026-11-01',
    format: 'CSV',
    refreshScheduleHours: 168,
    freshnessTtlHours: 336,
    isRequired: false,
    enabled: true,
    description: 'US healthcare practitioner and organization NPI registry. NPI presence does NOT verify active state licensing.',
    healthStatus: 'HEALTHY',
  },
];

// Dedicated Synthetic Demo Source Definition
export const DEMO_SOURCE_DEFINITION: SourceDefinition = {
  id: 'DEMO_SANCTIONS_FIXTURES',
  name: 'ComplianceGate Synthetic Demo Fixtures',
  publisher: 'ComplianceGate Synthetic Test Harness',
  category: 'INTERNAL_WATCHLIST',
  authoritativeUrl: 'urn:compliancegate:fixtures:synthetic-demo-v1',
  termsUrl: 'https://github.com/compliancegate/compliancegate-mcp#synthetic-fixtures',
  termsReviewedDate: '2026-11-01',
  format: 'JSON',
  refreshScheduleHours: 0,
  freshnessTtlHours: 8760,
  isRequired: false,
  enabled: true,
  description: 'Synthetic demonstration records for offline evaluation, sample screening, and test harness. NOT downloaded official government data.',
  healthStatus: 'HEALTHY',
};

// Seed records for initial official baseline snapshots (with synthetic demo preservation)
export const SEED_OFFICIAL_RECORDS: Record<string, SourceRecord[]> = {
  OFAC_SDN: [
    {
      id: 'OFAC_SDN:DEMO-SDN-001',
      sourceId: 'OFAC_SDN',
      providerRecordId: 'DEMO-SDN-001',
      name: 'Oceanic Aurora Maritime Ltd',
      aliases: ['Oceanic Aurora Shipping Co', 'Aurora Maritime Transport', 'MV Oceanic Aurora'],
      entityType: 'VESSEL',
      identifiers: [
        { type: 'IMO', value: '9123456' },
        { type: 'LEI', value: '549300DEMOOAURORA00' },
      ],
      country: 'Marshall Islands',
      programs: ['DEMO-NPWMD', 'DEMO-IRAN'],
      remarks: 'Primary carrier and designated maritime vessel management company.',
    },
    {
      id: 'OFAC_SDN:DEMO-SDN-002',
      sourceId: 'OFAC_SDN',
      providerRecordId: 'DEMO-SDN-002',
      name: 'Al-Huda International Trading LLC',
      aliases: ['Al Huda General Trading', 'Huda Marine Transport', 'Al Huda Logistics Group'],
      entityType: 'ORGANIZATION',
      identifiers: [
        { type: 'TAX_ID', value: 'AE-DEMO-99214' },
        { type: 'REGISTRATION_NO', value: 'DEMO-REG-10492' },
        { type: 'SWIFT_BIC', value: 'HUDADEMOXXX' },
        { type: 'BIC', value: 'HUDADEMOXXX' },
      ],
      country: 'United Arab Emirates',
      programs: ['DEMO-SYRIA', 'DEMO-SDGT'],
      remarks: 'Facilitator of transshipment operations for prohibited entities.',
    },
    {
      id: 'OFAC_SDN:DEMO-SDN-003',
      sourceId: 'OFAC_SDN',
      providerRecordId: 'DEMO-SDN-003',
      name: 'Dmitry Sergeyevich Volkov',
      aliases: ['Dmitri Volkov', 'Дмитрий Сергеевич Волков', 'Volkov D.S.'],
      entityType: 'INDIVIDUAL',
      identifiers: [
        { type: 'PASSPORT', value: 'RU-DEMO-8829140', country: 'RUS' },
        { type: 'TAX_ID', value: 'RU-DEMO-INN-7701928374' },
      ],
      country: 'Russia',
      programs: ['DEMO-RUSSIA-EO14024'],
      remarks: 'Corporate executive of sanctioned precision tooling conglomerate.',
    },
    {
      id: 'OFAC_SDN:DEMO-SDN-004',
      sourceId: 'OFAC_SDN',
      providerRecordId: 'DEMO-SDN-004',
      name: 'Beijing Horizon Microelectronics Co Ltd',
      aliases: ['Horizon Micro Tech', '北京地平线微电子有限公司', 'Beijing Horizon Semiconductor Corp'],
      entityType: 'ORGANIZATION',
      identifiers: [
        { type: 'LEI', value: '549300DEMOBEIJING01' },
        { type: 'TAX_ID', value: 'CN-DEMO-91110000000001' },
      ],
      country: 'China',
      programs: ['DEMO-CMIC'],
      remarks: 'Manufacturer of advanced dual-use gallium nitride chips.',
    },
    {
      id: 'OFAC_SDN:DEMO-SDN-005',
      sourceId: 'OFAC_SDN',
      providerRecordId: 'DEMO-SDN-005',
      name: 'Karim Tariq Al-Mansoor',
      aliases: ['طارق عبد الكريم المنصور', 'Tariq Al-Mansour', 'Karim Mansour'],
      entityType: 'INDIVIDUAL',
      identifiers: [
        { type: 'PASSPORT', value: 'SY-DEMO-112345', country: 'SYR' },
      ],
      country: 'Syria',
      programs: ['DEMO-CAESAR'],
      remarks: 'Petroleum procurement coordinator.',
    },
  ],
  OFAC_NON_SDN: [
    {
      id: 'OFAC_NON_SDN:DEMO-NONSDN-001',
      sourceId: 'OFAC_NON_SDN',
      providerRecordId: 'DEMO-NONSDN-001',
      name: 'Rosneft Sectoral Finance Subsidiary',
      aliases: ['RN Finance Capital', 'Rosneft Capital Ltd'],
      entityType: 'ORGANIZATION',
      identifiers: [
        { type: 'LEI', value: '253400DEMOROSNEFT01' },
        { type: 'TAX_ID', value: 'RU-DEMO-7705012345' },
      ],
      country: 'Russia',
      programs: ['UKRAINE-EO13662-DIRECTIVE-2'],
      remarks: 'Sectoral sanctions on new debt financing with maturity exceeding 90 days.',
    },
  ],
  UK_SANCTIONS_LIST: [
    {
      id: 'UK_SANCTIONS_LIST:DEMO-UK-001',
      sourceId: 'UK_SANCTIONS_LIST',
      providerRecordId: 'DEMO-UK-001',
      name: 'Caspian Sea Petrochemical Transshipment Ltd',
      aliases: ['Caspian Petro Trans', 'Caspian Transshipment UK Ltd'],
      entityType: 'ORGANIZATION',
      identifiers: [
        { type: 'REGISTRATION_NO', value: 'UK-DEMO-991200' },
        { type: 'TAX_ID', value: 'GB-DEMO-VAT-12345678' },
      ],
      country: 'United Kingdom',
      programs: ['DEMO-UK-RUSSIA-SANCTIONS'],
      remarks: 'Shadow tanker fleet bunker brokerage.',
    },
  ],
  UN_CONSOLIDATED: [
    {
      id: 'UN_CONSOLIDATED:DEMO-UN-001',
      sourceId: 'UN_CONSOLIDATED',
      providerRecordId: 'DEMO-UN-001',
      name: 'Al-Furqan Humanitarian Relief Foundation',
      aliases: ['مؤسسة الفرقان الإغاثية', 'Al-Furqan Charity Trust'],
      entityType: 'ORGANIZATION',
      identifiers: [
        { type: 'REGISTRATION_NO', value: 'UN-DEMO-NG-4412' },
      ],
      country: 'Somalia',
      programs: ['DEMO-UN-RES-751'],
      remarks: 'Front organization funnelling trans-border arms purchases.',
    },
  ],
  EU_FSF: [
    {
      id: 'EU_FSF:DEMO-EU-001',
      sourceId: 'EU_FSF',
      providerRecordId: 'DEMO-EU-001',
      name: 'Nordic Volga Logistics OOO',
      aliases: ['Nordic Volga Freight Forwarding', 'ООО Нордик Волга Логистикс'],
      entityType: 'ORGANIZATION',
      identifiers: [
        { type: 'TAX_ID', value: 'RU-DEMO-7712345678' },
        { type: 'REGISTRATION_NO', value: 'OGRN-DEMO-10277001' },
      ],
      country: 'Russia',
      programs: ['DEMO-EU-REG-269/2014'],
      remarks: 'Logistics operator transporting dual-use turbine equipment.',
    },
  ],
  US_CSL: [
    {
      id: 'US_CSL:DEMO-CSL-001',
      sourceId: 'US_CSL',
      providerRecordId: 'DEMO-CSL-001',
      name: 'Aero Space Components International Corp',
      aliases: ['ASCI Global Aviation Components'],
      entityType: 'ORGANIZATION',
      identifiers: [
        { type: 'REGISTRATION_NO', value: 'US-BIS-DPL-9921' },
      ],
      country: 'United States',
      programs: ['DOC-BIS-DENIED-PERSONS'],
      remarks: 'Denied person on Department of Commerce Bureau of Industry and Security list.',
    },
  ],
  AU_DFAT: [
    {
      id: 'AU_DFAT:DEMO-AU-001',
      sourceId: 'AU_DFAT',
      providerRecordId: 'DEMO-AU-001',
      name: 'Southern Cross Maritime Holdings Pty Ltd',
      aliases: ['Southern Cross Shipping'],
      entityType: 'ORGANIZATION',
      identifiers: [
        { type: 'REGISTRATION_NO', value: 'ACN-DEMO-001-992-111' },
      ],
      country: 'Australia',
      programs: ['AUTONOMOUS-SANCTIONS-ACT-2011'],
      remarks: 'Australian autonomous sanctions designated entity.',
    },
  ],
  CA_SEMA: [
    {
      id: 'CA_SEMA:DEMO-CA-001',
      sourceId: 'CA_SEMA',
      providerRecordId: 'DEMO-CA-001',
      name: 'Arctic Boreal Mining & Trading Inc',
      aliases: ['Arctic Boreal Resources Corp'],
      entityType: 'ORGANIZATION',
      identifiers: [
        { type: 'TAX_ID', value: 'CA-BN-992148192' },
      ],
      country: 'Canada',
      programs: ['SEMA-RUSSIA-REGULATIONS'],
      remarks: 'Designated under Canadian Special Economic Measures Act.',
    },
  ],
  GLEIF_LEI: [
    {
      id: 'GLEIF_LEI:549300DEMOOAURORA00',
      sourceId: 'GLEIF_LEI',
      providerRecordId: '549300DEMOOAURORA00',
      name: 'Oceanic Aurora Maritime Ltd',
      aliases: ['Oceanic Aurora Group'],
      entityType: 'ORGANIZATION',
      identifiers: [
        { type: 'LEI', value: '549300DEMOOAURORA00' },
      ],
      country: 'Marshall Islands',
      remarks: 'GLEIF Golden Copy Level 1 LEI record. Ultimate consolidator: Global Maritime Trust Corp (LEI: 549300GMTCORP001) — Accounting parent, not verified UBO.',
    },
  ],
  COMPANIES_HOUSE: [
    {
      id: 'COMPANIES_HOUSE:UK-DEMO-991200',
      sourceId: 'COMPANIES_HOUSE',
      providerRecordId: 'UK-DEMO-991200',
      name: 'Caspian Sea Petrochemical Transshipment Ltd',
      aliases: ['Caspian Petro Trans'],
      entityType: 'ORGANIZATION',
      identifiers: [
        { type: 'REGISTRATION_NO', value: 'UK-DEMO-991200' },
      ],
      country: 'United Kingdom',
      remarks: 'Companies House active registry entry. Declared PSC: Caspian Energy Nominees Ltd.',
    },
  ],
  NPPES_NPI: [
    {
      id: 'NPPES_NPI:1982736450',
      sourceId: 'NPPES_NPI',
      providerRecordId: '1982736450',
      name: 'Dr. Michael Robert Vance MD',
      aliases: ['Michael Vance MD'],
      entityType: 'INDIVIDUAL',
      identifiers: [
        { type: 'NPI', value: '1982736450' },
        { type: 'TAX_ID', value: 'US-DEMO-EIN-441299102' },
      ],
      country: 'United States',
      remarks: 'NPPES registered provider. Taxonomy: 207Q00000X Family Medicine. Licensure status requires state medical board verification.',
    },
  ],
};

export class SourceRegistryService {
  private initialized = false;

  constructor() {
    this.bootstrapSources();
  }

  public async bootstrapSources(): Promise<void> {
    if (this.initialized) return;

    // 1. Ensure all official and reference sources are registered in durable storage
    for (const src of INITIAL_OFFICIAL_SOURCES) {
      const existing = storageRepository.getSource(src.id, 'GLOBAL');
      if (!existing) {
        storageRepository.saveSource(src);
      }
    }

    // 2. Ensure Dedicated Synthetic Demo Fixture source is registered
    const existingDemo = storageRepository.getSource(DEMO_SOURCE_DEFINITION.id, 'GLOBAL');
    if (!existingDemo) {
      storageRepository.saveSource(DEMO_SOURCE_DEFINITION);
    }

    // Also register DEMO_OFAC_SDN for legacy test fixture compatibility
    const demoOfacDef: SourceDefinition = {
      id: 'DEMO_OFAC_SDN',
      name: 'OFAC SDN Demonstration Fixtures',
      publisher: 'ComplianceGate Test Harness',
      category: 'INTERNAL_WATCHLIST',
      authoritativeUrl: 'urn:compliancegate:fixtures:demo-ofac-sdn',
      termsUrl: 'https://github.com/compliancegate/compliancegate-mcp#demo-fixtures',
      termsReviewedDate: '2026-11-01',
      format: 'JSON',
      refreshScheduleHours: 0,
      freshnessTtlHours: 8760,
      isRequired: false,
      enabled: true,
      description: 'Synthetic demonstration records for OFAC SDN test cases. NOT downloaded official data.',
      healthStatus: 'HEALTHY',
    };
    if (!storageRepository.getSource(demoOfacDef.id, 'GLOBAL')) {
      storageRepository.saveSource(demoOfacDef);
    }

    // 3. Load synthetic demo fixtures under DEMO_SANCTIONS_FIXTURES and DEMO_OFAC_SDN
    const allDemoRecords: SourceRecord[] = Object.entries(SEED_OFFICIAL_RECORDS).flatMap(([srcId, recs]) =>
      recs.map((r) => ({
        ...r,
        sourceId: DEMO_SOURCE_DEFINITION.id,
        id: `${DEMO_SOURCE_DEFINITION.id}:${r.providerRecordId}`,
      }))
    );

    const demoSnap = storageRepository.getSnapshot(`snap_demo_fixtures_v2026.11`);
    if (!demoSnap) {
      const digest = sha256(allDemoRecords);
      const snapshotId = `snap_demo_fixtures_v2026.11`;
      const snapshot: SourceSnapshot = {
        snapshotId,
        sourceId: DEMO_SOURCE_DEFINITION.id,
        versionTag: 'v2026.11-DEMO-SYNTHETIC',
        schemaVersion: '1.0.0',
        sha256Digest: digest,
        recordCount: allDemoRecords.length,
        aliasCount: allDemoRecords.reduce((acc, r) => acc + (r.aliases?.length || 0), 0),
        fetchedAt: '2026-11-01T00:00:00.000Z',
        status: 'ACTIVE',
        tenantId: 'GLOBAL',
      };
      storageRepository.saveSnapshot(snapshot, allDemoRecords);
      storageRepository.updateSourceStatus(
        DEMO_SOURCE_DEFINITION.id,
        {
          activeSnapshotId: snapshotId,
          activeVersionTag: snapshot.versionTag,
          recordCount: snapshot.recordCount,
          aliasCount: snapshot.aliasCount,
          healthStatus: 'HEALTHY',
          lastSuccessfulFetch: snapshot.fetchedAt,
        },
        'GLOBAL'
      );
    }

    // Load DEMO_OFAC_SDN fixtures specifically
    const ofacDemoRecords = (SEED_OFFICIAL_RECORDS['OFAC_SDN'] || []).map((r) => ({
      ...r,
      sourceId: 'DEMO_OFAC_SDN',
      id: `DEMO_OFAC_SDN:${r.providerRecordId}`,
    }));
    const ofacDemoSnap = storageRepository.getSnapshot('snap_demo_ofac_sdn_v2026.11');
    if (!ofacDemoSnap && ofacDemoRecords.length > 0) {
      const digest = sha256(ofacDemoRecords);
      const snapshotId = 'snap_demo_ofac_sdn_v2026.11';
      const snapshot: SourceSnapshot = {
        snapshotId,
        sourceId: 'DEMO_OFAC_SDN',
        versionTag: 'v2026.11-DEMO-SYNTHETIC',
        schemaVersion: '1.0.0',
        sha256Digest: digest,
        recordCount: ofacDemoRecords.length,
        aliasCount: ofacDemoRecords.reduce((acc, r) => acc + (r.aliases?.length || 0), 0),
        fetchedAt: '2026-11-01T00:00:00.000Z',
        status: 'ACTIVE',
        tenantId: 'GLOBAL',
      };
      storageRepository.saveSnapshot(snapshot, ofacDemoRecords);
      storageRepository.updateSourceStatus(
        'DEMO_OFAC_SDN',
        {
          activeSnapshotId: snapshotId,
          activeVersionTag: snapshot.versionTag,
          recordCount: snapshot.recordCount,
          aliasCount: snapshot.aliasCount,
          healthStatus: 'HEALTHY',
          lastSuccessfulFetch: snapshot.fetchedAt,
        },
        'GLOBAL'
      );
    }

    // 4. For official sources: PRESERVE existing valid snapshots from prior downloads/imports.
    // Do NOT create synthetic baseline snapshots for official sources!
    // Do NOT reset real snapshots if record count shrinks!
    for (const src of INITIAL_OFFICIAL_SOURCES) {
      const current = storageRepository.getSource(src.id, 'GLOBAL');
      if (current && current.activeSnapshotId) {
        const snap = storageRepository.getSnapshot(current.activeSnapshotId);
        if (snap) {
          // Existing valid snapshot is retained untouched
          continue;
        }
      }
    }

    // 3. Trigger initial memory index build
    try {
      await memorySearchIndex.rebuildIndex('default');
    } catch {
      // Non-fatal during early bootstrap
    }

    this.initialized = true;
  }

  public listSources(tenantId = 'default'): SourceDefinition[] {
    return storageRepository.listSources(tenantId);
  }

  public getSource(sourceId: string, tenantId = 'default'): SourceDefinition | undefined {
    return storageRepository.getSource(sourceId, tenantId);
  }

  public toggleSource(sourceId: string, enabled: boolean, tenantId = 'default'): SourceDefinition {
    const src = storageRepository.getSource(sourceId, tenantId);
    if (!src) {
      throw new Error(`Source not found: ${sourceId}`);
    }
    storageRepository.updateSourceStatus(sourceId, { enabled }, src.tenantId);
    // Rebuild index
    memorySearchIndex.rebuildIndex(tenantId);
    return storageRepository.getSource(sourceId, tenantId)!;
  }

  public createCustomSource(
    params: {
      sourceId: string;
      name: string;
      publisher: string;
      category: 'INTERNAL_WATCHLIST' | 'LICENSED_WATCHLIST';
      format: 'CSV' | 'JSON' | 'XML';
      description?: string;
      isRequired?: boolean;
    },
    tenantId = 'default'
  ): SourceDefinition {
    const cleanId = params.sourceId.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '_');
    // Ensure cannot conflict with global official sources
    const globalExisting = storageRepository.getSource(cleanId, 'GLOBAL');
    if (globalExisting) {
      throw new Error(`Cannot create custom source: ID "${cleanId}" conflicts with an official source.`);
    }

    const tenantExisting = storageRepository.getSource(cleanId, tenantId);
    if (tenantExisting) {
      throw new Error(`Source with ID "${cleanId}" already exists for tenant ${tenantId}.`);
    }

    const sourceDef: SourceDefinition = {
      id: cleanId,
      name: sanitizeString(params.name),
      publisher: sanitizeString(params.publisher),
      category: params.category,
      authoritativeUrl: `urn:compliancegate:tenant:${tenantId}:source:${cleanId}`,
      termsUrl: `https://compliancegate.local/tenant/${tenantId}/sources/${cleanId}`,
      termsReviewedDate: new Date().toISOString().slice(0, 10),
      format: params.format,
      refreshScheduleHours: 0,
      freshnessTtlHours: 8760,
      isRequired: Boolean(params.isRequired),
      enabled: true,
      description: sanitizeString(params.description || `Tenant-private ${params.category} source.`),
      healthStatus: 'HEALTHY',
      tenantId,
    };

    storageRepository.saveSource(sourceDef);
    return sourceDef;
  }

  public previewUpload(
    rawContent: string,
    format: 'CSV' | 'JSON' | 'XML',
    sourceId: string,
    tenantId = 'default'
  ): {
    totalRecords: number;
    validRecords: number;
    rejectedRecords: number;
    rejectionReasons: string[];
    sampleRecords: SourceRecord[];
  } {
    const { records, rejectedCount, reasons } = this.parseRawData(
      rawContent,
      format,
      sourceId,
      tenantId
    );
    return {
      totalRecords: records.length + rejectedCount,
      validRecords: records.length,
      rejectedRecords: rejectedCount,
      rejectionReasons: reasons.slice(0, 20),
      sampleRecords: records.slice(0, 5),
    };
  }

  /**
   * Refreshes an official source by downloading its authoritative upstream feed,
   * parsing records with the source-specific parser, validating counts and schema,
   * updating snapshot atomically, and rebuilding memory index.
   * On failure: preserves last good active snapshot and marks health degraded.
   */
  public async refreshSource(
    sourceId: string,
    tenantId = 'GLOBAL',
    actor = 'SYSTEM'
  ): Promise<{ job: ImportJobRecord; message: string }> {
    const source = storageRepository.getSource(sourceId, tenantId) || storageRepository.getSource(sourceId, 'GLOBAL');
    if (!source) {
      throw new Error(`Unknown source: ${sourceId}`);
    }

    if (source.category === 'REFERENCE_REGISTRY') {
      const job: ImportJobRecord = {
        jobId: `ref_job_${Date.now()}_${sourceId.toLowerCase()}`,
        tenantId,
        sourceId,
        jobType: 'OFFICIAL_SYNC',
        status: 'COMPLETED',
        progressPercent: 100,
        totalRecords: 0,
        validRecords: 0,
        rejectedRecords: 0,
        rejectionReasons: [],
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        triggeredBy: actor,
      };
      storageRepository.saveImportJob(job);
      return {
        job,
        message: `Reference registry ${source.name} is maintained on-demand and does not require bulk downloading.`,
      };
    }

    const jobId = `sync_${Date.now()}_${sourceId.toLowerCase()}`;
    const startTime = new Date().toISOString();

    const job: ImportJobRecord = {
      jobId,
      tenantId,
      sourceId,
      jobType: 'OFFICIAL_SYNC',
      status: 'PARSING',
      progressPercent: 10,
      totalRecords: 0,
      validRecords: 0,
      rejectedRecords: 0,
      rejectionReasons: [],
      previousSnapshotId: source.activeSnapshotId,
      startedAt: startTime,
      triggeredBy: actor,
    };
    storageRepository.saveImportJob(job);

    try {
      // 1. Download official feed with bounded timeout & size limit
      const downloadRes = await downloadOfficialFeed(source.authoritativeUrl, {
        timeoutMs: 15000,
        maxBytes: 60 * 1024 * 1024,
      });

      job.rawFileDigest = sha256(downloadRes.rawText);
      job.progressPercent = 40;

      // 2. Parse using source-specific parser
      let parsedFeed: { records: SourceRecord[]; rejectedCount: number; reasons: string[] };
      switch (sourceId) {
        case 'OFAC_SDN':
        case 'OFAC_NON_SDN':
          parsedFeed = parseOfacSdnXml(downloadRes.rawText, sourceId);
          break;
        case 'UK_SANCTIONS_LIST':
          parsedFeed = parseUkSanctionsXml(downloadRes.rawText, sourceId);
          break;
        case 'UN_CONSOLIDATED':
          parsedFeed = parseUnSanctionsXml(downloadRes.rawText, sourceId);
          break;
        case 'EU_FSF':
          parsedFeed = parseEuFsfXml(downloadRes.rawText, sourceId);
          break;
        case 'AU_DFAT':
          parsedFeed = parseDfatCsv(downloadRes.rawText, sourceId);
          break;
        case 'CA_SEMA':
          parsedFeed = parseSemaCsv(downloadRes.rawText, sourceId);
          break;
        default:
          parsedFeed = this.parseRawData(downloadRes.rawText, source.format as any, sourceId, tenantId);
          break;
      }

      const records = parsedFeed.records;
      job.totalRecords = records.length + parsedFeed.rejectedCount;
      job.validRecords = records.length;
      job.rejectedRecords = parsedFeed.rejectedCount;
      job.rejectionReasons = parsedFeed.reasons;
      job.progressPercent = 70;

      // 3. Validation checks
      if (records.length === 0) {
        throw new Error(`Quarantine rejection: Upstream download for ${sourceId} yielded zero valid records.`);
      }

      // Check count drop anomaly vs previous active snapshot
      const currentActive = source.activeSnapshotId ? storageRepository.getSnapshot(source.activeSnapshotId) : null;
      if (currentActive && currentActive.recordCount > 10) {
        const dropPercent = ((currentActive.recordCount - records.length) / currentActive.recordCount) * 100;
        if (dropPercent > 50) {
          throw new Error(
            `Quarantine anomaly: Record count dropped by ${dropPercent.toFixed(1)}% (from ${currentActive.recordCount} to ${records.length}). Requires manual review.`
          );
        }
      }

      // Check if unchanged (idempotent update)
      const newDigest = sha256(records);
      if (currentActive && currentActive.sha256Digest === newDigest) {
        job.status = 'COMPLETED';
        job.progressPercent = 100;
        job.completedAt = new Date().toISOString();
        storageRepository.saveImportJob(job);
        storageRepository.updateSourceStatus(
          sourceId,
          {
            healthStatus: 'HEALTHY',
            lastSuccessfulFetch: new Date().toISOString(),
            ingestErrors: [],
          },
          tenantId
        );
        return {
          job,
          message: `Official feed for ${sourceId} is unchanged (${records.length} records verified, digest matches active snapshot).`,
        };
      }

      // 4. Create and atomically activate new snapshot
      const snapshotId = `snap_${sourceId.toLowerCase()}_${Date.now()}`;
      const snapshot: SourceSnapshot = {
        snapshotId,
        sourceId,
        versionTag: `v${new Date().toISOString().slice(0, 10)}.${Date.now().toString().slice(-4)}`,
        schemaVersion: '2.0.0',
        sha256Digest: newDigest,
        recordCount: records.length,
        aliasCount: records.reduce((acc, r) => acc + (r.aliases?.length || 0), 0),
        fetchedAt: new Date().toISOString(),
        status: 'ACTIVE',
        tenantId,
      };

      storageRepository.saveSnapshot(snapshot, records);
      storageRepository.updateSourceStatus(
        sourceId,
        {
          activeSnapshotId: snapshotId,
          activeVersionTag: snapshot.versionTag,
          recordCount: snapshot.recordCount,
          aliasCount: snapshot.aliasCount,
          healthStatus: 'HEALTHY',
          lastSuccessfulFetch: snapshot.fetchedAt,
          ingestErrors: [],
        },
        tenantId
      );

      // Rebuild memory index
      await memorySearchIndex.rebuildIndex('default');

      job.status = 'COMPLETED';
      job.progressPercent = 100;
      job.completedAt = new Date().toISOString();
      storageRepository.saveImportJob(job);

      return {
        job,
        message: `Successfully ingested and activated ${records.length} records for ${sourceId} (Snapshot: ${snapshotId}).`,
      };
    } catch (err: any) {
      // KEEP LAST GOOD SNAPSHOT on failure!
      job.status = 'FAILED';
      job.errorMessage = err.message;
      job.completedAt = new Date().toISOString();
      storageRepository.saveImportJob(job);

      storageRepository.updateSourceStatus(
        sourceId,
        {
          healthStatus: source.activeSnapshotId ? 'DEGRADED' : 'UNAVAILABLE',
          ingestErrors: [err.message],
        },
        tenantId
      );

      throw err;
    }
  }

  public async refreshAllOfficialSources(tenantId = 'GLOBAL'): Promise<Array<{ sourceId: string; success: boolean; message: string }>> {
    const results: Array<{ sourceId: string; success: boolean; message: string }> = [];
    const sources = storageRepository.listSources(tenantId).filter((s) => s.category === 'OFFICIAL_SANCTIONS' && s.enabled);
    for (const src of sources) {
      try {
        const res = await this.refreshSource(src.id, tenantId, 'AUTO_SCHEDULER');
        results.push({ sourceId: src.id, success: true, message: res.message });
      } catch (err: any) {
        results.push({ sourceId: src.id, success: false, message: err.message });
      }
    }
    return results;
  }

  // ==========================================
  // Ingestion & Import Pipeline
  // ==========================================
  /**
   * Imports and validates raw watchlist data (CSV, JSON, XML).
   * Enforces quarantine on:
   * - Parse errors
   * - Unexpected zero records
   * - Count reduction > 30% compared to active snapshot
   * - Duplicate primary keys or missing mandatory name/id
   */
  public async ingestAndValidate(params: {
    sourceId: string;
    tenantId: string;
    rawContent: string;
    filename: string;
    format: 'CSV' | 'JSON' | 'XML';
    actor: string;
    autoActivate?: boolean;
    bypassQuarantine?: boolean;
  }): Promise<{
    job: ImportJobRecord;
    snapshot?: SourceSnapshot;
    previewRecords: SourceRecord[];
    quarantined: boolean;
    quarantineReason?: string;
  }> {
    const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const startTime = new Date().toISOString();
    const source = storageRepository.getSource(params.sourceId, params.tenantId);
    if (!source) {
      throw new Error(`Cannot import into unknown source: ${params.sourceId}`);
    }

    // Enforce Tenant Isolation: Private tenant uploads cannot overwrite or modify GLOBAL official sources!
    if (params.tenantId !== 'GLOBAL') {
      const globalSource = storageRepository.getSource(params.sourceId, 'GLOBAL');
      if (globalSource && globalSource.category === 'OFFICIAL_SANCTIONS') {
        throw new Error(
          `SECURITY REJECTION: Tenant uploads cannot overwrite or modify GLOBAL official source "${params.sourceId}". Please create or select a private internal or licensed list.`
        );
      }
    }

    const job: ImportJobRecord = {
      jobId,
      tenantId: params.tenantId,
      sourceId: params.sourceId,
      jobType: params.tenantId === 'GLOBAL' ? 'OFFICIAL_SYNC' : 'USER_UPLOAD',
      status: 'PARSING',
      progressPercent: 20,
      totalRecords: 0,
      validRecords: 0,
      rejectedRecords: 0,
      rejectionReasons: [],
      previousSnapshotId: source.activeSnapshotId,
      startedAt: startTime,
      triggeredBy: params.actor,
      rawFilename: params.filename,
      rawFileDigest: sha256(params.rawContent),
    };
    storageRepository.saveImportJob(job);

    try {
      // 1. Parse raw content according to format
      const { records, rejectedCount, reasons } = this.parseRawData(
        params.rawContent,
        params.format,
        params.sourceId,
        params.tenantId
      );

      job.totalRecords = records.length + rejectedCount;
      job.validRecords = records.length;
      job.rejectedRecords = rejectedCount;
      job.rejectionReasons = reasons;
      job.progressPercent = 50;

      // Check if unchanged file imported (idempotency check)
      const currentActive = source.activeSnapshotId ? storageRepository.getSnapshot(source.activeSnapshotId) : null;
      const newDigest = sha256(records);

      if (currentActive && currentActive.sha256Digest === newDigest) {
        job.status = 'COMPLETED';
        job.progressPercent = 100;
        job.completedAt = new Date().toISOString();
        storageRepository.saveImportJob(job);
        return {
          job,
          snapshot: currentActive,
          previewRecords: records.slice(0, 10),
          quarantined: false,
        };
      }

      // 2. Validation & Anomaly Checks
      let isQuarantined = false;
      let quarantineReason = '';

      if (records.length === 0) {
        isQuarantined = true;
        quarantineReason = 'CRITICAL_ANOMALY: Import yielded zero valid records. Auto-activation prohibited.';
      } else if (currentActive && currentActive.recordCount > 10) {
        const dropPercent = ((currentActive.recordCount - records.length) / currentActive.recordCount) * 100;
        if (dropPercent > 30) {
          isQuarantined = true;
          quarantineReason = `COUNT_DROP_ANOMALY: Record count dropped by ${dropPercent.toFixed(1)}% (from ${currentActive.recordCount} to ${records.length}). Requires manual senior approval.`;
        }
      }

      // 3. Create new snapshot
      const snapshotId = `snap_${params.sourceId.toLowerCase()}_${Date.now()}`;
      const snapshot: SourceSnapshot = {
        snapshotId,
        sourceId: params.sourceId,
        versionTag: `v${new Date().toISOString().slice(0, 10).replace(/-/g, '.')}.${Date.now().toString().slice(-4)}`,
        schemaVersion: '2.0.0',
        sha256Digest: newDigest,
        recordCount: records.length,
        aliasCount: records.reduce((acc, r) => acc + (r.aliases?.length || 0), 0),
        fetchedAt: new Date().toISOString(),
        status: isQuarantined ? 'QUARANTINED' : 'STAGED',
        tenantId: params.tenantId,
        quarantineReason: isQuarantined ? quarantineReason : undefined,
      };

      storageRepository.saveSnapshot(snapshot, records);

      if (isQuarantined && !params.bypassQuarantine) {
        job.status = 'QUARANTINED';
        job.errorMessage = quarantineReason;
        job.completedAt = new Date().toISOString();
        storageRepository.saveImportJob(job);

        // Keep last good snapshot active, mark source degraded
        storageRepository.updateSourceStatus(params.sourceId, {
          healthStatus: 'DEGRADED',
          ingestErrors: [quarantineReason],
        }, params.tenantId);

        return {
          job,
          snapshot,
          previewRecords: records.slice(0, 10),
          quarantined: true,
          quarantineReason,
        };
      }

      // 4. Activation (if autoActivate requested and not quarantined)
      if (params.autoActivate || params.bypassQuarantine) {
        job.status = 'ACTIVATING';
        job.progressPercent = 80;
        storageRepository.saveImportJob(job);

        storageRepository.activateSnapshot(snapshotId, params.actor);
        await memorySearchIndex.rebuildIndex(params.tenantId);

        job.status = 'COMPLETED';
        job.progressPercent = 100;
        job.activatedSnapshotId = snapshotId;
        job.completedAt = new Date().toISOString();
        storageRepository.saveImportJob(job);
      } else {
        job.status = 'COMPLETED';
        job.progressPercent = 100;
        job.completedAt = new Date().toISOString();
        storageRepository.saveImportJob(job);
      }

      return {
        job,
        snapshot,
        previewRecords: records.slice(0, 10),
        quarantined: false,
      };
    } catch (err: any) {
      job.status = 'FAILED';
      job.errorMessage = err.message;
      job.completedAt = new Date().toISOString();
      storageRepository.saveImportJob(job);

      // Keep last good version active, mark degraded
      storageRepository.updateSourceStatus(params.sourceId, {
        healthStatus: 'DEGRADED',
        ingestErrors: [err.message],
      }, params.tenantId);

      throw err;
    }
  }

  /**
   * Secure parsers for CSV, JSON, and XML.
   * Protects against CSV formula injection, XXE, and malformed tags.
   */
  private parseRawData(
    raw: string,
    format: 'CSV' | 'JSON' | 'XML',
    sourceId: string,
    tenantId: string
  ): { records: SourceRecord[]; rejectedCount: number; reasons: string[] } {
    // 1. Source-Specific Parsers for Official Feeds
    if ((sourceId === 'OFAC_SDN' || sourceId === 'OFAC_NON_SDN') && format === 'XML') {
      const feed = parseOfacSdnXml(raw, sourceId);
      return { records: feed.records, rejectedCount: feed.rejectedCount, reasons: feed.reasons };
    }
    if (sourceId === 'UK_SANCTIONS_LIST' && format === 'XML') {
      const feed = parseUkSanctionsXml(raw, sourceId);
      return { records: feed.records, rejectedCount: feed.rejectedCount, reasons: feed.reasons };
    }
    if (sourceId === 'UN_CONSOLIDATED' && format === 'XML') {
      const feed = parseUnSanctionsXml(raw, sourceId);
      return { records: feed.records, rejectedCount: feed.rejectedCount, reasons: feed.reasons };
    }
    if (sourceId === 'EU_FSF' && format === 'XML') {
      const feed = parseEuFsfXml(raw, sourceId);
      return { records: feed.records, rejectedCount: feed.rejectedCount, reasons: feed.reasons };
    }
    if (sourceId === 'AU_DFAT' && format === 'CSV') {
      const feed = parseDfatCsv(raw, sourceId);
      return { records: feed.records, rejectedCount: feed.rejectedCount, reasons: feed.reasons };
    }
    if (sourceId === 'CA_SEMA' && format === 'CSV') {
      const feed = parseSemaCsv(raw, sourceId);
      return { records: feed.records, rejectedCount: feed.rejectedCount, reasons: feed.reasons };
    }

    const records: SourceRecord[] = [];
    const reasons: string[] = [];
    let rejectedCount = 0;
    const seenIds = new Set<string>();

    if (format === 'JSON') {
      let parsed: any;
      try {
        parsed = JSON.parse(raw);
      } catch (err: any) {
        throw new Error(`Malformed JSON file: ${err.message}`);
      }

      const items = Array.isArray(parsed) ? parsed : Array.isArray(parsed.entries) ? parsed.entries : [parsed];
      for (const item of items) {
        if (!item || !item.name) {
          rejectedCount++;
          reasons.push('Skipped entry missing mandatory "name" attribute.');
          continue;
        }
        const providerRecordId = String(item.id || item.providerRecordId || sha256(item.name).slice(0, 12));
        const recordId = `${sourceId}:${providerRecordId}`;

        if (seenIds.has(recordId)) {
          rejectedCount++;
          reasons.push(`Duplicate ID rejected: ${providerRecordId}`);
          continue;
        }
        seenIds.add(recordId);

        records.push({
          id: recordId,
          sourceId,
          providerRecordId,
          name: this.sanitizeString(String(item.name)),
          aliases: Array.isArray(item.aliases) ? item.aliases.map((a: any) => this.sanitizeString(String(a))) : [],
          entityType: item.entityType || 'ORGANIZATION',
          identifiers: Array.isArray(item.identifiers) ? item.identifiers : [],
          country: item.country ? this.sanitizeString(String(item.country)) : undefined,
          programs: Array.isArray(item.programs) ? item.programs : [],
          remarks: item.remarks ? this.sanitizeString(String(item.remarks)) : undefined,
          rawPayload: item,
        });
      }
    } else if (format === 'CSV') {
      const lines = raw.split(/\r?\n/).filter(Boolean);
      if (lines.length <= 1) {
        return { records: [], rejectedCount: 0, reasons: ['CSV contains header only without data rows.'] };
      }

      const headers = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/['"]/g, ''));
      const idIdx = headers.findIndex((h) => h === 'id' || h === 'record_id' || h === 'provider_id');
      const nameIdx = headers.findIndex((h) => h === 'name' || h === 'entity_name' || h === 'full_name');
      const aliasIdx = headers.findIndex((h) => h === 'aliases' || h === 'alias' || h === 'aka');
      const typeIdx = headers.findIndex((h) => h === 'type' || h === 'entity_type');
      const countryIdx = headers.findIndex((h) => h === 'country' || h === 'nationality');
      const programIdx = headers.findIndex((h) => h === 'programs' || h === 'program' || h === 'list');
      const remarksIdx = headers.findIndex((h) => h === 'remarks' || h === 'notes');

      if (nameIdx === -1) {
        throw new Error('CSV is missing mandatory "name" or "entity_name" header column.');
      }

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // Parse CSV line handling quotes and commas
        const cols = this.parseCsvLine(line);
        const nameVal = cols[nameIdx]?.trim();
        if (!nameVal) {
          rejectedCount++;
          reasons.push(`Row ${i + 1}: Missing name value.`);
          continue;
        }

        const providerId = (idIdx >= 0 && cols[idIdx]?.trim()) ? cols[idIdx].trim() : `row_${i}`;
        const recordId = `${sourceId}:${providerId}`;

        if (seenIds.has(recordId)) {
          rejectedCount++;
          reasons.push(`Row ${i + 1}: Duplicate ID ${providerId}`);
          continue;
        }
        seenIds.add(recordId);

        const aliases = aliasIdx >= 0 && cols[aliasIdx]
          ? cols[aliasIdx].split(/[;|]/).map((a) => this.sanitizeString(a.trim())).filter(Boolean)
          : [];

        records.push({
          id: recordId,
          sourceId,
          providerRecordId: providerId,
          name: this.sanitizeString(nameVal),
          aliases,
          entityType: (typeIdx >= 0 && cols[typeIdx]?.trim()) ? cols[typeIdx].trim().toUpperCase() as EntityType : 'ORGANIZATION',
          identifiers: [],
          country: countryIdx >= 0 ? this.sanitizeString(cols[countryIdx]?.trim()) : undefined,
          programs: programIdx >= 0 && cols[programIdx] ? [cols[programIdx].trim()] : [],
          remarks: remarksIdx >= 0 ? this.sanitizeString(cols[remarksIdx]?.trim()) : undefined,
        });
      }
    } else if (format === 'XML') {
      // Security guard: Reject prohibited DTDs and External Entities (XXE)
      if (raw.includes('<!DOCTYPE') || raw.includes('<!ENTITY') || raw.includes('SYSTEM "') || raw.includes('PUBLIC "')) {
        throw new Error('XML parsing security rejection: DOCTYPE and ENTITY declarations strictly prohibited to prevent XXE.');
      }

      // Check for unclosed / truncated XML
      const openTags = (raw.match(/<[a-zA-Z0-9_:-]+(\s+[^>]*)?>/g) || []).filter((t) => !t.endsWith('/>') && !t.startsWith('<?'));
      const closeTags = raw.match(/<\/[a-zA-Z0-9_:-]+>/g) || [];
      if (Math.abs(openTags.length - closeTags.length) > 10) {
        throw new Error('Malformed or truncated XML: Severe imbalance between open and closing tags.');
      }

      // Simple regex extraction of record nodes (<record>, <sdnEntry>, <sanctionEntry>, <item>)
      const entryRegex = /<(?:record|sdnEntry|sanctionEntry|item|entity)[\s>]([\s\S]*?)<\/(?:record|sdnEntry|sanctionEntry|item|entity)>/gi;
      let match;
      let count = 0;

      while ((match = entryRegex.exec(raw)) !== null) {
        count++;
        const content = match[1];
        const idMatch = content.match(/<(?:uid|id|reference|recordId)>([^<]+)<\//i);
        const nameMatch = content.match(/<(?:name|fullName|lastName|entityName)>([^<]+)<\//i);
        const typeMatch = content.match(/<(?:type|sdnType|entityType)>([^<]+)<\//i);
        const countryMatch = content.match(/<(?:country|nationality)>([^<]+)<\//i);

        if (!nameMatch) {
          rejectedCount++;
          reasons.push(`XML Entry ${count}: Missing name tag.`);
          continue;
        }

        const providerId = idMatch ? idMatch[1].trim() : `xml_${count}`;
        const recordId = `${sourceId}:${providerId}`;

        if (seenIds.has(recordId)) {
          rejectedCount++;
          reasons.push(`Duplicate XML ID: ${providerId}`);
          continue;
        }
        seenIds.add(recordId);

        records.push({
          id: recordId,
          sourceId,
          providerRecordId: providerId,
          name: this.sanitizeString(nameMatch[1].trim()),
          aliases: [],
          entityType: typeMatch ? typeMatch[1].trim().toUpperCase() as EntityType : 'ORGANIZATION',
          identifiers: [],
          country: countryMatch ? this.sanitizeString(countryMatch[1].trim()) : undefined,
        });
      }

      if (count === 0) {
        throw new Error('XML parser could not find supported entry nodes (<record>, <sdnEntry>, <sanctionEntry>, or <item>).');
      }
    }

    return { records, rejectedCount, reasons };
  }

  /**
   * Sanitizes strings against CSV formula injection and malicious characters.
   */
  private sanitizeString(s: string): string {
    if (!s) return '';
    // Strip CSV formula prefixes
    let clean = s.trim();
    if (clean.startsWith('=') || clean.startsWith('+') || clean.startsWith('-') || clean.startsWith('@')) {
      clean = clean.replace(/^[=+\-@]+/, '');
    }
    return clean;
  }

  private parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (c === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += c;
      }
    }
    result.push(current);
    return result;
  }
}

export const sourceRegistryService = new SourceRegistryService();
