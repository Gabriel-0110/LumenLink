import type { Ticker } from '../core/types.js';

export const computeSpreadBps = (ticker: Ticker): number => {
  const mid = (ticker.ask + ticker.bid) / 2;
  if (mid <= 0) return Infinity;
  return ((ticker.ask - ticker.bid) / mid) * 10000;
};

export const estimateSlippageBps = (ticker: Ticker): number => {
  const mid = (ticker.ask + ticker.bid) / 2;
  if (mid <= 0) return Infinity;
  return (Math.abs(ticker.last - mid) / mid) * 10000;
};
