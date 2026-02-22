import type { Strategy } from './interface.js';
import { RsiMeanReversionStrategy } from './rsiMeanReversion.js';
import { EmaCrossoverStrategy } from './emaCrossover.js';
import { CompositeExampleStrategy } from './compositeExample.js';
import { AdvancedCompositeStrategy } from './advancedComposite.js';
import { GridTradingStrategy } from './gridTrading.js';
import { SmartDCAStrategy } from './smartDCA.js';
import { RegimeAwareCompositeStrategy } from './regimeAwareComposite.js';

export function createStrategy(name: string): Strategy {
  switch (name) {
    case 'rsi_mean_reversion':
      return new RsiMeanReversionStrategy();
    case 'ema_crossover':
      return new EmaCrossoverStrategy();
    case 'composite':
      return new CompositeExampleStrategy();
    case 'advanced_composite':
      return new AdvancedCompositeStrategy();
    case 'grid_trading':
      return new GridTradingStrategy();
    case 'smart_dca':
      return new SmartDCAStrategy();
    case 'regime_aware':
      return new RegimeAwareCompositeStrategy();
    default:
      // Default to regime-aware composite — best overall strategy
      return new RegimeAwareCompositeStrategy();
  }
}