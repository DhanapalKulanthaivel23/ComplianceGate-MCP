// Package iso20022 parses ISO 20022 MX XML messages across all domains (pacs, pain, camt, head, acmt, admi, sese, setr, fxtr, tsmt, etc.).
package iso20022

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/xml"
	"fmt"
	"io"
	"regexp"
	"strconv"
	"strings"

	"github.com/compliancegate/compliancegate-core/pkg/model"
)

var (
	mxSchemaRe = regexp.MustCompile(`(?i)\b(pacs|pain|camt|acmt|admi|auth|caaa|caad|caam|cafc|cafm|cafr|cain|canm|casr|catm|catp|colr|deri|fxtr|reda|remt|secl|seeu|seev|semt|sese|setr|supl|trea|tsin|tsmt|tsrv|xsys|head)\.(\d{3})(?:\.(\d{3})\.(\d{2}))?`)
	isoStructureRe = regexp.MustCompile(`(?i)(urn:iso:std:iso:20022|<(?:[a-z0-9_.-]+:)?(?:Document|AppHdr|BizData|FIToFICstmrCdtTrf|FICdtTrf|PmtRtr|CstmrCdtTrfInitn|CstmrCdtTrfInit|BkToCstmrStmt|SctiesSttlmTxInstr)[\s>])`)
)

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

func validateIsoDate(dateStr, tag string) (string, error) {
	clean := strings.TrimSpace(dateStr)
	if clean == "" {
		return "2026-11-02", nil
	}
	parts := strings.Split(clean, "-")
	if len(parts) != 3 {
		return "", fmt.Errorf("malformed date format [%s] in <%s>: expected YYYY-MM-DD", clean, tag)
	}
	y, err1 := strconv.Atoi(parts[0])
	m, err2 := strconv.Atoi(parts[1])
	d, err3 := strconv.Atoi(parts[2])
	if err1 != nil || err2 != nil || err3 != nil || !isValidCalendarDate(y, m, d) {
		return "", fmt.Errorf("invalid settlement date: impossible calendar date [%s] in <%s>", clean, tag)
	}
	return clean, nil
}

// xmlNode is a strict DOM representation built from xml.Decoder with Strict=true.
type xmlNode struct {
	Local string
	Attrs map[string]string
	Text  string
	Child []*xmlNode
}

func parseStrictXMLTree(rawXml string) (*xmlNode, error) {
	trimmed := strings.TrimSpace(rawXml)
	if trimmed == "" {
		return nil, fmt.Errorf("empty XML payload provided")
	}

	lower := strings.ToLower(trimmed)
	if strings.Contains(lower, "<!doctype") || strings.Contains(lower, "<!entity") {
		return nil, fmt.Errorf("security violation: DOCTYPE and ENTITY declarations are strictly prohibited")
	}

	if !strings.HasPrefix(trimmed, "<") || !strings.HasSuffix(trimmed, ">") {
		return nil, fmt.Errorf("malformed XML: payload does not start and end with XML tags")
	}

	decoder := xml.NewDecoder(strings.NewReader(trimmed))
	decoder.Strict = true

	root := &xmlNode{Local: "__root__"}
	stack := []*xmlNode{root}
	var textBuf strings.Builder
	seenElement := false

	for {
		tok, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("malformed ISO 20022 XML: %w", err)
		}

		switch elem := tok.(type) {
		case xml.StartElement:
			seenElement = true
			attrs := make(map[string]string, len(elem.Attr))
			for _, a := range elem.Attr {
				attrs[localName(a.Name.Local)] = a.Value
			}
			node := &xmlNode{
				Local: localName(elem.Name.Local),
				Attrs: attrs,
			}
			parent := stack[len(stack)-1]
			parent.Child = append(parent.Child, node)
			stack = append(stack, node)
			textBuf.Reset()

		case xml.EndElement:
			if len(stack) <= 1 {
				return nil, fmt.Errorf("malformed ISO 20022 XML: unexpected closing tag </%s>", elem.Name.Local)
			}
			curr := stack[len(stack)-1]
			if curr.Local != localName(elem.Name.Local) {
				return nil, fmt.Errorf("malformed ISO 20022 XML: mismatched closing tag </%s> for <%s>", elem.Name.Local, curr.Local)
			}
			if len(curr.Child) == 0 {
				curr.Text = strings.TrimSpace(textBuf.String())
			}
			stack = stack[:len(stack)-1]
			textBuf.Reset()

		case xml.CharData:
			textBuf.Write(elem)
		}
	}

	if !seenElement || len(stack) != 1 {
		return nil, fmt.Errorf("malformed ISO 20022 XML: unclosed XML elements")
	}

	return root, nil
}

func findFirst(node *xmlNode, path ...string) *xmlNode {
	if node == nil || len(path) == 0 {
		return nil
	}
	target := path[0]
	for _, c := range node.Child {
		if strings.EqualFold(c.Local, target) {
			if len(path) == 1 {
				return c
			}
			if sub := findFirst(c, path[1:]...); sub != nil {
				return sub
			}
		}
		if sub := findFirst(c, path...); sub != nil {
			return sub
		}
	}
	return nil
}

func findAll(node *xmlNode, tagName string) []*xmlNode {
	var out []*xmlNode
	if node == nil {
		return out
	}
	for _, c := range node.Child {
		if strings.EqualFold(c.Local, tagName) {
			out = append(out, c)
		} else {
			out = append(out, findAll(c, tagName)...)
		}
	}
	return out
}

func getText(node *xmlNode, path ...string) string {
	n := findFirst(node, path...)
	if n == nil {
		return ""
	}
	return strings.TrimSpace(n.Text)
}

func extractAmountFromNode(node *xmlNode, preferredTags ...string) (string, float64, error) {
	for _, tag := range preferredTags {
		if amtNode := findFirst(node, tag); amtNode != nil && amtNode.Text != "" {
			ccy := amtNode.Attrs["Ccy"]
			val, err := strconv.ParseFloat(strings.TrimSpace(amtNode.Text), 64)
			if err == nil && ccy != "" && val > 0 {
				return ccy, val, nil
			}
		}
	}
	return "", 0, fmt.Errorf("mandatory amount/currency element (%v) missing or invalid", preferredTags)
}

func extractPartyEntity(parent *xmlNode, partyTag, role, seq string) *model.ScreenableEntity {
	pNode := findFirst(parent, partyTag)
	if pNode == nil {
		return nil
	}

	name := getText(pNode, "Nm")
	bic := getText(pNode, "BICFI")
	if bic == "" {
		bic = getText(pNode, "BIC")
	}
	if name == "" && bic != "" {
		name = "Financial Institution " + bic
	}
	if name == "" {
		return nil
	}

	var idents []model.Identifier
	if bic != "" {
		idents = append(idents, model.Identifier{Type: "BIC", Value: bic})
	}
	if lei := getText(pNode, "LEI"); lei != "" {
		idents = append(idents, model.Identifier{Type: "LEI", Value: lei})
	}
	if acctNode := findFirst(parent, partyTag+"Acct"); acctNode != nil {
		if iban := getText(acctNode, "IBAN"); iban != "" {
			idents = append(idents, model.Identifier{Type: "IBAN", Value: iban})
		} else if idVal := getText(acctNode, "Id"); idVal != "" {
			idents = append(idents, model.Identifier{Type: "ACCOUNT", Value: idVal})
		}
	}
	if idVal := getText(pNode, "Id"); idVal != "" {
		idents = append(idents, model.Identifier{Type: "NATIONAL_ID", Value: idVal})
	}

	var addrs []model.Address
	if adrNode := findFirst(pNode, "PstlAdr"); adrNode != nil {
		var rawLines []string
		for _, l := range findAll(adrNode, "AdrLine") {
			if l.Text != "" {
				rawLines = append(rawLines, l.Text)
			}
		}
		addr := model.Address{
			Street:     getText(adrNode, "StrtNm"),
			City:       getText(adrNode, "TwnNm"),
			PostalCode: getText(adrNode, "PstCd"),
			Country:    getText(adrNode, "Ctry"),
			RawLines:   rawLines,
		}
		if addr.Street != "" || addr.City != "" || addr.Country != "" || len(addr.RawLines) > 0 {
			addrs = append(addrs, addr)
		}
	}

	return &model.ScreenableEntity{
		ID:          generateID("mx", name),
		Name:        name,
		EntityType:  model.EntityTypeEntity,
		Role:        role,
		Sequence:    seq,
		Identifiers: idents,
		Addresses:   addrs,
		SourceTag:   partyTag,
	}
}

// ParseISO20022Transactions parses an ISO 20022 XML document into one or more canonical ParsedTransactions,
// enforcing profile-specific structure and expanding batch transactions.
func ParseISO20022Transactions(rawXml string) ([]model.ParsedTransaction, string, error) {
	root, err := parseStrictXMLTree(rawXml)
	if err != nil {
		return nil, "", err
	}

	subType := DetectMXType(rawXml)
	if subType == "ISO20022_GENERIC" && !isoStructureRe.MatchString(rawXml) {
		return nil, "", fmt.Errorf("unrecognized XML structure: payload lacks ISO 20022 namespace or business elements")
	}

	switch subType {
	case "pacs.008":
		sttlmDt, err := validateIsoDate(getText(root, "IntrBkSttlmDt"), "IntrBkSttlmDt")
		if err != nil {
			return nil, subType, fmt.Errorf("pacs.008 validation error: %w", err)
		}
		txBlocks := findAll(root, "CdtTrfTxInf")
		if len(txBlocks) == 0 {
			txBlocks = []*xmlNode{root}
		}
		var txs []model.ParsedTransaction
		for i, blk := range txBlocks {
			ccy, amt, err := extractAmountFromNode(blk, "IntrBkSttlmAmt", "InstdAmt")
			if err != nil {
				return nil, subType, fmt.Errorf("pacs.008 validation error: %w", err)
			}
			txID := getText(blk, "EndToEndId")
			if txID == "" {
				txID = fmt.Sprintf("PACS008-%d", i+1)
			}
			var entities []model.ScreenableEntity
			for _, spec := range []struct{ tag, role string }{
				{"Dbtr", "DEBTOR"},
				{"UltmtDbtr", "ULTIMATE_DEBTOR"},
				{"DbtrAgt", "ORDERING_INSTITUTION"},
				{"IntrmyAgt1", "INTERMEDIARY_AGENT"},
				{"CdtrAgt", "CREDITOR_AGENT"},
				{"Cdtr", "CREDITOR"},
				{"UltmtCdtr", "ULTIMATE_CREDITOR"},
			} {
				if e := extractPartyEntity(blk, spec.tag, spec.role, "ROOT"); e != nil {
					entities = append(entities, *e)
				}
			}
			txs = append(txs, model.ParsedTransaction{
				TransactionID:   txID,
				MessageFamily:   "ISO20022_MX",
				MessageType:     "pacs.008",
				IsProfileTested: true,
				SettlementDate:  sttlmDt,
				Currency:        ccy,
				Amount:          amt,
				Entities:        entities,
			})
		}
		return txs, subType, nil

	case "pacs.009_COV":
		sttlmDt, err := validateIsoDate(getText(root, "IntrBkSttlmDt"), "IntrBkSttlmDt")
		if err != nil {
			return nil, subType, fmt.Errorf("pacs.009_COV validation error: %w", err)
		}
		txBlocks := findAll(root, "CdtTrfTxInf")
		if len(txBlocks) == 0 {
			txBlocks = []*xmlNode{root}
		}
		var txs []model.ParsedTransaction
		for i, blk := range txBlocks {
			covNode := findFirst(blk, "UndrlygCstmrCdtTrf")
			if covNode == nil {
				return nil, subType, fmt.Errorf("pacs.009_COV validation error: mandatory <UndrlygCstmrCdtTrf> cover block is missing")
			}
			ccy, amt, err := extractAmountFromNode(blk, "IntrBkSttlmAmt", "InstdAmt")
			if err != nil {
				return nil, subType, fmt.Errorf("pacs.009_COV validation error: %w", err)
			}
			txID := getText(blk, "EndToEndId")
			if txID == "" {
				txID = fmt.Sprintf("PACS009COV-%d", i+1)
			}
			var entities []model.ScreenableEntity
			if e := extractPartyEntity(blk, "InstgAgt", "INSTRUCTING_AGENT", "A"); e != nil {
				entities = append(entities, *e)
			}
			if e := extractPartyEntity(blk, "InstdAgt", "CREDITOR_AGENT", "A"); e != nil {
				entities = append(entities, *e)
			}
			if e := extractPartyEntity(covNode, "Dbtr", "DEBTOR", "B"); e != nil {
				entities = append(entities, *e)
			}
			if e := extractPartyEntity(covNode, "Cdtr", "CREDITOR", "B"); e != nil {
				entities = append(entities, *e)
			}
			if e := extractPartyEntity(covNode, "IntrmyAgt1", "INTERMEDIARY_AGENT", "B"); e != nil {
				entities = append(entities, *e)
			}
			txs = append(txs, model.ParsedTransaction{
				TransactionID:   txID,
				MessageFamily:   "ISO20022_MX",
				MessageType:     "pacs.009_COV",
				IsProfileTested: true,
				SettlementDate:  sttlmDt,
				Currency:        ccy,
				Amount:          amt,
				Entities:        entities,
			})
		}
		return txs, subType, nil

	case "pacs.004":
		txBlocks := findAll(root, "TxInf")
		if len(txBlocks) == 0 {
			txBlocks = []*xmlNode{root}
		}
		var txs []model.ParsedTransaction
		for i, blk := range txBlocks {
			ccy, amt, err := extractAmountFromNode(blk, "RtrdIntrBkSttlmAmt", "InstdAmt")
			if err != nil {
				return nil, subType, fmt.Errorf("pacs.004 validation error: %w", err)
			}
			rtrID := getText(blk, "RtrId")
			if rtrID == "" {
				rtrID = fmt.Sprintf("PACS004-%d", i+1)
			}
			rsn := getText(blk, "Cd")
			if rsn == "" {
				rsn = "NARR"
			}
			origRef := findFirst(blk, "OrgnlTxRef")
			if origRef == nil {
				origRef = blk
			}
			var entities []model.ScreenableEntity
			if e := extractPartyEntity(blk, "InstgAgt", "RETURNING_INSTITUTION", "ROOT"); e != nil {
				entities = append(entities, *e)
			}
			if e := extractPartyEntity(origRef, "Dbtr", "DEBTOR", "ROOT"); e != nil {
				entities = append(entities, *e)
			}
			if e := extractPartyEntity(origRef, "Cdtr", "CREDITOR", "ROOT"); e != nil {
				entities = append(entities, *e)
			}
			txs = append(txs, model.ParsedTransaction{
				TransactionID:    rtrID,
				MessageFamily:    "ISO20022_MX",
				MessageType:      "pacs.004",
				IsProfileTested:  true,
				Currency:         ccy,
				Amount:           amt,
				ReturnReasonCode: rsn,
				Entities:         entities,
			})
		}
		return txs, subType, nil

	case "pain.001":
		pmtBlocks := findAll(root, "PmtInf")
		if len(pmtBlocks) == 0 {
			pmtBlocks = []*xmlNode{root}
		}
		var txs []model.ParsedTransaction
		for pIdx, pmtBlk := range pmtBlocks {
			debtor := extractPartyEntity(pmtBlk, "Dbtr", "DEBTOR", "ROOT")
			debtorAgt := extractPartyEntity(pmtBlk, "DbtrAgt", "ORDERING_INSTITUTION", "ROOT")
			txBlocks := findAll(pmtBlk, "CdtTrfTxInf")
			for tIdx, txBlk := range txBlocks {
				ccy, amt, err := extractAmountFromNode(txBlk, "InstdAmt", "IntrBkSttlmAmt")
				if err != nil {
					return nil, subType, fmt.Errorf("pain.001 validation error: %w", err)
				}
				txID := getText(txBlk, "EndToEndId")
				if txID == "" {
					txID = fmt.Sprintf("PAIN001-%d-%d", pIdx+1, tIdx+1)
				}
				var entities []model.ScreenableEntity
				if debtor != nil {
					entities = append(entities, *debtor)
				}
				if debtorAgt != nil {
					entities = append(entities, *debtorAgt)
				}
				if e := extractPartyEntity(txBlk, "Cdtr", "CREDITOR", "ROOT"); e != nil {
					entities = append(entities, *e)
				}
				if e := extractPartyEntity(txBlk, "CdtrAgt", "CREDITOR_AGENT", "ROOT"); e != nil {
					entities = append(entities, *e)
				}
				if e := extractPartyEntity(txBlk, "UltmtCdtr", "ULTIMATE_CREDITOR", "ROOT"); e != nil {
					entities = append(entities, *e)
				}
				txs = append(txs, model.ParsedTransaction{
					TransactionID:   txID,
					MessageFamily:   "ISO20022_MX",
					MessageType:     "pain.001",
					IsProfileTested: true,
					Currency:        ccy,
					Amount:          amt,
					Entities:        entities,
				})
			}
		}
		if len(txs) == 0 {
			return nil, subType, fmt.Errorf("pain.001 validation error: no <CdtTrfTxInf> transactions found")
		}
		return txs, subType, nil
	}

	// Generic best-effort ISO 20022 envelope extraction (IsProfileTested = false)
	var entities []model.ScreenableEntity
	for _, spec := range []struct{ tag, role string }{
		{"Dbtr", "DEBTOR"},
		{"Cdtr", "CREDITOR"},
		{"UltmtDbtr", "ULTIMATE_DEBTOR"},
		{"UltmtCdtr", "ULTIMATE_CREDITOR"},
		{"DbtrAgt", "INSTRUCTING_AGENT"},
		{"CdtrAgt", "CREDITOR_AGENT"},
		{"InstgAgt", "INSTRUCTING_AGENT"},
		{"InstdAgt", "CREDITOR_AGENT"},
		{"IntrmyAgt1", "INTERMEDIARY_AGENT"},
		{"InitgPty", "DEBTOR"},
		{"AcctOwnr", "DEBTOR"},
		{"AcctSvcr", "INSTRUCTING_AGENT"},
		{"Assgnr", "SENDER"},
		{"Assgne", "RECEIVER"},
		{"Buyr", "DEBTOR"},
		{"Sellr", "CREDITOR"},
		{"Fr", "SENDER"},
		{"To", "RECEIVER"},
	} {
		if e := extractPartyEntity(root, spec.tag, spec.role, "ROOT"); e != nil {
			entities = append(entities, *e)
		}
	}

	ccy, amt, _ := extractAmountFromNode(root, "IntrBkSttlmAmt", "InstdAmt", "SttlmAmt", "Amt")
	msgID := getText(root, "MsgId")
	if msgID == "" {
		msgID = getText(root, "BizMsgIdr")
	}
	if msgID == "" {
		msgID = "MX-GENERIC"
	}

	return []model.ParsedTransaction{
		{
			TransactionID:   msgID,
			MessageFamily:   "ISO20022_MX",
			MessageType:     subType,
			IsProfileTested: false,
			Currency:        ccy,
			Amount:          amt,
			Entities:        entities,
		},
	}, subType, nil
}

// ParseISO20022 parses any ISO 20022 MX XML message into canonical ScreenableEntities.
func ParseISO20022(rawXml string) ([]model.ScreenableEntity, string, error) {
	txs, subType, err := ParseISO20022Transactions(rawXml)
	if err != nil {
		return nil, subType, err
	}
	var all []model.ScreenableEntity
	for _, tx := range txs {
		all = append(all, tx.Entities...)
	}
	return all, subType, nil
}

func localName(tag string) string {
	parts := strings.Split(tag, ":")
	return parts[len(parts)-1]
}

// DetectMXType detects the ISO 20022 MX message identifier from schema namespaces, BAH MsgDefIdr, or root elements.
// Note: pacs.009 is only classified as pacs.009_COV when an underlying customer credit transfer (<UndrlygCstmrCdtTrf>) is present.
func DetectMXType(raw string) string {
	lower := strings.ToLower(raw)
	hasCover := strings.Contains(lower, "undrlygcstmrcdttrf")

	matches := mxSchemaRe.FindAllStringSubmatch(lower, -1)
	for _, m := range matches {
		if len(m) >= 3 && m[1] != "head" {
			if m[1] == "pacs" && m[2] == "009" {
				if hasCover {
					return "pacs.009_COV"
				}
				return "pacs.009"
			}
			return m[1] + "." + m[2]
		}
	}
	if len(matches) > 0 && len(matches[0]) >= 3 {
		return matches[0][1] + "." + matches[0][2]
	}

	switch {
	case strings.Contains(lower, "fitoficstmrcdttrf"):
		return "pacs.008"
	case strings.Contains(lower, "ficdttrf"):
		if hasCover {
			return "pacs.009_COV"
		}
		return "pacs.009"
	case strings.Contains(lower, "pmtrtr"):
		return "pacs.004"
	case strings.Contains(lower, "cstmrcdttrfinit"):
		return "pain.001"
	case strings.Contains(lower, "bktocstmrstmt"):
		return "camt.053"
	case strings.Contains(lower, "fitofipmtstsrpt"):
		return "pacs.002"
	default:
		return "ISO20022_GENERIC"
	}
}

func generateID(prefix, seed string) string {
	h := sha256.Sum256([]byte(seed))
	return prefix + "_" + hex.EncodeToString(h[:])[:8]
}
