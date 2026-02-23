/**
 * Trend Continuation Alpha Model
 *
 * Looks for breakout + pullback setups in trending markets.
 * Active when ADX > 22 and price structure confirms direction.
 */

import { EMA, ADX, ATR, RSI, MACD } from 'technicalindicators';
import type { AlphaModel, AlphaModelContext } from './interface.js';
import type { AlphaVote, Regime } from '../types.js';

export class TrendContinuationModel implements AlphaModel {
  readonly id = 'trend_continuation' as const;
  readonly name = 'Trend Continuation';
  readonly supportedRegimes: Regime[] = ['trending_up', 'trending_down', 'breakout'];

  vote(ctx: AlphaModelContext): AlphaVote {
    const { candles, marketState } = ctx;
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);

    if (closes.length < 100) {
      return this.neutralVote(marketState.regime, 'Insufficient data');
    }

    const metrics: Record<string, number> = {};
    let score = 0;
    const reasons: string[] = [];

    // EMA alignment check (9 > 21 > 50 for uptrend)
    const ema9 = EMA.calculate({ values: closes, period: 9 });
    const ema21 = EMA.calculate({ values: closes, period: 21 });
    const ema50 = EMA.calculate({ values: closes, period: 50 });
    const e9 = ema9[ema9.length - 1] ?? 0;
    const e21 = ema21[ema21.length - 1] ?? 0;
    const e50 = ema50[ema50.length - 1] ?? 0;
    metrics.ema9 = e9;
    metrics.ema21 = e21;
    metrics.ema50 = e50;

    const bullishStack = e9 > e21 && e21 > e50;
    const bearishStack = e9 < e21 && e21 < e50;

    if (bullishStack) { score += 2; reasons.push('Bullish EMA stack'); }
    if (bearishStack) { score -= 2; reasons.push('Bearish EMA stack'); }

    // ADX confirms trend strength
    const adxValues = ADX.calculate({ high: highs, low: lows, close: closes, period: 14 });
    const adxResult = adxValues[adxValues.length - 1];
    const adx = adxResult?.adx ?? 0;
    const pdi = adxResult?.pdi ?? 0;
    const mdi = adxResult?.mdi ?? 0;
    metrics.adx = adx;

    if (adx > 25) {
      if (pdi > mdi) { score += 1.5; reasons.push(`Trend strength ADX=${adx.toFixed(0)}, +DI leads`); }
      else { score -= 1.5; reasons.push(`Trend strength ADX=${adx.toFixed(0)}, -DI leads`); }
    }

    // Pullback detection: price near EMA21 in trend
    const price = closes[closes.length - 1]!;
    const pullbackDist = Math.abs(price - e21) / e21;
    metrics.pullbackDist = pullbackDist;

    if (bullishStack && pullbackDist < 0.01 && price > e21) {
      score += 1.5;
      reasons.push('Pullback to EMA21 support');
    }
    if (bearishStack && pullbackDist < 0.01 && price < e21) {
      score -= 1.5;
      reasons.push('Rally to EMA21 resistance');
    }

    // MACD momentum confirmation
    const macdArr = MACD.calculate({
      values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9,
      SimpleMAOscillator: false, SimpleMASignal: false,
    });
    const macd = macdArr[macdArr.length - 1];
    if (macd?.histogram) {
      metrics.macdHist = macd.histogram;
      if (macd.histogram > 0 && score > 0) { score += 0.5; reasons.push('MACD confirms bull'); }
      if (macd.histogram < 0 && score < 0) { score -= 0.5; reasons.push('MACD confirms bear'); }
    }

    // ATR for risk estimation
    const atrValues = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });
    const atr = atrValues[atrValues.length - 1] ?? 0;
    const atrBps = price > 0 ? (atr / price) * 10000 : 0;
    metrics.atrBps = atrBps;

    const direction: AlphaVote['direction'] = score > 1.0 ? 1 : score < -1.0 ? -1 : 0;
    const confidence = Math.min(1, Math.abs(score) / 6);
    const expectedReturnBps = direction !== 0 ? Math.round(atrBps * confidence * 0.5) : 0;
    const expectedRiskBps = Math.round(atrBps * 1.5);

    // Regime-adjusted weight
    const isSupported = this.supportedRegimes.includes(marketState.regime);
    const weight = isSupported ? 1.0 : 0.2;

    return {
      modelId: this.id,
      direction,
      confidence,
      expectedReturnBps,
      expectedRiskBps,
      regime: marketState.regime,
      weight,
      reason: reasons.join('; ') || 'No clear trend signal',
      metrics,
    };
  }

  private neutralVote(regime: Regime, reason: string): AlphaVote {
    return {
      modelId: this.id, direction: 0, confidence: 0, expectedReturnBps: 0,
      expectedRiskBps: 0, regime, weight: 0, reason, metrics: {},
    };
  }
}
