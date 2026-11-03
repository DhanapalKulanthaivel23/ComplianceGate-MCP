/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createOfficialMcpServer } from './mcpServer.ts';

/**
 * Standard I/O (stdio) transport runner for local CLI agents and desktop MCP clients.
 */
async function startStdioServer() {
  const server = createOfficialMcpServer(true);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('ComplianceGate-MCP official SDK stdio server connected and listening.\n');
}

if (process.argv[1]?.endsWith('mcpStdio.ts')) {
  startStdioServer().catch((err) => {
    process.stderr.write(`Stdio server error: ${err.message}\n`);
    process.exit(1);
  });
}

export { startStdioServer };
