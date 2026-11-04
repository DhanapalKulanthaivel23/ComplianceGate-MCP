package parsers

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/compliancegate/compliancegate-core/pkg/lists"
)

func TestUnifiedParserFactory_AllMTAndMX(t *testing.T) {
	f := NewUnifiedParserFactory()

	// 1. MT700 Documentary Credit (Generic Envelope -> IsProfileTested must be false)
	mt700 := "{1:F01DEUTDEDDXXX0000000000}{2:I700HSBCHKHHAXXXN}{4:\n:20:LC-700\n:32B:USD850000,00\n:50:APPLICANT CO\n:59:BENEFICIARY CO\n-}"
	txs700, hdr, err := f.ParseTransactions(mt700)
	if err != nil {
		t.Fatalf("unexpected error parsing MT700: %v", err)
	}
	if hdr.Family != "SWIFT_MT" || hdr.MessageType != "MT700" || hdr.IsProfileTested {
		t.Fatalf("expected SWIFT_MT / MT700 / IsProfileTested=false, got %+v", hdr)
	}
	if len(txs700) != 1 || txs700[0].IsProfileTested || len(txs700[0].Entities) < 2 {
		t.Fatalf("expected 1 unprofiled MT700 transaction with >=2 entities, got %+v", txs700)
	}

	// 2. ISO 20022 BAH + sese.023 (Generic Envelope -> IsProfileTested must be false)
	sese := `<BizData><AppHdr xmlns="urn:iso:std:iso:20022:tech:xsd:head.001.001.02"><MsgDefIdr>sese.023.001.09</MsgDefIdr></AppHdr><Document xmlns="urn:iso:std:iso:20022:tech:xsd:sese.023.001.09"><SctiesSttlmTxInstr><Buyr><Nm>ALPINE AG</Nm></Buyr><Sellr><Nm>VOLGA OOO</Nm></Sellr></SctiesSttlmTxInstr></Document></BizData>`
	mxTxs, mxHdr, err := f.ParseTransactions(sese)
	if err != nil {
		t.Fatalf("unexpected error parsing sese.023: %v", err)
	}
	if mxHdr.Family != "ISO20022_MX" || mxHdr.MessageType != "sese.023" || mxHdr.HeaderStyle != "ISO20022_BAH_ENVELOPE" || mxHdr.IsProfileTested {
		t.Fatalf("unexpected header for sese.023: %+v", mxHdr)
	}
	if len(mxTxs) != 1 || mxTxs[0].IsProfileTested || len(mxTxs[0].Entities) < 2 {
		t.Fatalf("expected 1 unprofiled sese.023 transaction with >=2 entities, got %+v", mxTxs)
	}

	// 3. pacs.009 WITHOUT <UndrlygCstmrCdtTrf> must route to pacs.009 (non-COV, IsProfileTested=false)
	pacs009NoCov := `<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.009.001.08"><FICdtTrf><CdtTrfTxInf><PmtId><EndToEndId>FI-009-1</EndToEndId></PmtId><IntrBkSttlmAmt Ccy="USD">100000.00</IntrBkSttlmAmt><InstgAgt><FinInstnId><BICFI>DEUTDEFFXXX</BICFI></FinInstnId></InstgAgt><InstdAgt><FinInstnId><BICFI>CHASUS33XXX</BICFI></FinInstnId></InstdAgt></CdtTrfTxInf></FICdtTrf></Document>`
	noCovTxs, noCovHdr, err := f.ParseTransactions(pacs009NoCov)
	if err != nil {
		t.Fatalf("unexpected error parsing non-COV pacs.009: %v", err)
	}
	if noCovHdr.MessageType != "pacs.009" || noCovHdr.IsProfileTested || noCovTxs[0].IsProfileTested {
		t.Fatalf("non-COV pacs.009 must be classified as pacs.009 with IsProfileTested=false, got hdr=%+v tx=%+v", noCovHdr, noCovTxs[0])
	}

	// 4. pacs.009 WITH <UndrlygCstmrCdtTrf> routes to pacs.009_COV (IsProfileTested=true)
	pacs009Cov := `<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.009.001.08"><FICdtTrf><CdtTrfTxInf><PmtId><EndToEndId>COV-009-1</EndToEndId></PmtId><IntrBkSttlmAmt Ccy="USD">250000.00</IntrBkSttlmAmt><InstgAgt><FinInstnId><BICFI>DEUTDEFFXXX</BICFI></FinInstnId></InstgAgt><InstdAgt><FinInstnId><BICFI>CHASUS33XXX</BICFI></FinInstnId></InstdAgt><UndrlygCstmrCdtTrf><Dbtr><Nm>Underlying Debtor Co</Nm></Dbtr><Cdtr><Nm>Underlying Creditor Ltd</Nm></Cdtr></UndrlygCstmrCdtTrf></CdtTrfTxInf></FICdtTrf></Document>`
	covTxs, covHdr, err := f.ParseTransactions(pacs009Cov)
	if err != nil {
		t.Fatalf("unexpected error parsing pacs.009_COV: %v", err)
	}
	if covHdr.MessageType != "pacs.009_COV" || !covHdr.IsProfileTested || !covTxs[0].IsProfileTested {
		t.Fatalf("pacs.009 with UndrlygCstmrCdtTrf must be pacs.009_COV with IsProfileTested=true, got %+v", covHdr)
	}

	// 5. Malformed / truncated XML must return error and NEVER return partial entities
	truncatedXml := `<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08"><FIToFICstmrCdtTrf><CdtTrfTxInf><IntrBkSttlmAmt Ccy="EUR">500.00</IntrBkSttlmAmt><Dbtr><Nm>Partial Debtor</Nm></Dbtr>`
	partialEntities, _, err := f.ParseMessage(truncatedXml)
	if err == nil || len(partialEntities) > 0 {
		t.Fatalf("expected truncated XML to fail with 0 partial entities, got err=%v entities=%v", err, partialEntities)
	}

	// 6. Arbitrary non-ISO 20022 XML must be rejected
	if _, _, err := f.ParseMessage(`<randomRoot><foo>bar</foo></randomRoot>`); err == nil {
		t.Fatalf("expected non-ISO 20022 XML to be rejected")
	}

	// 7. Mandatory :32A: enforcement on MT103 in Go
	mt103Missing32A := "{1:F01DEUTDEDDXXX0000000000}{2:I103HSBCHKHHAXXXN}{4:\n:20:REF-103\n:50K:DEBTOR\n:59:CREDITOR\n-}"
	if _, _, err := f.ParseMessage(mt103Missing32A); err == nil {
		t.Fatalf("expected MT103 missing :32A: to fail validation in Go")
	}

	// 7b. Impossible calendar dates in :32A: must be rejected in Go
	invalidDateCases := []string{
		"269932EUR100,00", // Month 99, Day 32
		"261315EUR100,00", // Month 13
		"260015EUR100,00", // Month 00
		"260100EUR100,00", // Day 00
		"260132EUR100,00", // Day 32
		"260431EUR100,00", // April 31 (April has 30 days)
		"260229EUR100,00", // Feb 29 in non-leap year (2026)
	}
	for _, badVal := range invalidDateCases {
		rawBad := fmt.Sprintf("{1:F01DEUTDEDDXXX0000000000}{2:I103HSBCHKHHAXXXN}{4:\n:20:BAD-DATE\n:32A:%s\n:50K:DEBTOR\n:59:CREDITOR\n-}", badVal)
		if _, _, err := f.ParseMessage(rawBad); err == nil {
			t.Fatalf("expected impossible date :32A:%s to be rejected in Go, but was accepted", badVal)
		}
	}

	// Leap year valid date in Go (2024-02-29) must succeed
	leapYearValid := "{1:F01DEUTDEDDXXX0000000000}{2:I103HSBCHKHHAXXXN}{4:\n:20:LEAP-DATE\n:32A:240229EUR100,00\n:50K:DEBTOR\n:59:CREDITOR\n-}"
	if txs, _, err := f.ParseTransactions(leapYearValid); err != nil || len(txs) != 1 || txs[0].SettlementDate != "2024-02-29" {
		t.Fatalf("expected valid leap year Feb 29 2024 to succeed, got txs=%+v err=%v", txs, err)
	}

	// 8. pain.001 multi-transaction batch expansion in Go
	painBatch := `<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.09"><CstmrCdtTrfInitn><PmtInf><Dbtr><Nm>Batch Debtor</Nm></Dbtr><CdtTrfTxInf><PmtId><EndToEndId>E2E-1</EndToEndId></PmtId><Amt><InstdAmt Ccy="EUR">100.00</InstdAmt></Amt><Cdtr><Nm>Creditor One</Nm></Cdtr></CdtTrfTxInf><CdtTrfTxInf><PmtId><EndToEndId>E2E-2</EndToEndId></PmtId><Amt><InstdAmt Ccy="EUR">200.00</InstdAmt></Amt><Cdtr><Nm>Creditor Two</Nm></Cdtr></CdtTrfTxInf></PmtInf></CstmrCdtTrfInitn></Document>`
	painTxs, painHdr, err := f.ParseTransactions(painBatch)
	if err != nil {
		t.Fatalf("unexpected error parsing pain.001 batch: %v", err)
	}
	if !painHdr.IsProfileTested || len(painTxs) != 2 {
		t.Fatalf("expected 2 expanded pain.001 transactions with IsProfileTested=true, got %d", len(painTxs))
	}

	// 9. MT103_STP dedicated profile: valid Option A BIC vs invalid Option D agent
	mt103StpValid := "{1:F01DEUTDEDDXXX0000000000}{2:I103HSBCHKHHAXXXN}{3:{119:STP}}{4:\n:20:STP-GO-1\n:32A:260301EUR12500,00\n:50K:/DE89370400440532013000\nALPINE GMBH\n:57A:HSBCHKHHXXX\n:59:/HK0011223344\nPACIFIC TRADING\n:71A:SHA\n-}"
	stpTxs, stpHdr, err := f.ParseTransactions(mt103StpValid)
	if err != nil || stpHdr.MessageType != "MT103_STP" || !stpHdr.IsProfileTested || !stpTxs[0].IsProfileTested {
		t.Fatalf("expected valid MT103_STP to have IsProfileTested=true, got hdr=%+v err=%v", stpHdr, err)
	}
	mt103StpInvalid := "{1:F01DEUTDEDDXXX0000000000}{2:I103HSBCHKHHAXXXN}{3:{119:STP}}{4:\n:20:STP-GO-BAD\n:32A:260301EUR12500,00\n:50K:/DE89370400440532013000\nALPINE GMBH\n:57D:LOCAL BANK WITHOUT BIC\n:59:/HK0011223344\nPACIFIC TRADING\n:71A:SHA\n-}"
	stpBadTxs, stpBadHdr, err := f.ParseTransactions(mt103StpInvalid)
	if err != nil || stpBadHdr.IsProfileTested || stpBadTxs[0].IsProfileTested {
		t.Fatalf("expected MT103_STP with :57D: to fail STP rules and downgrade IsProfileTested=false, got hdr=%+v", stpBadHdr)
	}

	// 10. MT103_REMIT dedicated profile: requires :77T: and prohibits :70:
	mt103RemitValid := "{1:F01DEUTDEDDXXX0000000000}{2:I103HSBCHKHHAXXXN}{3:{119:REMIT}}{4:\n:20:REMIT-GO-1\n:32A:260301USD9000,00\n:50K:/US112233\nACME CORP\n:59:/GB998877\nGLOBAL SUPPLIER\n:71A:SHA\n:77T:/EREF/INV-2026-9988\n-}"
	remitTxs, remitHdr, err := f.ParseTransactions(mt103RemitValid)
	if err != nil || remitHdr.MessageType != "MT103_REMIT" || !remitHdr.IsProfileTested || !remitTxs[0].IsProfileTested {
		t.Fatalf("expected valid MT103_REMIT with :77T: to have IsProfileTested=true, got hdr=%+v err=%v", remitHdr, err)
	}
	mt103RemitInvalid := "{1:F01DEUTDEDDXXX0000000000}{2:I103HSBCHKHHAXXXN}{3:{119:REMIT}}{4:\n:20:REMIT-GO-BAD\n:32A:260301USD9000,00\n:50K:/US112233\nACME CORP\n:59:/GB998877\nGLOBAL SUPPLIER\n:70:STANDARD REMITTANCE NOT ALLOWED\n:71A:SHA\n-}"
	remitBadTxs, remitBadHdr, err := f.ParseTransactions(mt103RemitInvalid)
	if err != nil || remitBadHdr.IsProfileTested || remitBadTxs[0].IsProfileTested {
		t.Fatalf("expected MT103_REMIT missing :77T: to downgrade IsProfileTested=false, got hdr=%+v", remitBadHdr)
	}

	// 11. MT205_COV dedicated profile: requires Sequence A + Sequence B
	mt205CovValid := "{1:F01DEUTDEDDXXX0000000000}{2:I205HSBCHKHHAXXXN}{3:{119:COV}}{4:\n:20:205COV-GO-1\n:21:REL-205-1\n:32A:260301EUR75000,00\n:52A:DEUTDEFFXXX\n:58A:CHASUS33XXX\n:50K:/DE89370400440532013000\nUNDERLYING DEBTOR AG\n:59:/US9988776655\nUNDERLYING CREDITOR INC\n-}"
	cov205Txs, cov205Hdr, err := f.ParseTransactions(mt205CovValid)
	if err != nil || cov205Hdr.MessageType != "MT205_COV" || !cov205Hdr.IsProfileTested || !cov205Txs[0].IsProfileTested {
		t.Fatalf("expected valid MT205_COV to have IsProfileTested=true, got hdr=%+v err=%v", cov205Hdr, err)
	}
}

func TestExhaustiveAllMTCategoriesAndAll33MXDomains(t *testing.T) {
	f := NewUnifiedParserFactory()

	// All 9 SWIFT MT categories (representative & full sweep across 1xx..9xx)
	mtCodes := []string{
		"101", "102", "103", "104", "107", "110", "111", "112", "190", "191", "192", "195", "196", "198", "199",
		"200", "201", "202", "203", "204", "205", "207", "210", "256", "290", "291", "292", "295", "296", "298", "299",
		"300", "304", "305", "306", "320", "330", "340", "341", "350", "360", "361", "362", "370", "380", "381", "390", "395", "399",
		"400", "410", "412", "416", "420", "422", "430", "450", "455", "456", "490", "491", "492", "495", "496", "498", "499",
		"500", "502", "509", "515", "518", "535", "540", "541", "542", "543", "544", "545", "546", "547", "548", "564", "566", "599",
		"600", "601", "604", "605", "606", "607", "608", "620", "670", "671", "690", "691", "692", "695", "696", "698", "699",
		"700", "701", "707", "710", "720", "730", "734", "740", "742", "747", "750", "752", "754", "756", "760", "767", "799",
		"800", "801", "802", "824", "890", "891", "892", "895", "896", "898", "899",
		"900", "910", "920", "935", "940", "941", "942", "950", "970", "971", "972", "973", "985", "986", "990", "991", "992", "995", "996", "998", "999",
	}
	for _, code := range mtCodes {
		raw := fmt.Sprintf("{1:F01DEUTDEDDXXX0000000000}{2:I%sHSBCHKHHAXXXN}{4:\n:20:REF-%s\n:32A:260301USD1000,00\n:50K:/DE89370400440532013000\nDEBTOR %s\n:59:/GB29NWBK60161331926819\nCREDITOR %s\n:71A:SHA\n-}", code, code, code, code)
		txs, hdr, err := f.ParseTransactions(raw)
		if err != nil || len(txs) == 0 {
			t.Fatalf("failed parsing MT%s: err=%v txs=%d", code, err, len(txs))
		}
		expectedProfiled := code == "103"
		if hdr.IsProfileTested != expectedProfiled {
			t.Fatalf("MT%s expected IsProfileTested=%v, got %v", code, expectedProfiled, hdr.IsProfileTested)
		}
	}

	// All 33 ISO 20022 4-letter business domains
	domains := []string{
		"acmt", "admi", "auth", "caaa", "caad", "caam", "cafc", "cafm", "cafr", "cain", "camt",
		"canm", "casr", "catm", "catp", "colr", "deri", "fxtr", "head", "pacs", "pain", "reda",
		"remt", "secl", "seev", "semt", "sese", "setr", "trea", "tsin", "tsmt", "tsrv", "xsys",
	}
	for _, dom := range domains {
		msgId := fmt.Sprintf("%s.001.001.01", dom)
		raw := fmt.Sprintf(`<Document xmlns="urn:iso:std:iso:20022:tech:xsd:%s"><GenericRoot><PmtInf><Dbtr><Nm>Debtor %s</Nm></Dbtr><CdtTrfTxInf><PmtId><EndToEndId>E2E-%s</EndToEndId></PmtId><Amt><InstdAmt Ccy="EUR">1500.00</InstdAmt></Amt><Cdtr><Nm>Creditor %s</Nm></Cdtr></CdtTrfTxInf></PmtInf></GenericRoot></Document>`, msgId, dom, strings.ToUpper(dom), dom)
		txs, hdr, err := f.ParseTransactions(raw)
		if err != nil || len(txs) == 0 {
			t.Fatalf("failed parsing ISO 20022 domain %s: err=%v txs=%d", dom, err, len(txs))
		}
		if hdr.Family != "ISO20022_MX" || !strings.HasPrefix(hdr.MessageType, dom+".") {
			t.Fatalf("domain %s expected ISO20022_MX header starting with %s., got %+v", dom, dom, hdr)
		}
	}
}

func TestWatchlistEnvFolders(t *testing.T) {
	tmpDir := t.TempDir()
	listFile := filepath.Join(tmpDir, "custom.json")
	data := `[{"id":"ENV-1","listId":"DEMO_OFAC_SDN","listName":"US OFAC","name":"Env Test Corp","entityType":"ENTITY"}]`
	if err := os.WriteFile(listFile, []byte(data), 0644); err != nil {
		t.Fatal(err)
	}

	os.Setenv("WATCHLIST_DIRS", tmpDir)
	defer os.Unsetenv("WATCHLIST_DIRS")

	// 1. In default public demo mode (IS_PUBLIC_DEMO unset or true), client folders must NOT be loaded
	os.Setenv("IS_PUBLIC_DEMO", "true")
	publicRepo := lists.NewWatchlistRepository("")
	for _, e := range publicRepo.GetAllEntries() {
		if e.ID == "ENV-1" {
			t.Fatalf("public synthetic demo mode must never load client folder data")
		}
	}

	// 2. In enterprise gateway mode (IS_PUBLIC_DEMO=false), client folders from env vars are loaded
	os.Setenv("IS_PUBLIC_DEMO", "false")
	defer os.Unsetenv("IS_PUBLIC_DEMO")

	repo := lists.NewWatchlistRepository("")
	entries := repo.GetAllEntries()
	found := false
	for _, e := range entries {
		if e.ID == "ENV-1" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected ENV-1 entry loaded from WATCHLIST_DIRS environment variable in enterprise mode")
	}

	// 3. Verify CSV and XML watchlist ingestion in Go
	csvFile := filepath.Join(tmpDir, "client_ofac.csv")
	csvData := "id,name,type,country,program,aliases\nCSV-GO-1,\"BALTIC SHADOW SHIPPING\",ORGANIZATION,RU,OFAC_SDN,\"BALTIC MARITIME;SHADOW FLEET\"\n"
	if err := os.WriteFile(csvFile, []byte(csvData), 0644); err != nil {
		t.Fatal(err)
	}
	xmlFile := filepath.Join(tmpDir, "client_ofac.xml")
	xmlData := `<?xml version="1.0"?><sdnList><sdnEntry><uid>XML-GO-1</uid><lastName>CASPIAN ENERGY TRADING</lastName><sdnType>Entity</sdnType></sdnEntry></sdnList>`
	if err := os.WriteFile(xmlFile, []byte(xmlData), 0644); err != nil {
		t.Fatal(err)
	}
	if err := repo.LoadFromDirectory(tmpDir); err != nil {
		t.Fatalf("expected LoadFromDirectory to ingest new CSV and XML files: %v", err)
	}
	foundCsv, foundXml := false, false
	for _, e := range repo.GetAllEntries() {
		if e.ID == "CSV-GO-1" {
			foundCsv = true
		}
		if e.ID == "OFAC-XML-GO-1" {
			foundXml = true
		}
	}
	if !foundCsv || !foundXml {
		t.Fatalf("expected both CSV-GO-1 (%v) and OFAC-XML-GO-1 (%v) loaded after atomic hot reload", foundCsv, foundXml)
	}

	// 4. Verify safe file_ref resolution blocks path traversal
	if _, err := repo.ResolveSafeFileRef("../../etc/passwd", tmpDir); err == nil {
		t.Fatalf("expected ResolveSafeFileRef to block ../../etc/passwd traversal")
	}
	if resolved, err := repo.ResolveSafeFileRef("client_ofac.csv", tmpDir); err != nil || resolved == "" {
		t.Fatalf("expected ResolveSafeFileRef to allow valid relative file_ref inside tmpDir, got err=%v", err)
	}
}
