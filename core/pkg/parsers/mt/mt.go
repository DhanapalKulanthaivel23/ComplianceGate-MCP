// Package mt parses SWIFT FIN format messages across all SWIFT MT Categories 1-9 (MT101..MT999).
package mt

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/compliancegate/compliancegate-core/pkg/model"
)

var (
	tagLineRegex   = regexp.MustCompile(`^:([0-9]{2}[A-Z]?):(.*)$`)
	block1Regex    = regexp.MustCompile(`\{1:[FAl]\d{2}([A-Z]{4}[A-Z]{2}[A-Z0-9]{2})(?:[A-Z0-9])?([A-Z0-9]{3})?`)
	block2Regex    = regexp.MustCompile(`\{2:[IO](\d{3})([A-Z0-9]*)`)
	block3VarRegex = regexp.MustCompile(`\{119:([A-Z0-9]+)\}`)
	explicitMtRe   = regexp.MustCompile(`(?i)^\s*MT\s*(\d{3})\b`)
	field32ARegex  = regexp.MustCompile(`^(\d{6})([A-Z]{3})([0-9]+(?:[.,][0-9]{1,2})?)$`)
	flexAmtRegex   = regexp.MustCompile(`([A-Z]{3})([0-9]+(?:[.,][0-9]+)?)`)
)

type tagRecord struct {
	Tag   string
	Value string
}

func isValidCalendarDate(year, month, day int) bool {
	if month < 1 || month > 12 || day < 1 || day > 31 {
		return false
	}
	daysInMonth := []int{31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31}
	isLeap := (year%4 == 0 && year%100 != 0) || (year%400 == 0)
	maxDays := daysInMonth[month-1]
	if month == 2 && isLeap {
		maxDays = 29
	}
	return day <= maxDays
}

func parseField32A(val string) (string, string, float64, error) {
	clean := strings.TrimSpace(val)
	if clean == "" {
		return "", "", 0, fmt.Errorf("mandatory Field :32A: (Value Date, Currency, Amount) is missing")
	}
	m := field32ARegex.FindStringSubmatch(clean)
	if len(m) != 4 {
		return "", "", 0, fmt.Errorf("malformed Field :32A: format [%s]: expected YYMMDD + 3-letter currency + numeric amount", clean)
	}
	yymmdd := m[1]
	yy, _ := strconv.Atoi(yymmdd[:2])
	century := "20"
	year := 2000 + yy
	if yy >= 50 {
		century = "19"
		year = 1900 + yy
	}
	mm, _ := strconv.Atoi(yymmdd[2:4])
	dd, _ := strconv.Atoi(yymmdd[4:6])
	if !isValidCalendarDate(year, mm, dd) {
		return "", "", 0, fmt.Errorf("invalid settlement date: impossible calendar date [%s%s-%s-%s] in Field :32A:", century, yymmdd[:2], yymmdd[2:4], yymmdd[4:6])
	}
	date := fmt.Sprintf("%s%s-%s-%s", century, yymmdd[:2], yymmdd[2:4], yymmdd[4:6])
	ccy := m[2]
	amtStr := strings.ReplaceAll(m[3], ",", ".")
	amt, err := strconv.ParseFloat(amtStr, 64)
	if err != nil || amt <= 0 {
		return "", "", 0, fmt.Errorf("invalid settlement amount [%s] in Field :32A:", m[3])
	}
	return date, ccy, amt, nil
}

func parseFlexibleFinancials(records []tagRecord) (string, string, float64) {
	for _, r := range records {
		if r.Tag == "32A" {
			if d, c, a, err := parseField32A(r.Value); err == nil {
				return d, c, a
			}
		}
		if strings.HasPrefix(r.Tag, "32") || strings.HasPrefix(r.Tag, "33") || strings.HasPrefix(r.Tag, "19") || strings.HasPrefix(r.Tag, "60") || strings.HasPrefix(r.Tag, "62") {
			if m := flexAmtRegex.FindStringSubmatch(r.Value); len(m) == 3 {
				amt, _ := strconv.ParseFloat(strings.ReplaceAll(m[2], ",", "."), 64)
				return "", m[1], amt
			}
		}
	}
	return "", "USD", 0
}

// ParseMTTransactions parses a SWIFT MT message into canonical ParsedTransaction records,
// enforcing mandatory fields (:20:, :32A:) and Sequence A/B separation on dedicated profiles (MT103, MT202_COV).
func ParseMTTransactions(raw string) ([]model.ParsedTransaction, string, error) {
	clean := strings.TrimSpace(raw)
	if clean == "" {
		return nil, "", fmt.Errorf("empty SWIFT MT payload")
	}

	records := extractTagRecords(clean)
	if len(records) == 0 {
		return nil, "", fmt.Errorf("malformed SWIFT MT payload: no valid Block 4 field tags found")
	}

	msgType := DetectMTType(clean)
	findTag := func(prefix string) (tagRecord, bool) {
		for _, r := range records {
			if r.Tag == prefix || strings.HasPrefix(r.Tag, prefix) {
				return r, true
			}
		}
		return tagRecord{}, false
	}

	// Dedicated Profile 1: MT103 (and variants MT103_STP, MT103_REMIT)
	if msgType == "MT103" || msgType == "MT103_STP" || msgType == "MT103_REMIT" {
		tag20, ok20 := findTag("20")
		if !ok20 || strings.TrimSpace(tag20.Value) == "" {
			return nil, msgType, fmt.Errorf("mandatory Field :20: (Sender Reference) missing in %s message", msgType)
		}
		tag32A, ok32 := findTag("32A")
		if !ok32 {
			return nil, msgType, fmt.Errorf("mandatory Field :32A: (Value Date, Currency, Amount) missing in %s message", msgType)
		}
		date, ccy, amt, err := parseField32A(tag32A.Value)
		if err != nil {
			return nil, msgType, err
		}

		var entities []model.ScreenableEntity
		for _, r := range records {
			switch {
			case strings.HasPrefix(r.Tag, "50"):
				if e := parseCustomerField(r.Tag, r.Value, "DEBTOR", "ROOT"); e.Name != "" {
					entities = append(entities, e)
				}
			case strings.HasPrefix(r.Tag, "52"):
				entities = append(entities, parseAgentField(r.Tag, r.Value, "ORDERING_INSTITUTION", "ROOT"))
			case strings.HasPrefix(r.Tag, "56"):
				entities = append(entities, parseAgentField(r.Tag, r.Value, "INTERMEDIARY_AGENT", "ROOT"))
			case strings.HasPrefix(r.Tag, "57"):
				entities = append(entities, parseAgentField(r.Tag, r.Value, "CREDITOR_AGENT", "ROOT"))
			case strings.HasPrefix(r.Tag, "59"):
				if e := parseCustomerField(r.Tag, r.Value, "CREDITOR", "ROOT"); e.Name != "" {
					entities = append(entities, e)
				}
			}
		}

		isTested := true
		if msgType == "MT103_STP" {
			// STP requires Option A on agent fields (52, 54, 55, 56, 57) and prohibits non-STP 23E codes
			for _, r := range records {
				t := strings.ToUpper(r.Tag)
				if t == "52B" || t == "52C" || t == "52D" || t == "53D" || t == "54B" || t == "54D" || t == "55B" || t == "55D" || t == "56C" || t == "56D" || t == "57B" || t == "57C" || t == "57D" {
					isTested = false
				}
				if t == "23E" {
					v := strings.ToUpper(r.Value)
					if strings.Contains(v, "CHQB") || strings.Contains(v, "HOLD") || strings.Contains(v, "PHON") || strings.Contains(v, "TELE") {
						isTested = false
					}
				}
			}
		} else if msgType == "MT103_REMIT" {
			// REMIT requires Field :77T: and prohibits Field :70:
			_, has77T := findTag("77T")
			_, has70 := findTag("70")
			isTested = has77T && !has70
		}

		return []model.ParsedTransaction{
			{
				TransactionID:   strings.TrimSpace(tag20.Value),
				MessageFamily:   "SWIFT_MT",
				MessageType:     msgType,
				IsProfileTested: isTested,
				SettlementDate:  date,
				Currency:        ccy,
				Amount:          amt,
				Entities:        entities,
			},
		}, msgType, nil
	}

	// Dedicated Profile 2: MT202_COV and MT205_COV
	if msgType == "MT202_COV" || msgType == "MT205_COV" {
		tag20, ok20 := findTag("20")
		if !ok20 || strings.TrimSpace(tag20.Value) == "" {
			return nil, msgType, fmt.Errorf("mandatory Field :20: (Transaction Reference) missing in %s message", msgType)
		}
		tag32A, ok32 := findTag("32A")
		if !ok32 {
			return nil, msgType, fmt.Errorf("mandatory Field :32A: (Value Date, Currency, Amount) missing in %s message", msgType)
		}
		date, ccy, amt, err := parseField32A(tag32A.Value)
		if err != nil {
			return nil, msgType, err
		}

		var entities []model.ScreenableEntity
		inSeqB := false
		hasSeqA := false
		hasSeqB := false
		for _, r := range records {
			if strings.HasPrefix(r.Tag, "50") {
				inSeqB = true
			}
			seq := "A"
			if inSeqB {
				seq = "B"
			}
			if !inSeqB {
				switch {
				case strings.HasPrefix(r.Tag, "52"):
					entities = append(entities, parseAgentField(r.Tag, r.Value, "ORDERING_INSTITUTION", seq))
					hasSeqA = true
				case strings.HasPrefix(r.Tag, "56"):
					entities = append(entities, parseAgentField(r.Tag, r.Value, "INTERMEDIARY_AGENT", seq))
					hasSeqA = true
				case strings.HasPrefix(r.Tag, "57"):
					entities = append(entities, parseAgentField(r.Tag, r.Value, "CREDITOR_AGENT", seq))
					hasSeqA = true
				case strings.HasPrefix(r.Tag, "58"):
					entities = append(entities, parseAgentField(r.Tag, r.Value, "CREDITOR", seq))
					hasSeqA = true
				}
			} else {
				switch {
				case strings.HasPrefix(r.Tag, "50"):
					if e := parseCustomerField(r.Tag, r.Value, "DEBTOR", seq); e.Name != "" {
						entities = append(entities, e)
						hasSeqB = true
					}
				case strings.HasPrefix(r.Tag, "52"):
					entities = append(entities, parseAgentField(r.Tag, r.Value, "ORDERING_INSTITUTION", seq))
				case strings.HasPrefix(r.Tag, "56"):
					entities = append(entities, parseAgentField(r.Tag, r.Value, "INTERMEDIARY_AGENT", seq))
				case strings.HasPrefix(r.Tag, "57"):
					entities = append(entities, parseAgentField(r.Tag, r.Value, "CREDITOR_AGENT", seq))
				case strings.HasPrefix(r.Tag, "59"):
					if e := parseCustomerField(r.Tag, r.Value, "CREDITOR", seq); e.Name != "" {
						entities = append(entities, e)
						hasSeqB = true
					}
				}
			}
		}

		return []model.ParsedTransaction{
			{
				TransactionID:   strings.TrimSpace(tag20.Value),
				MessageFamily:   "SWIFT_MT",
				MessageType:     msgType,
				IsProfileTested: hasSeqA && hasSeqB,
				SettlementDate:  date,
				Currency:        ccy,
				Amount:          amt,
				Entities:        entities,
			},
		}, msgType, nil
	}

	// Generic SWIFT MT Category 1-9 Envelope (IsProfileTested = false)
	ref := "MT-GENERIC"
	if tag20, ok := findTag("20"); ok && tag20.Value != "" {
		ref = tag20.Value
	}
	date, ccy, amt := parseFlexibleFinancials(records)
	var entities []model.ScreenableEntity

	for _, r := range records {
		val := strings.TrimSpace(r.Value)
		switch {
		case strings.HasPrefix(r.Tag, "50") || strings.HasPrefix(r.Tag, "42") || strings.HasPrefix(r.Tag, "82"):
			if e := parseCustomerField(r.Tag, val, "DEBTOR", "ROOT"); e.Name != "" {
				entities = append(entities, e)
			}
		case strings.HasPrefix(r.Tag, "51") || strings.HasPrefix(r.Tag, "52"):
			entities = append(entities, parseAgentField(r.Tag, val, "ORDERING_INSTITUTION", "ROOT"))
		case strings.HasPrefix(r.Tag, "53"):
			entities = append(entities, parseAgentField(r.Tag, val, "INSTRUCTING_AGENT", "ROOT"))
		case strings.HasPrefix(r.Tag, "54") || strings.HasPrefix(r.Tag, "55") || strings.HasPrefix(r.Tag, "56"):
			entities = append(entities, parseAgentField(r.Tag, val, "INTERMEDIARY_AGENT", "ROOT"))
		case strings.HasPrefix(r.Tag, "57") || strings.HasPrefix(r.Tag, "41"):
			entities = append(entities, parseAgentField(r.Tag, val, "CREDITOR_AGENT", "ROOT"))
		case strings.HasPrefix(r.Tag, "58"):
			entities = append(entities, parseAgentField(r.Tag, val, "BENEFICIARY_INSTITUTION", "ROOT"))
		case strings.HasPrefix(r.Tag, "59") || strings.HasPrefix(r.Tag, "87"):
			if e := parseCustomerField(r.Tag, val, "CREDITOR", "ROOT"); e.Name != "" {
				entities = append(entities, e)
			}
		case strings.HasPrefix(r.Tag, "83"):
			if e := parseCustomerField(r.Tag, val, "ULTIMATE_DEBTOR", "ROOT"); e.Name != "" {
				entities = append(entities, e)
			}
		case strings.HasPrefix(r.Tag, "95"):
			if e := parseCustomerField(r.Tag, val, "SECURITIES_PARTY", "ROOT"); e.Name != "" {
				entities = append(entities, e)
			}
		}
	}

	// Fallback to Block 1/2 BIC headers when free-format or cash management MT has no body party fields
	if len(entities) == 0 {
		if b1 := block1Regex.FindStringSubmatch(clean); len(b1) > 1 {
			bic := b1[1]
			if len(b1) > 2 && b1[2] != "" {
				bic += b1[2]
			} else {
				bic += "XXX"
			}
			entities = append(entities, model.ScreenableEntity{
				ID:          generateID("mt", bic),
				Name:        "Financial Institution " + bic,
				EntityType:  model.EntityTypeEntity,
				Role:        "SENDER",
				Sequence:    "ROOT",
				Identifiers: []model.Identifier{{Type: "BIC", Value: bic}},
				SourceTag:   "Block1",
			})
		}
	}

	return []model.ParsedTransaction{
		{
			TransactionID:   ref,
			MessageFamily:   "SWIFT_MT",
			MessageType:     msgType,
			IsProfileTested: false,
			SettlementDate:  date,
			Currency:        ccy,
			Amount:          amt,
			Entities:        entities,
		},
	}, msgType, nil
}

// ParseMT extracts screenable entities from any SWIFT MT (FIN Category 1-9) text.
func ParseMT(raw string) ([]model.ScreenableEntity, string, error) {
	txs, msgType, err := ParseMTTransactions(raw)
	if err != nil {
		return nil, msgType, err
	}
	var all []model.ScreenableEntity
	for _, tx := range txs {
		all = append(all, tx.Entities...)
	}
	return all, msgType, nil
}

// DetectMTType inspects SWIFT FIN Block 2/3 headers and field tags to identify any MT100-MT999 message type.
func DetectMTType(raw string) string {
	variant := ""
	if v := block3VarRegex.FindStringSubmatch(raw); len(v) > 1 {
		variant = strings.ToUpper(v[1])
	}

	m := block2Regex.FindStringSubmatch(raw)
	if len(m) > 1 {
		num := m[1]
		if (num == "202" || num == "205") && (variant == "COV" || strings.Contains(raw, ":50K:") || strings.Contains(raw, ":50F:") || strings.Contains(raw, ":50A:") || strings.Contains(raw, "COV")) {
			return "MT" + num + "_COV"
		}
		if variant == "STP" || variant == "REMIT" || variant == "COV" {
			return "MT" + num + "_" + variant
		}
		return "MT" + num
	}

	if em := explicitMtRe.FindStringSubmatch(raw); len(em) > 1 {
		return "MT" + em[1]
	}

	if strings.Contains(raw, "MT202 COV") || (strings.Contains(raw, "202") && strings.Contains(raw, ":50K:")) {
		return "MT202_COV"
	}
	if strings.Contains(raw, ":23B:") || (strings.Contains(raw, ":59:") && strings.Contains(raw, ":50K:")) {
		return "MT103"
	}
	return "MT_GENERIC"
}

func extractTagRecords(raw string) []tagRecord {
	var records []tagRecord
	lines := strings.Split(raw, "\n")
	var currentTag string
	var currentLines []string

	flush := func() {
		if currentTag != "" {
			records = append(records, tagRecord{
				Tag:   currentTag,
				Value: strings.TrimSpace(strings.Join(currentLines, "\n")),
			})
		}
	}

	for _, line := range lines {
		trimmedLine := strings.TrimRight(line, "\r")
		if m := tagLineRegex.FindStringSubmatch(trimmedLine); len(m) > 2 {
			flush()
			currentTag = m[1]
			currentLines = []string{m[2]}
		} else if currentTag != "" {
			t := strings.TrimSpace(trimmedLine)
			if t == "-" || t == "-}" {
				flush()
				currentTag = ""
				currentLines = nil
				continue
			}
			currentLines = append(currentLines, trimmedLine)
		}
	}
	flush()
	return records
}

func parseCustomerField(tag, val, role, seq string) model.ScreenableEntity {
	lines := strings.Split(val, "\n")
	var account string
	var name string
	var addrLines []string

	for i, l := range lines {
		l = strings.TrimSpace(l)
		if i == 0 && strings.HasPrefix(l, "/") {
			account = strings.TrimPrefix(l, "/")
			continue
		}
		if name == "" {
			name = l
		} else {
			addrLines = append(addrLines, l)
		}
	}

	id := generateID("mt", name)
	var idents []model.Identifier
	if account != "" {
		idents = append(idents, model.Identifier{Type: "ACCOUNT", Value: account})
	}

	return model.ScreenableEntity{
		ID:          id,
		Name:        name,
		EntityType:  model.EntityTypeEntity,
		Role:        role,
		Sequence:    seq,
		Identifiers: idents,
		Addresses: []model.Address{
			{RawLines: addrLines},
		},
		SourceTag: ":" + tag + ":",
	}
}

func parseAgentField(tag, val, role, seq string) model.ScreenableEntity {
	clean := strings.TrimSpace(val)
	lines := strings.Split(clean, "\n")
	first := strings.TrimSpace(lines[0])

	var bic string
	name := first
	if strings.HasSuffix(tag, "A") {
		bic = first
		name = "Financial Institution " + first
	}

	var idents []model.Identifier
	if bic != "" {
		idents = append(idents, model.Identifier{Type: "BIC", Value: bic})
	}

	return model.ScreenableEntity{
		ID:          generateID("mt", name),
		Name:        name,
		EntityType:  model.EntityTypeEntity,
		Role:        role,
		Sequence:    seq,
		Identifiers: idents,
		SourceTag:   ":" + tag + ":",
	}
}

func generateID(prefix, seed string) string {
	h := sha256.Sum256([]byte(seed))
	return prefix + "_" + hex.EncodeToString(h[:])[:8]
}
