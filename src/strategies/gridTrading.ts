import { ADX, BollingerBands } from 'technicalindicators';
import type { Candle, Signal } from '../core/types.js';
import type { Strategy, StrategyContext } from './interface.js';

interface GridConfig {
  gridLevels: number;       // e.g. 10 levels
  gridSpacingPercent: number; // e.g. 1.0 = 1% between levels
}

export class GridTradingStrategy implements Strategy {
  readonly name = 'grid_trading';

  private gridLevels: number[] = [];
  private lastGridIndex: number = -1;
  private gridCenter: number = 0;

  constructor(private config: GridConfig = { gridLevels: 10, gridSpacingPercent: 1.0 }) {}

  onCandle(candle: Candle, context: StrategyContext): Signal {
    const { candles } = context;

    // Need enough data for ADX (14) + Bollinger Bands (20) + buffer
    if (candles.length < 50) {
      return {
        action: 'HOLD',
        confidence: 0.1,
        reason: 'Insufficient data for grid trading (need 50+ candles)'
      };
    }

    try {
      // Calculate indicators
      const closes = candles.map(c => c.close);
      const highs = candles.map(c => c.high);
      const lows = candles.map(c => c.low);

      // Check if market is ranging using ADX
      const adxArr = ADX.calculate({
        high: highs,
        low: lows,
        close: closes,
        period: 14
      });
      const latestADX = adxArr[adxArr.length - 1];

      if (!latestADX) {
        return {
          action: 'HOLD',
          confidence: 0.1,
          reason: 'ADX calculation failed'
        };
      }

      // If ADX > 25, market is trending - not suitable for grid trading
      if (latestADX.adx > 25) {
        return {
          action: 'HOLD',
          confidence: 0.2,
          reason: `Trending market (ADX ${latestADX.adx.toFixed(1)}) - grid not suitable`
        };
      }

      // Calculate Bollinger Bands for grid center
      const bbArr = BollingerBands.calculate({
        values: closes,
        period: 20,
        stdDev: 2
      });
      const latestBB = bbArr[bbArr.length - 1];

      if (!latestBB) {
        return {
          action: 'HOLD',
          confidence: 0.1,
          reason: 'Bollinger Bands calculation failed'
        };
      }

      // Set grid center as Bollinger Band middle (SMA 20)
      this.gridCenter = latestBB.middle;
      
      // Generate grid levels
      this.generateGridLevels();

      const currentPrice = candle.close;
      const newGridIndex = this.findGridIndex(currentPrice);

      if (newGridIndex === -1) {
        return {
          action: 'HOLD',
          confidence: 0.2,
          reason: 'Price outside grid range'
        };
      }

      // First time - just record position
      if (this.lastGridIndex === -1) {
        this.lastGridIndex = newGridIndex;
        return {
          action: 'HOLD',
          confidence: 0.3,
          reason: 'Initializing grid position'
        };
      }

      // Check for grid level crossings
      if (newGridIndex !== this.lastGridIndex) {
        const signal = this.generateGridSignal(this.lastGridIndex, newGridIndex, currentPrice, latestBB);
        this.lastGridIndex = newGridIndex;
        return signal;
      }

      return {
        action: 'HOLD',
        confidence: 0.3,
        reason: `Ranging market (ADX ${latestADX.adx.toFixed(1)}) - no grid crossing`
      };

    } catch (error) {
      return {
        action: 'HOLD',
        confidence: 0.1,
        reason: `Grid calculation error: ${String(error)}`
      };
    }
  }

  private generateGridLevels(): void {
    this.gridLevels = [];
    const spacing = this.gridCenter * (this.config.gridSpacingPercent / 100);
    
    // Generate levels above and below center
    const halfLevels = Math.floor(this.config.gridLevels / 2);
    
    for (let i = -halfLevels; i <= halfLevels; i++) {
      this.gridLevels.push(this.gridCenter + (i * spacing));
    }
    
    // Sort levels from lowest to highest
    this.gridLevels.sort((a, b) => a - b);
  }

  private findGridIndex(price: number): number {
    // Find which grid level the price is closest to
    let closestIndex = -1;
    let closestDistance = Infinity;

    for (let i = 0; i < this.gridLevels.length; i++) {
      const distance = Math.abs(price - this.gridLevels[i]!);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = i;
      }
    }

    return closestIndex;
  }

  private generateGridSignal(
    previousIndex: number,
    currentIndex: number,
    currentPrice: number,
    bb: { upper: number; middle: number; lower: number }
  ): Signal {
    // Price crossed DOWN through a grid level → BUY signal
    if (currentIndex < previousIndex) {
      const confidence = this.calculateConfidence(currentPrice, bb, 'buy');
      return {
        action: 'BUY',
        confidence,
        reason: `Grid buy signal - price ${currentPrice.toFixed(2)} crossed down from level ${previousIndex} to ${currentIndex}`
      };
    }

    // Price crossed UP through a grid level → SELL signal
    if (currentIndex > previousIndex) {
      const confidence = this.calculateConfidence(currentPrice, bb, 'sell');
      return {
        action: 'SELL',
        confidence,
        reason: `Grid sell signal - price ${currentPrice.toFixed(2)} crossed up from level ${previousIndex} to ${currentIndex}`
      };
    }

    return {
      action: 'HOLD',
      confidence: 0.3,
      reason: 'No grid level change detected'
    };
  }

  private calculateConfidence(
    currentPrice: number,
    bb: { upper: number; middle: number; lower: number },
    action: 'buy' | 'sell'
  ): number {
    // Base confidence
    let confidence = 0.6;

    // Boost confidence when near Bollinger Band extremes
    const bbRange = bb.upper - bb.lower;
    if (bbRange > 0) {
      const bbPosition = (currentPrice - bb.lower) / bbRange;
      
      if (action === 'buy') {
        // Higher confidence for buys when price is near lower BB
        if (bbPosition <= 0.2) {
          confidence += 0.25; // Near lower band = good buy opportunity
        } else if (bbPosition <= 0.4) {
          confidence += 0.15; // Somewhat near lower band
        }
      } else if (action === 'sell') {
        // Higher confidence for sells when price is near upper BB
        if (bbPosition >= 0.8) {
          confidence += 0.25; // Near upper band = good sell opportunity
        } else if (bbPosition >= 0.6) {
          confidence += 0.15; // Somewhat near upper band
        }
      }
    }

    // Cap confidence at 0.9
    return Math.min(0.9, confidence);
  }
}