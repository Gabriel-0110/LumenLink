import type { Candle, Signal } from '../core/types.js';
import { EmaCrossoverStrategy } from './emaCrossover.js';
import type { Strategy, StrategyContext } from './interface.js';
import { RsiMeanReversionStrategy } from './rsiMeanReversion.js';

export class CompositeExampleStrategy implements Strategy {
  readonly name = 'composite';
  private readonly ema = new EmaCrossoverStrategy();
  private readonly rsi = new RsiMeanReversionStrategy();

  onCandle(candle: Candle, context: StrategyContext): Signal {
    const emaSignal = this.ema.onCandle(candle, context);
    const rsiSignal = this.rsi.onCandle(candle, context);

    if (emaSignal.action === rsiSignal.action && emaSignal.action !== 'HOLD') {
      return {
        action: emaSignal.action,
        confidence: Math.min(1, (emaSignal.confidence + rsiSignal.confidence) / 2 + 0.1),
        reason: `Composite agreement: ${emaSignal.reason}; ${rsiSignal.reason}`
      };
    }

    return {
      action: 'HOLD',
      confidence: 0.35,
      reason: `Composite hold: ema=${emaSignal.action}, rsi=${rsiSignal.action}`
    };
  }
}
