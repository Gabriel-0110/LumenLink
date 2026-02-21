/**
 * Volatility circuit breaker — disables trading when ATR/volatility exceeds threshold.
 * Uses a rolling window of recent ATR values to detect regime changes.
 */

import type { Candle } from '../core/types.js';
import { ATR } from 'technicalindicators';

export interface VolatilityGuardConfig {
  /** ATR multiplier threshold — if current ATR > (median ATR * multiplier), block trading */
  atrMultiplierThreshold: number;
  /** ATR period (default 14) */
  atrPeriod: number;
  /** How many candles to use for median ATR baseline (default 100) */
  baselineWindow: number;
}

const DEFAULT_CONFIG: VolatilityGuardConfig = {
  atrMultiplierThreshold: 2.5,
  atrPeriod: 14,
  baselineWindow: 100,
};

export class VolatilityGuard {
  private readonly config: VolatilityGuardConfig;

  constructor(config: Partial<VolatilityGuardConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check if volatility is too high to trade.
   * Returns { blocked: true, reason } if ATR spike detected.
   */
  check(candles: Candle[]): { blocked: boolean; reason: string; currentAtr?: number; medianAtr?: number } {
    if (candles.length < this.config.atrPeriod + this.config.baselineWindow) {
      return { blocked: false, reason: 'Insufficient data for volatility check' };
    }

    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const closes = candles.map(c => c.close);

    const atrValues = ATR.calculate({
      high: highs,
      low: lows,
      close: closes,
      period: this.config.atrPeriod,
    });

    if (atrValues.length < 2) {
      return { blocked: false, reason: 'Not enough ATR values' };
    }

    const currentAtr = atrValues[atrValues.length - 1]!;
    const baselineSlice = atrValues.slice(-this.config.baselineWindow);
    const sorted = [...baselineSlice].sort((a, b) => a - b);
    const medianAtr = sorted[Math.floor(sorted.length / 2)]!;

    if (medianAtr <= 0) {
      return { blocked: false, reason: 'Median ATR is zero', currentAtr, medianAtr };
    }

    const ratio = currentAtr / medianAtr;

    if (ratio > this.config.atrMultiplierThreshold) {
      return {
        blocked: true,
        reason: `Volatility spike: ATR ${currentAtr.toFixed(2)} is ${ratio.toFixed(1)}x median (threshold: ${this.config.atrMultiplierThreshold}x)`,
        currentAtr,
        medianAtr,
      };
    }

    return { blocked: false, reason: 'Volatility within normal range', currentAtr, medianAtr };
  }
}
