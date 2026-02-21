import { describe, expect, it } from 'vitest';
import { MultiTimeframeAnalyzer } from '../../src/strategies/multiTimeframe.js';
import type { Candle } from '../../src/core/types.js';

// Helper to create trending candles
const createTrendingCandles = (count: number, trend: 'up' | 'down' | 'sideways'): Candle[] => {
  const candles: Candle[] = [];
  const baseTime = Date.now() - (count * 60 * 60 * 1000);
  let basePrice = 50000;
  
  for (let i = 0; i < count; i++) {
    const time = baseTime + (i * 60 * 60 * 1000);
    
    // Create trending price movement
    if (trend === 'up') {
      basePrice += Math.random() * 100 + 20; // Generally upward
    } else if (trend === 'down') {
      basePrice -= Math.random() * 100 + 20; // Generally downward
    } else {
      basePrice += (Math.random() - 0.5) * 50; // Sideways
    }
    
    const high = basePrice * (1 + Math.random() * 0.02);
    const low = basePrice * (1 - Math.random() * 0.02);
    
    candles.push({
      symbol: 'BTC-USD',
      interval: '1h',
      time,
      open: basePrice,
      high,
      low,
      close: basePrice,
      volume: 100 + Math.random() * 50
    });
  }
  
  return candles;
};

describe('MultiTimeframeAnalyzer', () => {
  const analyzer = new MultiTimeframeAnalyzer();

  it('should identify bullish trend with proper EMA stack', () => {
    const bullishCandles = createTrendingCandles(250, 'up');
    const signal = analyzer.analyzeTrend(bullishCandles, '1h');
    
    expect(signal.timeframe).toBe('1h');
    expect(signal.trend).toBe('bullish');
    expect(signal.strength).toBeGreaterThan(0);
    expect(signal.reason).toContain('1h');
  });

  it('should identify bearish trend with proper EMA stack', () => {
    const bearishCandles = createTrendingCandles(250, 'down');
    const signal = analyzer.analyzeTrend(bearishCandles, '4h');
    
    expect(signal.timeframe).toBe('4h');
    expect(signal.trend).toBe('bearish');
    expect(signal.strength).toBeGreaterThan(0);
    expect(signal.reason).toContain('4h');
  });

  it('should handle insufficient data gracefully', () => {
    const fewCandles = createTrendingCandles(50, 'up'); // Less than 200 required
    const signal = analyzer.analyzeTrend(fewCandles, '1d');
    
    expect(signal.trend).toBe('neutral');
    expect(signal.strength).toBe(0);
    expect(signal.reason).toContain('Insufficient data');
  });

  it('should detect aligned bullish signals across timeframes', () => {
    const timeframeData = new Map<string, Candle[]>();
    
    // All timeframes bullish
    timeframeData.set('1h', createTrendingCandles(250, 'up'));
    timeframeData.set('4h', createTrendingCandles(250, 'up'));
    timeframeData.set('1d', createTrendingCandles(250, 'up'));
    
    const result = analyzer.analyze(timeframeData);
    
    expect(result.aligned).toBe(true);
    expect(result.direction).toBe('bullish');
    expect(result.confidenceBoost).toBeGreaterThan(0);
    expect(result.signals).toHaveLength(3);
  });

  it('should detect mixed signals and handle conflicts', () => {
    const timeframeData = new Map<string, Candle[]>();
    
    // Mixed signals: daily bearish, hourly bullish
    timeframeData.set('1h', createTrendingCandles(250, 'up'));
    timeframeData.set('4h', createTrendingCandles(250, 'up'));
    timeframeData.set('1d', createTrendingCandles(250, 'down'));
    
    const result = analyzer.analyze(timeframeData);
    
    expect(result.aligned).toBe(false);
    expect(result.direction).toBe('bearish'); // Daily should dominate
    expect(result.confidenceBoost).toBeLessThanOrEqual(0); // Should reduce confidence
    expect(result.signals).toHaveLength(3);
  });

  it('should prioritize higher timeframes', () => {
    const timeframeData = new Map<string, Candle[]>();
    
    // Only daily data available
    timeframeData.set('1d', createTrendingCandles(250, 'down'));
    
    const result = analyzer.analyze(timeframeData);
    
    expect(result.direction).toBe('bearish');
    expect(result.signals).toHaveLength(1);
    expect(result.signals[0]?.timeframe).toBe('1d');
  });

  it('should handle empty timeframe data', () => {
    const emptyData = new Map<string, Candle[]>();
    const result = analyzer.analyze(emptyData);
    
    expect(result.aligned).toBe(false);
    expect(result.direction).toBe('neutral');
    expect(result.confidenceBoost).toBe(0);
    expect(result.signals).toHaveLength(0);
  });

  it('should sort signals by timeframe priority', () => {
    const timeframeData = new Map<string, Candle[]>();
    
    // Add in reverse priority order
    timeframeData.set('1h', createTrendingCandles(250, 'up'));
    timeframeData.set('1d', createTrendingCandles(250, 'up'));
    timeframeData.set('4h', createTrendingCandles(250, 'up'));
    
    const result = analyzer.analyze(timeframeData);
    
    // Should be sorted by priority: 1d, 4h, 1h
    expect(result.signals[0]?.timeframe).toBe('1d');
    expect(result.signals[1]?.timeframe).toBe('4h');
    expect(result.signals[2]?.timeframe).toBe('1h');
  });
});