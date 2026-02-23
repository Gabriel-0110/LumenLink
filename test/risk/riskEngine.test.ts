import { describe, it, expect } from 'vitest';
import { RiskEngine } from '../../src/risk/riskEngine.js';
import { makeTicker, makeSnapshot, makePosition, makeCandleSeries } from '../helpers.js';
import type { Signal } from '../../src/core/types.js';

function makeConfig(overrides: Record<string, any> = {}) {
  return {
    mode: 'paper' as const,
    killSwitch: false,
    allowLiveTrading: false,
    risk: {
      maxDailyLossUsd: 150,
      maxPositionUsd: 250,
      maxOpenPositions: 2,
      cooldownMinutes: 15,
    },
    guards: {
      maxSpreadBps: 25,
      maxSlippageBps: 20,
      minVolume: 0,
    },
    ...overrides,
  } as any;
}

const buySignal: Signal = { action: 'BUY', confidence: 0.8, reason: 'test' };
const sellSignal: Signal = { action: 'SELL', confidence: 0.8, reason: 'test' };
const holdSignal: Signal = { action: 'HOLD', confidence: 0, reason: 'test' };

describe('RiskEngine', () => {
  it('allows a valid BUY signal', () => {
    const engine = new RiskEngine(makeConfig());
    const result = engine.evaluate({
      signal: buySignal,
      symbol: 'BTC-USD',
      snapshot: makeSnapshot(),
      ticker: makeTicker(),
      nowMs: Date.now(),
    });
    expect(result.allowed).toBe(true);
  });

  it('blocks HOLD signals', () => {
    const engine = new RiskEngine(makeConfig());
    const result = engine.evaluate({
      signal: holdSignal,
      symbol: 'BTC-USD',
      snapshot: makeSnapshot(),
      ticker: makeTicker(),
      nowMs: Date.now(),
    });
    expect(result.allowed).toBe(false);
  });

  it('blocks when kill switch is active in live mode', () => {
    const engine = new RiskEngine(makeConfig({ mode: 'live', killSwitch: true }));
    const result = engine.evaluate({
      signal: buySignal,
      symbol: 'BTC-USD',
      snapshot: makeSnapshot(),
      ticker: makeTicker(),
      nowMs: Date.now(),
    });
    expect(result.allowed).toBe(false);
    expect(result.blockedBy).toBe('kill_switch');
  });

  it('blocks live trading when not allowed', () => {
    const engine = new RiskEngine(makeConfig({ mode: 'live', killSwitch: false, allowLiveTrading: false }));
    const result = engine.evaluate({
      signal: buySignal,
      symbol: 'BTC-USD',
      snapshot: makeSnapshot(),
      ticker: makeTicker(),
      nowMs: Date.now(),
    });
    expect(result.allowed).toBe(false);
    expect(result.blockedBy).toBe('live_disabled');
  });

  it('blocks selling when no position exists (phantom sell)', () => {
    const engine = new RiskEngine(makeConfig());
    const result = engine.evaluate({
      signal: sellSignal,
      symbol: 'BTC-USD',
      snapshot: makeSnapshot({ openPositions: [] }),
      ticker: makeTicker(),
      nowMs: Date.now(),
    });
    expect(result.allowed).toBe(false);
  });

  it('allows selling when position exists', () => {
    const engine = new RiskEngine(makeConfig({
      risk: { maxDailyLossUsd: 150, maxPositionUsd: 50000, maxOpenPositions: 2, cooldownMinutes: 15 },
    }));
    const result = engine.evaluate({
      signal: sellSignal,
      symbol: 'BTC-USD',
      snapshot: makeSnapshot({
        openPositions: [makePosition({ symbol: 'BTC-USD', quantity: 0.01 })],
      }),
      ticker: makeTicker(),
      nowMs: Date.now(),
    });
    expect(result.allowed).toBe(true);
  });

  it('blocks when max daily loss exceeded', () => {
    const engine = new RiskEngine(makeConfig());
    const result = engine.evaluate({
      signal: buySignal,
      symbol: 'BTC-USD',
      snapshot: makeSnapshot({ realizedPnlUsd: -200 }),
      ticker: makeTicker(),
      nowMs: Date.now(),
    });
    expect(result.allowed).toBe(false);
    expect(result.blockedBy).toBe('max_daily_loss');
  });

  it('blocks when max open positions reached', () => {
    const engine = new RiskEngine(makeConfig());
    const result = engine.evaluate({
      signal: buySignal,
      symbol: 'SOL-USD',
      snapshot: makeSnapshot({
        openPositions: [
          makePosition({ symbol: 'BTC-USD' }),
          makePosition({ symbol: 'ETH-USD' }),
        ],
      }),
      ticker: makeTicker(),
      nowMs: Date.now(),
    });
    expect(result.allowed).toBe(false);
    expect(result.blockedBy).toBe('max_open_positions');
  });

  it('allows adding to existing position even at max positions', () => {
    const engine = new RiskEngine(makeConfig());
    const result = engine.evaluate({
      signal: buySignal,
      symbol: 'BTC-USD',
      snapshot: makeSnapshot({
        openPositions: [
          makePosition({ symbol: 'BTC-USD' }),
          makePosition({ symbol: 'ETH-USD' }),
        ],
      }),
      ticker: makeTicker({ last: 1 }),
      nowMs: Date.now(),
    });
    expect(result.blockedBy).not.toBe('max_open_positions');
  });

  it('blocks during cooldown after stop-out', () => {
    const engine = new RiskEngine(makeConfig());
    const now = Date.now();
    const result = engine.evaluate({
      signal: buySignal,
      symbol: 'BTC-USD',
      snapshot: makeSnapshot({
        lastStopOutAtBySymbol: { 'BTC-USD': now - 5 * 60_000 },
      }),
      ticker: makeTicker(),
      nowMs: now,
    });
    expect(result.allowed).toBe(false);
    expect(result.blockedBy).toBe('cooldown');
  });

  it('allows trading after cooldown expires', () => {
    const engine = new RiskEngine(makeConfig());
    const now = Date.now();
    const result = engine.evaluate({
      signal: buySignal,
      symbol: 'BTC-USD',
      snapshot: makeSnapshot({
        lastStopOutAtBySymbol: { 'BTC-USD': now - 20 * 60_000 },
      }),
      ticker: makeTicker(),
      nowMs: now,
    });
    expect(result.allowed).toBe(true);
  });

  it('blocks when spread too wide', () => {
    const engine = new RiskEngine(makeConfig());
    const result = engine.evaluate({
      signal: buySignal,
      symbol: 'BTC-USD',
      snapshot: makeSnapshot(),
      ticker: makeTicker({ bid: 49000, ask: 51000 }),
      nowMs: Date.now(),
    });
    expect(result.allowed).toBe(false);
    expect(result.blockedBy).toBe('spread_guard');
  });

  // ── New: Pair Whitelist ──────────────────────────────────────

  it('blocks pairs not in whitelist', () => {
    const engine = new RiskEngine(makeConfig(), { allowedPairs: ['BTC-USD', 'ETH-USD'] });
    const result = engine.evaluate({
      signal: buySignal,
      symbol: 'DOGE-USD',
      snapshot: makeSnapshot(),
      ticker: makeTicker(),
      nowMs: Date.now(),
    });
    expect(result.allowed).toBe(false);
    expect(result.blockedBy).toBe('pair_not_whitelisted');
  });

  it('allows whitelisted pairs', () => {
    const engine = new RiskEngine(makeConfig(), { allowedPairs: ['BTC-USD', 'ETH-USD'] });
    const result = engine.evaluate({
      signal: buySignal,
      symbol: 'BTC-USD',
      snapshot: makeSnapshot(),
      ticker: makeTicker(),
      nowMs: Date.now(),
    });
    expect(result.allowed).toBe(true);
  });

  it('allows all pairs when no whitelist set', () => {
    const engine = new RiskEngine(makeConfig());
    const result = engine.evaluate({
      signal: buySignal,
      symbol: 'SHIB-USD',
      snapshot: makeSnapshot(),
      ticker: makeTicker(),
      nowMs: Date.now(),
    });
    expect(result.allowed).toBe(true);
  });

  // ── New: Max Leverage ────────────────────────────────────────

  it('blocks when leverage exceeds max', () => {
    const engine = new RiskEngine(makeConfig(), { maxLeverage: 3 });
    const result = engine.evaluate({
      signal: buySignal,
      symbol: 'BTC-USD',
      snapshot: makeSnapshot(),
      ticker: makeTicker(),
      nowMs: Date.now(),
      leverage: 5,
    });
    expect(result.allowed).toBe(false);
    expect(result.blockedBy).toBe('max_leverage');
  });

  it('allows leverage within limit', () => {
    const engine = new RiskEngine(makeConfig(), { maxLeverage: 3 });
    const result = engine.evaluate({
      signal: buySignal,
      symbol: 'BTC-USD',
      snapshot: makeSnapshot(),
      ticker: makeTicker(),
      nowMs: Date.now(),
      leverage: 2,
    });
    expect(result.allowed).toBe(true);
  });

  // ── New: Event Lockout ───────────────────────────────────────

  it('blocks during event lockout window', () => {
    const engine = new RiskEngine(makeConfig());
    const now = Date.now();
    engine.getEventLockout().addEvents([{
      name: 'FOMC Rate Decision',
      time: now + 10 * 60_000, // 10 min from now
      category: 'macro',
      impact: 'high',
    }]);

    const result = engine.evaluate({
      signal: buySignal,
      symbol: 'BTC-USD',
      snapshot: makeSnapshot(),
      ticker: makeTicker(),
      nowMs: now, // within 30 min lockout window
    });
    expect(result.allowed).toBe(false);
    expect(result.blockedBy).toBe('event_lockout');
  });

  // ── Remaining capacity: position sizing caps to available room ──

  it('blocks BUY when existing position fully uses the limit', () => {
    const engine = new RiskEngine(makeConfig({
      risk: { maxDailyLossUsd: 150, maxPositionUsd: 250, maxOpenPositions: 2, cooldownMinutes: 15 },
    }));
    const result = engine.evaluate({
      signal: buySignal,
      symbol: 'BTC-USD',
      snapshot: makeSnapshot({
        openPositions: [makePosition({ symbol: 'BTC-USD', quantity: 0.005, marketPrice: 50000 })], // $250
      }),
      ticker: makeTicker({ last: 50000 }),
      nowMs: Date.now(),
    });
    expect(result.allowed).toBe(false);
    expect(result.blockedBy).toBe('max_position_usd');
  });

  it('caps BUY positionSizeUsd to remaining capacity under the limit', () => {
    const engine = new RiskEngine(makeConfig({
      risk: { maxDailyLossUsd: 150, maxPositionUsd: 500, maxOpenPositions: 2, cooldownMinutes: 15 },
    }));
    // Existing position worth $300 (0.006 BTC @ $50000) → remaining capacity = $200
    const result = engine.evaluate({
      signal: { action: 'BUY', confidence: 0.95, reason: 'test' } as Signal,
      symbol: 'BTC-USD',
      snapshot: makeSnapshot({
        openPositions: [makePosition({ symbol: 'BTC-USD', quantity: 0.006, marketPrice: 50000 })],
      }),
      ticker: makeTicker({ last: 50000 }),
      nowMs: Date.now(),
    });
    expect(result.allowed).toBe(true);
    // positionSizeUsd should be capped to remaining capacity ($200), not full confidence-scaled value ($463)
    expect(result.positionSizeUsd).toBeLessThanOrEqual(200);
  });

  it('allows trading outside event lockout window', () => {
    const engine = new RiskEngine(makeConfig());
    const now = Date.now();
    engine.getEventLockout().addEvents([{
      name: 'CPI Release',
      time: now + 5 * 3_600_000, // 5 hours from now
      category: 'macro',
      impact: 'high',
    }]);

    const result = engine.evaluate({
      signal: buySignal,
      symbol: 'BTC-USD',
      snapshot: makeSnapshot(),
      ticker: makeTicker(),
      nowMs: now,
    });
    expect(result.allowed).toBe(true);
  });
});
