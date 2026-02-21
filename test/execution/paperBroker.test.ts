import { describe, it, expect } from 'vitest';
import { PaperBroker } from '../../src/execution/paperBroker.js';
import { makeTicker } from '../helpers.js';

describe('PaperBroker', () => {
  const broker = new PaperBroker();

  it('fills immediately with status filled', async () => {
    const order = await broker.place(
      { symbol: 'BTC-USD', side: 'buy', type: 'market', quantity: 0.01, clientOrderId: 'test-1' },
      makeTicker({ bid: 50000, ask: 50010 }),
      20
    );
    expect(order.status).toBe('filled');
    expect(order.filledQuantity).toBe(0.01);
    expect(order.clientOrderId).toBe('test-1');
  });

  it('applies slippage on buy (fills above mid)', async () => {
    const ticker = makeTicker({ bid: 50000, ask: 50010 });
    const mid = (50000 + 50010) / 2;
    const order = await broker.place(
      { symbol: 'BTC-USD', side: 'buy', type: 'market', quantity: 0.01, clientOrderId: 'test-buy' },
      ticker,
      20
    );
    expect(order.avgFillPrice!).toBeGreaterThan(mid);
  });

  it('applies slippage on sell (fills below mid)', async () => {
    const ticker = makeTicker({ bid: 50000, ask: 50010 });
    const mid = (50000 + 50010) / 2;
    const order = await broker.place(
      { symbol: 'BTC-USD', side: 'sell', type: 'market', quantity: 0.01, clientOrderId: 'test-sell' },
      ticker,
      20
    );
    expect(order.avgFillPrice!).toBeLessThan(mid);
  });

  it('generates unique order IDs', async () => {
    const ticker = makeTicker();
    const order1 = await broker.place(
      { symbol: 'BTC-USD', side: 'buy', type: 'market', quantity: 0.01, clientOrderId: 'a' },
      ticker, 20
    );
    const order2 = await broker.place(
      { symbol: 'BTC-USD', side: 'buy', type: 'market', quantity: 0.01, clientOrderId: 'b' },
      ticker, 20
    );
    expect(order1.orderId).not.toBe(order2.orderId);
  });

  it('caps slippage at 2%', async () => {
    const ticker = makeTicker({ bid: 50000, ask: 50010 });
    const mid = (50000 + 50010) / 2;
    const order = await broker.place(
      { symbol: 'BTC-USD', side: 'buy', type: 'market', quantity: 0.01, clientOrderId: 'test-cap' },
      ticker,
      5000 // absurdly high slippage bps
    );
    // Should be capped at 2%
    expect(order.avgFillPrice!).toBeLessThanOrEqual(mid * 1.021);
  });
});
