import { describe, it, expect } from 'vitest';
import { computePositionUsd, computePositionUsdATR } from '../../src/risk/positionSizing.js';

describe('computePositionUsd', () => {
  it('scales position by confidence using convex (power 1.5) curve', () => {
    // Full confidence → full size
    expect(computePositionUsd(1.0, 250)).toBe(250);
    // 0.5 confidence → 250 * 0.5^1.5 ≈ 88.39 (less than linear 125 — intentional penalty)
    expect(computePositionUsd(0.5, 250)).toBeCloseTo(88.39, 1);
    // Low-confidence signals receive disproportionately less capital
    expect(computePositionUsd(0.5, 250)).toBeLessThan(125);
  });

  it('respects floor', () => {
    expect(computePositionUsd(0.01, 250)).toBe(25); // 2.5 < floor of 25
  });

  it('clamps confidence to 0-1', () => {
    expect(computePositionUsd(1.5, 250)).toBe(250); // capped at 1.0
    expect(computePositionUsd(-0.5, 250)).toBe(25); // clamped to 0, hits floor
  });

  it('uses custom floor', () => {
    expect(computePositionUsd(0.01, 250, 50)).toBe(50);
  });
});

describe('computePositionUsdATR', () => {
  it('sizes position based on ATR risk', () => {
    const result = computePositionUsdATR(10000, 0.02, 1000, 50000, 1.5);
    // riskUsd = 10000 * 0.02 = 200
    // stopDistance = 1000 * 1.5 = 1500
    // stopPercent = 1500 / 50000 = 0.03
    // positionUsd = 200 / 0.03 = 6666.67
    expect(result.positionUsd).toBeCloseTo(6666.67, 0);
    expect(result.stopDistance).toBe(1500);
    expect(result.quantity).toBeCloseTo(6666.67 / 50000, 4);
  });

  it('smaller ATR = larger position (less volatile)', () => {
    const lowVol = computePositionUsdATR(10000, 0.02, 500, 50000);
    const highVol = computePositionUsdATR(10000, 0.02, 2000, 50000);
    expect(lowVol.positionUsd).toBeGreaterThan(highVol.positionUsd);
  });

  it('higher risk percent = larger position', () => {
    const conservative = computePositionUsdATR(10000, 0.01, 1000, 50000);
    const aggressive = computePositionUsdATR(10000, 0.03, 1000, 50000);
    expect(aggressive.positionUsd).toBeGreaterThan(conservative.positionUsd);
  });
});
