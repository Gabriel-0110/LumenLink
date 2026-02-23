/**
 * Momentum Divergence Alpha Model
 *
 * Detects divergences between price and momentum indicators.
 * Bullish divergence: price makes lower low, RSI/MACD make higher low.
 * Bearish divergence: price makes higher high, RSI/MACD make lower high.
 */

import { RSI, MACD, ATR } from 'technicalindicators';
import type { AlphaModel, AlphaModelContext } from './interface.js';
import type { AlphaVote, Regime } from '../types.js';

export class MomentumDivergenceModel implements AlphaModel {
  readonly id = 'momentum_divergence' as const;
  readonly name = 'Momentum Divergence';
  readonly supportedRegimes: Regime[] = ['trending_up', 'trending_down', 'mean_revert'];

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
    const price = closes[closes.length - 1]!;

    // RSI divergence (look back 20 candles for swing points)
    const rsiValues = RSI.calculate({ values: closes, period: 14 });
    const recentRsi = rsiValues.slice(-20);
    const recentCloses = closes.slice(-20);

    if (recentRsi.length >= 20 && recentCloses.length >= 20) {
      // Find local lows and highs in price and RSI
      const priceLows = this.findLocalExtrema(recentCloses, 'low');
      const rsiLows = this.findLocalExtrema(recentRsi, 'low');
      const priceHighs = this.findLocalExtrema(recentCloses, 'high');
      const rsiHighs = this.findLocalExtrema(recentRsi, 'high');

      // Bullish divergence: price lower low, RSI higher low
      if (priceLows.length >= 2 && rsiLows.length >= 2) {
        const priceTrend = priceLows[priceLows.length - 1]! - priceLows[priceLows.length - 2]!;
        const rsiTrend = rsiLows[rsiLows.length - 1]! - rsiLows[rsiLows.length - 2]!;
        if (priceTrend < 0 && rsiTrend > 0) {
          score += 2.5;
          reasons.push('Bullish RSI divergence');
          metrics.bullishDivergence = 1;
        }
      }

      // Bearish divergence: price higher high, RSI lower high
      if (priceHighs.length >= 2 && rsiHighs.length >= 2) {
        const priceTrend = priceHighs[priceHighs.length - 1]! - priceHighs[priceHighs.length - 2]!;
        const rsiTrend = rsiHighs[rsiHighs.length - 1]! - rsiHighs[rsiHighs.length - 2]!;
        if (priceTrend > 0 && rsiTrend < 0) {
          score -= 2.5;
          reasons.push('Bearish RSI divergence');
          metrics.bearishDivergence = 1;
        }
      }
    }

    // MACD histogram divergence
    const macdArr = MACD.calculate({
      values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9,
      SimpleMAOscillator: false, SimpleMASignal: false,
    });
    const recentMacdHist = macdArr.slice(-20).map(m => m.histogram ?? 0);
    const recentPrices20 = closes.slice(-(recentMacdHist.length));

    if (recentMacdHist.length >= 10) {
      const macdLows = this.findLocalExtrema(recentMacdHist, 'low');
      const pLows = this.findLocalExtrema(recentPrices20, 'low');
      const macdHighs = this.findLocalExtrema(recentMacdHist, 'high');
      const pHighs = this.findLocalExtrema(recentPrices20, 'high');

      if (pLows.length >= 2 && macdLows.length >= 2) {
        const pt = pLows[pLows.length - 1]! - pLows[pLows.length - 2]!;
        const mt = macdLows[macdLows.length - 1]! - macdLows[macdLows.length - 2]!;
        if (pt < 0 && mt > 0) {
          score += 1.5;
          reasons.push('Bullish MACD histogram divergence');
        }
      }
      if (pHighs.length >= 2 && macdHighs.length >= 2) {
        const pt = pHighs[pHighs.length - 1]! - pHighs[pHighs.length - 2]!;
        const mt = macdHighs[macdHighs.length - 1]! - macdHighs[macdHighs.length - 2]!;
        if (pt > 0 && mt < 0) {
          score -= 1.5;
          reasons.push('Bearish MACD histogram divergence');
        }
      }
    }

    // ATR for risk
    const atrValues = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });
    const atr = atrValues[atrValues.length - 1] ?? 0;
    const atrBps = price > 0 ? (atr / price) * 10000 : 0;
    metrics.atrBps = atrBps;

    const direction: AlphaVote['direction'] = score > 1.0 ? 1 : score < -1.0 ? -1 : 0;
    const confidence = Math.min(1, Math.abs(score) / 5);
    const expectedReturnBps = direction !== 0 ? Math.round(atrBps * confidence * 0.6) : 0;
    const expectedRiskBps = Math.round(atrBps * 1.5);

    const isSupported = this.supportedRegimes.includes(marketState.regime);
    const weight = isSupported ? 0.8 : 0.2;

    return {
      modelId: this.id,
      direction,
      confidence,
      expectedReturnBps,
      expectedRiskBps,
      regime: marketState.regime,
      weight,
      reason: reasons.join('; ') || 'No divergence detected',
      metrics,
    };
  }

  private findLocalExtrema(data: number[], type: 'low' | 'high'): number[] {
    const extrema: number[] = [];
    for (let i = 2; i < data.length - 2; i++) {
      if (type === 'low') {
        if (data[i]! < data[i - 1]! && data[i]! < data[i - 2]! &&
            data[i]! < data[i + 1]! && data[i]! < data[i + 2]!) {
          extrema.push(data[i]!);
        }
      } else {
        if (data[i]! > data[i - 1]! && data[i]! > data[i - 2]! &&
            data[i]! > data[i + 1]! && data[i]! > data[i + 2]!) {
          extrema.push(data[i]!);
        }
      }
    }
    return extrema;
  }

  private neutralVote(regime: Regime, reason: string): AlphaVote {
    return {
      modelId: this.id, direction: 0, confidence: 0, expectedReturnBps: 0,
      expectedRiskBps: 0, regime, weight: 0, reason, metrics: {},
    };
  }
}
