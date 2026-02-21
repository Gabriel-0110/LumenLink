import { describe, expect, it, beforeEach } from 'vitest';
import { TrailingStopManager } from '../../src/execution/trailingStop.js';

describe('TrailingStopManager', () => {
  let manager: TrailingStopManager;

  beforeEach(() => {
    manager = new TrailingStopManager({
      activationProfitPercent: 2.0, // 2% profit to activate
      trailPercent: 1.0,            // Trail 1% below high
      atrMultiplier: 2.0           // ATR-based alternative
    });
  });

  it('should create and track a new position', () => {
    manager.openPosition('BTC-USD', 50000);
    
    const positions = manager.getPositions();
    expect(positions).toHaveLength(1);
    expect(positions[0]?.symbol).toBe('BTC-USD');
    expect(positions[0]?.entryPrice).toBe(50000);
    expect(positions[0]?.activated).toBe(false);
  });

  it('should not exit before activation threshold', () => {
    manager.openPosition('BTC-USD', 50000);
    
    // Price up 1% - not enough to activate (need 2%)
    const result = manager.update('BTC-USD', 50500);
    
    expect(result.shouldExit).toBe(false);
    expect(result.reason).toContain('Waiting for 2% profit');
  });

  it('should activate trailing stop after profit threshold', () => {
    manager.openPosition('BTC-USD', 50000);
    
    // Price up 2.5% - should activate trailing stop
    const result = manager.update('BTC-USD', 51250);
    
    expect(result.shouldExit).toBe(false);
    expect(result.reason).toContain('Trailing stop activated');
    
    const position = manager.getPosition('BTC-USD');
    expect(position?.activated).toBe(true);
    expect(position?.highestPrice).toBe(51250);
  });

  it('should trigger exit when price falls below trailing stop', () => {
    manager.openPosition('BTC-USD', 50000);
    
    // Activate at 2.5% profit
    manager.update('BTC-USD', 51250);
    
    // Price goes higher - should update trailing stop
    manager.update('BTC-USD', 52000);
    
    // Price falls below trailing stop (1% below 52000 = 51480)
    const result = manager.update('BTC-USD', 51000);
    
    expect(result.shouldExit).toBe(true);
    expect(result.reason).toContain('Trailing stop triggered');
  });

  it('should use ATR-based trailing when ATR is provided', () => {
    manager.openPosition('BTC-USD', 50000);
    
    // Activate trailing stop
    manager.update('BTC-USD', 51250);
    
    // Update with ATR - should use ATR * multiplier instead of percentage
    const atr = 500; // $500 ATR
    manager.update('BTC-USD', 52000, atr);
    
    const position = manager.getPosition('BTC-USD');
    // With ATR = 500 and multiplier = 2.0, stop should be 52000 - (500 * 2) = 51000
    expect(position?.currentStopPrice).toBe(51000);
  });

  it('should close and remove position', () => {
    manager.openPosition('BTC-USD', 50000);
    expect(manager.hasPosition('BTC-USD')).toBe(true);
    
    manager.closePosition('BTC-USD');
    expect(manager.hasPosition('BTC-USD')).toBe(false);
    expect(manager.getPositions()).toHaveLength(0);
  });

  it('should handle multiple positions independently', () => {
    manager.openPosition('BTC-USD', 50000);
    manager.openPosition('ETH-USD', 3000);
    
    expect(manager.getPositions()).toHaveLength(2);
    
    // Activate trailing stop for BTC only
    manager.update('BTC-USD', 51250);
    manager.update('ETH-USD', 3050); // Only 1.67% profit, not enough
    
    const btcPosition = manager.getPosition('BTC-USD');
    const ethPosition = manager.getPosition('ETH-USD');
    
    expect(btcPosition?.activated).toBe(true);
    expect(ethPosition?.activated).toBe(false);
  });
});