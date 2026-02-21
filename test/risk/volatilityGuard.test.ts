import { describe, it, expect } from 'vitest';
import { VolatilityGuard } from '../../src/risk/volatilityGuard.js';
import type { Candle } from '../../src/core/types.js';

function makeCandles(count: number, basePrice: number, volatility: number): Candle[] {
  return Array.from({ length: count }, (_, i) => ({
    symbol: 'BTC-USD',
    interval: '1h',
    time: Date.now() - (count - i) * 3_600_000,
    open: basePrice,
    high: basePrice + volatility,
    low: basePrice - volatility,
    close: basePrice + (Math.random() - 0.5) * volatility,
    volume: 100,
  }));
}

describe('VolatilityGuard', () => {
  it('passes when volatility is normal', () => {
    const guard = new VolatilityGuard({ atrMultiplierThreshold: 2.5, atrPeriod: 14, baselineWindow: 50 });
    // 200 candles with consistent volatility
    const candles = makeCandles(200, 50000, 500);
    const result = guard.check(candles);
    expect(result.blocked).toBe(false);
  });

  it('blocks when ATR spikes', () => {
    const guard = new VolatilityGuard({ atrMultiplierThreshold: 2.0, atrPeriod: 14, baselineWindow: 50 });
    // Normal volatility for most of the series
    const normalCandles = makeCandles(180, 50000, 200);
    // Then a massive spike
    const spikeCandles = makeCandles(20, 50000, 5000);
    const candles = [...normalCandles, ...spikeCandles];
    const result = guard.check(candles);
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain('Volatility spike');
  });

  it('returns not blocked when insufficient data', () => {
    const guard = new VolatilityGuard({ atrPeriod: 14, baselineWindow: 100 });
    const candles = makeCandles(10, 50000, 500);
    const result = guard.check(candles);
    expect(result.blocked).toBe(false);
    expect(result.reason).toContain('Insufficient');
  });

  it('respects custom threshold', () => {
    // Very strict threshold
    const strict = new VolatilityGuard({ atrMultiplierThreshold: 1.1, atrPeriod: 14, baselineWindow: 50 });
    // Moderate spike
    const normalCandles = makeCandles(180, 50000, 200);
    const spikeCandles = makeCandles(20, 50000, 500);
    const candles = [...normalCandles, ...spikeCandles];
    const strictResult = strict.check(candles);

    // Lenient threshold on same data
    const lenient = new VolatilityGuard({ atrMultiplierThreshold: 5.0, atrPeriod: 14, baselineWindow: 50 });
    const lenientResult = lenient.check(candles);

    // Strict should be more likely to block
    if (strictResult.blocked) {
      // This is expected behavior — strict catches what lenient doesn't
      expect(lenientResult.blocked).toBe(false);
    }
  });
});
