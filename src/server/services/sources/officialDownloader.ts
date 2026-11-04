/**
 * @license
 * SPDX-License-Identifier: MIT
 */

export interface DownloadResult {
  rawText: string;
  statusCode: number;
  durationMs: number;
  bytesRead: number;
  contentType?: string;
  etag?: string;
  lastModified?: string;
}

export interface DownloadOptions {
  timeoutMs?: number;
  maxBytes?: number;
  retries?: number;
  headers?: Record<string, string>;
}

export async function downloadOfficialFeed(
  url: string,
  options: DownloadOptions = {}
): Promise<DownloadResult> {
  const timeoutMs = options.timeoutMs ?? 15000;
  const maxBytes = options.maxBytes ?? 50 * 1024 * 1024; // 50MB
  const maxRetries = options.retries ?? 2;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const startTime = Date.now();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'ComplianceGate-MCP/1.0 (Official Sanctions Ingestion Engine; Automated Verifier)',
          Accept: 'application/xml, text/xml, text/csv, application/json, */*',
          ...options.headers,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        throw new Error(`Upstream server returned HTTP ${res.status}: ${res.statusText}`);
      }

      // Check content-length header if provided
      const contentLengthHeader = res.headers.get('content-length');
      if (contentLengthHeader && parseInt(contentLengthHeader, 10) > maxBytes) {
        throw new Error(
          `Payload size limit exceeded: upstream declared ${contentLengthHeader} bytes, max allowed is ${maxBytes} bytes.`
        );
      }

      // Read text with bounded buffer guard
      const rawText = await res.text();
      const bytesRead = Buffer.byteLength(rawText, 'utf8');

      if (bytesRead > maxBytes) {
        throw new Error(`Payload size exceeded ${maxBytes} bytes (read ${bytesRead} bytes).`);
      }

      if (!rawText.trim()) {
        throw new Error('Upstream response body is empty (zero bytes).');
      }

      const durationMs = Date.now() - startTime;

      return {
        rawText,
        statusCode: res.status,
        durationMs,
        bytesRead,
        contentType: res.headers.get('content-type') || undefined,
        etag: res.headers.get('etag') || undefined,
        lastModified: res.headers.get('last-modified') || undefined,
      };
    } catch (err: any) {
      lastError = err;
      if (attempt < maxRetries) {
        const backoffMs = Math.min(1000 * Math.pow(2, attempt), 3000);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
  }

  throw new Error(`Failed to download feed from ${url}: ${lastError?.message || 'Unknown network error'}`);
}

