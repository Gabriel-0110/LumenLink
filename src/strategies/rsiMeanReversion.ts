import { RSI } from 'technicalindicators';
import type { Candle, Signal } from '../core/types.js';
import type { Strategy, StrategyContext } from './interface.js';

export class RsiMeanReversionStrategy implements Strategy {
  readonly name = 'rsi_mean_reversion';

  constructor(
    private readonly period = 14,
    private readonly oversold = 30,
    private readonly overbought = 70
  ) {}

  onCandle(_candle: Candle, context: StrategyContext): Signal {
    const closes = context.candles.map((c) => c.close);
    if (closes.length < this.period + 1) {
      return { action: 'HOLD', confidence: 0.1, reason: 'Insufficient lookback for RSI' };
    }

    const rsiValues = RSI.calculate({ values: closes, period: this.period });
    if (rsiValues.length === 0) {
      return { action: 'HOLD', confidence: 0.1, reason: 'RSI calculation failed' };
    }

    const value = rsiValues[rsiValues.length - 1];
    
    // Check for undefined RSI value
    if (value == null) {
      return { action: 'HOLD', confidence: 0.1, reason: 'RSI value is undefined' };
    }
    
    if (value <= this.oversold) {
      const confidence = Math.min(0.95, 0.65 + (this.oversold - value) / 20 * 0.2);
      return { action: 'BUY', confidence, reason: `RSI oversold (${value.toFixed(2)})` };
    }
    if (value >= this.overbought) {
      const confidence = Math.min(0.95, 0.65 + (value - this.overbought) / 20 * 0.2);
      return { action: 'SELL', confidence, reason: `RSI overbought (${value.toFixed(2)})` };
    }
    return { action: 'HOLD', confidence: 0.3, reason: `RSI neutral (${value.toFixed(2)})` };
  }
}
