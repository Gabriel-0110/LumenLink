/**
 * Regime-Aware Composite Strategy
 *
 * Detects the market regime on every candle and routes to the most appropriate
 * sub-strategy, dynamically adjusting the signal threshold:
 *
 *   high_volatility  → HOLD    (no new entries — too dangerous)
 *   ranging          → RsiMeanReversion (profit from oscillations)
 *   breakout         → AdvancedComposite(threshold 3.5) — wait for strong breakout confirmation
 *   trending_up/down → AdvancedComposite(threshold 1.5 if ADX>40, else 2.0) — ride the trend
 *
 * This replaces static strategy selection and is the recommended default strategy.
 */

import type { Candle, Signal } from '../core/types.js';
import type { Strategy, StrategyContext } from './interface.js';
import { RegimeDetector } from './regimeDetector.js';
import { AdvancedCompositeStrategy } from './advancedComposite.js';
import { RsiMeanReversionStrategy } from './rsiMeanReversion.js';

export class RegimeAwareCompositeStrategy implements Strategy {
  readonly name = 'regime_aware';

  private readonly regimeDetector = new RegimeDetector();

  // Pre-instantiated strategy variants with 5m-tuned score thresholds
  private readonly trendingStrong = new AdvancedCompositeStrategy({ minScoreThreshold: 0.8 }); // was 1.5
  private readonly trendingNormal = new AdvancedCompositeStrategy({ minScoreThreshold: 1.2 }); // was 2.0
  private readonly breakoutStrict = new AdvancedCompositeStrategy({ minScoreThreshold: 2.0 }); // was 3.5
  private readonly rangingMeanRev = new RsiMeanReversionStrategy(14, 30, 70);

  onCandle(candle: Candle, context: StrategyContext): Signal {
    const { candles } = context;

    if (candles.length < 100) {
      return {
        action: 'HOLD',
        confidence: 0.1,
        reason: 'Insufficient data for regime detection (need 100+ candles)',
      };
    }

    const regime = this.regimeDetector.detect(candles);

    // ── 1. High volatility → no new entries ───────────────────
    if (regime.regime === 'high_volatility') {
      return {
        action: 'HOLD',
        confidence: 0.05,
        reason: `BLOCKED: High volatility regime — ${regime.details}`,
      };
    }

    // ── 2. Ranging → mean reversion is more appropriate ───────
    if (regime.regime === 'ranging') {
      // Use AdvancedComposite with a moderate threshold in ranging markets —
      // RSI mean reversion only fires at RSI extremes (<38 / >62) which rarely
      // occur on 5m BTC. AdvancedComposite uses 10+ indicators and fires more often.
      const signal = this.trendingNormal.onCandle(candle, context);
      return {
        ...signal,
        reason: `[Ranging regime, ADX:${regime.adx.toFixed(0)}] ${signal.reason}`,
      };
    }

    // ── 3. Breakout → advanced composite with strict threshold ─
    if (regime.regime === 'breakout') {
      const signal = this.breakoutStrict.onCandle(candle, context);
      return {
        ...signal,
        reason: `[Breakout regime] ${signal.reason}`,
      };
    }

    // ── 4. Trending up/down → advanced composite ──────────────
    // Use a tighter threshold in strong trends (ADX > 28) to catch moves earlier — was 40, 5m ADX rarely hits 40
    const strategy = regime.adx > 28 ? this.trendingStrong : this.trendingNormal;
    const signal = strategy.onCandle(candle, context);
    const regimeLabel = regime.regime === 'trending_up' ? 'Trending↑' : 'Trending↓';
    return {
      ...signal,
      reason: `[${regimeLabel}, ADX:${regime.adx.toFixed(0)}, conf:${(regime.confidence * 100).toFixed(0)}%] ${signal.reason}`,
    };
  }
}
