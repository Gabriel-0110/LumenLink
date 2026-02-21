import type { Candle, Signal } from '../core/types.js';
import type { MTFResult } from './multiTimeframe.js';

export interface StrategyContext {
  candles: Candle[];
  symbol: string;
  mtfResult?: MTFResult;  // Optional multi-timeframe data
}

export interface Strategy {
  readonly name: string;
  onCandle(candle: Candle, context: StrategyContext): Signal;
}
