import * as crypto from 'node:crypto';

export interface CoinbaseAuthMaterial {
  apiKey: string;
  apiSecret: string;
  passphrase?: string;
}

export type CoinbaseAuthMode = 'cdp_jwt';

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

const CDP_KEY_PREFIX = 'organizations/';

const hasCdpApiKeyShape = (apiKey: string): boolean =>
  apiKey.startsWith(CDP_KEY_PREFIX) && apiKey.includes('/apiKeys/');

const hasSupportedPemShape = (apiSecret: string): boolean =>
  apiSecret.includes('BEGIN PRIVATE KEY') || apiSecret.includes('BEGIN EC PRIVATE KEY');

const ensureSupportedEcdsaKey = (auth: CoinbaseAuthMaterial): void => {
  try {
    const keyObj = crypto.createPrivateKey({ key: normalizePem(auth.apiSecret) });
    if (keyObj.asymmetricKeyType !== 'ec') {
      throw new Error('expected ECDSA private key (Ed25519 keys are not supported)');
    }

    const namedCurve = keyObj.asymmetricKeyDetails?.namedCurve;
    if (namedCurve && namedCurve !== 'prime256v1' && namedCurve !== 'secp256r1') {
      throw new Error(`unsupported ECDSA curve ${namedCurve}; expected prime256v1/secp256r1`);
    }
  } catch (err) {
    throw new Error(`Coinbase auth rejected: ${err instanceof Error ? err.message : String(err)}`);
  }
};

export const getCoinbaseAuthMode = (auth: CoinbaseAuthMaterial): CoinbaseAuthMode => {
  if (!hasCdpApiKeyShape(auth.apiKey)) {
    throw new Error(
      'Coinbase auth rejected: expected CDP API key format organizations/{org_id}/apiKeys/{key_id}.'
    );
  }

  const normalizedSecret = normalizePem(auth.apiSecret);
  if (!hasSupportedPemShape(normalizedSecret)) {
    throw new Error(
      'Coinbase auth rejected: expected CDP ECDSA private key in PEM or base64 DER PKCS#8 format.'
    );
  }

  ensureSupportedEcdsaKey({ ...auth, apiSecret: normalizedSecret });

  return 'cdp_jwt';
};

export const describeCoinbaseAuthMaterial = (
  auth: CoinbaseAuthMaterial,
): { mode: CoinbaseAuthMode; apiKeyShape: 'cdp'; pemType: 'pkcs8' | 'ec'; hasPassphrase: boolean } => {
  const mode = getCoinbaseAuthMode(auth);
  return {
    mode,
    apiKeyShape: 'cdp',
    pemType: auth.apiSecret.includes('BEGIN EC PRIVATE KEY') ? 'ec' : 'pkcs8',
    hasPassphrase: Boolean(auth.passphrase),
  };
};

/* ------------------------------------------------------------------ */
/*  CDP JWT (ES256) authentication — Coinbase Advanced Trade v3        */
/* ------------------------------------------------------------------ */

/**
 * Normalize PEM: .env files often store literal `\n` instead of real newlines.
 */
const normalizePem = (pem: string): string => {
  const trimmed = pem.replace(/\\n/g, '\n').trim();

  if (trimmed.includes('BEGIN ')) {
    return trimmed;
  }

  // Accept base64 DER PKCS#8 private keys and convert them to PEM.
  const looksBase64 = /^[A-Za-z0-9+/=\r\n]+$/.test(trimmed);
  if (!looksBase64) {
    return trimmed;
  }

  try {
    const der = Buffer.from(trimmed.replace(/\s+/g, ''), 'base64');
    const keyObj = crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
    return keyObj.export({ format: 'pem', type: 'pkcs8' }).toString();
  } catch {
    return trimmed;
  }
};

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
/*  CDP header builder                                                  */
/* ------------------------------------------------------------------ */

/**
 * Build auth headers for Coinbase API requests.
 * Enforces CDP JWT (ES256) credentials.
 */
export const buildCoinbaseHeaders = (
  auth: CoinbaseAuthMaterial,
  method: string,
  path: string,
  _body: string
): Record<string, string> => {
  getCoinbaseAuthMode(auth);
  const jwt = buildJwt(auth, method, 'api.coinbase.com', path);
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${jwt}`
  };
};
