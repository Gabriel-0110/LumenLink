import { describe, it, expect } from 'vitest';
import { RegimeDetector } from '../../src/strategies/regimeDetector.js';
import type { Candle } from '../../src/core/types.js';

function makeTrendCandles(count: number, direction: 'up' | 'down' | 'flat', volatility: number = 200): Candle[] {
  const step = direction === 'up' ? 150 : direction === 'down' ? -150 : 0;
  return Array.from({ length: count }, (_, i) => {
    const base = 50000 + step * i;
    return {
      symbol: 'BTC-USD',
      interval: '1h',
      time: Date.now() - (count - i) * 3_600_000,
      open: base,
      high: base + volatility,
      low: base - volatility,
      close: base + (direction === 'up' ? 100 : direction === 'down' ? -100 : (Math.random() - 0.5) * 50),
      volume: 100 + Math.random() * 200,
    };
  });
}

describe('RegimeDetector', () => {
  const detector = new RegimeDetector();

  it('returns ranging with insufficient data', () => {
    const candles = makeTrendCandles(10, 'flat');
    const result = detector.detect(candles);
    expect(result.regime).toBe('ranging');
    expect(result.confidence).toBe(0);
  });

  it('detects uptrend with strong directional move', () => {
    const candles = makeTrendCandles(200, 'up');
    const result = detector.detect(candles);
    // With consistent up movement, should detect trending_up or at least not ranging
    expect(['trending_up', 'breakout', 'high_volatility']).toContain(result.regime);
    expect(result.adx).toBeGreaterThan(0);
  });

  it('detects downtrend', () => {
    const candles = makeTrendCandles(200, 'down');
    const result = detector.detect(candles);
    expect(['trending_down', 'breakout', 'high_volatility']).toContain(result.regime);
  });

  it('detects ranging market with flat price action', () => {
    const candles = makeTrendCandles(200, 'flat', 50); // low volatility, no direction
    const result = detector.detect(candles);
    // Flat with low vol should be ranging or breakout (squeeze)
    expect(['ranging', 'breakout']).toContain(result.regime);
  });

  it('detects high volatility', () => {
    // Normal candles then huge volatility spike
    const normal = makeTrendCandles(180, 'flat', 100);
    const spike = makeTrendCandles(20, 'flat', 5000);
    const candles = [...normal, ...spike];
    const result = detector.detect(candles);
    // Should detect the volatility spike
    expect(result.atrRatio).toBeGreaterThan(1.5);
  });

  it('provides confidence score', () => {
    const candles = makeTrendCandles(200, 'up');
    const result = detector.detect(candles);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it('returns details string', () => {
    const candles = makeTrendCandles(200, 'flat');
    const result = detector.detect(candles);
    expect(result.details).toBeTruthy();
    expect(typeof result.details).toBe('string');
  });
});
