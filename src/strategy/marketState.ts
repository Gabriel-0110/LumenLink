/**
 * Market State Engine — the "world model"
 *
 * Outputs a unified state per symbol:
 *   regime, volatility, liquidity, momentum, microstructure warnings, data integrity
 *
 * Strategies respond to market state, not raw candle math.
 */

import { ADX, ATR, BollingerBands, EMA, RSI } from 'technicalindicators';
import type { Candle, Ticker } from '../core/types.js';
import type {
  MarketState,
  Regime,
  VolatilityState,
  LiquidityState,
  MomentumState,
  MicrostructureWarnings,
  DataIntegrity,
} from './types.js';

interface MarketStateConfig {
  atrPeriod: number;
  adxPeriod: number;
  emaPeriod: number;
  bbPeriod: number;
  volLookback: number;         // candles for realized vol
  atrSpikeThreshold: number;
  spreadHighPct: number;       // spread % considered "high"
  staleDataMs: number;         // ms before data is considered stale
  expectedIntervalMs: number;  // expected candle interval
}

const DEFAULT_CONFIG: MarketStateConfig = {
  atrPeriod: 14,
  adxPeriod: 14,
  emaPeriod: 50,
  bbPeriod: 20,
  volLookback: 60,
  atrSpikeThreshold: 2.5,
  spreadHighPct: 0.15,
  staleDataMs: 120_000,
  expectedIntervalMs: 300_000, // 5m default
};

export class MarketStateEngine {
  private readonly cfg: MarketStateConfig;
  private lastState: Map<string, MarketState> = new Map();

  constructor(config: Partial<MarketStateConfig> = {}) {
    this.cfg = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Compute full market state from candles + optional ticker.
   * Needs ≥100 candles for reliable classification.
   */
  compute(symbol: string, candles: Candle[], ticker?: Ticker): MarketState {
    const now = Date.now();

    if (candles.length < 100) {
      return this.fallbackState(symbol, now, 'Insufficient data');
    }

    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const volumes = candles.map(c => c.volume);
    const price = closes[closes.length - 1]!;

    const volatility = this.computeVolatility(highs, lows, closes, price);
    const liquidity = this.computeLiquidity(ticker, volumes, price);
    const momentum = this.computeMomentum(closes);
    const microstructure = this.computeMicrostructure(candles, ticker);
    const dataIntegrity = this.computeDataIntegrity(candles, now);
    const { regime, regimeConfidence } = this.classifyRegime(
      closes, highs, lows, volatility, liquidity, momentum,
    );

    const state: MarketState = {
      symbol,
      timestamp: now,
      regime,
      regimeConfidence,
      volatility,
      liquidity,
      momentum,
      microstructure,
      dataIntegrity,
      summary: this.buildSummary(regime, volatility, liquidity, momentum, microstructure),
    };

    this.lastState.set(symbol, state);
    return state;
  }

  getLastState(symbol: string): MarketState | undefined {
    return this.lastState.get(symbol);
  }

  // ── Volatility ───────────────────────────────────────────────────────────

  private computeVolatility(
    highs: number[], lows: number[], closes: number[], price: number,
  ): VolatilityState {
    // ATR
    const atrValues = ATR.calculate({
      high: highs, low: lows, close: closes, period: this.cfg.atrPeriod,
    });
    const currentAtr = atrValues[atrValues.length - 1] ?? 0;
    const atrPercent = price > 0 ? (currentAtr / price) * 100 : 0;

    // Realized volatility (annualized from log returns)
    const lookback = closes.slice(-this.cfg.volLookback);
    const logReturns: number[] = [];
    for (let i = 1; i < lookback.length; i++) {
      if (lookback[i - 1]! > 0 && lookback[i]! > 0) {
        logReturns.push(Math.log(lookback[i]! / lookback[i - 1]!));
      }
    }
    const meanReturn = logReturns.length > 0
      ? logReturns.reduce((a, b) => a + b, 0) / logReturns.length
      : 0;
    const variance = logReturns.length > 1
      ? logReturns.reduce((s, r) => s + (r - meanReturn) ** 2, 0) / (logReturns.length - 1)
      : 0;
    const realizedVol = Math.sqrt(variance) * Math.sqrt(365 * 288); // annualized for 5m candles

    // Vol-of-vol: standard deviation of rolling 10-period volatility
    const rollingVols: number[] = [];
    for (let i = 10; i < logReturns.length; i++) {
      const window = logReturns.slice(i - 10, i);
      const wMean = window.reduce((a, b) => a + b, 0) / window.length;
      const wVar = window.reduce((s, r) => s + (r - wMean) ** 2, 0) / (window.length - 1);
      rollingVols.push(Math.sqrt(wVar));
    }
    const volMean = rollingVols.length > 0
      ? rollingVols.reduce((a, b) => a + b, 0) / rollingVols.length
      : 0;
    const volOfVol = rollingVols.length > 1
      ? Math.sqrt(
          rollingVols.reduce((s, v) => s + (v - volMean) ** 2, 0) / (rollingVols.length - 1),
        )
      : 0;

    // Percentile: where current vol sits in recent ATR history
    const sorted = [...atrValues].sort((a, b) => a - b);
    const rank = sorted.findIndex(v => v >= currentAtr);
    const percentile = sorted.length > 0 ? rank / sorted.length : 0.5;

    return { atrPercent, realizedVol, volOfVol, percentile };
  }

  // ── Liquidity ────────────────────────────────────────────────────────────

  private computeLiquidity(
    ticker: Ticker | undefined, volumes: number[], price: number,
  ): LiquidityState {
    // Spread
    const spreadPercent = ticker && ticker.bid > 0 && ticker.ask > 0
      ? ((ticker.ask - ticker.bid) / ((ticker.ask + ticker.bid) / 2)) * 100
      : 0;

    // Volume ratio
    const recent20 = volumes.slice(-20);
    const avgVol = recent20.length > 0
      ? recent20.reduce((a, b) => a + b, 0) / recent20.length
      : 0;
    const currentVol = volumes[volumes.length - 1] ?? 0;
    const volumeRatio = avgVol > 0 ? currentVol / avgVol : 1;

    // Depth proxy (estimated from volume and spread)
    const depthProxy = Math.min(1, Math.max(0,
      (volumeRatio * 0.5 + (1 - Math.min(spreadPercent / this.cfg.spreadHighPct, 1)) * 0.5),
    ));

    // Slippage risk classification
    let slippageRisk: LiquidityState['slippageRisk'];
    if (spreadPercent > this.cfg.spreadHighPct * 2 || volumeRatio < 0.2) {
      slippageRisk = 'extreme';
    } else if (spreadPercent > this.cfg.spreadHighPct || volumeRatio < 0.5) {
      slippageRisk = 'high';
    } else if (spreadPercent > this.cfg.spreadHighPct * 0.5 || volumeRatio < 0.8) {
      slippageRisk = 'medium';
    } else {
      slippageRisk = 'low';
    }

    return { spreadPercent, depthProxy, slippageRisk, volumeRatio };
  }

  // ── Momentum ─────────────────────────────────────────────────────────────

  private computeMomentum(closes: number[]): MomentumState {
    const lookback = closes.slice(-30);
    if (lookback.length < 10) {
      return { trendSlope: 0, strength: 0, persistence: 0, direction: 0 };
    }

    // Linear regression slope
    const n = lookback.length;
    const xMean = (n - 1) / 2;
    const yMean = lookback.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
      num += (i - xMean) * (lookback[i]! - yMean);
      den += (i - xMean) ** 2;
    }
    const slope = den > 0 ? num / den : 0;
    const trendSlope = yMean > 0 ? (slope / yMean) * 100 : 0; // % per candle

    // Strength from ADX
    const rsiValues = RSI.calculate({ values: closes, period: 14 });
    const rsi = rsiValues[rsiValues.length - 1] ?? 50;
    const strength = Math.abs(rsi - 50) / 50; // 0-1

    // Persistence: sign autocorrelation of returns
    const returns: number[] = [];
    for (let i = 1; i < lookback.length; i++) {
      returns.push(lookback[i]! - lookback[i - 1]!);
    }
    let sameSign = 0;
    for (let i = 1; i < returns.length; i++) {
      if (Math.sign(returns[i]!) === Math.sign(returns[i - 1]!)) sameSign++;
    }
    const persistence = returns.length > 1 ? sameSign / (returns.length - 1) : 0;

    const direction: MomentumState['direction'] = trendSlope > 0.01 ? 1 : trendSlope < -0.01 ? -1 : 0;

    return { trendSlope, strength, persistence, direction };
  }

  // ── Microstructure ───────────────────────────────────────────────────────

  private computeMicrostructure(
    candles: Candle[], ticker?: Ticker,
  ): MicrostructureWarnings {
    const flags: string[] = [];
    const recent = candles.slice(-20);

    // Gap detection: close-to-open gap > 2 ATR
    const atrValues = ATR.calculate({
      high: candles.map(c => c.high),
      low: candles.map(c => c.low),
      close: candles.map(c => c.close),
      period: this.cfg.atrPeriod,
    });
    const atr = atrValues[atrValues.length - 1] ?? 0;
    let gapDetected = false;
    if (recent.length >= 2) {
      const prev = recent[recent.length - 2]!;
      const curr = recent[recent.length - 1]!;
      if (Math.abs(curr.open - prev.close) > atr * 2) {
        gapDetected = true;
        flags.push('Price gap detected');
      }
    }

    // Wickiness: wick/body ratio extreme (>3)
    let highWickiness = false;
    const last = recent[recent.length - 1];
    if (last) {
      const body = Math.abs(last.close - last.open);
      const totalRange = last.high - last.low;
      const wick = totalRange - body;
      if (body > 0 && wick / body > 3) {
        highWickiness = true;
        flags.push('High wick-to-body ratio');
      }
    }

    // Churn: high volume but no net price movement
    let churnDetected = false;
    if (recent.length >= 5) {
      const vol5 = recent.slice(-5).reduce((s, c) => s + c.volume, 0);
      const avgVol = candles.slice(-20).reduce((s, c) => s + c.volume, 0) / 20;
      const priceChange = Math.abs(
        recent[recent.length - 1]!.close - recent[recent.length - 5]!.close,
      );
      const priceChangePct = recent[recent.length - 5]!.close > 0
        ? priceChange / recent[recent.length - 5]!.close
        : 0;
      if (vol5 > avgVol * 5 * 1.5 && priceChangePct < 0.002) {
        churnDetected = true;
        flags.push('Volume churn (high volume, no movement)');
      }
    }

    // Spread spike
    let spreadSpike = false;
    if (ticker && ticker.bid > 0 && ticker.ask > 0) {
      const spread = ((ticker.ask - ticker.bid) / ((ticker.ask + ticker.bid) / 2)) * 100;
      if (spread > this.cfg.spreadHighPct * 2) {
        spreadSpike = true;
        flags.push(`Spread spike: ${spread.toFixed(3)}%`);
      }
    }

    return { gapDetected, highWickiness, churnDetected, spreadSpike, flags };
  }

  // ── Data Integrity ───────────────────────────────────────────────────────

  private computeDataIntegrity(candles: Candle[], now: number): DataIntegrity {
    const last = candles[candles.length - 1];
    const lastUpdateMs = last ? now - last.time : Infinity;
    const staleFeed = lastUpdateMs > this.cfg.staleDataMs;

    // Count missing candles (gaps in timestamp sequence)
    let missingCandles = 0;
    for (let i = 1; i < candles.length; i++) {
      const gap = candles[i]!.time - candles[i - 1]!.time;
      const expectedGap = this.cfg.expectedIntervalMs;
      if (gap > expectedGap * 1.8) {
        missingCandles += Math.round(gap / expectedGap) - 1;
      }
    }

    // Exchange jitter: inconsistent intervals
    let exchangeJitter = false;
    if (candles.length >= 10) {
      const intervals: number[] = [];
      for (let i = candles.length - 10; i < candles.length; i++) {
        intervals.push(candles[i]!.time - candles[i - 1]!.time);
      }
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const maxDev = Math.max(...intervals.map(i => Math.abs(i - avg)));
      if (maxDev > this.cfg.expectedIntervalMs * 0.5) {
        exchangeJitter = true;
      }
    }

    const healthy = !staleFeed && missingCandles < 3 && !exchangeJitter;

    return { staleFeed, missingCandles, exchangeJitter, lastUpdateMs, healthy };
  }

  // ── Regime Classification ────────────────────────────────────────────────

  private classifyRegime(
    closes: number[], highs: number[], lows: number[],
    vol: VolatilityState, liq: LiquidityState, mom: MomentumState,
  ): { regime: Regime; regimeConfidence: number } {
    // Priority-ordered classification

    // 1. High volatility overrides
    if (vol.percentile > 0.9 || vol.atrPercent > 3) {
      return { regime: 'high_vol', regimeConfidence: Math.min(1, vol.percentile) };
    }

    // 2. Low liquidity
    if (liq.slippageRisk === 'extreme' || (liq.volumeRatio < 0.3 && liq.spreadPercent > 0.1)) {
      return { regime: 'low_liquidity', regimeConfidence: 0.7 };
    }

    // 3. ADX-based trend/range detection
    const adxValues = ADX.calculate({
      high: highs, low: lows, close: closes, period: this.cfg.adxPeriod,
    });
    const adxResult = adxValues[adxValues.length - 1];
    const adx = adxResult?.adx ?? 0;

    // BB squeeze → breakout
    const bbValues = BollingerBands.calculate({
      values: closes, period: this.cfg.bbPeriod, stdDev: 2,
    });
    const bbCurrent = bbValues[bbValues.length - 1];
    if (bbCurrent) {
      const bbWidth = (bbCurrent.upper - bbCurrent.lower) / bbCurrent.middle;
      const recentWidths = bbValues.slice(-20).map(
        bb => (bb.upper - bb.lower) / bb.middle,
      );
      const avgWidth = recentWidths.reduce((a, b) => a + b, 0) / recentWidths.length;
      if (bbWidth < avgWidth * 0.6 && adx < 22) {
        return { regime: 'breakout', regimeConfidence: 0.6 };
      }
    }

    // Trend classification
    if (adx > 22) {
      if (mom.direction === 1) {
        return { regime: 'trending_up', regimeConfidence: Math.min(1, adx / 40) };
      }
      if (mom.direction === -1) {
        return { regime: 'trending_down', regimeConfidence: Math.min(1, adx / 40) };
      }
    }

    // Default: mean revert
    return {
      regime: 'mean_revert',
      regimeConfidence: Math.min(1, (25 - adx) / 25),
    };
  }

  // ── Summary ──────────────────────────────────────────────────────────────

  private buildSummary(
    regime: Regime, vol: VolatilityState, liq: LiquidityState,
    mom: MomentumState, micro: MicrostructureWarnings,
  ): string {
    const parts: string[] = [];
    parts.push(`Regime: ${regime}`);
    parts.push(`Vol: ${vol.atrPercent.toFixed(2)}% ATR (p${(vol.percentile * 100).toFixed(0)})`);
    parts.push(`Liq: ${liq.slippageRisk} (spread ${liq.spreadPercent.toFixed(3)}%)`);
    if (mom.direction !== 0) {
      parts.push(`Mom: ${mom.direction > 0 ? 'up' : 'down'} (str: ${mom.strength.toFixed(2)})`);
    }
    if (micro.flags.length > 0) {
      parts.push(`Warnings: ${micro.flags.join(', ')}`);
    }
    return parts.join(' | ');
  }

  private fallbackState(symbol: string, timestamp: number, reason: string): MarketState {
    return {
      symbol,
      timestamp,
      regime: 'mean_revert',
      regimeConfidence: 0,
      volatility: { atrPercent: 0, realizedVol: 0, volOfVol: 0, percentile: 0.5 },
      liquidity: { spreadPercent: 0, depthProxy: 0.5, slippageRisk: 'medium', volumeRatio: 1 },
      momentum: { trendSlope: 0, strength: 0, persistence: 0, direction: 0 },
      microstructure: { gapDetected: false, highWickiness: false, churnDetected: false, spreadSpike: false, flags: [] },
      dataIntegrity: { staleFeed: true, missingCandles: 0, exchangeJitter: false, lastUpdateMs: 0, healthy: false },
      summary: reason,
    };
  }
}
