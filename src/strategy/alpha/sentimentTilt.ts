/**
 * Sentiment Tilt Alpha Model
 *
 * Uses Fear & Greed + news sentiment as a MODIFIER, not a trigger.
 * Extreme sentiment conditions tilt the ensemble, never drive it alone.
 */

import type { AlphaModel, AlphaModelContext } from './interface.js';
import type { AlphaVote, Regime } from '../types.js';

export class SentimentTiltModel implements AlphaModel {
  readonly id = 'sentiment_tilt' as const;
  readonly name = 'Sentiment Tilt';
  readonly supportedRegimes: Regime[] = [
    'trending_up', 'trending_down', 'mean_revert', 'high_vol',
    'low_liquidity', 'news_risk', 'breakout',
  ];

  vote(ctx: AlphaModelContext): AlphaVote {
    const { marketState, fearGreedIndex, newsSentiment } = ctx;
    const metrics: Record<string, number> = {};
    let score = 0;
    const reasons: string[] = [];

    // Fear & Greed index (0-100)
    if (fearGreedIndex !== undefined) {
      metrics.fearGreed = fearGreedIndex;

      if (fearGreedIndex <= 10) {
        score += 2;
        reasons.push(`Extreme fear (F&G: ${fearGreedIndex}) — contrarian bullish`);
      } else if (fearGreedIndex <= 25) {
        score += 1;
        reasons.push(`Fear zone (F&G: ${fearGreedIndex}) — mild bullish tilt`);
      } else if (fearGreedIndex >= 90) {
        score -= 2;
        reasons.push(`Extreme greed (F&G: ${fearGreedIndex}) — contrarian bearish`);
      } else if (fearGreedIndex >= 75) {
        score -= 1;
        reasons.push(`Greed zone (F&G: ${fearGreedIndex}) — mild bearish tilt`);
      }
    }

    // News sentiment (-1 to +1)
    if (newsSentiment !== undefined) {
      metrics.newsSentiment = newsSentiment;

      if (newsSentiment < -0.5) {
        score += 0.5; // contrarian
        reasons.push(`Very negative news (${newsSentiment.toFixed(2)}) — contrarian tilt`);
      } else if (newsSentiment > 0.5) {
        score -= 0.5; // contrarian
        reasons.push(`Very positive news (${newsSentiment.toFixed(2)}) — contrarian tilt`);
      }
    }

    // If no sentiment data, this model contributes nothing
    if (fearGreedIndex === undefined && newsSentiment === undefined) {
      return {
        modelId: this.id, direction: 0, confidence: 0, expectedReturnBps: 0,
        expectedRiskBps: 0, regime: marketState.regime, weight: 0,
        reason: 'No sentiment data available', metrics,
      };
    }

    const direction: AlphaVote['direction'] = score > 0.5 ? 1 : score < -0.5 ? -1 : 0;
    const confidence = Math.min(1, Math.abs(score) / 3);

    // Sentiment model always has low weight — it's a modifier
    const weight = 0.3;

    return {
      modelId: this.id,
      direction,
      confidence,
      expectedReturnBps: 0,  // sentiment doesn't predict magnitude
      expectedRiskBps: 0,
      regime: marketState.regime,
      weight,
      reason: reasons.join('; ') || 'Neutral sentiment',
      metrics,
    };
  }
}
