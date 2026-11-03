# ComplianceGate-MCP: Payments Screening & Ingestion Gateway

**ComplianceGate-MCP** is a deterministic, full-stack trade and payment compliance gateway and Model Context Protocol (MCP) server. It parses SWIFT MT and ISO 20022 MX payment messages, evaluates parties through a deterministic multi-script screening engine, identifies missing originator/beneficiary compliance fields, and enforces human-in-the-loop review governance with tamper-evident audit trails.

---

## 1. Core Architecture & Standards Coverage

### A. Message Families & Tested Profiles
1. **SWIFT MT103 (Single Customer Credit Transfer)**: Standard, STP, and REMIT parsing (:20:, :23B:, :32A:, :50a, :52a, :56a, :57a, :59a, :70, :71a).
2. **SWIFT MT202 COV (Cover Payment)**: Handles both Sequence A (Interbank routing) and Sequence B (Underlying commercial customer parties) to prevent cover sanctions evasion.
3. **ISO 20022 pacs.008.001.08 / .09 (FI to FI Customer Credit Transfer)**: Safe bounded XML parsing; extracts Debtor, Creditor, Ultimate parties, Agents, and structured postal addresses.
4. **ISO 20022 pacs.009 COV (Financial Institution Transfer with Cover)**: Extracts both direct interbank FI settlement parties and underlying commercial cover parties (`UndrlygCstmrCdtTrf`).
5. **ISO 20022 pacs.004.001.09 / .10 (Payment Return)**: Captures return reason codes, separates original debtor/creditor from returning institutions, and re-screens the return path.
6. **ISO 20022 pain.001.001.09 / .10 (Corporate Initiation)**: Extracts and screens ALL payment transactions across multi-payment `<PmtInf>` / `<CdtTrfTxInf>` batches.
7. **Generic Envelope Fallback**: Safely parses unprofiled SWIFT FIN blocks (MT101, MT202 non-cov, MT940) and ISO 20022 documents (`camt.053`, `pacs.002`) without throwing schema exceptions.

### B. 2-Dimensional Evaluation Matrix
Every transaction query produces two independent dimensions:
1. **Coverage Status**:
   - `COMPLETE`: All required watchlists are fresh and verified.
   - `PARTIAL_STALE`: One or more secondary lists are stale, but available lists were evaluated. *(Hard invariant: Stale secondary lists never suppress or mask an exact identifier candidate hit found on an active list).*
   - `INSUFFICIENT`: A mandatory watchlist is unindexed or missing.
2. **Finding Severity**:
   - `EXACT_IDENTIFIER_MATCH`: Candidate hit on a typed identifier (SWIFT BIC, LEI, Tax ID, Passport). Automated release or agent override is prohibited (`HUMAN_ONLY`).
   - `FUZZY_NAME_CANDIDATE`: Algorithmic token-similarity match exceeding threshold.
   - `NO_MATCH_FOUND`: No matching record found. Explicitly labeled `NO_MATCH_FOUND`, never "Cleared" or "Approved".

### C. Missing Data & Travel Rule Engine
Audits transactions against configurable compliance profiles (e.g. FATF Recommendation 16 cross-border wire standards) flagging missing originator/beneficiary physical addresses, national identity numbers, or destination account numbers.

---

## 2. Local Run & Test Commands

### Run Development Server
```bash
npm run dev
```
Starts the full-stack server on `http://localhost:3000` with the Streamable HTTP MCP endpoint at `http://localhost:3000/mcp`.

### Run Automated Test Suite
```bash
npm test
```
Executes the comprehensive CLI test suite (`src/tests/payments_gateway.test.ts`), verifying:
- SWIFT MT103 and MT202 COV dual-sequence parsing
- ISO 20022 pacs.008, pacs.009 COV, pacs.004 return, and pain.001 multi-payment batch parsing
- Generic envelope fallback handling
- Configurable missing data rules
- Multi-script Unicode normalization (Arabic, Chinese, Cyrillic, accented Latin)
- Exact identifier candidate matching (BIC, LEI)
- List freshness gate & severity independence
- Server-held result reference tokens (`ref_<uuid>`) and forgery prevention
- Case adjudication validation with mandatory review rationale ($\ge 10$ chars)
- Tamper-evident SHA-256 hash-chain verification
- Client remote engine adapter unconfigured failure contract
- Official MCP Client protocol (`initialize`, `tools/list`, `tools/call`)
- MCP sensitive data redaction for agent contexts

---

## 3. Official Model Context Protocol (MCP) Integration

### Streamable HTTP Endpoint
- **URL**: `POST /mcp` (or `POST /api/mcp`)
- **Protocol**: JSON-RPC 2.0
- **Supported Methods**: `initialize`, `tools/list`, `tools/call`

### Local Terminal Stdio Runner
For local CLI agents or desktop MCP clients (e.g. Claude Desktop), launch:
```bash
npx tsx src/server/mcpStdio.ts
```

### Registered Tools
1. `extract_payment_parties`: Extracts standardized canonical parties, amounts, and provenance from raw MT/MX.
2. `screen_payment`: Screens payment parties against registered watchlists; returns 2D status matrix and server reference token.
3. `route_payment_alert`: Validates a server-held reference token (`ref_<uuid>`).
4. `audit_missing_data`: Audits transaction against missing-data profiles (e.g. FATF Rec 16).
5. `list_health`: Queries snapshot timestamps, digests, and freshness states.
6. `get_payment_evidence`: Exports verified tamper-evident audit bundle.
7. `generate_test_payments`: Emits synthetic test payments.

---

## 4. Google Cloud Deployment Prerequisites & Budget Boundaries

### Environment Status
- Current Project: `gen-lang-client-0475955540`
- Billing Status: Currently **no billing account is linked**.
- Spending Ceiling: Target is **$\le$ £10/month**.

### Deployment Commands (For Execution when Billing is Linked)
```bash
# 1. Authenticate with Google Cloud
gcloud auth login

# 2. Set active project
gcloud config set project gen-lang-client-0475955540

# 3. Build container using Cloud Build
gcloud builds submit --tag gcr.io/gen-lang-client-0475955540/compliancegate-mcp:latest

# 4. Deploy to Cloud Run (Scale-to-zero, 512MB RAM, max 1 instance)
gcloud run deploy compliancegate-mcp \
  --image gcr.io/gen-lang-client-0475955540/compliancegate-mcp:latest \
  --platform managed \
  --region europe-west2 \
  --allow-unauthenticated \
  --memory 512Mi \
  --max-instances 1 \
  --port 3000
```

### Cost Controls
- Cloud Run scales down to zero instances when idle.
- In preview, the system operates completely in-memory with local snapshot persistence at **£0 cost**.
- Real commercial watchlists (Dow Jones, World-Check) and live vessel/price feeds remain explicitly disabled stubs until customer enterprise licenses are provided.

---

## 5. License

This project is licensed under the MIT License — see the [LICENSE](./LICENSE) file for details.

