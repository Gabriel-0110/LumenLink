import type { Position, Ticker } from '../core/types.js';

export interface TrailingStopConfig {
  symbol: string;
  initialStopPercent: number; // e.g., 0.05 for 5%
  trailPercent: number; // e.g., 0.02 for 2%
}

export interface TrailingStop {
  symbol: string;
  side: 'buy' | 'sell'; // Original position side
  currentStopPrice: number;
  highestPrice: number; // For long positions
  lowestPrice: number; // For short positions
  initialStopPercent: number;
  trailPercent: number;
  createdAt: number;
  updatedAt: number;
}

export class TrailingStopManager {
  private stops = new Map<string, TrailingStop>();

  addTrailingStop(
    position: Position,
    config: TrailingStopConfig,
    currentPrice: number,
    nowMs: number = Date.now()
  ): TrailingStop {
    const isLong = position.quantity > 0;
    const initialStopPrice = isLong
      ? currentPrice * (1 - config.initialStopPercent)
      : currentPrice * (1 + config.initialStopPercent);

    const stop: TrailingStop = {
      symbol: config.symbol,
      side: isLong ? 'buy' : 'sell',
      currentStopPrice: initialStopPrice,
      highestPrice: isLong ? currentPrice : 0,
      lowestPrice: isLong ? 0 : currentPrice,
      initialStopPercent: config.initialStopPercent,
      trailPercent: config.trailPercent,
      createdAt: nowMs,
      updatedAt: nowMs
    };

    this.stops.set(config.symbol, stop);
    return stop;
  }

  updateTrailingStops(ticker: Ticker, nowMs: number = Date.now()): string[] {
    const triggeredSymbols: string[] = [];
    const stop = this.stops.get(ticker.symbol);
    
    if (!stop) return triggeredSymbols;

    const currentPrice = ticker.last;
    const isLong = stop.side === 'buy';

    if (isLong) {
      // Long position: trail up, stop if price falls below trailing stop
      if (currentPrice > stop.highestPrice) {
        // New high, update trailing stop
        stop.highestPrice = currentPrice;
        stop.currentStopPrice = currentPrice * (1 - stop.trailPercent);
        stop.updatedAt = nowMs;
      }
      
      // Check if stop is triggered
      if (currentPrice <= stop.currentStopPrice) {
        triggeredSymbols.push(ticker.symbol);
      }
    } else {
      // Short position: trail down, stop if price rises above trailing stop
      if (currentPrice < stop.lowestPrice || stop.lowestPrice === 0) {
        // New low, update trailing stop
        stop.lowestPrice = currentPrice;
        stop.currentStopPrice = currentPrice * (1 + stop.trailPercent);
        stop.updatedAt = nowMs;
      }
      
      // Check if stop is triggered
      if (currentPrice >= stop.currentStopPrice) {
        triggeredSymbols.push(ticker.symbol);
      }
    }

    return triggeredSymbols;
  }

  removeTrailingStop(symbol: string): boolean {
    return this.stops.delete(symbol);
  }

  getTrailingStop(symbol: string): TrailingStop | undefined {
    return this.stops.get(symbol);
  }

  getAllTrailingStops(): TrailingStop[] {
    return Array.from(this.stops.values());
  }

  hasTrailingStop(symbol: string): boolean {
    return this.stops.has(symbol);
  }

  clear(): void {
    this.stops.clear();
  }
}