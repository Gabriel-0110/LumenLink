export interface TrailingStopConfig {
  activationProfitPercent: number;  // e.g. 1.0 = activate after 1% profit
  trailPercent: number;             // e.g. 2.0 = trail 2% below highest price
  atrMultiplier?: number;           // alternative: trail by ATR * multiplier
}

export interface TrackedPosition {
  symbol: string;
  entryPrice: number;
  highestPrice: number;
  currentStopPrice: number;
  activated: boolean;
  entryTime: number;
}

export class TrailingStopManager {
  private positions: Map<string, TrackedPosition> = new Map();

  constructor(private config: TrailingStopConfig) {}

  // Call on every price update
  update(symbol: string, currentPrice: number, atr?: number): { shouldExit: boolean; reason: string } {
    const position = this.positions.get(symbol);
    if (!position) {
      return { shouldExit: false, reason: 'No tracked position' };
    }

    const profitPercent = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;

    // Check if we should activate trailing stop
    if (!position.activated && profitPercent >= this.config.activationProfitPercent) {
      position.activated = true;
      position.highestPrice = currentPrice;
      
      // Calculate initial stop price
      if (atr && this.config.atrMultiplier) {
        // Use ATR-based trailing (more adaptive)
        position.currentStopPrice = currentPrice - (atr * this.config.atrMultiplier);
      } else {
        // Use percentage-based trailing
        position.currentStopPrice = currentPrice * (1 - this.config.trailPercent / 100);
      }
      
      return { shouldExit: false, reason: `Trailing stop activated at ${profitPercent.toFixed(2)}% profit` };
    }

    // If not activated yet, no exit
    if (!position.activated) {
      return { shouldExit: false, reason: `Waiting for ${this.config.activationProfitPercent}% profit (current: ${profitPercent.toFixed(2)}%)` };
    }

    // Update highest price and trailing stop
    if (currentPrice > position.highestPrice) {
      position.highestPrice = currentPrice;
      
      // Update stop price
      if (atr && this.config.atrMultiplier) {
        // ATR-based trailing - more adaptive to volatility
        const newStopPrice = currentPrice - (atr * this.config.atrMultiplier);
        // Only move stop up, never down
        position.currentStopPrice = Math.max(position.currentStopPrice, newStopPrice);
      } else {
        // Percentage-based trailing
        const newStopPrice = currentPrice * (1 - this.config.trailPercent / 100);
        position.currentStopPrice = Math.max(position.currentStopPrice, newStopPrice);
      }
    }

    // Check if we should exit
    if (currentPrice <= position.currentStopPrice) {
      const finalProfitPercent = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
      const trailMethod = (atr && this.config.atrMultiplier) ? 'ATR-based' : 'percentage-based';
      return {
        shouldExit: true,
        reason: `Trailing stop triggered (${trailMethod}). Entry: $${position.entryPrice.toFixed(4)}, High: $${position.highestPrice.toFixed(4)}, Stop: $${position.currentStopPrice.toFixed(4)}, Final profit: ${finalProfitPercent.toFixed(2)}%`
      };
    }

    return { shouldExit: false, reason: `Trailing: Stop at $${position.currentStopPrice.toFixed(4)} (trailing high: $${position.highestPrice.toFixed(4)})` };
  }

  // Register a new position
  openPosition(symbol: string, entryPrice: number): void {
    this.positions.set(symbol, {
      symbol,
      entryPrice,
      highestPrice: entryPrice,
      currentStopPrice: 0, // Will be set when activated
      activated: false,
      entryTime: Date.now()
    });
  }

  // Remove position
  closePosition(symbol: string): void {
    this.positions.delete(symbol);
  }

  // Get all tracked positions
  getPositions(): TrackedPosition[] {
    return Array.from(this.positions.values());
  }

  // Check if position is being tracked
  hasPosition(symbol: string): boolean {
    return this.positions.has(symbol);
  }

  // Get specific position info
  getPosition(symbol: string): TrackedPosition | undefined {
    return this.positions.get(symbol);
  }

  // Clear all positions (useful for testing)
  clear(): void {
    this.positions.clear();
  }
}