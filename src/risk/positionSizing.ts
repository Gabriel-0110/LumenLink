import { clamp } from '../core/validation.js';

export const computePositionUsd = (
  confidence: number,
  maxPositionUsd: number,
  floorUsd = 25
): number => {
  const scaled = maxPositionUsd * clamp(confidence, 0, 1);
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
