import * as crypto from 'node:crypto';

export interface CoinbaseAuthMaterial {
  apiKey: string;
  apiSecret: string;
  passphrase?: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers for Base64URL encoding (RFC 7515)                          */
/* ------------------------------------------------------------------ */

const base64url = (input: string | Buffer): string => {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/* ------------------------------------------------------------------ */
/*  Detect key type: CDP JWT (ES256) vs legacy HMAC                    */
/* ------------------------------------------------------------------ */

const isCdpKey = (auth: CoinbaseAuthMaterial): boolean =>
  auth.apiKey.startsWith('organizations/') && auth.apiSecret.includes('BEGIN EC PRIVATE KEY');

/* ------------------------------------------------------------------ */
/*  CDP JWT (ES256) authentication — Coinbase Advanced Trade v3        */
/* ------------------------------------------------------------------ */

/**
 * Normalize PEM: .env files often store literal `\n` instead of real newlines.
 */
const normalizePem = (pem: string): string =>
  pem.replace(/\\n/g, '\n').trim();

/**
 * Build a short-lived ES256 JWT for Coinbase CDP API keys.
 *
 * Header:  { "alg": "ES256", "kid": "<apiKey>", "nonce": "<hex>", "typ": "JWT" }
 * Payload: { "sub": "<apiKey>", "iss": "coinbase-cloud",
 *            "nbf": <now>, "exp": <now+120>,
 *            "aud": ["retail_rest_api_proxy"],
 *            "uri": "<METHOD> <host><path>" }
 */
const buildJwt = (
  auth: CoinbaseAuthMaterial,
  method: string,
  host: string,
  path: string
): string => {
  const now = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomBytes(16).toString('hex');

  // Strip query parameters — Coinbase JWT URI must be path-only
  const pathOnly = path.split('?')[0]!;

  const header = {
    alg: 'ES256',
    kid: auth.apiKey,
    nonce,
    typ: 'JWT'
  };

  const payload = {
    sub: auth.apiKey,
    iss: 'coinbase-cloud',
    nbf: now,
    exp: now + 120,
    aud: ['retail_rest_api_proxy'],
    uri: `${method.toUpperCase()} ${host}${pathOnly}`
  };

  const segments = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const pem = normalizePem(auth.apiSecret);
  const sig = crypto.sign('SHA256', Buffer.from(segments), {
    key: pem,
    dsaEncoding: 'ieee-p1363'        // compact R||S required by JWS
  });

  return `${segments}.${base64url(sig)}`;
};

/* ------------------------------------------------------------------ */
/*  Legacy HMAC-SHA256 authentication (Coinbase Pro / legacy keys)     */
/* ------------------------------------------------------------------ */

const buildHmacHeaders = (
  auth: CoinbaseAuthMaterial,
  method: string,
  path: string,
  body: string
): Record<string, string> => {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const prehash = `${timestamp}${method.toUpperCase()}${path}${body}`;
  const signature = crypto
    .createHmac('sha256', Buffer.from(auth.apiSecret, 'base64'))
    .update(prehash)
    .digest('base64');

  return {
    'Content-Type': 'application/json',
    'CB-ACCESS-KEY': auth.apiKey,
    'CB-ACCESS-SIGN': signature,
    'CB-ACCESS-TIMESTAMP': timestamp,
    ...(auth.passphrase ? { 'CB-ACCESS-PASSPHRASE': auth.passphrase } : {})
  };
};

/* ------------------------------------------------------------------ */
/*  Unified header builder — auto-selects auth method                  */
/* ------------------------------------------------------------------ */

/**
 * Build auth headers for Coinbase API requests.
 * Automatically chooses between JWT (ES256) and legacy HMAC depending on the
 * key format.
 */
export const buildCoinbaseHeaders = (
  auth: CoinbaseAuthMaterial,
  method: string,
  path: string,
  body: string
): Record<string, string> => {
  if (isCdpKey(auth)) {
    const jwt = buildJwt(auth, method, 'api.coinbase.com', path);
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`
    };
  }

  return buildHmacHeaders(auth, method, path, body);
};
