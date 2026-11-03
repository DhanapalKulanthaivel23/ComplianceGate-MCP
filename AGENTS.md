# ComplianceGate-MCP Workspace Guidelines

## Overview
**ComplianceGate-MCP** is a multi-module financial crime, trade, maritime, air cargo, insurance, crypto, healthcare, securities, and model-validation screening gateway exposing an official Model Context Protocol (MCP) server (Stdio + Streamable HTTP), a Go core engine (`core/bin/compliancegate-core`), a REST API, and a React 19 + Tailwind CSS v4 dashboard.

## Key Architectural Rules
1. **Strict Separation of Verified Profiles vs. Universal Envelope Extraction**:
   - Only the 9 dedicated profiles in `VERIFIED_TESTED_PROFILES` (`MT103`, `MT103_STP`, `MT103_REMIT`, `MT202_COV`, `MT205_COV`, `PACS_008`, `PACS_009_COV`, `PACS_004`, `PAIN_001`) may set `isProfileTested: true`, and only after passing profile-specific validation (including schema version checks, mandatory field checks, STP/REMIT/Sequence A+B checks, and server-side extraction completeness verification).
   - All other SWIFT MT types (across all 195 catalogue types / Categories 1–9) and ISO 20022 MX types (across all 140 catalogue types / 33 business domains) are extracted via universal envelope fallback with `isProfileTested: false`, triggering `PROF_01_UNPROFILED_MESSAGE_ENVELOPE`, `coverageStatus: 'INSUFFICIENT'`, and mandatory human review.
2. **PII Redaction in Agent Contexts**:
   - All MCP tool outputs pass through `redactSensitiveDataForAgent()` to mask IBANs, account numbers, passport numbers, and tax IDs before returning to LLM context windows.
3. **Immutable Audit Trail**:
   - Every screening decision, case adjudication, and module investigation workflow step is recorded in the SHA-256 hash-chained write-ahead log (`src/server/services/durableStorage.ts`).

## Commands
- **Run TypeScript + Go Tests**: `npm test` and `/usr/local/go/bin/go test -C core -v ./...`
- **Typecheck**: `npm run lint`
- **Build Production Web UI**: `npm run build`
- **Start Web UI + REST API + Streamable HTTP MCP (`/mcp`)**: `npm start`
- **Start Stdio MCP Server (TypeScript, 15 tools)**: `npm run mcp:stdio`
- **Start Stdio MCP Server (Go Core Engine)**: `./core/bin/compliancegate-core -stdio-mcp`

