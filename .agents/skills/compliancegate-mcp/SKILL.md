---
name: compliancegate-mcp
description: Run, test, screen, and deploy the ComplianceGate-MCP multi-module compliance gateway and its TypeScript and Go MCP servers.
---

# ComplianceGate-MCP Skill

Use this skill when working with payment screening (SWIFT MT Categories 1–9 and ISO 20022 MX across all 33 domains), trade/cargo reconciliation, maritime vessel screening, air cargo AWB verification, insurance UBO 50% rule checks, crypto Travel Rule (IVMS101), healthcare NPI/DEA/LEIE verification, securities FIX surveillance, or model validation benchmarks.

## MCP Server Transports

1. **TypeScript Stdio MCP Server (15 Tools)**:
   ```bash
   npx tsx /Users/dhanapal/antigravity/ComplianceGate-MCP/src/server/stdioMcp.ts
   ```
2. **Streamable HTTP MCP Endpoint (`/mcp`)**:
   Start the server with `npm start` (default port `3000`) and connect to:
   ```text
   http://127.0.0.1:3000/mcp
   ```
3. **Go Native Core Engine Stdio MCP Server**:
   ```bash
   /Users/dhanapal/antigravity/ComplianceGate-MCP/core/bin/compliancegate-core -stdio-mcp
   ```

## Verification Checklist
1. `npm run lint` — Zero TypeScript compiler errors.
2. `/usr/local/go/bin/go test -C core -v ./...` — All Go parser, engine, and watchlist tests pass.
3. `npm test` — All 221 TypeScript assertions pass across Payments and Multi-Module suites.

