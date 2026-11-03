// Package lists provides ingestion adapters and directory hot reloading for sanctions and PEP watchlists.
package lists

import (
	"crypto/sha256"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/compliancegate/compliancegate-core/pkg/model"
)

type WatchlistRepository struct {
	mu          sync.RWMutex
	entries     []model.WatchlistEntry
	entriesByID map[string]model.WatchlistEntry
	versionHash string
	lastReload  time.Time
	dataDir     string
	listDirs    []string
}

// ResolveEnvListDirs collects configured watchlist folders from environment variables.
func ResolveEnvListDirs(defaultDir string) []string {
	var dirs []string
	seen := make(map[string]bool)
	addDir := func(d string) {
		d = strings.TrimSpace(d)
		if d != "" && !seen[d] {
			seen[d] = true
			dirs = append(dirs, d)
		}
	}

	if defaultDir != "" {
		addDir(defaultDir)
	}

	envVars := []string{
		"DATA_DIR", "LICENSED_LISTS_DIR", "INTERNAL_LISTS_DIR",
		"WATCHLIST_DIRS", "WATCHLIST_DIR", "LIST_FOLDERS", "LIST_FOLDER",
		"LISTS_DIR", "SANCTIONS_LIST_DIRS", "OFAC_LIST_DIR", "EU_LIST_DIR",
		"UN_LIST_DIR", "UK_LIST_DIR", "VESSEL_LIST_DIR",
	}
	for _, key := range envVars {
		val := os.Getenv(key)
		if val == "" {
			continue
		}
		for _, part := range strings.FieldsFunc(val, func(r rune) bool {
			return r == ',' || r == ';' || r == filepath.ListSeparator
		}) {
			addDir(part)
		}
	}
	return dirs
}

// IsPublicDemoMode returns true unless IS_PUBLIC_DEMO is explicitly set to "false".
// In public synthetic demo mode, external client list folders are never loaded.
func IsPublicDemoMode() bool {
	return strings.ToLower(strings.TrimSpace(os.Getenv("IS_PUBLIC_DEMO"))) != "false"
}

func NewWatchlistRepository(dataDir string) *WatchlistRepository {
	var dirs []string
	if !IsPublicDemoMode() {
		dirs = ResolveEnvListDirs(dataDir)
	}
	repo := &WatchlistRepository{
		entriesByID: make(map[string]model.WatchlistEntry),
		dataDir:     dataDir,
		listDirs:    dirs,
	}
	repo.SeedSyntheticBaselines()
	if !IsPublicDemoMode() {
		for _, d := range dirs {
			_ = repo.LoadFromDirectory(d)
		}
	}
	return repo
}

// SeedSyntheticBaselines populates standard benchmark entries across UN, EU, UK, Dow Jones, and World-Check.
func (r *WatchlistRepository) SeedSyntheticBaselines() {
	r.mu.Lock()
	defer r.mu.Unlock()

	baselines := []model.WatchlistEntry{
		{
			ID:         "SDN-1001",
			ListID:     "DEMO_OFAC_SDN",
			ListName:   "US OFAC Specially Designated Nationals",
			Name:       "Oceanic Aurora Maritime Ltd",
			EntityType: model.EntityTypeEntity,
			Aliases:    []string{"Oceanic Aurora Shipping", "Aurora Maritime Shipping LLC"},
			Identifiers: []model.Identifier{
				{Type: "IMO", Value: "9256858"},
				{Type: "BIC", Value: "OAMLRU2MXXX"},
			},
			Countries: []string{"RU", "CY"},
			Programs:  []string{"RUSSIA-EO14024", "MARITIME-SANCTIONS"},
			Remarks:   "Commercial management of sanctioned shadow tanker fleet",
		},
		{
			ID:         "SDN-1002",
			ListID:     "DEMO_OFAC_SDN",
			ListName:   "US OFAC Specially Designated Nationals",
			Name:       "Dmitry Sergeyevich Volkov",
			EntityType: model.EntityTypeIndividual,
			Aliases:    []string{"Dmitri Volkov", "Volkov Dmitry"},
			Identifiers: []model.Identifier{
				{Type: "PASSPORT", Value: "RU-DEMO-8829140", Country: "RU"},
			},
			Countries: []string{"RU"},
			Programs:  []string{"CYBER2-EO13694"},
			Remarks:   "Affiliated with state-sponsored illicit procurement network",
		},
		{
			ID:         "EU-2001",
			ListID:     "DEMO_EU_FSF",
			ListName:   "EU Financial Sanctions Files",
			Name:       "Nordic Volga Logistics OOO",
			EntityType: model.EntityTypeEntity,
			Aliases:    []string{"Nordic Volga", "Volga Logistics Group"},
			Identifiers: []model.Identifier{
				{Type: "TAX_ID", Value: "RU7701928374"},
			},
			Countries: []string{"RU"},
			Programs:  []string{"EU-REG-269-2014"},
			Remarks:   "Dual-use industrial transport intermediary",
		},
		{
			ID:         "UN-3001",
			ListID:     "DEMO_UN_CONSOLIDATED",
			ListName:   "UN Security Council Consolidated List",
			Name:       "Al-Furqan Humanitarian Relief Foundation",
			EntityType: model.EntityTypeEntity,
			Aliases:    []string{"Al-Furqan Trust", "Al Furqan Charity"},
			Countries:  []string{"SY", "TR"},
			Programs:   []string{"UN-SC-1267-ISIL-AL-QAIDA"},
			Remarks:    "Front entity diverting charitable relief to proscribed organizations",
		},
		{
			ID:         "UK-4001",
			ListID:     "DEMO_UK_OFSI",
			ListName:   "UK OFSI Consolidated Sanctions",
			Name:       "Al-Huda International Trading LLC",
			EntityType: model.EntityTypeEntity,
			Aliases:    []string{"Al Huda General Trading", "Al-Huda Trading Co"},
			Identifiers: []model.Identifier{
				{Type: "LEI", Value: "549300DEMOBEIJING01"},
			},
			Countries: []string{"AE", "IR"},
			Programs:  []string{"UK-RUSSIA-SANCTIONS-2019"},
			Remarks:   "High-risk re-export conduit for dual-use electronic assemblies",
		},
		{
			ID:         "DJ-5001",
			ListID:     "DEMO_DOW_JONES",
			ListName:   "Dow Jones Risk & Compliance (Synthetic Adapter)",
			Name:       "Trans-Eurasia Mining Corporation",
			EntityType: model.EntityTypeEntity,
			Aliases:    []string{"Eurasian Minerals Holding"},
			Countries:  []string{"RU", "KZ"},
			Programs:   []string{"STATE_OWNED_ENTERPRISE_50_PCT"},
			Remarks:    "Majority state-controlled extractive conglomerate",
		},
		{
			ID:         "WC-6001",
			ListID:     "DEMO_WORLD_CHECK",
			ListName:   "Refinitiv World-Check (Synthetic Adapter)",
			Name:       "Viktor Romanovich Belov",
			EntityType: model.EntityTypeIndividual,
			Aliases:    []string{"Victor Belov"},
			Countries:  []string{"RU"},
			Programs:   []string{"PEP_TIER_1_DEPUTY_MINISTER"},
			Remarks:    "Politically Exposed Person: Deputy Minister of Industry and Trade",
		},
	}

	r.entries = baselines
	for _, e := range baselines {
		r.entriesByID[e.ID] = e
	}
	r.recomputeHash()
	r.lastReload = time.Now().UTC()
}

// ResolveSafeFileRef validates and resolves a relative file_ref within an allowed directory,
// preventing path traversal (..), absolute paths, and symlink escapes.
func (r *WatchlistRepository) ResolveSafeFileRef(fileRef, allowedDir string) (string, error) {
	if strings.TrimSpace(fileRef) == "" || strings.Contains(fileRef, "\x00") {
		return "", fmt.Errorf("invalid file_ref")
	}
	if strings.Contains(fileRef, "..") || filepath.IsAbs(fileRef) {
		return "", fmt.Errorf("security violation: path traversal or absolute path prohibited in file_ref [%s]", fileRef)
	}
	realRoot, err := filepath.EvalSymlinks(allowedDir)
	if err != nil {
		return "", err
	}
	candidate := filepath.Join(realRoot, fileRef)
	if !strings.HasPrefix(candidate, realRoot+string(filepath.Separator)) {
		return "", fmt.Errorf("security violation: file_ref [%s] escapes root directory", fileRef)
	}
	info, err := os.Lstat(candidate)
	if err != nil {
		return "", err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return "", fmt.Errorf("security violation: symlinks prohibited in file_ref [%s]", fileRef)
	}
	realCandidate, err := filepath.EvalSymlinks(candidate)
	if err != nil {
		return "", err
	}
	if !strings.HasPrefix(realCandidate, realRoot+string(filepath.Separator)) {
		return "", fmt.Errorf("security violation: resolved symlink escapes root directory")
	}
	return realCandidate, nil
}

var (
	sdnEntryRe = regexp.MustCompile(`(?is)<(?:[a-z0-9_.-]+:)?sdnEntry[^>]*>(.*?)</(?:[a-z0-9_.-]+:)?sdnEntry>`)
	uidTagRe   = regexp.MustCompile(`(?is)<(?:[a-z0-9_.-]+:)?uid[^>]*>(.*?)</(?:[a-z0-9_.-]+:)?uid>`)
	fnTagRe    = regexp.MustCompile(`(?is)<(?:[a-z0-9_.-]+:)?firstName[^>]*>(.*?)</(?:[a-z0-9_.-]+:)?firstName>`)
	lnTagRe    = regexp.MustCompile(`(?is)<(?:[a-z0-9_.-]+:)?lastName[^>]*>(.*?)</(?:[a-z0-9_.-]+:)?lastName>`)
)

func parseCSVEntries(raw string) []model.WatchlistEntry {
	reader := csv.NewReader(strings.NewReader(raw))
	rows, err := reader.ReadAll()
	if err != nil || len(rows) == 0 {
		return nil
	}
	var out []model.WatchlistEntry
	startIdx := 0
	first := strings.ToLower(strings.TrimSpace(rows[0][0]))
	if first == "id" || first == "ent_num" || first == "uid" {
		startIdx = 1
	}
	for i := startIdx; i < len(rows); i++ {
		row := rows[i]
		if len(row) < 2 {
			continue
		}
		id := strings.TrimSpace(row[0])
		name := strings.TrimSpace(row[1])
		if id == "" || name == "" {
			continue
		}
		listID := "DEMO_OFAC_SDN"
		if len(row) >= 4 && strings.TrimSpace(row[3]) != "" {
			listID = strings.TrimSpace(row[3])
		}
		out = append(out, model.WatchlistEntry{
			ID:         id,
			ListID:     listID,
			ListName:   "CSV Watchlist (" + listID + ")",
			Name:       name,
			EntityType: model.EntityTypeEntity,
		})
	}
	return out
}

func parseXMLEntries(raw string) []model.WatchlistEntry {
	var out []model.WatchlistEntry
	for _, m := range sdnEntryRe.FindAllStringSubmatch(raw, -1) {
		blk := m[1]
		var uid, fn, ln string
		if u := uidTagRe.FindStringSubmatch(blk); len(u) > 1 {
			uid = strings.TrimSpace(u[1])
		}
		if f := fnTagRe.FindStringSubmatch(blk); len(f) > 1 {
			fn = strings.TrimSpace(f[1])
		}
		if l := lnTagRe.FindStringSubmatch(blk); len(l) > 1 {
			ln = strings.TrimSpace(l[1])
		}
		name := strings.TrimSpace(fn + " " + ln)
		if uid != "" && name != "" {
			out = append(out, model.WatchlistEntry{
				ID:         "OFAC-" + uid,
				ListID:     "DEMO_OFAC_SDN",
				ListName:   "US OFAC SDN XML",
				Name:       name,
				EntityType: model.EntityTypeEntity,
			})
		}
	}
	return out
}

// LoadFromDirectory reads JSON, CSV, and XML list files from client watch directories and atomically merges them.
// In PUBLIC_SYNTHETIC_DEMO mode, external client folders are strictly rejected.
func (r *WatchlistRepository) LoadFromDirectory(dir string) error {
	if IsPublicDemoMode() {
		return fmt.Errorf("loading client watchlist directories is disabled in public synthetic demo mode")
	}
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, err := os.Stat(dir); os.IsNotExist(err) {
		return fmt.Errorf("directory %s does not exist", dir)
	}

	var allFiles []string
	for _, pattern := range []string{"*.json", "*.csv", "*.xml"} {
		if matches, err := filepath.Glob(filepath.Join(dir, pattern)); err == nil {
			allFiles = append(allFiles, matches...)
		}
	}

	var newEntries []model.WatchlistEntry
	for _, f := range allFiles {
		info, err := os.Lstat(f)
		if err != nil || info.Mode()&os.ModeSymlink != 0 {
			continue
		}
		data, err := os.ReadFile(f)
		if err != nil {
			continue
		}
		ext := strings.ToLower(filepath.Ext(f))
		switch ext {
		case ".json":
			var parsed []model.WatchlistEntry
			if err := json.Unmarshal(data, &parsed); err == nil {
				newEntries = append(newEntries, parsed...)
			}
		case ".csv":
			newEntries = append(newEntries, parseCSVEntries(string(data))...)
		case ".xml":
			newEntries = append(newEntries, parseXMLEntries(string(data))...)
		}
	}

	if len(newEntries) > 0 {
		for _, e := range newEntries {
			if e.ID == "" || e.Name == "" {
				continue
			}
			if _, exists := r.entriesByID[e.ID]; !exists {
				r.entries = append(r.entries, e)
			}
			r.entriesByID[e.ID] = e
		}
		r.recomputeHash()
		r.lastReload = time.Now().UTC()
	}

	return nil
}

func (r *WatchlistRepository) recomputeHash() {
	hasher := sha256.New()
	for _, e := range r.entries {
		hasher.Write([]byte(e.ID + e.Name + e.ListID))
	}
	r.versionHash = hex.EncodeToString(hasher.Sum(nil))
}

func (r *WatchlistRepository) GetAllEntries() []model.WatchlistEntry {
	r.mu.RLock()
	defer r.mu.RUnlock()
	copied := make([]model.WatchlistEntry, len(r.entries))
	copy(copied, r.entries)
	return copied
}

func (r *WatchlistRepository) GetStatus() model.ListStatus {
	r.mu.RLock()
	defer r.mu.RUnlock()

	counts := make(map[string]int)
	names := make(map[string]string)
	for _, e := range r.entries {
		counts[e.ListID]++
		names[e.ListID] = e.ListName
	}

	var lists []model.ListInfo
	for listID, count := range counts {
		lists = append(lists, model.ListInfo{
			ListID:      listID,
			Name:        names[listID],
			Source:      "LOCAL_INDEX",
			EntryCount:  count,
			LastUpdated: r.lastReload.Format(time.RFC3339),
		})
	}

	return model.ListStatus{
		TotalEntries:        len(r.entries),
		VersionHash:         r.versionHash,
		LastReloadTimestamp: r.lastReload.Format(time.RFC3339),
		Lists:               lists,
	}
}
