import type { Candle, Signal } from '../core/types.js';

export interface StrategyContext {
  candles: Candle[];
  symbol: string;
}

export interface Strategy {
  readonly name: string;
  onCandle(candle: Candle, context: StrategyContext): Signal;
}
