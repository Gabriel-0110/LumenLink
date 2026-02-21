import { describe, it, expect, beforeEach } from 'vitest';
import { OrderManager } from '../../src/execution/orderManager.js';
import { OrderState } from '../../src/execution/orderState.js';
import { PaperBroker } from '../../src/execution/paperBroker.js';
import { LiveBroker } from '../../src/execution/liveBroker.js';
import { InMemoryStore } from '../../src/data/inMemoryStore.js';
import { createMockLogger, createMockMetrics, makeTicker } from '../helpers.js';
import type { Signal } from '../../src/core/types.js';

function makeConfig(overrides: Record<string, any> = {}) {
  return {
    mode: 'paper' as const,
    killSwitch: false,
    allowLiveTrading: false,
    risk: { maxDailyLossUsd: 150, maxPositionUsd: 250, maxOpenPositions: 2, cooldownMinutes: 15 },
    guards: { maxSpreadBps: 25, maxSlippageBps: 20, minVolume: 0 },
    ...overrides,
  } as any;
}

describe('OrderManager', () => {
  let manager: OrderManager;
  let orderState: OrderState;
  let metrics: ReturnType<typeof createMockMetrics>;

  beforeEach(() => {
    const store = new InMemoryStore();
    orderState = new OrderState(store);
    metrics = createMockMetrics();
    manager = new OrderManager(
      makeConfig(),
      orderState,
      new PaperBroker(),
      new LiveBroker(null as any), // not used in paper mode
      createMockLogger(),
      metrics
    );
  });

  it('submits a BUY signal and returns an order', async () => {
    const signal: Signal = { action: 'BUY', confidence: 0.8, reason: 'test' };
    const ticker = makeTicker();
    const order = await manager.submitSignal({ symbol: 'BTC-USD', signal, ticker });
    expect(order).toBeDefined();
    expect(order!.side).toBe('buy');
    expect(order!.status).toBe('filled');
  });

  it('submits a SELL signal', async () => {
    const signal: Signal = { action: 'SELL', confidence: 0.8, reason: 'test' };
    const ticker = makeTicker();
    const order = await manager.submitSignal({ symbol: 'BTC-USD', signal, ticker });
    expect(order).toBeDefined();
    expect(order!.side).toBe('sell');
  });

  it('returns undefined for HOLD signal', async () => {
    const signal: Signal = { action: 'HOLD', confidence: 0, reason: 'test' };
    const ticker = makeTicker();
    const order = await manager.submitSignal({ symbol: 'BTC-USD', signal, ticker });
    expect(order).toBeUndefined();
  });

  it('enforces idempotency — same key returns same order', async () => {
    const signal: Signal = { action: 'BUY', confidence: 0.8, reason: 'test' };
    const ticker = makeTicker();
    const key = 'idempotent-test-123';

    const order1 = await manager.submitSignal({ symbol: 'BTC-USD', signal, ticker, idempotencyKey: key });
    const order2 = await manager.submitSignal({ symbol: 'BTC-USD', signal, ticker, idempotencyKey: key });

    expect(order1!.orderId).toBe(order2!.orderId);
    expect(metrics.counters.get('orders.idempotent_hit')).toBe(1);
  });

  it('different keys produce different orders', async () => {
    const signal: Signal = { action: 'BUY', confidence: 0.8, reason: 'test' };
    const ticker = makeTicker();

    const order1 = await manager.submitSignal({ symbol: 'BTC-USD', signal, ticker, idempotencyKey: 'key-1' });
    const order2 = await manager.submitSignal({ symbol: 'BTC-USD', signal, ticker, idempotencyKey: 'key-2' });

    expect(order1!.orderId).not.toBe(order2!.orderId);
  });

  it('persists orders to OrderState', async () => {
    const signal: Signal = { action: 'BUY', confidence: 0.8, reason: 'test' };
    const ticker = makeTicker();
    const order = await manager.submitSignal({ symbol: 'BTC-USD', signal, ticker });

    const stored = orderState.getByOrderId(order!.orderId);
    expect(stored).toEqual(order);
  });

  it('increments orders.submitted metric', async () => {
    const signal: Signal = { action: 'BUY', confidence: 0.8, reason: 'test' };
    await manager.submitSignal({ symbol: 'BTC-USD', signal, ticker: makeTicker() });
    expect(metrics.counters.get('orders.submitted')).toBe(1);
  });
});
