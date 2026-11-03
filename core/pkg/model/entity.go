// Package model defines canonical screening entities and outcomes.
package model

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"time"
)

type EntityType string

const (
	EntityTypeIndividual    EntityType = "INDIVIDUAL"
	EntityTypeEntity        EntityType = "ENTITY"
	EntityTypeVessel        EntityType = "VESSEL"
	EntityTypeAircraft      EntityType = "AIRCRAFT"
	EntityTypeCryptoAddress EntityType = "CRYPTO_ADDRESS"
)

type FindingSeverity string

const (
	SeverityNoMatchFound        FindingSeverity = "NO_MATCH_FOUND"
	SeverityFuzzyNameCandidate  FindingSeverity = "FUZZY_NAME_CANDIDATE"
	SeverityExactIdentifierMatch FindingSeverity = "EXACT_IDENTIFIER_MATCH"
)

type MatchType string

const (
	MatchExactIdentifier MatchType = "EXACT_IDENTIFIER"
	MatchExactName       MatchType = "EXACT_NAME"
	MatchFuzzyName       MatchType = "FUZZY_NAME"
	MatchPhonetic        MatchType = "PHONETIC"
	MatchTokenSet        MatchType = "TOKEN_SET"
	MatchAlias           MatchType = "ALIAS"
)

type Identifier struct {
	Type    string `json:"type"` // BIC, LEI, TAX_ID, PASSPORT, IMO, MMSI, ISIN, NPI, DEA, ETH_ADDRESS, BTC_ADDRESS
	Value   string `json:"value"`
	Country string `json:"country,omitempty"`
}

type Address struct {
	Street          string   `json:"street,omitempty"`
	City            string   `json:"city,omitempty"`
	StateOrProvince string   `json:"stateOrProvince,omitempty"`
	PostalCode      string   `json:"postalCode,omitempty"`
	Country         string   `json:"country,omitempty"`
	RawLines        []string `json:"rawLines,omitempty"`
}

// ScreenableEntity is the single common entity model that all format parsers emit.
type ScreenableEntity struct {
	ID                string       `json:"id"`
	Name              string       `json:"name"`
	OriginalScript    string       `json:"originalScript,omitempty"`
	EntityType        EntityType   `json:"entityType"`
	Role              string       `json:"role,omitempty"` // DEBTOR, CREDITOR, BENEFICIARY, VESSEL, SHIPPER, PRACTITIONER, etc.
	Sequence          string       `json:"sequence,omitempty"` // ROOT, A, B
	Identifiers       []Identifier `json:"identifiers,omitempty"`
	Addresses         []Address    `json:"addresses,omitempty"`
	Countries         []string     `json:"countries,omitempty"`
	GoodsDescriptions []string     `json:"goodsDescriptions,omitempty"`
	HSCodes           []string     `json:"hsCodes,omitempty"`
	SourceTag         string       `json:"sourceTag,omitempty"`
}

// ParsedTransaction represents a single parsed payment transaction with profile verification metadata.
type ParsedTransaction struct {
	TransactionID    string             `json:"transactionId"`
	MessageFamily    string             `json:"messageFamily"` // SWIFT_MT or ISO20022_MX
	MessageType      string             `json:"messageType"`
	IsProfileTested  bool               `json:"isProfileTested"`
	SettlementDate   string             `json:"settlementDate,omitempty"`
	Currency         string             `json:"currency,omitempty"`
	Amount           float64            `json:"amount,omitempty"`
	ReturnReasonCode string             `json:"returnReasonCode,omitempty"`
	Entities         []ScreenableEntity `json:"entities"`
}

var verifiedTestedProfiles = map[string]bool{
	"MT103":        true,
	"MT103_STP":    true,
	"MT103_REMIT":  true,
	"MT202_COV":    true,
	"MT205_COV":    true,
	"pacs.008":     true,
	"PACS_008":     true,
	"pacs.009_COV": true,
	"PACS_009_COV": true,
	"pacs.004":     true,
	"PACS_004":     true,
	"pain.001":     true,
	"PAIN_001":     true,
}

// IsVerifiedTestedProfile returns true only if the messageType is in the verified tested profile allowlist.
func IsVerifiedTestedProfile(messageType string, suppliedFlag bool) bool {
	if !suppliedFlag {
		return false
	}
	return verifiedTestedProfiles[messageType]
}

type WatchlistEntry struct {
	ID          string       `json:"id"`
	ListID      string       `json:"listId"` // OFAC_SDN, EU_FSF, UN_CONSOLIDATED, UK_OFSI, DOW_JONES, WORLD_CHECK
	ListName    string       `json:"listName"`
	Name        string       `json:"name"`
	EntityType  EntityType   `json:"entityType"`
	Aliases     []string     `json:"aliases,omitempty"`
	Identifiers []Identifier `json:"identifiers,omitempty"`
	Addresses   []Address    `json:"addresses,omitempty"`
	Countries   []string     `json:"countries,omitempty"`
	Programs    []string     `json:"programs,omitempty"`
	Remarks     string       `json:"remarks,omitempty"`
	VersionHash string       `json:"versionHash,omitempty"`
}

type MatchDetail struct {
	ListID          string     `json:"listId"`
	ListName        string     `json:"listName"`
	EntryID         string     `json:"entryId"`
	EntryName       string     `json:"entryName"`
	EntryType       EntityType `json:"entryType"`
	MatchType       MatchType  `json:"matchType"`
	MatchedField    string     `json:"matchedField"`
	QueryValue      string     `json:"queryValue"`
	ListValue       string     `json:"listValue"`
	SimilarityScore float64    `json:"similarityScore"`
	Programs        []string   `json:"programs,omitempty"`
	Notes           string     `json:"notes,omitempty"`
}

type ScreeningResult struct {
	EntityID             string          `json:"entityId"`
	FindingSeverity      FindingSeverity `json:"findingSeverity"`
	HighestScore         float64         `json:"highestScore"`
	Matches              []MatchDetail   `json:"matches"`
	EvidenceDigest       string          `json:"evidenceDigest"`
	EvaluationDurationMs float64         `json:"evaluationDurationMs"`
}

type MessageScreeningResult struct {
	Format            string            `json:"format"`
	SubType           string            `json:"subType,omitempty"`
	EntitiesExtracted int               `json:"entitiesExtracted"`
	Entities          []ScreenableEntity `json:"entities"`
	EntityResults     []ScreeningResult `json:"entityResults"`
	Disposition       string            `json:"disposition"` // AUTO_RELEASE, MANUAL_REVIEW_REQUIRED, BLOCKED
	EvidenceDigest    string            `json:"evidenceDigest"`
}

type ListStatus struct {
	TotalEntries        int              `json:"totalEntries"`
	VersionHash         string           `json:"versionHash"`
	LastReloadTimestamp string           `json:"lastReloadTimestamp"`
	Lists               []ListInfo       `json:"lists"`
}

type ListInfo struct {
	ListID      string `json:"listId"`
	Name        string `json:"name"`
	Source      string `json:"source"`
	EntryCount  int    `json:"entryCount"`
	LastUpdated string `json:"lastUpdated"`
}

// ComputeEvidenceDigest creates a deterministic SHA-256 hash of any Go data structure.
func ComputeEvidenceDigest(v interface{}) string {
	b, err := json.Marshal(v)
	if err != nil {
		return ""
	}
	hash := sha256.Sum256(b)
	return hex.EncodeToString(hash[:])
}

func NowISO8601() string {
	return time.Now().UTC().Format(time.RFC3339)
}
