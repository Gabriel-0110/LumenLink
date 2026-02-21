import { describe, expect, it } from 'vitest';
import { createStrategy } from '../../src/strategies/selector.js';
import { GridTradingStrategy } from '../../src/strategies/gridTrading.js';
import { SmartDCAStrategy } from '../../src/strategies/smartDCA.js';
import type { Candle } from '../../src/core/types.js';

// Helper to create mock candles
const createMockCandles = (count: number): Candle[] => {
  const candles: Candle[] = [];
  const baseTime = Date.now() - (count * 60 * 60 * 1000); // 1 hour intervals
  
  for (let i = 0; i < count; i++) {
    const time = baseTime + (i * 60 * 60 * 1000);
    const price = 50000 + (Math.sin(i * 0.1) * 2000); // Oscillating price around 50k
    
    candles.push({
      symbol: 'BTC-USD',
      interval: '1h',
      time,
      open: price,
      high: price * 1.02,
      low: price * 0.98,
      close: price,
      volume: 100 + Math.random() * 50
    });
  }
  
  return candles;
};

describe('strategy selector', () => {
  it('creates grid trading strategy', () => {
    const strategy = createStrategy('grid_trading');
    expect(strategy).toBeInstanceOf(GridTradingStrategy);
    expect(strategy.name).toBe('grid_trading');
  });

  it('creates smart DCA strategy', () => {
    const strategy = createStrategy('smart_dca');
    expect(strategy).toBeInstanceOf(SmartDCAStrategy);
    expect(strategy.name).toBe('smart_dca');
  });

  it('defaults to advanced composite for unknown strategy', () => {
    const strategy = createStrategy('unknown_strategy');
    expect(strategy.name).toBe('advanced_composite');
  });
});

describe('grid trading strategy', () => {
  it('requires sufficient data', () => {
    const strategy = new GridTradingStrategy();
    const candles = createMockCandles(10); // Not enough data
    const signal = strategy.onCandle(candles[9]!, { candles, symbol: 'BTC-USD' });
    
    expect(signal.action).toBe('HOLD');
    expect(signal.reason).toContain('Insufficient data');
  });

  it('handles sufficient data without errors', () => {
    const strategy = new GridTradingStrategy();
    const candles = createMockCandles(60); // Sufficient data
    const signal = strategy.onCandle(candles[59]!, { candles, symbol: 'BTC-USD' });
    
    expect(['BUY', 'SELL', 'HOLD']).toContain(signal.action);
    expect(signal.confidence).toBeGreaterThan(0);
    expect(signal.reason).toBeTruthy();
  });
});

describe('smart DCA strategy', () => {
  it('requires sufficient data', () => {
    const strategy = new SmartDCAStrategy();
    const candles = createMockCandles(10); // Not enough data
    const signal = strategy.onCandle(candles[9]!, { candles, symbol: 'BTC-USD' });
    
    expect(signal.action).toBe('HOLD');
    expect(signal.reason).toContain('Insufficient data');
  });

  it('initializes properly on first run', () => {
    const strategy = new SmartDCAStrategy();
    const candles = createMockCandles(30);
    const signal = strategy.onCandle(candles[29]!, { candles, symbol: 'BTC-USD' });
    
    expect(signal.action).toBe('HOLD');
    expect(signal.reason).toContain('initialized');
  });

  it('generates buy signals after interval', () => {
    const strategy = new SmartDCAStrategy({ baseInterval: 1, maxConfidence: 0.9 }); // 1 hour interval
    const candles = createMockCandles(50); // Enough candles for RSI calculation
    
    // First call initializes - use candle with enough history
    const firstCandle = candles[25]!;
    const initSignal = strategy.onCandle(firstCandle, { candles: candles.slice(0, 26), symbol: 'BTC-USD' });
    expect(initSignal.action).toBe('HOLD');
    expect(initSignal.reason).toContain('initialized');
    
    // Create a candle that's 2 hours later to trigger the buy signal
    const laterCandle = {
      ...candles[40]!,
      time: firstCandle.time + (2 * 60 * 60 * 1000) // 2 hours later
    };
    
    const signal = strategy.onCandle(laterCandle, { candles: candles.slice(0, 41), symbol: 'BTC-USD' });
    
    expect(signal.action).toBe('BUY');
    expect(signal.confidence).toBeGreaterThan(0);
    expect(signal.reason).toContain('DCA');
  });

  it('respects sentiment data when available', () => {
    const strategy = new SmartDCAStrategy({ baseInterval: 1, maxConfidence: 0.9 });
    const candles = createMockCandles(50);
    
    // Initialize with first candle (with enough history)
    const firstCandle = candles[25]!;
    strategy.onCandle(firstCandle, { candles: candles.slice(0, 26), symbol: 'BTC-USD' });
    
    // Create a later candle to trigger interval check
    const laterCandle = {
      ...candles[40]!,
      time: firstCandle.time + (2 * 60 * 60 * 1000) // 2 hours later
    };
    
    // Test with extreme greed (should skip buy)
    const contextWithGreed = {
      candles: candles.slice(0, 41),
      symbol: 'BTC-USD',
      sentiment: { fearGreedIndex: 85 }
    };
    
    const signal = strategy.onCandle(laterCandle, contextWithGreed as any);
    expect(signal.action).toBe('HOLD');
    expect(signal.reason).toContain('Extreme Greed');
  });
});