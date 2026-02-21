import { describe, expect, it } from 'vitest';
import { CoinbaseAdapter } from '../src/exchanges/coinbase/adapter.js';

describe('coinbase adapter smoke', () => {
  it.skipIf(!process.env.COINBASE_API_KEY || !process.env.COINBASE_API_SECRET)(
    'can call getTicker when credentials exist',
    async () => {
      const adapter = new CoinbaseAdapter({
        apiKey: process.env.COINBASE_API_KEY as string,
        apiSecret: process.env.COINBASE_API_SECRET as string,
        passphrase: process.env.COINBASE_API_PASSPHRASE
      });
      const ticker = await adapter.getTicker('BTC-USD');
      expect(ticker.symbol).toBe('BTC-USD');
      expect(ticker.last).toBeGreaterThan(0);
    }
  );
});
