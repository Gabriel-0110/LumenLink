/**
 * Market Regime Detector — classifies current market conditions.
 * 
 * Regimes:
 *   - trending_up:    Strong directional move up (ADX > 25, price > EMA)
 *   - trending_down:  Strong directional move down (ADX > 25, price < EMA)
 *   - ranging:        Choppy, no clear direction (ADX < 20)
 *   - high_volatility: Extreme volatility (ATR spike), dangerous to trade
 *   - breakout:       Transitioning from range to trend (BB squeeze → expansion)
 * 
 * This is NOT a signal generator — it's context for the signal engine.
 * Strategies should adapt behavior based on regime.
 */

import type { Candle } from '../core/types.js';
import { ADX, ATR, BollingerBands, EMA, RSI } from 'technicalindicators';

export type MarketRegime = 'trending_up' | 'trending_down' | 'ranging' | 'high_volatility' | 'breakout';

export interface RegimeAnalysis {
  regime: MarketRegime;
  confidence: number;      // 0-1 how confident in this classification
  adx: number;             // trend strength (0-100)
  atrRatio: number;        // current ATR / median ATR
  bbWidth: number;         // Bollinger Band width (volatility proxy)
  bbSqueeze: boolean;      // bands tightening (breakout setup)
  trendDirection: number;  // +1 up, -1 down, 0 neutral
  details: string;
}

export class RegimeDetector {
  private readonly adxPeriod: number;
  private readonly atrPeriod: number;
  private readonly emaPeriod: number;
  private readonly bbPeriod: number;
  private readonly atrSpikeThreshold: number;

  constructor(config: {
    adxPeriod?: number;
    atrPeriod?: number;
    emaPeriod?: number;
    bbPeriod?: number;
    atrSpikeThreshold?: number;
  } = {}) {
    this.adxPeriod = config.adxPeriod ?? 14;
    this.atrPeriod = config.atrPeriod ?? 14;
    this.emaPeriod = config.emaPeriod ?? 50;
    this.bbPeriod = config.bbPeriod ?? 20;
    this.atrSpikeThreshold = config.atrSpikeThreshold ?? 2.8; // raised from 2.0 — 5m micro-volatility spikes otherwise always block
  }

  /**
   * Detect the current market regime from candle data.
   * Needs at least 100 candles for reliable detection.
   */
  detect(candles: Candle[]): RegimeAnalysis {
    if (candles.length < 100) {
      return {
        regime: 'ranging',
        confidence: 0,
        adx: 0,
        atrRatio: 1,
        bbWidth: 0,
        bbSqueeze: false,
        trendDirection: 0,
        details: 'Insufficient data for regime detection',
      };
    }

    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const closes = candles.map(c => c.close);

    // ── ADX: Trend Strength ──────────────────────────────────────
    const adxValues = ADX.calculate({
      high: highs,
      low: lows,
      close: closes,
      period: this.adxPeriod,
    });
    const currentAdx = adxValues.length > 0 ? adxValues[adxValues.length - 1]!.adx : 0;

    // ── ATR: Volatility ──────────────────────────────────────────
    const atrValues = ATR.calculate({
      high: highs,
      low: lows,
      close: closes,
      period: this.atrPeriod,
    });
    const currentAtr = atrValues.length > 0 ? atrValues[atrValues.length - 1]! : 0;
    const sorted = [...atrValues].sort((a, b) => a - b);
    const medianAtr = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)]! : 1;
    const atrRatio = medianAtr > 0 ? currentAtr / medianAtr : 1;

    // ── EMA: Trend Direction ─────────────────────────────────────
    const emaValues = EMA.calculate({ values: closes, period: this.emaPeriod });
    const currentEma = emaValues.length > 0 ? emaValues[emaValues.length - 1]! : closes[closes.length - 1]!;
    const currentPrice = closes[closes.length - 1]!;
    const priceVsEma = (currentPrice - currentEma) / currentEma;

    // ── Bollinger Bands: Squeeze Detection ───────────────────────
    const bbValues = BollingerBands.calculate({
      values: closes,
      period: this.bbPeriod,
      stdDev: 2,
    });
    const currentBB = bbValues.length > 0 ? bbValues[bbValues.length - 1]! : null;
    const bbWidth = currentBB ? (currentBB.upper - currentBB.lower) / currentBB.middle : 0;

    // Check BB squeeze (compare current width to recent average)
    const recentBBWidths = bbValues.slice(-20).map(bb => (bb.upper - bb.lower) / bb.middle);
    const avgBBWidth = recentBBWidths.length > 0
      ? recentBBWidths.reduce((a, b) => a + b, 0) / recentBBWidths.length
      : bbWidth;
    const bbSqueeze = bbWidth < avgBBWidth * 0.6; // bands 40%+ tighter than average

    // ── RSI: Momentum confirmation ───────────────────────────────
    const rsiValues = RSI.calculate({ values: closes, period: 14 });
    const currentRsi = rsiValues.length > 0 ? rsiValues[rsiValues.length - 1]! : 50;

    // ── Classify Regime ──────────────────────────────────────────
    let regime: MarketRegime;
    let confidence: number;
    let trendDirection: number;
    let details: string;

    if (atrRatio > this.atrSpikeThreshold) {
      // High volatility overrides everything
      regime = 'high_volatility';
      confidence = Math.min(1, (atrRatio - this.atrSpikeThreshold) / 2);
      trendDirection = priceVsEma > 0 ? 1 : -1;
      details = `ATR spike ${atrRatio.toFixed(1)}x median. Dangerous conditions.`;
    } else if (bbSqueeze && currentAdx < 20) {
      // Low volatility + low trend = potential breakout setup
      regime = 'breakout';
      confidence = 0.5 + (1 - bbWidth / avgBBWidth) * 0.3;
      trendDirection = 0;
      details = `BB squeeze detected (width ${(bbWidth * 100).toFixed(1)}% vs avg ${(avgBBWidth * 100).toFixed(1)}%). Breakout imminent.`;
    } else if (currentAdx > 20) { // lowered from 25 — 5m ADX rarely hits 25
      // Strong trend
      if (priceVsEma > 0.003 && currentRsi > 42) {
        regime = 'trending_up';
        trendDirection = 1;
        confidence = Math.min(1, currentAdx / 40);
        details = `Uptrend: ADX ${currentAdx.toFixed(1)}, price ${(priceVsEma * 100).toFixed(1)}% above EMA${this.emaPeriod}, RSI ${currentRsi.toFixed(0)}`;
      } else if (priceVsEma < -0.003 && currentRsi < 58) {
        regime = 'trending_down';
        trendDirection = -1;
        confidence = Math.min(1, currentAdx / 40);
        details = `Downtrend: ADX ${currentAdx.toFixed(1)}, price ${(Math.abs(priceVsEma) * 100).toFixed(1)}% below EMA${this.emaPeriod}, RSI ${currentRsi.toFixed(0)}`;
      } else {
        regime = 'ranging';
        trendDirection = 0;
        confidence = 0.4;
        details = `ADX elevated (${currentAdx.toFixed(1)}) but mixed signals. Likely transitioning.`;
      }
    } else {
      // Weak trend = ranging
      regime = 'ranging';
      trendDirection = 0;
      confidence = Math.min(1, (20 - currentAdx) / 20);
      details = `Range-bound: ADX ${currentAdx.toFixed(1)}, no clear direction.`;
    }

    return {
      regime,
      confidence,
      adx: currentAdx,
      atrRatio,
      bbWidth,
      bbSqueeze,
      trendDirection,
      details,
    };
  }
}
