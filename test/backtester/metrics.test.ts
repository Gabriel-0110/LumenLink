import { describe, it, expect } from 'vitest';
import { computeMetrics } from '../../src/backtester/metrics.js';
import type { BacktestTrade } from '../../src/backtester/metrics.js';

function makeTrade(overrides: Partial<BacktestTrade> = {}): BacktestTrade {
  return {
    symbol: 'BTC-USD',
    side: 'long',
    entryPrice: 50000,
    exitPrice: 51000,
    entryTime: 1000000,
    exitTime: 2000000,
    pnlUsd: 100,
    pnlPercent: 2,
    positionSizeUsd: 5000,
    commission: 10,
    slippage: 10,
    reason: 'take_profit',
    barsHeld: 5,
    ...overrides,
  };
}

describe('computeMetrics', () => {
  it('returns zeros for empty data', () => {
    const m = computeMetrics([], [], 10000, 0);
    expect(m.totalTrades).toBe(0);
    expect(m.totalReturn).toBe(0);
    expect(m.sharpeRatio).toBe(0);
  });

  it('calculates totalReturn correctly', () => {
    const equity = [
      { time: 0, equity: 10000 },
      { time: 86400000, equity: 10500 },
      { time: 172800000, equity: 11000 },
    ];
    const m = computeMetrics([], equity, 10000, 100);
    expect(m.totalReturn).toBeCloseTo(10, 1);
  });

  it('calculates max drawdown', () => {
    const equity = [
      { time: 0, equity: 10000 },
      { time: 86400000, equity: 12000 },
      { time: 172800000, equity: 9000 },
      { time: 259200000, equity: 11000 },
    ];
    const m = computeMetrics([], equity, 10000, 100);
    // Peak 12000, trough 9000 => 25%
    expect(m.maxDrawdown).toBeCloseTo(25, 1);
  });

  it('calculates win rate', () => {
    const trades = [
      makeTrade({ pnlPercent: 5, pnlUsd: 250 }),
      makeTrade({ pnlPercent: -3, pnlUsd: -150 }),
      makeTrade({ pnlPercent: 2, pnlUsd: 100 }),
    ];
    const equity = [
      { time: 0, equity: 10000 },
      { time: 86400000, equity: 10200 },
    ];
    const m = computeMetrics(trades, equity, 10000, 100);
    expect(m.totalTrades).toBe(3);
    expect(m.winRate).toBeCloseTo(66.67, 0);
  });

  it('calculates profit factor', () => {
    const trades = [
      makeTrade({ pnlPercent: 5, pnlUsd: 500 }),
      makeTrade({ pnlPercent: -2, pnlUsd: -200 }),
    ];
    const equity = [
      { time: 0, equity: 10000 },
      { time: 86400000, equity: 10300 },
    ];
    const m = computeMetrics(trades, equity, 10000, 100);
    expect(m.profitFactor).toBeCloseTo(2.5, 1);
  });

  it('calculates consecutive wins/losses', () => {
    const trades = [
      makeTrade({ pnlPercent: 1, pnlUsd: 50 }),
      makeTrade({ pnlPercent: 2, pnlUsd: 100 }),
      makeTrade({ pnlPercent: 3, pnlUsd: 150 }),
      makeTrade({ pnlPercent: -1, pnlUsd: -50 }),
      makeTrade({ pnlPercent: -2, pnlUsd: -100 }),
    ];
    const equity = [
      { time: 0, equity: 10000 },
      { time: 86400000, equity: 10150 },
    ];
    const m = computeMetrics(trades, equity, 10000, 100);
    expect(m.maxConsecutiveWins).toBe(3);
    expect(m.maxConsecutiveLosses).toBe(2);
  });

  it('calculates avg bars held', () => {
    const trades = [
      makeTrade({ barsHeld: 10 }),
      makeTrade({ barsHeld: 20 }),
      makeTrade({ barsHeld: 30 }),
    ];
    const equity = [
      { time: 0, equity: 10000 },
      { time: 86400000, equity: 10300 },
    ];
    const m = computeMetrics(trades, equity, 10000, 100);
    expect(m.avgBarsHeld).toBe(20);
  });

  it('calculates time in market', () => {
    const trades = [
      makeTrade({ barsHeld: 25 }),
      makeTrade({ barsHeld: 25 }),
    ];
    const equity = [
      { time: 0, equity: 10000 },
      { time: 86400000, equity: 10000 },
    ];
    const m = computeMetrics(trades, equity, 10000, 100);
    expect(m.timeInMarket).toBe(50);
  });

  it('calculates avgRR correctly', () => {
    const trades = [
      makeTrade({ pnlPercent: 6, pnlUsd: 300 }),
      makeTrade({ pnlPercent: 4, pnlUsd: 200 }),
      makeTrade({ pnlPercent: -2, pnlUsd: -100 }),
      makeTrade({ pnlPercent: -4, pnlUsd: -200 }),
    ];
    const equity = [
      { time: 0, equity: 10000 },
      { time: 86400000, equity: 10200 },
    ];
    const m = computeMetrics(trades, equity, 10000, 100);
    // avg win = 5%, avg loss = -3%, R:R = 5/3 ≈ 1.667
    expect(m.avgRR).toBeCloseTo(1.667, 2);
  });

  it('handles all-winning trades for profit factor', () => {
    const trades = [
      makeTrade({ pnlPercent: 5, pnlUsd: 250 }),
      makeTrade({ pnlPercent: 3, pnlUsd: 150 }),
    ];
    const equity = [
      { time: 0, equity: 10000 },
      { time: 86400000, equity: 10400 },
    ];
    const m = computeMetrics(trades, equity, 10000, 100);
    expect(m.profitFactor).toBe(Infinity);
  });
});
