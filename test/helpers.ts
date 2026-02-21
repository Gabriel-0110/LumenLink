/**
 * Shared test helpers — mock factories for all modules.
 */

import type { Candle, Ticker, Signal, Order, AccountSnapshot, Position } from '../src/core/types.js';
import type { Logger } from '../src/core/logger.js';
import type { Metrics } from '../src/core/metrics.js';
import type { AlertService } from '../src/alerts/interface.js';

// ── Mock Logger ─────────────────────────────────────────────────────

export const createMockLogger = (): Logger => ({
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
});

// ── Mock Metrics ────────────────────────────────────────────────────

export const createMockMetrics = (): Metrics & { counters: Map<string, number> } => {
  const counters = new Map<string, number>();
  return {
    counters,
    increment(name: string, value = 1) { counters.set(name, (counters.get(name) ?? 0) + value); },
    gauge() {},
  };
};

// ── Mock Alert ──────────────────────────────────────────────────────

export const createMockAlert = (): AlertService & { calls: Array<{ title: string; message: string }> } => {
  const calls: Array<{ title: string; message: string }> = [];
  return {
    calls,
    async notify(title: string, message: string) { calls.push({ title, message }); },
  };
};

// ── Candle Factory ──────────────────────────────────────────────────

let candleSeq = 0;

export function makeCandle(overrides: Partial<Candle> = {}): Candle {
  candleSeq++;
  const base = 50000 + Math.sin(candleSeq * 0.1) * 2000;
  return {
    symbol: 'BTC-USD',
    interval: '1h',
    time: Date.now() - (300 - candleSeq) * 3_600_000,
    open: base,
    high: base + 200,
    low: base - 200,
    close: base + 50,
    volume: 100 + Math.random() * 500,
    ...overrides,
  };
}

/**
 * Generate a series of candles with a trend.
 * direction: 'up' | 'down' | 'flat'
 */
export function makeCandleSeries(
  count: number,
  direction: 'up' | 'down' | 'flat' = 'flat',
  opts: { symbol?: string; interval?: string; startPrice?: number } = {}
): Candle[] {
  const symbol = opts.symbol ?? 'BTC-USD';
  const interval = opts.interval ?? '1h';
  const startPrice = opts.startPrice ?? 50000;
  const step = direction === 'up' ? 100 : direction === 'down' ? -100 : 0;

  return Array.from({ length: count }, (_, i) => {
    const price = startPrice + step * i;
    return {
      symbol,
      interval,
      time: Date.now() - (count - i) * 3_600_000,
      open: price,
      high: price + 150,
      low: price - 150,
      close: price + (direction === 'up' ? 80 : direction === 'down' ? -80 : 0),
      volume: 200 + Math.random() * 300,
    };
  });
}

// ── Ticker Factory ──────────────────────────────────────────────────

export function makeTicker(overrides: Partial<Ticker> = {}): Ticker {
  return {
    symbol: 'BTC-USD',
    bid: 50000,
    ask: 50010,
    last: 50005,
    volume24h: 1000,
    time: Date.now(),
    ...overrides,
  };
}

// ── Order Factory ───────────────────────────────────────────────────

export function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    orderId: `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    clientOrderId: `client-${Date.now()}`,
    symbol: 'BTC-USD',
    side: 'buy',
    type: 'market',
    quantity: 0.01,
    status: 'filled',
    filledQuantity: 0.01,
    avgFillPrice: 50005,
    reason: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

// ── Snapshot Factory ────────────────────────────────────────────────

export function makeSnapshot(overrides: Partial<AccountSnapshot> = {}): AccountSnapshot {
  return {
    cashUsd: 10000,
    realizedPnlUsd: 0,
    unrealizedPnlUsd: 0,
    openPositions: [],
    lastStopOutAtBySymbol: {},
    ...overrides,
  };
}

export function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    symbol: 'BTC-USD',
    quantity: 0.01,
    avgEntryPrice: 50000,
    marketPrice: 50000,
    ...overrides,
  };
}
