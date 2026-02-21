import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStore } from '../../src/data/sqliteStore.js';
import { makeCandle, makeOrder } from '../helpers.js';
import * as fs from 'node:fs';

const TEST_DB = './data/test-runtime.sqlite';

describe('SqliteStore', () => {
  let store: SqliteStore;

  beforeEach(() => {
    // Clean up any leftover test DB
    try { fs.unlinkSync(TEST_DB); } catch {}
    store = new SqliteStore(TEST_DB);
  });

  afterEach(() => {
    try { fs.unlinkSync(TEST_DB); } catch {}
  });

  describe('candles', () => {
    it('saves and retrieves candles', async () => {
      const candles = [
        makeCandle({ symbol: 'BTC-USD', interval: '1h', time: 1000 }),
        makeCandle({ symbol: 'BTC-USD', interval: '1h', time: 2000 }),
        makeCandle({ symbol: 'BTC-USD', interval: '1h', time: 3000 }),
      ];
      await store.saveCandles(candles);
      const result = await store.getRecentCandles('BTC-USD', '1h', 10);
      expect(result).toHaveLength(3);
      expect(result[0]!.time).toBe(1000); // oldest first
      expect(result[2]!.time).toBe(3000); // newest last
    });

    it('upserts on conflict (same symbol+interval+time)', async () => {
      await store.saveCandles([makeCandle({ symbol: 'BTC-USD', interval: '1h', time: 1000, close: 50000 })]);
      await store.saveCandles([makeCandle({ symbol: 'BTC-USD', interval: '1h', time: 1000, close: 51000 })]);
      const result = await store.getRecentCandles('BTC-USD', '1h', 10);
      expect(result).toHaveLength(1);
      expect(result[0]!.close).toBe(51000);
    });

    it('respects limit', async () => {
      const candles = Array.from({ length: 10 }, (_, i) =>
        makeCandle({ symbol: 'BTC-USD', interval: '1h', time: (i + 1) * 1000 })
      );
      await store.saveCandles(candles);
      const result = await store.getRecentCandles('BTC-USD', '1h', 3);
      expect(result).toHaveLength(3);
      // Should be the 3 most recent, returned in ascending order
      expect(result[0]!.time).toBe(8000);
      expect(result[2]!.time).toBe(10000);
    });

    it('filters by symbol and interval', async () => {
      await store.saveCandles([
        makeCandle({ symbol: 'BTC-USD', interval: '1h', time: 1000 }),
        makeCandle({ symbol: 'ETH-USD', interval: '1h', time: 1000 }),
        makeCandle({ symbol: 'BTC-USD', interval: '1d', time: 1000 }),
      ]);
      const result = await store.getRecentCandles('BTC-USD', '1h', 10);
      expect(result).toHaveLength(1);
    });
  });

  describe('orders', () => {
    it('saves and retrieves orders', async () => {
      const order = makeOrder({ orderId: 'test-1', clientOrderId: 'client-1' });
      await store.saveOrder(order);
      const orders = await store.getOrders();
      expect(orders).toHaveLength(1);
      expect(orders[0]!.orderId).toBe('test-1');
    });

    it('upserts orders on conflict', async () => {
      const order = makeOrder({ orderId: 'test-1', status: 'pending' });
      await store.saveOrder(order);
      await store.saveOrder({ ...order, status: 'filled' });
      const orders = await store.getOrders();
      expect(orders).toHaveLength(1);
      expect(orders[0]!.status).toBe('filled');
    });

    it('handles nullable fields', async () => {
      const order = makeOrder({ price: undefined, avgFillPrice: undefined, reason: null });
      await store.saveOrder(order);
      const orders = await store.getOrders();
      expect(orders).toHaveLength(1);
    });
  });
});
