/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { createComplianceApp } from './src/server/app.ts';
import express from 'express';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const PORT = parseInt(process.env.PORT || '3000', 10);
  const isPublicDemo = process.env.IS_PUBLIC_DEMO !== 'false';

  const app = createComplianceApp({ isPublicDemo });

  // Vite Integration (Dev) or Static Serving (Prod)
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist/index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[ComplianceGate-MCP] Server listening at http://0.0.0.0:${PORT}`);
    console.log(`[ComplianceGate-MCP] Official Streamable HTTP MCP transport active at http://0.0.0.0:${PORT}/mcp`);
    console.log(`[ComplianceGate-MCP] Security Mode: ${isPublicDemo ? 'PUBLIC_SYNTHETIC_DEMO (SSRF Protected)' : 'ENTERPRISE_GATEWAY'}`);
  });
}

startServer().catch((err) => {
  console.error('[ComplianceGate-MCP] Failed to start server:', err);
  process.exit(1);
});
