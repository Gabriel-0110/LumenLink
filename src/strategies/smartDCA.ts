import { RSI } from 'technicalindicators';
import type { Candle, Signal } from '../core/types.js';
import type { Strategy, StrategyContext } from './interface.js';

interface SmartDCAConfig {
  baseInterval: number; // hours between buys
  maxConfidence: number; // maximum confidence level (default 0.9)
}

export class SmartDCAStrategy implements Strategy {
  readonly name = 'smart_dca';

  private lastBuyTime: number = 0;

  constructor(private config: SmartDCAConfig = { baseInterval: 24, maxConfidence: 0.9 }) {}

  onCandle(candle: Candle, context: StrategyContext): Signal {
    const { candles } = context;

    // Need enough data for RSI calculation
    if (candles.length < 20) {
      return {
        action: 'HOLD',
        confidence: 0.1,
        reason: 'Insufficient data for Smart DCA (need 20+ candles)'
      };
    }

    try {
      // Check if it's time for a DCA buy based on base interval
      const currentTime = candle.time;
      const hoursInMs = this.config.baseInterval * 60 * 60 * 1000;

      if (this.lastBuyTime === 0) {
        // First run - set last buy time and don't buy immediately
        this.lastBuyTime = currentTime;
        return {
          action: 'HOLD',
          confidence: 0.3,
          reason: 'Smart DCA initialized - waiting for next interval'
        };
      }

      const timeSinceLastBuy = currentTime - this.lastBuyTime;
      if (timeSinceLastBuy < hoursInMs) {
        const hoursRemaining = (hoursInMs - timeSinceLastBuy) / (60 * 60 * 1000);
        return {
          action: 'HOLD',
          confidence: 0.3,
          reason: `Next DCA buy in ${hoursRemaining.toFixed(1)} hours`
        };
      }

      // Time for a potential DCA buy - calculate confidence based on sentiment and RSI
      let baseConfidence = 0.6; // Base DCA confidence
      const reasons: string[] = ['DCA interval reached'];

      // Apply sentiment adjustment if available
      const sentimentData = (context as any).sentiment;
      if (sentimentData?.fearGreedIndex !== undefined) {
        const fearGreed = sentimentData.fearGreedIndex;
        const sentimentMultiplier = this.calculateSentimentMultiplier(fearGreed);
        
        if (sentimentMultiplier === 0) {
          // Extreme greed - skip this DCA buy
          return {
            action: 'HOLD',
            confidence: 0.2,
            reason: `Extreme Greed (${fearGreed}) - skipping DCA buy`
          };
        }

        baseConfidence *= sentimentMultiplier;
        reasons.push(`Fear&Greed: ${fearGreed} (${this.getFearGreedLabel(fearGreed)})`);
      } else {
        reasons.push('No sentiment data - using default confidence');
      }

      // Apply RSI overlay
      const closes = candles.map(c => c.close);
      const rsiArr = RSI.calculate({ values: closes, period: 14 });
      const currentRSI = rsiArr[rsiArr.length - 1];

      if (currentRSI !== undefined) {
        if (currentRSI < 30) {
          baseConfidence += 0.15; // Oversold = better entry
          reasons.push(`RSI oversold (${currentRSI.toFixed(1)})`);
        } else if (currentRSI > 70) {
          baseConfidence -= 0.15; // Overbought = worse entry
          reasons.push(`RSI overbought (${currentRSI.toFixed(1)})`);
        } else {
          reasons.push(`RSI neutral (${currentRSI.toFixed(1)})`);
        }
      } else {
        reasons.push('RSI calculation failed');
      }

      // Cap confidence at configured maximum
      const finalConfidence = Math.max(0.1, Math.min(this.config.maxConfidence, baseConfidence));

      // Update last buy time
      this.lastBuyTime = currentTime;

      return {
        action: 'BUY',
        confidence: finalConfidence,
        reason: `Smart DCA: ${reasons.join(' | ')}`
      };

    } catch (error) {
      return {
        action: 'HOLD',
        confidence: 0.1,
        reason: `Smart DCA calculation error: ${String(error)}`
      };
    }
  }

  private calculateSentimentMultiplier(fearGreedIndex: number): number {
    // Fear & Greed Index ranges from 0 (Extreme Fear) to 100 (Extreme Greed)
    
    if (fearGreedIndex < 25) {
      // Extreme Fear (0-24): BUY with 2x confidence (buy the fear)
      return 2.0;
    } else if (fearGreedIndex < 45) {
      // Fear (25-44): BUY with 1.5x confidence
      return 1.5;
    } else if (fearGreedIndex < 55) {
      // Neutral (45-54): BUY with normal confidence
      return 1.0;
    } else if (fearGreedIndex < 75) {
      // Greed (55-74): BUY with 0.5x confidence (slow down)
      return 0.5;
    } else {
      // Extreme Greed (75-100): HOLD (skip this DCA buy)
      return 0; // This will trigger a HOLD signal
    }
  }

  private getFearGreedLabel(fearGreedIndex: number): string {
    if (fearGreedIndex < 25) return 'Extreme Fear';
    if (fearGreedIndex < 45) return 'Fear';
    if (fearGreedIndex < 55) return 'Neutral';
    if (fearGreedIndex < 75) return 'Greed';
    return 'Extreme Greed';
  }
}