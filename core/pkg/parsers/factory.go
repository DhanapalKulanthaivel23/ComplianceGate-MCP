// Package parsers implements a unified parser factory capable of dynamically dispatching
// SWIFT MT (FIN Categories 1-9: MT101..MT999) and ISO 20022 MX message types based on header structure.
package parsers

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/compliancegate/compliancegate-core/pkg/model"
	"github.com/compliancegate/compliancegate-core/pkg/parsers/iso20022"
	"github.com/compliancegate/compliancegate-core/pkg/parsers/mt"
)

var (
	finBlockHeaderRe = regexp.MustCompile(`(?i)\{[12345]:[A-Z0-9\s\r\n:{}-]+`)
	finTagHeaderRe   = regexp.MustCompile(`(?m)^:[0-9]{2}[A-Z]?:`)
	mxNamespaceRe    = regexp.MustCompile(`(?i)urn:iso:std:iso:20022:tech:xsd:`)
)

// HeaderDescriptor captures the inspected header structure for an MT or MX message.
type HeaderDescriptor struct {
	Family          string `json:"family"`          // SWIFT_MT or ISO20022_MX
	MessageType     string `json:"messageType"`     // e.g., MT103, MT202_COV, MT700, pacs.008, pacs.009, pacs.009_COV, camt.053
	HeaderStyle     string `json:"headerStyle"`     // SWIFT_FIN_BLOCKS, SWIFT_TAG_BLOCK, ISO20022_BAH_ENVELOPE, ISO20022_XML_DOCUMENT
	IsProfileTested bool   `json:"isProfileTested"` // true only for verified tested profiles (MT103, MT202_COV, pacs.008, pacs.009_COV, pacs.004, pain.001)
}

// UnifiedParserFactory dynamically dispatches MT (FIN) and MX (ISO 20022) messages.
type UnifiedParserFactory struct{}

// NewUnifiedParserFactory constructs a new UnifiedParserFactory instance.
func NewUnifiedParserFactory() *UnifiedParserFactory {
	return &UnifiedParserFactory{}
}

// InspectHeader classifies the raw message header structure.
func (f *UnifiedParserFactory) InspectHeader(raw string) (HeaderDescriptor, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return HeaderDescriptor{}, fmt.Errorf("empty payment message payload")
	}

	if strings.HasPrefix(trimmed, "<") || mxNamespaceRe.MatchString(trimmed) {
		style := "ISO20022_XML_DOCUMENT"
		lower := strings.ToLower(trimmed)
		if strings.Contains(lower, "<apphdr") || strings.Contains(lower, ":apphdr") || strings.Contains(lower, "head.001") {
			style = "ISO20022_BAH_ENVELOPE"
		}
		msgType := iso20022.DetectMXType(trimmed)
		return HeaderDescriptor{
			Family:          "ISO20022_MX",
			MessageType:     msgType,
			HeaderStyle:     style,
			IsProfileTested: model.IsVerifiedTestedProfile(msgType, true),
		}, nil
	}

	if finBlockHeaderRe.MatchString(trimmed) || finTagHeaderRe.MatchString(trimmed) {
		style := "SWIFT_TAG_BLOCK"
		if finBlockHeaderRe.MatchString(trimmed) {
			style = "SWIFT_FIN_BLOCKS"
		}
		msgType := mt.DetectMTType(trimmed)
		return HeaderDescriptor{
			Family:          "SWIFT_MT",
			MessageType:     msgType,
			HeaderStyle:     style,
			IsProfileTested: model.IsVerifiedTestedProfile(msgType, true),
		}, nil
	}

	return HeaderDescriptor{}, fmt.Errorf("unrecognized message header structure: neither SWIFT MT (FIN) nor ISO 20022 (MX)")
}

// ParseTransactions inspects the header, dispatches to the appropriate MT or MX parser,
// and returns transaction-level records with mandatory field enforcement and batch expansion.
func (f *UnifiedParserFactory) ParseTransactions(raw string) ([]model.ParsedTransaction, HeaderDescriptor, error) {
	hdr, err := f.InspectHeader(raw)
	if err != nil {
		return nil, HeaderDescriptor{}, err
	}

	if hdr.Family == "ISO20022_MX" {
		txs, subType, err := iso20022.ParseISO20022Transactions(raw)
		if err != nil {
			return nil, hdr, err
		}
		hdr.MessageType = subType
		hdr.IsProfileTested = model.IsVerifiedTestedProfile(subType, len(txs) > 0 && txs[0].IsProfileTested)
		return txs, hdr, nil
	}

	txs, msgType, err := mt.ParseMTTransactions(raw)
	if err != nil {
		return nil, hdr, err
	}
	hdr.MessageType = msgType
	hdr.IsProfileTested = model.IsVerifiedTestedProfile(msgType, len(txs) > 0 && txs[0].IsProfileTested)
	return txs, hdr, nil
}

// ParseMessage inspects the header and dispatches to the appropriate MT or MX parser, returning all extracted entities.
func (f *UnifiedParserFactory) ParseMessage(raw string) ([]model.ScreenableEntity, HeaderDescriptor, error) {
	txs, hdr, err := f.ParseTransactions(raw)
	if err != nil {
		return nil, hdr, err
	}
	var entities []model.ScreenableEntity
	for _, tx := range txs {
		entities = append(entities, tx.Entities...)
	}
	return entities, hdr, nil
}
