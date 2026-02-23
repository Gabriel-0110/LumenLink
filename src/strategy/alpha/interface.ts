/**
 * Alpha Model Interface — contract for all signal models in the ensemble.
 */

import type { Candle, Ticker } from '../../core/types.js';
import type { AlphaVote, MarketState } from '../types.js';

export interface AlphaModelContext {
  candles: Candle[];
  ticker?: Ticker;
  marketState: MarketState;
  fearGreedIndex?: number;
  newsSentiment?: number;
}

export interface AlphaModel {
  readonly id: AlphaVote['modelId'];
  readonly name: string;

  /** Which regimes this model is designed for. */
  readonly supportedRegimes: MarketState['regime'][];

  /** Produce a vote given current market context. */
  vote(ctx: AlphaModelContext): AlphaVote;
}
