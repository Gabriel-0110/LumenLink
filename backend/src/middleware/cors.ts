/**
 * CORS middleware — configurable Cross-Origin Resource Sharing headers.
 *
 * Handles preflight OPTIONS requests and sets appropriate CORS headers
 * on all responses.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

export interface CorsConfig {
  /** Allowed origins. Use ['*'] for wide open (dev only). */
  allowedOrigins?: string[];
  /** Additional allowed headers beyond the defaults. */
  allowedHeaders?: string[];
  /** Allowed HTTP methods. */
  allowedMethods?: string[];
  /** Max age for preflight cache (seconds). */
  maxAge?: number;
  /** Whether to allow credentials. */
  credentials?: boolean;
}

const DEFAULT_ORIGINS = ['http://localhost:3000', 'http://localhost:5173', 'http://localhost:8080'];
const DEFAULT_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'];
const DEFAULT_HEADERS = ['Content-Type', 'Authorization', 'x-api-key'];

/**
 * Creates a CORS handler. Returns true if the request was a preflight
 * OPTIONS request that has been fully handled (caller should return early).
 * Returns false for normal requests (headers have been set, continue processing).
 */
export function createCorsMiddleware(config: CorsConfig = {}) {
  const origins = config.allowedOrigins ?? DEFAULT_ORIGINS;
  const methods = (config.allowedMethods ?? DEFAULT_METHODS).join(', ');
  const headers = [...DEFAULT_HEADERS, ...(config.allowedHeaders ?? [])].join(', ');
  const maxAge = String(config.maxAge ?? 86400);
  const credentials = config.credentials ?? true;
  const wildcard = origins.includes('*');

  return function handleCors(req: IncomingMessage, res: ServerResponse): boolean {
    const origin = req.headers['origin'] ?? '';

    // Determine the value for Access-Control-Allow-Origin
    let allowOrigin = '';
    if (wildcard) {
      allowOrigin = '*';
    } else if (origins.includes(origin)) {
      allowOrigin = origin;
    } else if (origins.length > 0 && origin === '') {
      // Same-origin or server-to-server requests (no Origin header)
      allowOrigin = origins[0]!;
    }

    if (allowOrigin) {
      res.setHeader('Access-Control-Allow-Origin', allowOrigin);
    }
    if (!wildcard) {
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', methods);
    res.setHeader('Access-Control-Allow-Headers', headers);
    res.setHeader('Access-Control-Max-Age', maxAge);
    if (credentials && !wildcard) {
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }

    // Handle preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return true; // Signal: request fully handled
    }

    return false; // Signal: continue to route handler
  };
}
