import type { AppConfig } from '../config/types.js';
import type { AccountSnapshot, RiskDecision, Signal, Ticker } from '../core/types.js';
import { computeSpreadBps, estimateSlippageBps } from './guards.js';
import { exceedsMaxDailyLoss, exceedsMaxOpenPositions, exceedsMaxPositionUsd } from './limits.js';
import { computePositionUsd } from './positionSizing.js';

export class RiskEngine {
  constructor(private readonly config: AppConfig) {}

  evaluate(input: {
    signal: Signal;
    symbol: string;
    snapshot: AccountSnapshot;
    ticker: Ticker;
    nowMs: number;
  }): RiskDecision {
    const { signal, symbol, snapshot, ticker, nowMs } = input;

    if (this.config.mode === 'live' && this.config.killSwitch) {
      return { allowed: false, reason: 'Kill switch enabled', blockedBy: 'kill_switch' };
    }

    if (this.config.mode === 'live' && !this.config.allowLiveTrading) {
      return { allowed: false, reason: 'Live trading disabled by config', blockedBy: 'live_disabled' };
    }

    if (signal.action === 'HOLD') {
      return { allowed: false, reason: 'No action signal' };
    }

    // Bug 1: Phantom sells — block selling symbols you don't own
    if (signal.action === 'SELL') {
      const pos = snapshot.openPositions.find((p) => p.symbol === symbol);
      if (!pos || pos.quantity <= 0) {
        return { allowed: false, reason: 'No position to sell' };
      }
    }

    if (exceedsMaxDailyLoss(snapshot, this.config.risk.maxDailyLossUsd)) {
      return { allowed: false, reason: 'Max daily loss reached', blockedBy: 'max_daily_loss' };
    }

    if (exceedsMaxOpenPositions(snapshot, this.config.risk.maxOpenPositions, symbol)) {
      return { allowed: false, reason: 'Max open positions reached', blockedBy: 'max_open_positions' };
    }

    const incomingOrderUsd = signal.action === 'BUY'
      ? computePositionUsd(signal.confidence, this.config.risk.maxPositionUsd)
      : 0;
    if (exceedsMaxPositionUsd(snapshot, symbol, this.config.risk.maxPositionUsd, ticker.last, incomingOrderUsd)) {
      return { allowed: false, reason: 'Max position exceeded', blockedBy: 'max_position_usd' };
    }

    const stopOutAt = snapshot.lastStopOutAtBySymbol[symbol];
    if (stopOutAt) {
      const cooldownMs = this.config.risk.cooldownMinutes * 60_000;
      if (nowMs - stopOutAt < cooldownMs) {
        return { allowed: false, reason: 'Cooldown active after stop-out', blockedBy: 'cooldown' };
      }
    }

    if ((ticker.volume24h ?? Number.MAX_SAFE_INTEGER) < this.config.guards.minVolume) {
      return { allowed: false, reason: 'Volume below minimum guard', blockedBy: 'min_volume' };
    }

    const spreadBps = computeSpreadBps(ticker);
    if (spreadBps > this.config.guards.maxSpreadBps) {
      return { allowed: false, reason: 'Spread guard blocked', blockedBy: 'spread_guard' };
    }

    const slippageBps = estimateSlippageBps(ticker);
    if (slippageBps > this.config.guards.maxSlippageBps) {
      return { allowed: false, reason: 'Slippage guard blocked', blockedBy: 'slippage_guard' };
    }

    return { allowed: true, reason: 'Risk checks passed' };
  }
}
