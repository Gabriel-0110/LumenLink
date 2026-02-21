import type { AccountSnapshot } from '../core/types.js';

export const exceedsMaxDailyLoss = (snapshot: AccountSnapshot, maxDailyLossUsd: number): boolean => {
  const pnl = snapshot.realizedPnlUsd + snapshot.unrealizedPnlUsd;
  return pnl <= -Math.abs(maxDailyLossUsd);
};

export const exceedsMaxOpenPositions = (
  snapshot: AccountSnapshot,
  maxOpenPositions: number,
  symbol: string
): boolean => {
  const hasSymbol = snapshot.openPositions.some((p) => p.symbol === symbol);
  if (hasSymbol) return false;
  return snapshot.openPositions.length >= maxOpenPositions;
};

export const exceedsMaxPositionUsd = (
  snapshot: AccountSnapshot,
  symbol: string,
  maxPositionUsd: number,
  currentPrice?: number,
  incomingOrderUsd?: number
): boolean => {
  const position = snapshot.openPositions.find((p) => p.symbol === symbol);
  if (!position) return (incomingOrderUsd ?? 0) >= maxPositionUsd;
  const price = currentPrice ?? position.marketPrice;
  const existingNotional = Math.abs(position.quantity * price);
  const totalNotional = existingNotional + (incomingOrderUsd ?? 0);
  return totalNotional >= maxPositionUsd;
};
