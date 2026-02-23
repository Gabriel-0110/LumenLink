import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildCoinbaseHeaders,
  describeCoinbaseAuthMaterial,
  getCoinbaseAuthMode,
} from '../../src/exchanges/coinbase/auth.js';

const makePem = (): string => {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
};

const makeDerBase64 = (): string => {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const der = privateKey.export({ format: 'der', type: 'pkcs8' }) as Buffer;
  return der.toString('base64');
};

const makeEd25519Pem = (): string => {
  const { privateKey } = generateKeyPairSync('ed25519');
  return privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
};

describe('coinbase auth (CDP-only)', () => {
  it('accepts CDP key + PKCS8 private key', () => {
    const auth = {
      apiKey: 'organizations/org-123/apiKeys/key-456',
      apiSecret: makePem(),
    };

    expect(getCoinbaseAuthMode(auth)).toBe('cdp_jwt');

    const profile = describeCoinbaseAuthMaterial(auth);
    expect(profile.mode).toBe('cdp_jwt');
    expect(profile.apiKeyShape).toBe('cdp');
    expect(profile.pemType).toBe('pkcs8');
    expect(profile.hasPassphrase).toBe(false);
  });

  it('rejects non-CDP api key shape', () => {
    const auth = {
      apiKey: 'legacy-key',
      apiSecret: makePem(),
    };

    expect(() => getCoinbaseAuthMode(auth)).toThrow(/expected CDP API key format/i);
  });

  it('rejects malformed private key', () => {
    const auth = {
      apiKey: 'organizations/org-123/apiKeys/key-456',
      apiSecret: 'not-a-pem-key',
    };

    expect(() => getCoinbaseAuthMode(auth)).toThrow(/expected CDP ECDSA private key/i);
  });

  it('rejects Ed25519 private keys', () => {
    const auth = {
      apiKey: 'organizations/org-123/apiKeys/key-456',
      apiSecret: makeEd25519Pem(),
    };

    expect(() => getCoinbaseAuthMode(auth)).toThrow(/expected ECDSA private key/i);
  });

  it('accepts base64 DER pkcs8 ECDSA private keys', () => {
    const auth = {
      apiKey: 'organizations/org-123/apiKeys/key-456',
      apiSecret: makeDerBase64(),
    };

    expect(getCoinbaseAuthMode(auth)).toBe('cdp_jwt');

    const headers = buildCoinbaseHeaders(auth, 'GET', '/api/v3/brokerage/accounts', '');
    expect(headers.Authorization).toMatch(/^Bearer\s+.+/);
  });

  it('builds bearer token headers for brokerage endpoints', () => {
    const auth = {
      apiKey: 'organizations/org-123/apiKeys/key-456',
      apiSecret: makePem(),
    };

    const headers = buildCoinbaseHeaders(auth, 'GET', '/api/v3/brokerage/accounts', '');

    expect(headers['Content-Type']).toBe('application/json');
    expect(headers.Authorization).toMatch(/^Bearer\s+.+/);
    expect(headers['CB-ACCESS-KEY']).toBeUndefined();
  });
});
