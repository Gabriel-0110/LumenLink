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

export class CircuitBreaker {
  private failureCount = 0;
  private lastFailureTime = 0;
  private resetTimeoutMs: number;
  private maxConsecutiveFailures: number;

  constructor(maxConsecutiveFailures = 5, resetTimeoutMs = 5 * 60 * 1000) {
    this.maxConsecutiveFailures = maxConsecutiveFailures;
    this.resetTimeoutMs = resetTimeoutMs;
  }

  isOpen(nowMs: number = Date.now()): boolean {
    // Reset after timeout
    if (this.failureCount > 0 && nowMs - this.lastFailureTime > this.resetTimeoutMs) {
      this.reset();
    }
    return this.failureCount >= this.maxConsecutiveFailures;
  }

  recordFailure(nowMs: number = Date.now()): void {
    this.failureCount++;
    this.lastFailureTime = nowMs;
  }

  recordSuccess(): void {
    this.reset();
  }

  reset(): void {
    this.failureCount = 0;
    this.lastFailureTime = 0;
  }

  getState() {
    return {
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
      isOpen: this.isOpen()
    };
  }
}
