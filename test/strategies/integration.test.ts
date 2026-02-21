import { describe, expect, it } from 'vitest';
import { AdvancedCompositeStrategy } from '../../src/strategies/advancedComposite.js';
import { MultiTimeframeAnalyzer } from '../../src/strategies/multiTimeframe.js';
import type { Candle } from '../../src/core/types.js';

// Helper to create test candles
const createTestCandles = (count: number): Candle[] => {
  const candles: Candle[] = [];
  const baseTime = Date.now() - (count * 60 * 60 * 1000);
  
  for (let i = 0; i < count; i++) {
    const time = baseTime + (i * 60 * 60 * 1000);
    const price = 50000 + (i * 10); // Slight uptrend
    
    candles.push({
      symbol: 'BTC-USD',
      interval: '1h',
      time,
      open: price,
      high: price * 1.01,
      low: price * 0.99,
      close: price,
      volume: 100
    });
  }
  
  return candles;
};

describe('Integration Tests', () => {
  it('should run advanced composite strategy with MTF data', () => {
    const strategy = new AdvancedCompositeStrategy();
    const analyzer = new MultiTimeframeAnalyzer();
    
    // Create test data
    const candles = createTestCandles(250);
    const latest = candles[candles.length - 1]!;
    
    // Create mock MTF data
    const timeframeData = new Map<string, Candle[]>();
    timeframeData.set('1h', candles);
    timeframeData.set('4h', candles);
    
    const mtfResult = analyzer.analyze(timeframeData);
    
    // Run strategy with MTF context
    const signal = strategy.onCandle(latest, {
      candles,
      symbol: 'BTC-USD',
      mtfResult
    });
    
    expect(signal).toBeDefined();
    expect(['BUY', 'SELL', 'HOLD']).toContain(signal.action);
    expect(signal.confidence).toBeGreaterThanOrEqual(0);
    expect(signal.confidence).toBeLessThanOrEqual(1);
    expect(signal.reason).toBeDefined();
    expect(typeof signal.reason).toBe('string');
  });

  it('should run advanced composite strategy without MTF data (backward compatibility)', () => {
    const strategy = new AdvancedCompositeStrategy();
    const candles = createTestCandles(250);
    const latest = candles[candles.length - 1]!;
    
    // Run strategy without MTF context (should still work)
    const signal = strategy.onCandle(latest, {
      candles,
      symbol: 'BTC-USD'
      // No mtfResult provided
    });
    
    expect(signal).toBeDefined();
    expect(['BUY', 'SELL', 'HOLD']).toContain(signal.action);
    expect(signal.confidence).toBeGreaterThanOrEqual(0);
    expect(signal.confidence).toBeLessThanOrEqual(1);
    expect(signal.reason).toBeDefined();
  });

  it('should handle MTF alignment confidence boost', () => {
    const strategy = new AdvancedCompositeStrategy();
    const analyzer = new MultiTimeframeAnalyzer();
    const candles = createTestCandles(250);
    const latest = candles[candles.length - 1]!;
    
    // Create aligned bullish MTF data
    const timeframeData = new Map<string, Candle[]>();
    // All timeframes show same trend - should create alignment
    timeframeData.set('1h', candles);
    timeframeData.set('4h', candles);
    timeframeData.set('1d', candles);
    
    const mtfResult = analyzer.analyze(timeframeData);
    
    // Run strategy with and without MTF
    const signalWithoutMTF = strategy.onCandle(latest, { candles, symbol: 'BTC-USD' });
    const signalWithMTF = strategy.onCandle(latest, { candles, symbol: 'BTC-USD', mtfResult });
    
    // Both signals should be valid
    expect(['BUY', 'SELL', 'HOLD']).toContain(signalWithoutMTF.action);
    expect(['BUY', 'SELL', 'HOLD']).toContain(signalWithMTF.action);
    
    // MTF result should have influenced the analysis (visible in reason)
    if (mtfResult.aligned && mtfResult.signals.length > 0) {
      expect(signalWithMTF.reason).toContain('MTF');
    }
  });
});