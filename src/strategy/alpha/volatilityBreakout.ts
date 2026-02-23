/**
 * Volatility Breakout Alpha Model
 *
 * Detects Bollinger Band squeeze → expansion patterns.
 * Only fires when volatility compression breaks with volume confirmation.
 */

import { BollingerBands, ATR, EMA } from 'technicalindicators';
import type { AlphaModel, AlphaModelContext } from './interface.js';
import type { AlphaVote, Regime } from '../types.js';

export class VolatilityBreakoutModel implements AlphaModel {
  readonly id = 'volatility_breakout' as const;
  readonly name = 'Volatility Breakout';
  readonly supportedRegimes: Regime[] = ['breakout', 'mean_revert'];

  vote(ctx: AlphaModelContext): AlphaVote {
    const { candles, marketState } = ctx;
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const volumes = candles.map(c => c.volume);

    if (closes.length < 100) {
      return this.neutralVote(marketState.regime, 'Insufficient data');
    }

    const metrics: Record<string, number> = {};
    let score = 0;
    const reasons: string[] = [];
    const price = closes[closes.length - 1]!;

    // BB width analysis
    const bbArr = BollingerBands.calculate({ values: closes, period: 20, stdDev: 2 });
    if (bbArr.length < 20) {
      return this.neutralVote(marketState.regime, 'Insufficient BB data');
    }

    const bbCurrent = bbArr[bbArr.length - 1]!;
    const bbPrev = bbArr[bbArr.length - 2]!;
    const currentWidth = (bbCurrent.upper - bbCurrent.lower) / bbCurrent.middle;
    const prevWidth = (bbPrev.upper - bbPrev.lower) / bbPrev.middle;

    // Calculate width percentile
    const widths = bbArr.slice(-40).map(bb => (bb.upper - bb.lower) / bb.middle);
    const sortedWidths = [...widths].sort((a, b) => a - b);
    const widthRank = sortedWidths.findIndex(w => w >= currentWidth);
    const widthPercentile = widthRank / sortedWidths.length;
    metrics.bbWidthPercentile = widthPercentile;
    metrics.bbWidth = currentWidth;

    // Squeeze detection: width in bottom 20th percentile
    const isSqueeze = widthPercentile < 0.2;
    metrics.isSqueeze = isSqueeze ? 1 : 0;

    // Expansion: width expanding after squeeze
    const isExpanding = currentWidth > prevWidth * 1.1;
    metrics.isExpanding = isExpanding ? 1 : 0;

    // Breakout direction
    if (isSqueeze) {
      score += 0.5;
      reasons.push('BB squeeze active');
    }

    if (isExpanding && widthPercentile < 0.4) {
      // Breakout is happening — determine direction
      if (price > bbCurrent.upper) {
        score += 3;
        reasons.push('Upside BB breakout from squeeze');
      } else if (price < bbCurrent.lower) {
        score -= 3;
        reasons.push('Downside BB breakout from squeeze');
      } else if (price > bbCurrent.middle) {
        score += 1.5;
        reasons.push('Expansion with bullish bias');
      } else {
        score -= 1.5;
        reasons.push('Expansion with bearish bias');
      }
    }

    // Volume confirmation
    const vol20 = volumes.slice(-20);
    const avgVol = vol20.reduce((a, b) => a + b, 0) / vol20.length;
    const currentVol = volumes[volumes.length - 1] ?? 0;
    const volRatio = avgVol > 0 ? currentVol / avgVol : 1;
    metrics.volRatio = volRatio;

    if (volRatio > 1.5 && Math.abs(score) > 1) {
      score *= 1.3;
      reasons.push(`Volume confirms breakout (${volRatio.toFixed(1)}x avg)`);
    } else if (volRatio < 0.7 && Math.abs(score) > 1) {
      score *= 0.5;
      reasons.push('Low volume weakens breakout');
    }

    // EMA direction alignment
    const ema21 = EMA.calculate({ values: closes, period: 21 });
    const ema50 = EMA.calculate({ values: closes, period: 50 });
    const e21 = ema21[ema21.length - 1] ?? 0;
    const e50 = ema50[ema50.length - 1] ?? 0;
    if (score > 0 && e21 > e50) { score += 0.5; reasons.push('EMA alignment supports upside'); }
    if (score < 0 && e21 < e50) { score -= 0.5; reasons.push('EMA alignment supports downside'); }

    // ATR for risk
    const atrValues = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });
    const atr = atrValues[atrValues.length - 1] ?? 0;
    const atrBps = price > 0 ? (atr / price) * 10000 : 0;
    metrics.atrBps = atrBps;

    const direction: AlphaVote['direction'] = score > 1.0 ? 1 : score < -1.0 ? -1 : 0;
    const confidence = Math.min(1, Math.abs(score) / 5);
    // Breakout targets are typically larger moves
    const expectedReturnBps = direction !== 0 ? Math.round(atrBps * confidence * 0.8) : 0;
    const expectedRiskBps = Math.round(atrBps * 1.0);

    const isSupported = this.supportedRegimes.includes(marketState.regime);
    const weight = isSupported ? 1.0 : 0.1;

    return {
      modelId: this.id,
      direction,
      confidence,
      expectedReturnBps,
      expectedRiskBps,
      regime: marketState.regime,
      weight,
      reason: reasons.join('; ') || 'No breakout signal',
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
