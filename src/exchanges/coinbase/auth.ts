import crypto from 'node:crypto';

export interface CoinbaseAuthMaterial {
  apiKey: string;
  apiSecret: string;
  passphrase?: string;
}

/**
 * Coinbase auth behavior depends on account/app type. This starter supports a
 * common HMAC signature shape and can be adapted for JWT-based Advanced Trade.
 */
export const buildCoinbaseHeaders = (
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
