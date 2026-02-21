import { EMA } from 'technicalindicators';
import type { Candle, Signal } from '../core/types.js';
import type { Strategy, StrategyContext } from './interface.js';

export class EmaCrossoverStrategy implements Strategy {
  readonly name = 'ema_crossover';

  constructor(
    private readonly fastPeriod = 9,
    private readonly slowPeriod = 21
  ) {}

  onCandle(_candle: Candle, context: StrategyContext): Signal {
    const closes = context.candles.map((c) => c.close);
    if (closes.length < this.slowPeriod + 2) {
      return { action: 'HOLD', confidence: 0.1, reason: 'Insufficient lookback for EMA crossover' };
    }

    // Calculate EMAs
    const fastEMA = EMA.calculate({ values: closes, period: this.fastPeriod });
    const slowEMA = EMA.calculate({ values: closes, period: this.slowPeriod });

    if (fastEMA.length < 2 || slowEMA.length < 2) {
      return { action: 'HOLD', confidence: 0.1, reason: 'Insufficient EMA data' };
    }

    const prevFast = fastEMA[fastEMA.length - 2];
    const prevSlow = slowEMA[slowEMA.length - 2];
    const currFast = fastEMA[fastEMA.length - 1];
    const currSlow = slowEMA[slowEMA.length - 1];

    // Check for undefined values
    if (prevFast == null || prevSlow == null || currFast == null || currSlow == null) {
      return { action: 'HOLD', confidence: 0.1, reason: 'EMA values are undefined' };
    }

    // Golden cross (bullish)
    if (prevFast <= prevSlow && currFast > currSlow) {
      const confidence = Math.min(0.9, 0.7 + Math.abs(currFast - currSlow) / currSlow * 2);
      return { action: 'BUY', confidence, reason: `Fast EMA (${currFast.toFixed(2)}) crossed above slow EMA (${currSlow.toFixed(2)})` };
    }
    
    // Death cross (bearish)
    if (prevFast >= prevSlow && currFast < currSlow) {
      const confidence = Math.min(0.9, 0.7 + Math.abs(currFast - currSlow) / currSlow * 2);
      return { action: 'SELL', confidence, reason: `Fast EMA (${currFast.toFixed(2)}) crossed below slow EMA (${currSlow.toFixed(2)})` };
    }
    
    return { action: 'HOLD', confidence: 0.3, reason: `No EMA crossover (Fast: ${currFast.toFixed(2)}, Slow: ${currSlow.toFixed(2)})` };
  }
}
