/**
 * Mean Reversion Alpha Model
 *
 * Active in choppy/ranging markets with low spread.
 * Uses RSI extremes, BB position, and oscillator consensus.
 */

import { RSI, BollingerBands, StochasticRSI, MFI, CCI, ATR } from 'technicalindicators';
import type { AlphaModel, AlphaModelContext } from './interface.js';
import type { AlphaVote, Regime } from '../types.js';

export class MeanReversionModel implements AlphaModel {
  readonly id = 'mean_reversion' as const;
  readonly name = 'Mean Reversion';
  readonly supportedRegimes: Regime[] = ['mean_revert'];

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

    // RSI extremes
    const rsiValues = RSI.calculate({ values: closes, period: 14 });
    const rsi = rsiValues[rsiValues.length - 1] ?? 50;
    metrics.rsi = rsi;

    if (rsi <= 25) { score += 3; reasons.push(`RSI deeply oversold (${rsi.toFixed(0)})`); }
    else if (rsi <= 35) { score += 1.5; reasons.push(`RSI oversold (${rsi.toFixed(0)})`); }
    else if (rsi >= 75) { score -= 3; reasons.push(`RSI deeply overbought (${rsi.toFixed(0)})`); }
    else if (rsi >= 65) { score -= 1.5; reasons.push(`RSI overbought (${rsi.toFixed(0)})`); }

    // Bollinger Band position
    const bbArr = BollingerBands.calculate({ values: closes, period: 20, stdDev: 2 });
    const bb = bbArr[bbArr.length - 1];
    if (bb) {
      const bbRange = bb.upper - bb.lower;
      const bbPos = bbRange > 0 ? (price - bb.lower) / bbRange : 0.5;
      metrics.bbPosition = bbPos;

      if (bbPos <= 0.05) { score += 2; reasons.push('At lower BB extreme'); }
      else if (bbPos <= 0.15) { score += 1; reasons.push('Near lower BB'); }
      else if (bbPos >= 0.95) { score -= 2; reasons.push('At upper BB extreme'); }
      else if (bbPos >= 0.85) { score -= 1; reasons.push('Near upper BB'); }
    }

    // Stochastic RSI
    const stochArr = StochasticRSI.calculate({
      values: closes, rsiPeriod: 14, stochasticPeriod: 14, kPeriod: 3, dPeriod: 3,
    });
    const stoch = stochArr[stochArr.length - 1];
    if (stoch) {
      metrics.stochK = stoch.k;
      if (stoch.k < 15 && stoch.d < 15) { score += 1; reasons.push('StochRSI deeply oversold'); }
      if (stoch.k > 85 && stoch.d > 85) { score -= 1; reasons.push('StochRSI deeply overbought'); }
    }

    // MFI
    const mfiValues = MFI.calculate({
      high: highs, low: lows, close: closes, volume: volumes, period: 14,
    });
    const mfi = mfiValues[mfiValues.length - 1] ?? 50;
    metrics.mfi = mfi;
    if (mfi < 20) { score += 0.5; reasons.push('MFI oversold'); }
    if (mfi > 80) { score -= 0.5; reasons.push('MFI overbought'); }

    // CCI
    const cciValues = CCI.calculate({ high: highs, low: lows, close: closes, period: 20 });
    const cci = cciValues[cciValues.length - 1] ?? 0;
    metrics.cci = cci;
    if (cci < -150) { score += 1; reasons.push('CCI deeply oversold'); }
    if (cci > 150) { score -= 1; reasons.push('CCI deeply overbought'); }

    // Liquidity check — mean reversion needs tight spreads
    if (marketState.liquidity.slippageRisk === 'high' || marketState.liquidity.slippageRisk === 'extreme') {
      score *= 0.3;
      reasons.push('Low liquidity dampens mean reversion');
    }

    // ATR for risk
    const atrValues = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });
    const atr = atrValues[atrValues.length - 1] ?? 0;
    const atrBps = price > 0 ? (atr / price) * 10000 : 0;
    metrics.atrBps = atrBps;

    const direction: AlphaVote['direction'] = score > 2 ? 1 : score < -2 ? -1 : 0;
    const confidence = Math.min(1, Math.abs(score) / 8);
    const expectedReturnBps = direction !== 0 ? Math.round(atrBps * confidence * 0.4) : 0;
    const expectedRiskBps = Math.round(atrBps * 1.2);

    const isSupported = this.supportedRegimes.includes(marketState.regime);
    const weight = isSupported ? 1.0 : 0.15;

    return {
      modelId: this.id,
      direction,
      confidence,
      expectedReturnBps,
      expectedRiskBps,
      regime: marketState.regime,
      weight,
      reason: reasons.join('; ') || 'No mean reversion signal',
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
