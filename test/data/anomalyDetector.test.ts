import { describe, it, expect } from 'vitest';
import { AnomalyDetector } from '../../src/data/anomalyDetector.js';
import { makeCandle, makeTicker } from '../helpers.js';

describe('AnomalyDetector', () => {
  const detector = new AnomalyDetector();

  it('returns empty for normal candles', () => {
    const candles = Array.from({ length: 50 }, (_, i) =>
      makeCandle({ time: (i + 1) * 3_600_000, volume: 100 + Math.random() * 50 })
    );
    const anomalies = detector.checkCandles(candles);
    // Most should be empty for normal data
    const volumeSpikes = anomalies.filter(a => a.type === 'volume_spike');
    expect(volumeSpikes.length).toBeLessThanOrEqual(1); // random might occasionally hit
  });

  it('detects volume spikes', () => {
    const candles = Array.from({ length: 50 }, (_, i) =>
      makeCandle({
        time: (i + 1) * 3_600_000,
        volume: i === 49 ? 10000 : 100, // last candle has 100x volume
      })
    );
    const anomalies = detector.checkCandles(candles);
    const spike = anomalies.find(a => a.type === 'volume_spike');
    expect(spike).toBeDefined();
    expect(spike!.severity).toBe('high');
  });

  it('detects price gaps', () => {
    const candles = Array.from({ length: 30 }, (_, i) =>
      makeCandle({
        time: (i + 1) * 3_600_000,
        open: i === 29 ? 55000 : 50000, // 10% gap on last candle
        close: i === 28 ? 50000 : 50000,
      })
    );
    const anomalies = detector.checkCandles(candles);
    const gap = anomalies.find(a => a.type === 'price_gap');
    expect(gap).toBeDefined();
  });

  it('detects wick anomalies', () => {
    const candles = Array.from({ length: 30 }, (_, i) =>
      makeCandle({
        time: (i + 1) * 3_600_000,
        open: 50000,
        close: i === 29 ? 50010 : 50050,  // tiny body on last
        high: i === 29 ? 51000 : 50200,   // huge upper wick
        low: i === 29 ? 49000 : 49800,    // huge lower wick
      })
    );
    const anomalies = detector.checkCandles(candles);
    const wick = anomalies.find(a => a.type === 'wick_anomaly');
    expect(wick).toBeDefined();
  });

  it('detects spread blowouts on ticker', () => {
    const anomalies = detector.checkTicker(makeTicker({ bid: 49000, ask: 51000 }));
    const blowout = anomalies.find(a => a.type === 'spread_blowout');
    expect(blowout).toBeDefined();
    expect(blowout!.severity).toBe('high');
  });

  it('returns empty for normal spread', () => {
    const anomalies = detector.checkTicker(makeTicker({ bid: 50000, ask: 50010 }));
    expect(anomalies).toHaveLength(0);
  });

  it('returns empty with insufficient data', () => {
    const candles = [makeCandle()];
    const anomalies = detector.checkCandles(candles);
    expect(anomalies).toHaveLength(0);
  });
});
