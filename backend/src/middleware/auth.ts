/**
 * Auth middleware — API key authentication for the backend HTTP server.
 *
 * Checks the `Authorization: Bearer <key>` header (or `x-api-key` header)
 * against the configured API key. Skips auth for health check and public routes.
 *
 * Set LUMENLINK_API_KEY env var to enable. If unset, auth is disabled (dev mode).
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export interface AuthConfig {
  /** API key to validate against. If empty/undefined, auth is disabled. */
  apiKey?: string;
  /** Paths that do not require authentication. */
  publicPaths?: string[];
}

const DEFAULT_PUBLIC_PATHS = ['/health', '/metrics'];

/**
 * Creates an auth gate function. Returns true if the request is authorized.
 * Writes 401 response and returns false otherwise.
 */
export function createAuthMiddleware(config: AuthConfig) {
  const apiKey = config.apiKey || process.env['LUMENLINK_API_KEY'];
  const publicPaths = new Set(config.publicPaths ?? DEFAULT_PUBLIC_PATHS);

  return function authorize(req: IncomingMessage, res: ServerResponse): boolean {
    // No key configured — auth disabled (development mode).
    if (!apiKey) return true;

    const url = req.url ?? '';
    const pathname = url.split('?')[0] ?? '';

    // Public paths skip auth.
    if (publicPaths.has(pathname)) return true;

    // Check Authorization: Bearer <key>
    const authHeader = req.headers['authorization'];
    if (authHeader) {
      const parts = authHeader.split(' ');
      if (parts[0]?.toLowerCase() === 'bearer' && parts[1] && safeCompare(parts[1], apiKey)) {
        return true;
      }
    }

    // Check x-api-key header
    const xApiKey = req.headers['x-api-key'];
    if (typeof xApiKey === 'string' && safeCompare(xApiKey, apiKey)) {
      return true;
    }

    // Unauthorized
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'unauthorized', message: 'Missing or invalid API key' }));
    return false;
  };
}
