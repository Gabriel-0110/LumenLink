/**
 * Edge Scorer — estimates probability that a move exceeds trading costs.
 *
 * Phase 1: Statistical method (no ML yet).
 *   - Uses recent volatility distribution to estimate P(move > threshold)
 *   - Threshold = fees + estimated slippage
 *   - Combines with ensemble confidence for calibrated probability
 *
 * Phase 3 will add ML-based scoring with proper calibration.
 */

import type { Candle } from '../../core/types.js';
import type { EdgeForecast, EnsembleResult, MarketState } from '../types.js';

interface EdgeScorerConfig {
  feeRateBps: number;          // exchange fee in bps (one-way)
  defaultSlippageBps: number;  // estimated slippage
  horizonCandles: number;      // forecast horizon in candle count
  minHistoryCandles: number;   // minimum candles for statistics
}

const DEFAULT_CONFIG: EdgeScorerConfig = {
  feeRateBps: 60,              // 0.6% taker (Coinbase)
  defaultSlippageBps: 10,
  horizonCandles: 3,           // next 3 candles (~15m for 5m interval)
  minHistoryCandles: 60,
};

export class EdgeScorer {
  private readonly cfg: EdgeScorerConfig;

  constructor(config: Partial<EdgeScorerConfig> = {}) {
    this.cfg = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Score the edge of a potential trade given current market context.
   */
  score(
    symbol: string,
    candles: Candle[],
    ensemble: EnsembleResult,
    marketState: MarketState,
    intervalMs: number,
  ): EdgeForecast {
    const now = Date.now();
    const horizonMs = intervalMs * this.cfg.horizonCandles;
    const costBps = this.cfg.feeRateBps * 2 + this.cfg.defaultSlippageBps; // round trip

    if (candles.length < this.cfg.minHistoryCandles) {
      return this.fallbackForecast(symbol, now, horizonMs, costBps);
    }

    const closes = candles.map(c => c.close);

    // Compute n-period returns distribution
    const returns: number[] = [];
    for (let i = this.cfg.horizonCandles; i < closes.length; i++) {
      const ret = (closes[i]! - closes[i - this.cfg.horizonCandles]!) /
                  closes[i - this.cfg.horizonCandles]! * 10000; // in bps
      returns.push(ret);
    }

    if (returns.length < 20) {
      return this.fallbackForecast(symbol, now, horizonMs, costBps);
    }

    // Distribution statistics
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
    const stdDev = Math.sqrt(variance);

    // P(move > cost threshold) using empirical distribution
    const upMoves = returns.filter(r => r > costBps).length;
    const downMoves = returns.filter(r => r < -costBps).length;
    const empiricalProbUp = upMoves / returns.length;
    const empiricalProbDown = downMoves / returns.length;

    // Adjust with ensemble signal
    let probabilityUp = empiricalProbUp;
    let probabilityDown = empiricalProbDown;

    if (ensemble.direction === 1 && ensemble.confidence > 0.3) {
      // Bullish ensemble — boost upside probability
      const boost = ensemble.confidence * 0.15; // max +15% probability boost
      probabilityUp = Math.min(0.95, probabilityUp + boost);
      probabilityDown = Math.max(0.05, probabilityDown - boost * 0.5);
    } else if (ensemble.direction === -1 && ensemble.confidence > 0.3) {
      const boost = ensemble.confidence * 0.15;
      probabilityDown = Math.min(0.95, probabilityDown + boost);
      probabilityUp = Math.max(0.05, probabilityUp - boost * 0.5);
    }

    // Expected return (conditional on ensemble direction)
    let expectedReturnBps: number;
    if (ensemble.direction === 1) {
      const upReturns = returns.filter(r => r > 0);
      const avgUp = upReturns.length > 0
        ? upReturns.reduce((a, b) => a + b, 0) / upReturns.length
        : 0;
      expectedReturnBps = Math.round(avgUp * probabilityUp - costBps);
    } else if (ensemble.direction === -1) {
      const downReturns = returns.filter(r => r < 0);
      const avgDown = downReturns.length > 0
        ? Math.abs(downReturns.reduce((a, b) => a + b, 0) / downReturns.length)
        : 0;
      expectedReturnBps = Math.round(avgDown * probabilityDown - costBps);
    } else {
      expectedReturnBps = Math.round(mean - costBps);
    }

    // Slippage adjustment based on liquidity
    let adjustedCostBps = costBps;
    if (marketState.liquidity.slippageRisk === 'high') adjustedCostBps += 15;
    if (marketState.liquidity.slippageRisk === 'extreme') adjustedCostBps += 40;

    const exceedsCosts = expectedReturnBps > adjustedCostBps;

    // Uncertainty: width of confidence interval
    const uncertainty = stdDev * 2; // ~95% CI width in bps

    // Calibration score (statistical method gets moderate score)
    const calibrationScore = Math.min(0.7, returns.length / 200);

    return {
      symbol,
      timestamp: now,
      horizonMs,
      probabilityUp,
      probabilityDown,
      expectedReturnBps,
      uncertainty,
      exceedsCosts,
      costBps: adjustedCostBps,
      calibrationScore,
      method: 'statistical',
    };
  }

  private fallbackForecast(
    symbol: string, timestamp: number, horizonMs: number, costBps: number,
  ): EdgeForecast {
    return {
      symbol, timestamp, horizonMs,
      probabilityUp: 0.5, probabilityDown: 0.5,
      expectedReturnBps: 0, uncertainty: 999,
      exceedsCosts: false, costBps,
      calibrationScore: 0, method: 'statistical',
    };
  }
}
