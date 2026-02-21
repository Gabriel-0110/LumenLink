import { describe, it, expect } from 'vitest';
import { computeSpreadBps, estimateSlippageBps, CircuitBreaker } from '../../src/risk/guards.js';
import { makeTicker } from '../helpers.js';

describe('computeSpreadBps', () => {
  it('calculates spread in basis points', () => {
    const ticker = makeTicker({ bid: 50000, ask: 50010 });
    const spread = computeSpreadBps(ticker);
    // (10 / 50005) * 10000 ≈ 2.0 bps
    expect(spread).toBeCloseTo(2.0, 0);
  });

  it('returns Infinity for zero mid price', () => {
    const ticker = makeTicker({ bid: 0, ask: 0 });
    expect(computeSpreadBps(ticker)).toBe(Infinity);
  });

  it('handles wide spreads', () => {
    const ticker = makeTicker({ bid: 49000, ask: 51000 });
    const spread = computeSpreadBps(ticker);
    expect(spread).toBeGreaterThan(300); // ~400 bps
  });
});

describe('estimateSlippageBps', () => {
  it('estimates slippage from last vs mid', () => {
    const ticker = makeTicker({ bid: 50000, ask: 50010, last: 50020 });
    const slippage = estimateSlippageBps(ticker);
    expect(slippage).toBeGreaterThan(0);
  });

  it('returns 0 when last equals mid', () => {
    const ticker = makeTicker({ bid: 50000, ask: 50010, last: 50005 });
    const slippage = estimateSlippageBps(ticker);
    expect(slippage).toBe(0);
  });
});

describe('CircuitBreaker', () => {
  it('starts closed', () => {
    const cb = new CircuitBreaker(3, 60_000);
    expect(cb.isOpen()).toBe(false);
  });

  it('opens after max consecutive failures', () => {
    const cb = new CircuitBreaker(3, 60_000);
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.isOpen()).toBe(false);
    cb.recordFailure();
    expect(cb.isOpen()).toBe(true);
  });

  it('resets on success', () => {
    const cb = new CircuitBreaker(3, 60_000);
    cb.recordFailure();
    cb.recordFailure();
    cb.recordSuccess();
    expect(cb.isOpen()).toBe(false);
    expect(cb.getState().failureCount).toBe(0);
  });

  it('auto-resets after timeout', () => {
    const cb = new CircuitBreaker(3, 1000); // 1 sec timeout
    const now = Date.now();
    cb.recordFailure(now);
    cb.recordFailure(now);
    cb.recordFailure(now);
    expect(cb.isOpen(now)).toBe(true);
    // After timeout
    expect(cb.isOpen(now + 2000)).toBe(false);
  });

  it('exposes state', () => {
    const cb = new CircuitBreaker(5, 60_000);
    cb.recordFailure();
    cb.recordFailure();
    const state = cb.getState();
    expect(state.failureCount).toBe(2);
    expect(state.isOpen).toBe(false);
  });
});
