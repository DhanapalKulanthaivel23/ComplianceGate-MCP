/**
 * @license
 * SPDX-License-Identifier: MIT
 *
 * Official Model Context Protocol (MCP) Stdio Server Entrypoint for Antigravity IDE / AGY CLI.
 * Exposes all 15 ComplianceGate-MCP tools (Payments, Trade & Cargo, Maritime, Air Cargo,
 * Insurance, Crypto, Healthcare, Securities, Validation & Audit) over standard input/output.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createOfficialMcpServer } from './mcpServer.ts';

async function runStdioMcpServer() {
  const server = createOfficialMcpServer(true);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

runStdioMcpServer().catch((err) => {
  console.error('[ComplianceGate-MCP] Fatal stdio MCP error:', err);
  process.exit(1);
});

