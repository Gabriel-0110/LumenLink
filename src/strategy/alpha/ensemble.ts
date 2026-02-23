/**
 * Alpha Ensemble — combines multiple signal models with regime-adjusted weights.
 *
 * Each model votes, then the ensemble weights and combines them based on:
 *   1. Model's regime suitability
 *   2. Model's confidence
 *   3. Historical validation weight (future: performance attribution feedback)
 */

import type { Candle, Ticker } from '../../core/types.js';
import type { AlphaVote, EnsembleResult, MarketState } from '../types.js';
import type { AlphaModel, AlphaModelContext } from './interface.js';
import { TrendContinuationModel } from './trendContinuation.js';
import { MeanReversionModel } from './meanReversion.js';
import { VolatilityBreakoutModel } from './volatilityBreakout.js';
import { MomentumDivergenceModel } from './momentumDivergence.js';
import { SentimentTiltModel } from './sentimentTilt.js';

export class AlphaEnsemble {
  private readonly models: AlphaModel[];

  constructor(models?: AlphaModel[]) {
    this.models = models ?? [
      new TrendContinuationModel(),
      new MeanReversionModel(),
      new VolatilityBreakoutModel(),
      new MomentumDivergenceModel(),
      new SentimentTiltModel(),
    ];
  }

  /**
   * Run all models and combine their votes into an ensemble result.
   */
  evaluate(
    candles: Candle[],
    marketState: MarketState,
    ticker?: Ticker,
    fearGreedIndex?: number,
    newsSentiment?: number,
  ): EnsembleResult {
    const ctx: AlphaModelContext = {
      candles,
      ticker,
      marketState,
      fearGreedIndex,
      newsSentiment,
    };

    // Collect votes from all models
    const votes = this.models.map(model => model.vote(ctx));

    // Weighted combination
    let totalWeight = 0;
    let weightedDirection = 0;
    let weightedConfidence = 0;
    let weightedReturn = 0;
    let weightedRisk = 0;

    for (const vote of votes) {
      if (vote.weight <= 0 || vote.direction === 0) continue;

      const effectiveWeight = vote.weight * vote.confidence;
      totalWeight += effectiveWeight;
      weightedDirection += vote.direction * effectiveWeight;
      weightedConfidence += vote.confidence * effectiveWeight;
      weightedReturn += vote.expectedReturnBps * effectiveWeight;
      weightedRisk += vote.expectedRiskBps * effectiveWeight;
    }

    if (totalWeight === 0) {
      return {
        direction: 0,
        confidence: 0,
        expectedEdgeBps: 0,
        expectedRiskBps: 0,
        edgeRatio: 0,
        votes,
        consensusLevel: 0,
        dominantModel: null,
      };
    }

    const normalizedDirection = weightedDirection / totalWeight;
    // Lower threshold from 0.3 to 0.15 — in ranging markets models often partially
    // agree but can't reach 0.3 consensus, causing perpetual "no direction" blocks
    const direction: EnsembleResult['direction'] =
      normalizedDirection > 0.15 ? 1 : normalizedDirection < -0.15 ? -1 : 0;

    const confidence = Math.min(1, weightedConfidence / totalWeight);
    const expectedEdgeBps = Math.round(weightedReturn / totalWeight);
    const expectedRiskBps = Math.round(weightedRisk / totalWeight);
    const edgeRatio = expectedRiskBps > 0 ? expectedEdgeBps / expectedRiskBps : 0;

    // Consensus: how many non-neutral models agree on direction
    const activeVotes = votes.filter(v => v.direction !== 0 && v.weight > 0);
    const agreeCount = activeVotes.filter(v => v.direction === direction).length;
    const consensusLevel = activeVotes.length > 0 ? agreeCount / activeVotes.length : 0;

    // Dominant model: highest weighted contribution
    let dominantModel: EnsembleResult['dominantModel'] = null;
    let maxContrib = 0;
    for (const vote of votes) {
      const contrib = Math.abs(vote.direction) * vote.weight * vote.confidence;
      if (contrib > maxContrib) {
        maxContrib = contrib;
        dominantModel = vote.modelId;
      }
    }

    return {
      direction,
      confidence,
      expectedEdgeBps,
      expectedRiskBps,
      edgeRatio,
      votes,
      consensusLevel,
      dominantModel,
    };
  }
}
