/**
 * Anomaly Detector — flags unusual market behavior.
 * 
 * Detects:
 *   - Volume spikes (unusual buying/selling pressure)
 *   - Spread blowouts (liquidity drying up)
 *   - Price gaps (sudden dislocations)
 *   - Candle body anomalies (wicks suggesting manipulation)
 * 
 * This module ALERTS but doesn't trade. It feeds into the risk engine
 * as additional context for decision-making.
 */

import type { Candle, Ticker } from '../core/types.js';

export type AnomalyType = 'volume_spike' | 'spread_blowout' | 'price_gap' | 'wick_anomaly' | 'stale_data';

export interface Anomaly {
  type: AnomalyType;
  severity: 'low' | 'medium' | 'high';
  message: string;
  value: number;          // the anomalous value
  threshold: number;      // what the threshold was
  timestamp: number;
}

export interface AnomalyConfig {
  /** Volume spike = current volume / median volume > this. Default: 3.0 */
  volumeSpikeThreshold: number;
  /** Spread blowout in bps. Default: 50 */
  spreadBlowoutBps: number;
  /** Price gap = abs(open - prevClose) / prevClose > this. Default: 0.02 (2%) */
  priceGapThreshold: number;
  /** Wick ratio = wick length / body length > this. Default: 5.0 */
  wickAnomalyRatio: number;
  /** Stale data = no new candle for this many expected intervals. Default: 3 */
  staleDataMultiplier: number;
}

const DEFAULT_CONFIG: AnomalyConfig = {
  volumeSpikeThreshold: 3.0,
  spreadBlowoutBps: 50,
  priceGapThreshold: 0.02,
  wickAnomalyRatio: 5.0,
  staleDataMultiplier: 3,
};

export class AnomalyDetector {
  private readonly config: AnomalyConfig;
  private lastCandleTime: number = 0;

  constructor(config: Partial<AnomalyConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check candles for anomalies. Returns array of detected anomalies.
   */
  checkCandles(candles: Candle[]): Anomaly[] {
    const anomalies: Anomaly[] = [];
    if (candles.length < 20) return anomalies;

    const latest = candles[candles.length - 1]!;
    const prev = candles[candles.length - 2]!;

    // ── Volume Spike ─────────────────────────────────────────────
    const volumes = candles.slice(-50).map(c => c.volume);
    const sorted = [...volumes].sort((a, b) => a - b);
    const medianVol = sorted[Math.floor(sorted.length / 2)]!;

    if (medianVol > 0 && latest.volume / medianVol > this.config.volumeSpikeThreshold) {
      const ratio = latest.volume / medianVol;
      anomalies.push({
        type: 'volume_spike',
        severity: ratio > 5 ? 'high' : ratio > 3 ? 'medium' : 'low',
        message: `Volume ${ratio.toFixed(1)}x median (${latest.volume.toFixed(0)} vs median ${medianVol.toFixed(0)})`,
        value: ratio,
        threshold: this.config.volumeSpikeThreshold,
        timestamp: latest.time,
      });
    }

    // ── Price Gap ────────────────────────────────────────────────
    if (prev.close > 0) {
      const gapPct = Math.abs(latest.open - prev.close) / prev.close;
      if (gapPct > this.config.priceGapThreshold) {
        anomalies.push({
          type: 'price_gap',
          severity: gapPct > 0.05 ? 'high' : gapPct > 0.03 ? 'medium' : 'low',
          message: `Price gap ${(gapPct * 100).toFixed(1)}% between candles ($${prev.close.toFixed(2)} → $${latest.open.toFixed(2)})`,
          value: gapPct,
          threshold: this.config.priceGapThreshold,
          timestamp: latest.time,
        });
      }
    }

    // ── Wick Anomaly (manipulation signal) ───────────────────────
    const body = Math.abs(latest.close - latest.open);
    const upperWick = latest.high - Math.max(latest.close, latest.open);
    const lowerWick = Math.min(latest.close, latest.open) - latest.low;
    const totalWick = upperWick + lowerWick;

    if (body > 0 && totalWick / body > this.config.wickAnomalyRatio) {
      const ratio = totalWick / body;
      anomalies.push({
        type: 'wick_anomaly',
        severity: ratio > 10 ? 'high' : 'medium',
        message: `Extreme wicks: wick/body ratio ${ratio.toFixed(1)}x (possible manipulation or flash crash)`,
        value: ratio,
        threshold: this.config.wickAnomalyRatio,
        timestamp: latest.time,
      });
    }

    // ── Stale Data ───────────────────────────────────────────────
    if (this.lastCandleTime > 0 && candles.length >= 2) {
      const expectedInterval = candles[candles.length - 1]!.time - candles[candles.length - 2]!.time;
      const timeSinceLast = Date.now() - latest.time;
      if (expectedInterval > 0 && timeSinceLast > expectedInterval * this.config.staleDataMultiplier) {
        anomalies.push({
          type: 'stale_data',
          severity: timeSinceLast > expectedInterval * 5 ? 'high' : 'medium',
          message: `No new candle for ${(timeSinceLast / 60_000).toFixed(0)} min (expected every ${(expectedInterval / 60_000).toFixed(0)} min)`,
          value: timeSinceLast / expectedInterval,
          threshold: this.config.staleDataMultiplier,
          timestamp: Date.now(),
        });
      }
    }
    this.lastCandleTime = latest.time;

    return anomalies;
  }

  /**
   * Check ticker for spread anomalies.
   */
  checkTicker(ticker: Ticker): Anomaly[] {
    const anomalies: Anomaly[] = [];
    const mid = (ticker.bid + ticker.ask) / 2;

    if (mid > 0) {
      const spreadBps = ((ticker.ask - ticker.bid) / mid) * 10_000;
      if (spreadBps > this.config.spreadBlowoutBps) {
        anomalies.push({
          type: 'spread_blowout',
          severity: spreadBps > 100 ? 'high' : 'medium',
          message: `Spread blowout: ${spreadBps.toFixed(0)} bps (bid $${ticker.bid.toFixed(2)}, ask $${ticker.ask.toFixed(2)})`,
          value: spreadBps,
          threshold: this.config.spreadBlowoutBps,
          timestamp: ticker.time,
        });
      }
    }

    return anomalies;
  }
}
