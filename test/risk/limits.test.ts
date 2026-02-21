import { describe, it, expect } from 'vitest';
import { exceedsMaxDailyLoss, exceedsMaxOpenPositions, exceedsMaxPositionUsd } from '../../src/risk/limits.js';
import { makeSnapshot, makePosition } from '../helpers.js';

describe('exceedsMaxDailyLoss', () => {
  it('returns false when within limit', () => {
    expect(exceedsMaxDailyLoss(makeSnapshot({ realizedPnlUsd: -100, unrealizedPnlUsd: 0 }), 150)).toBe(false);
  });

  it('returns true when exceeded', () => {
    expect(exceedsMaxDailyLoss(makeSnapshot({ realizedPnlUsd: -160, unrealizedPnlUsd: 0 }), 150)).toBe(true);
  });

  it('considers unrealized PnL', () => {
    expect(exceedsMaxDailyLoss(makeSnapshot({ realizedPnlUsd: -50, unrealizedPnlUsd: -110 }), 150)).toBe(true);
  });

  it('profits offset losses', () => {
    expect(exceedsMaxDailyLoss(makeSnapshot({ realizedPnlUsd: 100, unrealizedPnlUsd: -200 }), 150)).toBe(false);
  });
});

describe('exceedsMaxOpenPositions', () => {
  it('allows when below limit', () => {
    expect(exceedsMaxOpenPositions(makeSnapshot({ openPositions: [makePosition()] }), 2, 'ETH-USD')).toBe(false);
  });

  it('blocks new symbol at limit', () => {
    const snapshot = makeSnapshot({
      openPositions: [makePosition({ symbol: 'BTC-USD' }), makePosition({ symbol: 'ETH-USD' })],
    });
    expect(exceedsMaxOpenPositions(snapshot, 2, 'SOL-USD')).toBe(true);
  });

  it('allows existing symbol even at limit', () => {
    const snapshot = makeSnapshot({
      openPositions: [makePosition({ symbol: 'BTC-USD' }), makePosition({ symbol: 'ETH-USD' })],
    });
    expect(exceedsMaxOpenPositions(snapshot, 2, 'BTC-USD')).toBe(false);
  });
});

describe('exceedsMaxPositionUsd', () => {
  it('blocks when new order would exceed max', () => {
    expect(exceedsMaxPositionUsd(makeSnapshot(), 'BTC-USD', 250, 50000, 300)).toBe(true);
  });

  it('allows when within max', () => {
    expect(exceedsMaxPositionUsd(makeSnapshot(), 'BTC-USD', 250, 50000, 200)).toBe(false);
  });

  it('considers existing position notional', () => {
    const snapshot = makeSnapshot({
      openPositions: [makePosition({ symbol: 'BTC-USD', quantity: 0.004, marketPrice: 50000 })], // $200
    });
    expect(exceedsMaxPositionUsd(snapshot, 'BTC-USD', 250, 50000, 100)).toBe(true); // 200 + 100 >= 250
  });
});
