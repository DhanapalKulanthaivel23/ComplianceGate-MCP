/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import fs from 'fs';
import path from 'path';
import { ExternalAdapterInfo, WatchlistEntry, WatchlistInfo } from '../../shared/types.ts';
import { sha256 } from './normalizer.ts';

// Explicit synthetic watchlist records with DEMO prefixes
const INITIAL_DEMO_RECORDS: WatchlistEntry[] = [
  {
    id: 'DEMO-SDN-001',
    listId: 'DEMO_OFAC_SDN',
    name: 'Oceanic Aurora Maritime Ltd',
    aliases: ['Oceanic Aurora Shipping Co', 'Aurora Maritime Transport', 'MV Oceanic Aurora'],
    entityType: 'VESSEL',
    identifiers: [
      { type: 'IMO', value: '9123456' },
      { type: 'LEI', value: '549300DEMOOAURORA00' },
    ],
    country: 'Marshall Islands',
    programs: ['DEMO-NPWMD', 'DEMO-IRAN'],
    remarks: 'DEMO SYNTHETIC DATA: Designated maritime vessel management company and primary carrier.',
  },
  {
    id: 'DEMO-SDN-002',
    listId: 'DEMO_OFAC_SDN',
    name: 'Al-Huda International Trading LLC',
    aliases: ['Al Huda General Trading', 'Huda Marine Transport', 'Al Huda Logistics Group'],
    entityType: 'ORGANIZATION',
    identifiers: [
      { type: 'TAX_ID', value: 'AE-DEMO-99214' },
      { type: 'REGISTRATION_NO', value: 'DEMO-REG-10492' },
      { type: 'SWIFT_BIC', value: 'HUDADEMOXXX' },
    ],
    country: 'United Arab Emirates',
    programs: ['DEMO-SYRIA', 'DEMO-SDGT'],
    remarks: 'DEMO SYNTHETIC DATA: Facilitator of transshipment operations for prohibited entities.',
  },
  {
    id: 'DEMO-SDN-003',
    listId: 'DEMO_OFAC_SDN',
    name: 'Dmitry Sergeyevich Volkov',
    aliases: ['Dmitri Volkov', 'Дмитрий Сергеевич Волков', 'Volkov D.S.'],
    entityType: 'INDIVIDUAL',
    identifiers: [
      { type: 'PASSPORT', value: 'RU-DEMO-8829140', country: 'RUS' },
      { type: 'TAX_ID', value: 'RU-DEMO-INN-7701928374' },
    ],
    country: 'Russia',
    programs: ['DEMO-RUSSIA-EO14024'],
    remarks: 'DEMO SYNTHETIC DATA: Corporate executive of sanctioned precision tooling conglomerate.',
  },
  {
    id: 'DEMO-SDN-004',
    listId: 'DEMO_OFAC_SDN',
    name: 'Beijing Horizon Microelectronics Co Ltd',
    aliases: ['Horizon Micro Tech', '北京地平线微电子有限公司', 'Beijing Horizon Semiconductor Corp'],
    entityType: 'ORGANIZATION',
    identifiers: [
      { type: 'LEI', value: '549300DEMOBEIJING01' },
      { type: 'TAX_ID', value: 'CN-DEMO-91110000000001' },
    ],
    country: 'China',
    programs: ['DEMO-CMIC'],
    remarks: 'DEMO SYNTHETIC DATA: Manufacturer of advanced dual-use gallium nitride chips.',
  },
  {
    id: 'DEMO-SDN-005',
    listId: 'DEMO_OFAC_SDN',
    name: 'Karim Tariq Al-Mansoor',
    aliases: ['طارق عبد الكريم المنصور', 'Tariq Al-Mansour', 'Karim Mansour'],
    entityType: 'INDIVIDUAL',
    identifiers: [
      { type: 'PASSPORT', value: 'SY-DEMO-112345', country: 'SYR' },
    ],
    country: 'Syria',
    programs: ['DEMO-CAESAR'],
    remarks: 'DEMO SYNTHETIC DATA: Petroleum procurement coordinator.',
  },
  {
    id: 'DEMO-EU-001',
    listId: 'DEMO_EU_FSF',
    name: 'Nordic Volga Logistics OOO',
    aliases: ['Nordic Volga Freight Forwarding', 'ООО Нордик Волга Логистикс'],
    entityType: 'ORGANIZATION',
    identifiers: [
      { type: 'TAX_ID', value: 'RU-DEMO-7712345678' },
      { type: 'REGISTRATION_NO', value: 'OGRN-DEMO-10277001' },
    ],
    country: 'Russia',
    programs: ['DEMO-EU-REG-269/2014'],
    remarks: 'DEMO SYNTHETIC DATA: Logistics operator transporting dual-use turbine equipment.',
  },
  {
    id: 'DEMO-UN-001',
    listId: 'DEMO_UN_CONSOLIDATED',
    name: 'Al-Furqan Humanitarian Relief Foundation',
    aliases: ['مؤسسة الفرقان الإغاثية', 'Al-Furqan Charity Trust'],
    entityType: 'ORGANIZATION',
    identifiers: [
      { type: 'REGISTRATION_NO', value: 'UN-DEMO-NG-4412' },
    ],
    country: 'Somalia',
    programs: ['DEMO-UN-RES-751'],
    remarks: 'DEMO SYNTHETIC DATA: Front organization funnelling trans-border arms purchases.',
  },
  {
    id: 'DEMO-UK-001',
    listId: 'DEMO_UK_HMT',
    name: 'Caspian Sea Petrochemical Transshipment Ltd',
    aliases: ['Caspian Petro Trans', 'Caspian Transshipment UK Ltd'],
    entityType: 'ORGANIZATION',
    identifiers: [
      { type: 'REGISTRATION_NO', value: 'UK-DEMO-991200' },
      { type: 'TAX_ID', value: 'GB-DEMO-VAT-12345678' },
    ],
    country: 'United Kingdom',
    programs: ['DEMO-UK-RUSSIA-SANCTIONS'],
    remarks: 'DEMO SYNTHETIC DATA: Shadow tanker fleet bunker brokerage.',
  },
  {
    id: 'DEMO-VESSEL-001',
    listId: 'DEMO_VESSEL_IMO',
    name: 'MV OCEANIC AURORA',
    aliases: ['OCEANIC AURORA', 'AURORA STAR', 'MV AURORA-1'],
    entityType: 'VESSEL',
    identifiers: [
      { type: 'IMO', value: '9123456' },
      { type: 'REGISTRATION_NO', value: 'MMSI-DEMO-538000000' },
    ],
    country: 'Marshall Islands',
    programs: ['DEMO-MARITIME-BLOCKADE'],
    remarks: 'DEMO SYNTHETIC DATA: Flagged crude tanker engaged in deceptive STS transfers.',
  },
  {
    id: 'DEMO-VESSEL-002',
    listId: 'DEMO_VESSEL_IMO',
    name: 'MT NEPTUNE PRIDE',
    aliases: ['NEPTUNE PRIDE', 'PRIDE OF NEPTUNE'],
    entityType: 'VESSEL',
    identifiers: [
      { type: 'IMO', value: '9345678' },
    ],
    country: 'Liberia',
    programs: ['DEMO-MARITIME-BLOCKADE'],
    remarks: 'DEMO SYNTHETIC DATA: Bulk carrier involved in illicit grain transfers.',
  },
  {
    id: 'DEMO-VESSEL-003',
    listId: 'DEMO_VESSEL_IMO',
    name: 'MV CRIMSON TIDE',
    aliases: ['CRIMSON TIDE', 'CRIMSON EXPRESS'],
    entityType: 'VESSEL',
    identifiers: [
      { type: 'IMO', value: '9245679' },
    ],
    country: 'Panama',
    programs: ['DEMO-MARITIME-BLOCKADE'],
    remarks: 'DEMO SYNTHETIC DATA: Container vessel subject to port ban.',
  },
];

// Configuration of watchlists
interface InternalWatchlist {
  info: WatchlistInfo;
  entries: WatchlistEntry[];
}

class WatchlistService {
  private lists: Map<string, InternalWatchlist> = new Map();
  private configuredFolders: string[] = [];
  private lastVersionHash = '';
  private validationErrors: string[] = [];
  private pollingTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.initializeLists();
    if (!this.isPublicDemoMode()) {
      this.reloadFromEnvironment();
    }
  }

  /**
   * Resolves configured watchlist directories from environment variables:
   * - General list folder variables (comma, semicolon, or colon delimited):
   *   DATA_DIR, LICENSED_LISTS_DIR, INTERNAL_LISTS_DIR,
   *   WATCHLIST_DIRS, WATCHLIST_DIR, LIST_FOLDERS, LIST_FOLDER, LISTS_DIR, SANCTIONS_LIST_DIRS
   * - Per-list folder variables:
   *   OFAC_LIST_DIR, DEMO_OFAC_SDN_DIR, EU_LIST_DIR, DEMO_EU_FSF_DIR,
   *   UN_LIST_DIR, DEMO_UN_CONSOLIDATED_DIR, UK_LIST_DIR, DEMO_UK_HMT_DIR,
   *   DEMO_UK_OFSI_DIR, VESSEL_LIST_DIR, DEMO_VESSEL_IMO_DIR
   */
  public getConfiguredListFolders(): Array<{ folderPath: string; defaultListId?: string; envVar: string }> {
    const resolved: Array<{ folderPath: string; defaultListId?: string; envVar: string }> = [];
    const seen = new Set<string>();

    const generalVars = [
      'DATA_DIR',
      'LICENSED_LISTS_DIR',
      'INTERNAL_LISTS_DIR',
      'WATCHLIST_DIRS',
      'WATCHLIST_DIR',
      'LIST_FOLDERS',
      'LIST_FOLDER',
      'LISTS_DIR',
      'SANCTIONS_LIST_DIRS',
    ];

    for (const varName of generalVars) {
      const raw = process.env[varName];
      if (!raw || !raw.trim()) continue;
      // Split by comma, semicolon, or path.delimiter (preserving spaces and '/' path separators)
      const parts = raw
        .split(/[,;]/)
        .flatMap((p) => p.split(path.delimiter))
        .map((p) => p.trim())
        .filter(Boolean);

      for (const p of parts) {
        const abs = path.resolve(process.cwd(), p);
        const key = `${abs}::`;
        if (!seen.has(key)) {
          seen.add(key);
          resolved.push({ folderPath: abs, envVar: varName });
        }
      }
    }

    const perListEnvMap: Array<{ envVar: string; listId: string }> = [
      { envVar: 'OFAC_LIST_DIR', listId: 'DEMO_OFAC_SDN' },
      { envVar: 'DEMO_OFAC_SDN_DIR', listId: 'DEMO_OFAC_SDN' },
      { envVar: 'EU_LIST_DIR', listId: 'DEMO_EU_FSF' },
      { envVar: 'DEMO_EU_FSF_DIR', listId: 'DEMO_EU_FSF' },
      { envVar: 'UN_LIST_DIR', listId: 'DEMO_UN_CONSOLIDATED' },
      { envVar: 'DEMO_UN_CONSOLIDATED_DIR', listId: 'DEMO_UN_CONSOLIDATED' },
      { envVar: 'UK_LIST_DIR', listId: 'DEMO_UK_HMT' },
      { envVar: 'DEMO_UK_HMT_DIR', listId: 'DEMO_UK_HMT' },
      { envVar: 'DEMO_UK_OFSI_DIR', listId: 'DEMO_UK_HMT' },
      { envVar: 'VESSEL_LIST_DIR', listId: 'DEMO_VESSEL_IMO' },
      { envVar: 'DEMO_VESSEL_IMO_DIR', listId: 'DEMO_VESSEL_IMO' },
    ];

    for (const { envVar, listId } of perListEnvMap) {
      const raw = process.env[envVar];
      if (!raw || !raw.trim()) continue;
      const abs = path.resolve(process.cwd(), raw.trim());
      const key = `${abs}::${listId}`;
      if (!seen.has(key)) {
        seen.add(key);
        resolved.push({ folderPath: abs, defaultListId: listId, envVar });
      }
    }

    return resolved;
  }

  public isPublicDemoMode(): boolean {
    return process.env.IS_PUBLIC_DEMO !== 'false';
  }

  /**
   * Resolves a relative file_ref safely inside the configured read-only watchlist directories.
   * Rejects path traversal (..), null bytes, absolute paths escaping the root, and symlinks.
   */
  public resolveSafeFileRef(fileRef: string, allowedRootDir?: string): string {
    if (!fileRef || typeof fileRef !== 'string' || fileRef.includes('\0')) {
      throw new Error('Invalid file_ref: empty or contains null byte.');
    }
    const cleanRef = fileRef.trim();
    if (cleanRef.includes('..') || path.isAbsolute(cleanRef)) {
      throw new Error(`Security violation: path traversal or absolute path prohibited in file_ref [${fileRef}].`);
    }

    const roots = allowedRootDir
      ? [path.resolve(allowedRootDir)]
      : this.getConfiguredListFolders().map((c) => path.resolve(c.folderPath));

    if (roots.length === 0) {
      throw new Error('No configured watchlist root folders available to resolve file_ref.');
    }

    for (const rootDir of roots) {
      if (!fs.existsSync(rootDir)) continue;
      const realRoot = fs.realpathSync(rootDir);
      const candidate = path.resolve(realRoot, cleanRef);
      if (!candidate.startsWith(realRoot + path.sep)) {
        throw new Error(`Security violation: file_ref [${fileRef}] escapes watchlist root directory.`);
      }
      if (!fs.existsSync(candidate)) continue;
      const lstat = fs.lstatSync(candidate);
      if (lstat.isSymbolicLink()) {
        throw new Error(`Security violation: symbolic links are prohibited in watchlist file_ref [${fileRef}].`);
      }
      const realCandidate = fs.realpathSync(candidate);
      if (!realCandidate.startsWith(realRoot + path.sep)) {
        throw new Error(`Security violation: resolved realpath for [${fileRef}] escapes watchlist root.`);
      }
      return realCandidate;
    }

    throw new Error(`Referenced watchlist file_ref [${fileRef}] not found in any configured list directory.`);
  }

  /**
   * Parses CSV watchlist records (supports headered CSVs and OFAC/UK OFSI standard columns).
   */
  public parseCsvWatchlist(rawCsv: string, defaultListId = 'DEMO_OFAC_SDN'): WatchlistEntry[] {
    const lines = rawCsv
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('#'));
    if (lines.length === 0) return [];

    const splitCsvLine = (line: string): string[] => {
      const cols: string[] = [];
      let cur = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          inQuotes = !inQuotes;
        } else if (ch === ',' && !inQuotes) {
          cols.push(cur.trim());
          cur = '';
        } else {
          cur += ch;
        }
      }
      cols.push(cur.trim());
      return cols;
    };

    const firstRow = splitCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z0-9_]/g, ''));
    const hasHeader = firstRow.includes('id') || firstRow.includes('name') || firstRow.includes('ent_num') || firstRow.includes('sdn_name');
    const entries: WatchlistEntry[] = [];

    const startIdx = hasHeader ? 1 : 0;
    for (let i = startIdx; i < lines.length; i++) {
      const cols = splitCsvLine(lines[i]);
      if (cols.length < 2) continue;

      let id = '';
      let name = '';
      let entityType: WatchlistEntry['entityType'] = 'ORGANIZATION';
      let listId = defaultListId;
      let country: string | undefined;
      let programs: string[] = [];
      let aliases: string[] = [];
      const identifiers: WatchlistEntry['identifiers'] = [];
      let remarks: string | undefined;

      if (hasHeader) {
        const rowMap: Record<string, string> = {};
        firstRow.forEach((h, idx) => {
          rowMap[h] = cols[idx] || '';
        });
        id = rowMap['id'] || rowMap['ent_num'] || rowMap['uid'] || `CSV-${i}`;
        name = rowMap['name'] || rowMap['sdn_name'] || rowMap['wholename'] || '';
        const rawType = (rowMap['entitytype'] || rowMap['sdn_type'] || rowMap['type'] || '').toUpperCase();
        if (rawType.includes('INDIV')) entityType = 'INDIVIDUAL';
        else if (rawType.includes('VESSEL')) entityType = 'VESSEL';
        else entityType = 'ORGANIZATION';
        listId = rowMap['listid'] || defaultListId;
        country = rowMap['country'] || undefined;
        if (rowMap['programs'] || rowMap['program']) {
          programs = (rowMap['programs'] || rowMap['program']).split(/[;|]/).map((s) => s.trim()).filter(Boolean);
        }
        if (rowMap['aliases'] || rowMap['aka']) {
          aliases = (rowMap['aliases'] || rowMap['aka']).split(/[;|]/).map((s) => s.trim()).filter(Boolean);
        }
        if (rowMap['bic']) identifiers.push({ type: 'BIC', value: rowMap['bic'] });
        if (rowMap['lei']) identifiers.push({ type: 'LEI', value: rowMap['lei'] });
        if (rowMap['imo']) identifiers.push({ type: 'IMO', value: rowMap['imo'] });
        if (rowMap['taxid']) identifiers.push({ type: 'TAX_ID', value: rowMap['taxid'] });
        if (rowMap['passport']) identifiers.push({ type: 'PASSPORT', value: rowMap['passport'] });
        remarks = rowMap['remarks'] || undefined;
      } else {
        // Positional OFAC SDN CSV: ent_num, SDN_Name, SDN_Type, Program, Title, Call_Sign, Vess_type, Tonnage, GRT, Vess_flag, Vess_owner, Remarks
        id = cols[0];
        name = cols[1];
        const rawType = (cols[2] || '').toUpperCase();
        entityType = rawType.includes('INDIVIDUAL') ? 'INDIVIDUAL' : rawType.includes('VESSEL') ? 'VESSEL' : 'ORGANIZATION';
        if (cols[3]) programs = [cols[3]];
        remarks = cols[11] || cols[4] || undefined;
      }

      if (!id || !name || name === '-0-') continue;
      entries.push({
        id,
        listId,
        name,
        aliases,
        entityType,
        identifiers,
        country,
        programs,
        remarks,
      });
    }

    return entries;
  }

  /**
   * Parses XML watchlist files (supports OFAC <sdnEntry>, UN <INDIVIDUAL>/<ENTITY>, and EU <sanctionEntity>).
   */
  public parseXmlWatchlist(rawXml: string, defaultListId = 'DEMO_OFAC_SDN'): WatchlistEntry[] {
    if (/<!DOCTYPE/i.test(rawXml) || /<!ENTITY/i.test(rawXml)) {
      throw new Error('Security violation: XML watchlist contains prohibited DOCTYPE/ENTITY declarations.');
    }

    const entries: WatchlistEntry[] = [];
    const extractTag = (block: string, tag: string): string => {
      const m = block.match(new RegExp(`<(?:[a-zA-Z0-9_.-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_.-]+:)?${tag}>`, 'i'));
      return m ? m[1].trim() : '';
    };

    // 1. OFAC <sdnEntry>
    const sdnMatches = Array.from(rawXml.matchAll(/<(?:[a-zA-Z0-9_.-]+:)?sdnEntry(?:\s[^>]*)?>([\s\S]*?)<\/(?:[a-zA-Z0-9_.-]+:)?sdnEntry>/gi));
    for (const m of sdnMatches) {
      const blk = m[1];
      const uid = extractTag(blk, 'uid');
      const firstName = extractTag(blk, 'firstName');
      const lastName = extractTag(blk, 'lastName');
      const name = [firstName, lastName].filter(Boolean).join(' ').trim();
      const sdnType = extractTag(blk, 'sdnType').toUpperCase();
      const prog = extractTag(blk, 'program');
      if (uid && name) {
        entries.push({
          id: `OFAC-${uid}`,
          listId: defaultListId,
          name,
          aliases: [],
          entityType: sdnType.includes('INDIVIDUAL') ? 'INDIVIDUAL' : sdnType.includes('VESSEL') ? 'VESSEL' : 'ORGANIZATION',
          identifiers: [],
          programs: prog ? [prog] : [],
        });
      }
    }

    // 2. UN Consolidated <INDIVIDUAL> and <ENTITY>
    const unIndivMatches = Array.from(rawXml.matchAll(/<INDIVIDUAL(?:\s[^>]*)?>([\s\S]*?)<\/INDIVIDUAL>/gi));
    for (const m of unIndivMatches) {
      const blk = m[1];
      const dataId = extractTag(blk, 'DATAID');
      const first = extractTag(blk, 'FIRST_NAME');
      const second = extractTag(blk, 'SECOND_NAME');
      const third = extractTag(blk, 'THIRD_NAME');
      const name = [first, second, third].filter(Boolean).join(' ').trim();
      if (dataId && name) {
        entries.push({
          id: `UN-${dataId}`,
          listId: defaultListId === 'DEMO_OFAC_SDN' ? 'DEMO_UN_CONSOLIDATED' : defaultListId,
          name,
          aliases: [],
          entityType: 'INDIVIDUAL',
          identifiers: [],
          programs: [extractTag(blk, 'UN_LIST_TYPE') || 'UN_CONSOLIDATED'],
        });
      }
    }

    const unEntityMatches = Array.from(rawXml.matchAll(/<ENTITY(?:\s[^>]*)?>([\s\S]*?)<\/ENTITY>/gi));
    for (const m of unEntityMatches) {
      const blk = m[1];
      const dataId = extractTag(blk, 'DATAID');
      const first = extractTag(blk, 'FIRST_NAME');
      if (dataId && first) {
        entries.push({
          id: `UN-ENT-${dataId}`,
          listId: defaultListId === 'DEMO_OFAC_SDN' ? 'DEMO_UN_CONSOLIDATED' : defaultListId,
          name: first,
          aliases: [],
          entityType: 'ORGANIZATION',
          identifiers: [],
          programs: [extractTag(blk, 'UN_LIST_TYPE') || 'UN_CONSOLIDATED'],
        });
      }
    }

    // 3. EU FSF <sanctionEntity>
    const euMatches = Array.from(rawXml.matchAll(/<(?:[a-zA-Z0-9_.-]+:)?sanctionEntity([^>]*)>([\s\S]*?)<\/(?:[a-zA-Z0-9_.-]+:)?sanctionEntity>/gi));
    for (const m of euMatches) {
      const attrs = m[1];
      const blk = m[2];
      const logicalId = attrs.match(/logicalId=['"]([^'"]+)['"]/i)?.[1] || extractTag(blk, 'logicalId');
      const wholeName = blk.match(/wholeName=['"]([^'"]+)['"]/i)?.[1] || extractTag(blk, 'wholeName');
      if (logicalId && wholeName) {
        entries.push({
          id: `EU-${logicalId}`,
          listId: defaultListId === 'DEMO_OFAC_SDN' ? 'DEMO_EU_FSF' : defaultListId,
          name: wholeName,
          aliases: [],
          entityType: 'ORGANIZATION',
          identifiers: [],
          programs: ['EU_FSF'],
        });
      }
    }

    return entries;
  }

  /**
   * Computes a deterministic SHA-256 version digest across all files in configured watchlist directories.
   */
  public computeDirectoryVersionHash(): string {
    if (this.isPublicDemoMode()) return 'PUBLIC_DEMO_BASELINE';
    const folderConfigs = this.getConfiguredListFolders();
    const fileDigests: string[] = [];

    for (const cfg of folderConfigs) {
      if (!fs.existsSync(cfg.folderPath)) continue;
      try {
        const files = this.collectWatchlistFiles(cfg.folderPath);
        for (const f of files) {
          const stat = fs.statSync(f);
          fileDigests.push(`${f}:${stat.size}:${stat.mtimeMs}`);
        }
      } catch {
        // Ignore unreadable folder
      }
    }
    return sha256(fileDigests.sort());
  }

  /**
   * Hot-reloads watchlists only if the underlying client folders have changed.
   */
  public hotReloadIfChanged(): { reloaded: boolean; versionHash: string; loadedEntries: number } {
    if (this.isPublicDemoMode()) {
      return { reloaded: false, versionHash: 'PUBLIC_DEMO_BASELINE', loadedEntries: 0 };
    }
    const currentHash = this.computeDirectoryVersionHash();
    if (currentHash === this.lastVersionHash && this.lastVersionHash !== '') {
      return { reloaded: false, versionHash: currentHash, loadedEntries: 0 };
    }
    const res = this.reloadFromEnvironment();
    this.lastVersionHash = currentHash;
    return { reloaded: true, versionHash: currentHash, loadedEntries: res.loadedEntries };
  }

  public startPolling(intervalMs = 30_000): void {
    this.stopPolling();
    this.pollingTimer = setInterval(() => {
      this.hotReloadIfChanged();
    }, intervalMs);
    if (this.pollingTimer.unref) {
      this.pollingTimer.unref();
    }
  }

  public stopPolling(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
  }

  public getValidationErrors(): string[] {
    return [...this.validationErrors];
  }

  private collectWatchlistFiles(dirPath: string): string[] {
    const supportedExts = ['.json', '.csv', '.xml'];
    const collected: string[] = [];
    if (!fs.existsSync(dirPath)) return collected;
    const stat = fs.statSync(dirPath);
    if (!stat.isDirectory()) return collected;

    const items = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const item of items) {
      if (item.isSymbolicLink()) continue;
      const fullPath = path.join(dirPath, item.name);
      const ext = path.extname(item.name).toLowerCase();
      if (item.isFile() && supportedExts.includes(ext) && item.name !== 'payments_store.json') {
        collected.push(fullPath);
      } else if (item.isDirectory() && item.name !== 'backups') {
        try {
          const subItems = fs.readdirSync(fullPath, { withFileTypes: true });
          for (const sub of subItems) {
            if (sub.isSymbolicLink()) continue;
            const subExt = path.extname(sub.name).toLowerCase();
            if (sub.isFile() && supportedExts.includes(subExt) && sub.name !== 'payments_store.json') {
              collected.push(path.join(fullPath, sub.name));
            }
          }
        } catch {
          // Ignore unreadable subdirectory
        }
      }
    }
    return collected.sort();
  }

  /**
   * Reloads watchlists from environment-configured folders using atomic staging swap.
   * Hard security boundary: In PUBLIC_SYNTHETIC_DEMO mode (IS_PUBLIC_DEMO !== 'false'),
   * client folder data is strictly ignored and never loaded into memory or exposed.
   */
  public reloadFromEnvironment(): {
    loadedEntries: number;
    configuredFolders: string[];
    blockedByPublicDemo?: boolean;
    validationErrors?: string[];
  } {
    this.validationErrors = [];

    if (this.isPublicDemoMode()) {
      this.lists.clear();
      this.initializeLists();
      this.configuredFolders = [];
      return {
        loadedEntries: 0,
        configuredFolders: [],
        blockedByPublicDemo: true,
        validationErrors: [],
      };
    }

    // Build staged map first for atomic swap so a failure never leaves the active index empty
    const previousLists = new Map(this.lists);
    try {
      this.lists.clear();
      this.initializeLists();

      const folderConfigs = this.getConfiguredListFolders();
      this.configuredFolders = folderConfigs.map((f) => f.folderPath);

      let loadedEntries = 0;
      for (const cfg of folderConfigs) {
        loadedEntries += this.loadFromDirectory(cfg.folderPath, cfg.defaultListId);
      }
      this.lastVersionHash = this.computeDirectoryVersionHash();

      return {
        loadedEntries,
        configuredFolders: this.configuredFolders,
        blockedByPublicDemo: false,
        validationErrors: [...this.validationErrors],
      };
    } catch (err: any) {
      this.lists = previousLists;
      throw err;
    }
  }

  /**
   * Loads JSON, CSV, and XML watchlist files from a directory into active watchlists.
   * Refuses to load external client data when running in PUBLIC_SYNTHETIC_DEMO mode.
   */
  public loadFromDirectory(dirPath: string, defaultListId?: string): number {
    if (this.isPublicDemoMode()) {
      return 0;
    }
    try {
      const files = this.collectWatchlistFiles(dirPath);
      let count = 0;
      const now = new Date().toISOString();

      for (const file of files) {
        try {
          const raw = fs.readFileSync(file, 'utf8');
          const ext = path.extname(file).toLowerCase();
          let entries: WatchlistEntry[] = [];
          let parsedMeta: any = null;

          if (ext === '.json') {
            const parsed = JSON.parse(raw);
            parsedMeta = parsed;
            entries = Array.isArray(parsed)
              ? parsed
              : Array.isArray(parsed?.entries)
              ? parsed.entries
              : [];
          } else if (ext === '.csv') {
            entries = this.parseCsvWatchlist(raw, defaultListId || 'DEMO_OFAC_SDN');
          } else if (ext === '.xml') {
            entries = this.parseXmlWatchlist(raw, defaultListId || 'DEMO_OFAC_SDN');
          }

          for (const entry of entries) {
            if (!entry || !entry.id || !entry.name) {
              this.validationErrors.push(`Skipped entry missing id or name in ${path.basename(file)}`);
              continue;
            }
            const targetListId = entry.listId || parsedMeta?.listId || defaultListId || 'DEMO_OFAC_SDN';
            const normalizedEntry: WatchlistEntry = {
              id: entry.id,
              listId: targetListId,
              name: entry.name,
              aliases: Array.isArray(entry.aliases) ? entry.aliases : [],
              entityType: entry.entityType || 'ORGANIZATION',
              identifiers: Array.isArray(entry.identifiers) ? entry.identifiers : [],
              country: entry.country,
              programs: Array.isArray(entry.programs) ? entry.programs : [],
              remarks: entry.remarks,
            };

            let list = this.lists.get(targetListId);
            if (!list) {
              list = {
                info: {
                  id: targetListId,
                  name: parsedMeta?.name || `Custom Watchlist (${targetListId})`,
                  provider: parsedMeta?.provider || 'Environment Directory Watchlist',
                  description: parsedMeta?.description || `Loaded from ${dirPath}`,
                  recordCount: 0,
                  lastUpdated: now,
                  freshnessTtlHours: parsedMeta?.freshnessTtlHours || 24,
                  sha256Digest: '',
                  isSimulatedStale: false,
                  isStale: false,
                  isRequired: Boolean(parsedMeta?.isRequired),
                },
                entries: [],
              };
              this.lists.set(targetListId, list);
            }

            const existingIdx = list.entries.findIndex((e) => e.id === normalizedEntry.id);
            if (existingIdx >= 0) {
              list.entries[existingIdx] = normalizedEntry;
            } else {
              list.entries.push(normalizedEntry);
            }
            list.info.recordCount = list.entries.length;
            list.info.lastUpdated = now;
            list.info.sha256Digest = sha256(list.entries);
            count++;
          }
        } catch (fileErr: any) {
          this.validationErrors.push(`Failed to load ${path.basename(file)}: ${fileErr.message}`);
        }
      }

      return count;
    } catch {
      return 0;
    }
  }

  private initializeLists() {
    const listDefs: Array<{
      id: string;
      name: string;
      provider: string;
      description: string;
      freshnessTtlHours: number;
      isRequired: boolean;
    }> = [
      {
        id: 'DEMO_OFAC_SDN',
        name: 'DEMO OFAC Specially Designated Nationals (Synthetic)',
        provider: 'US Treasury OFAC (Synthetic Sandbox)',
        description: 'Synthetic SDN dataset for sanctions compliance testing. Contains persons, firms, and vessels.',
        freshnessTtlHours: 24,
        isRequired: true,
      },
      {
        id: 'DEMO_EU_FSF',
        name: 'DEMO EU Financial Sanctions Database (Synthetic)',
        provider: 'European External Action Service (Synthetic)',
        description: 'Synthetic consolidated list of persons, groups and entities subject to EU financial sanctions.',
        freshnessTtlHours: 24,
        isRequired: true,
      },
      {
        id: 'DEMO_UN_CONSOLIDATED',
        name: 'DEMO UN Security Council Sanctions (Synthetic)',
        provider: 'United Nations Security Council (Synthetic)',
        description: 'Synthetic UN Security Council consolidated sanctions list.',
        freshnessTtlHours: 24,
        isRequired: true,
      },
      {
        id: 'DEMO_UK_HMT',
        name: 'DEMO UK OFSI Consolidated Sanctions (Synthetic)',
        provider: 'UK HM Treasury / OFSI (Synthetic)',
        description: 'Synthetic UK Office of Financial Sanctions Implementation financial sanctions list.',
        freshnessTtlHours: 24,
        isRequired: true,
      },
      {
        id: 'DEMO_VESSEL_IMO',
        name: 'DEMO High-Risk Vessel Registry (Synthetic)',
        provider: 'International Maritime Compliance Registry (Synthetic)',
        description: 'Synthetic registry of sanctioned or high-risk maritime IMO vessel identifiers.',
        freshnessTtlHours: 24,
        isRequired: true,
      },
    ];

    const now = new Date().toISOString();

    for (const def of listDefs) {
      const entries = INITIAL_DEMO_RECORDS.filter((r) => r.listId === def.id);
      const digest = sha256(entries);

      this.lists.set(def.id, {
        info: {
          id: def.id,
          name: def.name,
          provider: def.provider,
          description: def.description,
          recordCount: entries.length,
          lastUpdated: now,
          freshnessTtlHours: def.freshnessTtlHours,
          sha256Digest: digest,
          isSimulatedStale: false,
          isStale: false,
          isRequired: def.isRequired,
        },
        entries,
      });
    }
  }

  public getAllLists(): WatchlistInfo[] {
    const result: WatchlistInfo[] = [];
    const nowMs = Date.now();

    for (const [, list] of this.lists.entries()) {
      const updatedMs = new Date(list.info.lastUpdated).getTime();
      const ageHours = (nowMs - updatedMs) / (1000 * 60 * 60);
      const isNaturallyStale = ageHours > list.info.freshnessTtlHours;
      const isStale = list.info.isSimulatedStale || isNaturallyStale;

      result.push({
        ...list.info,
        isStale,
      });
    }

    return result;
  }

  public getList(listId: string): InternalWatchlist | undefined {
    return this.lists.get(listId);
  }

  public getAllEntries(): WatchlistEntry[] {
    const all: WatchlistEntry[] = [];
    for (const [, list] of this.lists.entries()) {
      all.push(...list.entries);
    }
    return all;
  }

  public getListDigests(): Record<string, string> {
    const digests: Record<string, string> = {};
    for (const [id, list] of this.lists.entries()) {
      digests[id] = list.info.sha256Digest;
    }
    return digests;
  }

  /**
   * Required list freshness gate:
   * Returns false if any required list is marked simulated stale or naturally exceeds its TTL.
   */
  public checkListFreshness(): {
    isFresh: boolean;
    staleLists: string[];
    missingLists: string[];
    details: Array<{ id: string; name: string; ageHours: number; isStale: boolean }>;
  } {
    const staleLists: string[] = [];
    const missingLists: string[] = [];
    const details: Array<{ id: string; name: string; ageHours: number; isStale: boolean }> = [];
    const nowMs = Date.now();

    for (const [, list] of this.lists.entries()) {
      if (!list.info.isRequired) continue;

      const updatedMs = new Date(list.info.lastUpdated).getTime();
      const ageHours = Number(((nowMs - updatedMs) / (1000 * 60 * 60)).toFixed(2));
      const isNaturallyStale = ageHours > list.info.freshnessTtlHours;
      const isStale = list.info.isSimulatedStale || isNaturallyStale;

      details.push({
        id: list.info.id,
        name: list.info.name,
        ageHours,
        isStale,
      });

      if (isStale) {
        staleLists.push(list.info.id);
      }
    }

    return {
      isFresh: staleLists.length === 0 && missingLists.length === 0,
      staleLists,
      missingLists,
      details,
    };
  }

  /**
   * Toggle simulated staleness for testing the required freshness gate.
   */
  public toggleSimulatedStale(listId: string, isStale: boolean): boolean {
    const list = this.lists.get(listId);
    if (!list) return false;
    list.info.isSimulatedStale = isStale;
    list.info.isStale = isStale;
    return true;
  }

  /**
   * Refresh list snapshot timestamp and recalculate digest.
   */
  public refreshList(listId: string): WatchlistInfo | null {
    const list = this.lists.get(listId);
    if (!list) return null;

    list.info.lastUpdated = new Date().toISOString();
    list.info.isSimulatedStale = false;
    list.info.isStale = false;
    list.info.sha256Digest = sha256(list.entries);

    return { ...list.info };
  }

  /**
   * Reset all lists to fresh state.
   */
  public resetAllFresh(): void {
    const now = new Date().toISOString();
    for (const [, list] of this.lists.entries()) {
      list.info.lastUpdated = now;
      list.info.isSimulatedStale = false;
      list.info.isStale = false;
      list.info.sha256Digest = sha256(list.entries);
    }
  }

  /**
   * Returns explicit disabled adapters pending licensed external data.
   */
  public getDisabledAdapters(): ExternalAdapterInfo[] {
    return [
      {
        id: 'ADAPTER_AIS_LIVE_VESSEL',
        name: 'Live AIS Satellite Vessel Route Stream',
        provider: 'Spire / Lloyd\'s Maritime Intelligence',
        status: 'DISABLED_PENDING_LICENSE',
        reason: 'Requires licensed streaming AIS telemetry contract; mock/fabricated tracking strictly prohibited by policy.',
        sampleEndpoint: 'wss://api.maritime-intel.demo/ais/v2/stream (Inactive)',
      },
      {
        id: 'ADAPTER_IATA_TACT_AIR',
        name: 'IATA TACT Global Cargo & Flight Route Feeds',
        provider: 'International Air Transport Association (IATA)',
        status: 'DISABLED_PENDING_LICENSE',
        reason: 'Pending commercial air cargo rate & route benchmark subscription.',
        sampleEndpoint: 'https://api.iata.org/tact/v1/schedules (Inactive)',
      },
      {
        id: 'ADAPTER_COMMODITY_PRICE_BENCHMARKS',
        name: 'Crude Oil & Petrochemical Fair Value Price Screen',
        provider: 'Argus Media / S&P Global Platts',
        status: 'DISABLED_PENDING_LICENSE',
        reason: 'Price-cap enforcement requires licensed spot/derivative settlement data.',
        sampleEndpoint: 'https://api.energybenchmarks.demo/prices/v1 (Inactive)',
      },
      {
        id: 'ADAPTER_DUAL_USE_CLASSIFIER_ML',
        name: 'Military & Dual-Use ECCN Classifier Machine Learning Feed',
        provider: 'BAFA / BIS Export Control Data Partner',
        status: 'DISABLED_PENDING_LICENSE',
        reason: 'Autonomous dual-use ML overrides strictly prohibited without accredited sovereign validation.',
        sampleEndpoint: 'https://api.exportcontrol.demo/eccn/classify (Inactive)',
      },
    ];
  }
}

export const watchlistService = new WatchlistService();
