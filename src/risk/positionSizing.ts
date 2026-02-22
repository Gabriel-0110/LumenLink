import { clamp } from '../core/validation.js';

/**
 * Convex confidence → position size scaling.
 * Uses power of 1.5 so low-confidence signals receive disproportionately less capital.
 * Examples (maxPositionUsd=1000):
 *   confidence 0.3 → $164 (vs $300 linear)
 *   confidence 0.6 → $465 (vs $600 linear)
 *   confidence 0.9 → $855 (vs $900 linear)
 */
export const computePositionUsd = (
  confidence: number,
  maxPositionUsd: number,
  floorUsd = 25
): number => {
  const scaled = maxPositionUsd * Math.pow(clamp(confidence, 0, 1), 1.5);
  return Math.max(floorUsd, scaled);
};

export const computePositionUsdATR = (
  accountUsd: number,
  riskPercent: number,  // e.g. 0.02 for 2%
  atr: number,
  price: number,
  atrMultiplier: number = 1.5
): { positionUsd: number; stopDistance: number; quantity: number } => {
  const riskUsd = accountUsd * riskPercent;
  const stopDistance = atr * atrMultiplier;
  const stopPercent = stopDistance / price;
  const positionUsd = riskUsd / stopPercent;
  const quantity = positionUsd / price;
  return { positionUsd: Math.round(positionUsd * 100) / 100, stopDistance, quantity };
};
