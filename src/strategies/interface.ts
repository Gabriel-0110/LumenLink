import type { Candle, Signal } from '../core/types.js';
import type { MTFResult } from './multiTimeframe.js';

/** Optional external signals that strategies can use for context-aware decisions. */
export interface StrategyContextExtras {
  /** Fear & Greed index 0-100. <20 = Extreme Fear, >80 = Extreme Greed. */
  fearGreedIndex?: number;
  /** News sentiment score -1 (very negative) to +1 (very positive). */
  newsSentiment?: number;
}

export interface StrategyContext {
  candles: Candle[];
  symbol: string;
  mtfResult?: MTFResult;       // Optional multi-timeframe data
  sentiment?: StrategyContextExtras;
}

export interface Strategy {
  readonly name: string;
  onCandle(candle: Candle, context: StrategyContext): Signal;
}
