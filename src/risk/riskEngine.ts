import type { AppConfig } from '../config/types.js';
import type { AccountSnapshot, Candle, RiskDecision, Signal, Ticker } from '../core/types.js';
import { computeSpreadBps, estimateSlippageBps } from './guards.js';
import { exceedsMaxDailyLoss, exceedsMaxOpenPositions, exceedsMaxPositionUsd } from './limits.js';
import { computePositionUsd } from './positionSizing.js';
import { VolatilityGuard } from './volatilityGuard.js';
import { EventLockout } from './eventLockout.js';

export interface RiskEngineConfig {
  /** Whitelisted trading pairs. Empty = allow all. */
  allowedPairs?: string[];
  /** Max leverage (for futures). Default: 1 (spot only). */
  maxLeverage?: number;
  /** ATR multiplier threshold for volatility circuit breaker. Default: 2.5 */
  volatilityAtrThreshold?: number;
  /** Enable event lockout. Default: true */
  eventLockoutEnabled?: boolean;
}

export class RiskEngine {
  private readonly volatilityGuard: VolatilityGuard;
  private readonly eventLockout: EventLockout;
  private readonly allowedPairs: Set<string> | null;
  private readonly maxLeverage: number;

  constructor(
    private readonly config: AppConfig,
    riskConfig: RiskEngineConfig = {}
  ) {
    this.volatilityGuard = new VolatilityGuard({
      atrMultiplierThreshold: riskConfig.volatilityAtrThreshold ?? 2.5,
    });
    this.eventLockout = new EventLockout({
      enabled: riskConfig.eventLockoutEnabled ?? true,
    });
    this.allowedPairs = riskConfig.allowedPairs?.length
      ? new Set(riskConfig.allowedPairs)
      : null;
    this.maxLeverage = riskConfig.maxLeverage ?? 1;
  }

  /** Access event lockout for adding events externally */
  getEventLockout(): EventLockout {
    return this.eventLockout;
  }

  evaluate(input: {
    signal: Signal;
    symbol: string;
    snapshot: AccountSnapshot;
    ticker: Ticker;
    nowMs: number;
    candles?: Candle[];
    leverage?: number;
  }): RiskDecision {
    const { signal, symbol, snapshot, ticker, nowMs, candles, leverage } = input;

    // ── 1. Kill switch ──────────────────────────────────────────
    if (this.config.mode === 'live' && this.config.killSwitch) {
      return { allowed: false, reason: 'Kill switch enabled', blockedBy: 'kill_switch' };
    }

    // ── 2. Live trading gate ────────────────────────────────────
    if (this.config.mode === 'live' && !this.config.allowLiveTrading) {
      return { allowed: false, reason: 'Live trading disabled by config', blockedBy: 'live_disabled' };
    }

    // ── 3. HOLD = no action ─────────────────────────────────────
    if (signal.action === 'HOLD') {
      return { allowed: false, reason: 'No action signal' };
    }

    // ── 4. Pair whitelist ───────────────────────────────────────
    if (this.allowedPairs && !this.allowedPairs.has(symbol)) {
      return { allowed: false, reason: `Pair ${symbol} not in whitelist`, blockedBy: 'pair_not_whitelisted' };
    }

    // ── 5. Phantom sell prevention ──────────────────────────────
    if (signal.action === 'SELL') {
      const pos = snapshot.openPositions.find((p) => p.symbol === symbol);
      if (!pos || pos.quantity <= 0) {
        return { allowed: false, reason: 'No position to sell' };
      }
    }

    // ── 6. Max daily loss ───────────────────────────────────────
    if (exceedsMaxDailyLoss(snapshot, this.config.risk.maxDailyLossUsd)) {
      return { allowed: false, reason: 'Max daily loss reached', blockedBy: 'max_daily_loss' };
    }

    // ── 7. Max open positions ───────────────────────────────────
    if (exceedsMaxOpenPositions(snapshot, this.config.risk.maxOpenPositions, symbol)) {
      return { allowed: false, reason: 'Max open positions reached', blockedBy: 'max_open_positions' };
    }

    // ── 8. Max position size ────────────────────────────────────
    const incomingOrderUsd = signal.action === 'BUY'
      ? computePositionUsd(signal.confidence, this.config.risk.maxPositionUsd)
      : 0;
    if (exceedsMaxPositionUsd(snapshot, symbol, this.config.risk.maxPositionUsd, ticker.last, incomingOrderUsd)) {
      return { allowed: false, reason: 'Max position exceeded', blockedBy: 'max_position_usd' };
    }

    // ── 9. Cooldown after stop-out ──────────────────────────────
    const stopOutAt = snapshot.lastStopOutAtBySymbol[symbol];
    if (stopOutAt) {
      const cooldownMs = this.config.risk.cooldownMinutes * 60_000;
      if (nowMs - stopOutAt < cooldownMs) {
        return { allowed: false, reason: 'Cooldown active after stop-out', blockedBy: 'cooldown' };
      }
    }

    // ── 10. Volume guard ────────────────────────────────────────
    if ((ticker.volume24h ?? Number.MAX_SAFE_INTEGER) < this.config.guards.minVolume) {
      return { allowed: false, reason: 'Volume below minimum guard', blockedBy: 'min_volume' };
    }

    // ── 11. Spread guard ────────────────────────────────────────
    const spreadBps = computeSpreadBps(ticker);
    if (spreadBps > this.config.guards.maxSpreadBps) {
      return { allowed: false, reason: 'Spread guard blocked', blockedBy: 'spread_guard' };
    }

    // ── 12. Slippage guard ──────────────────────────────────────
    const slippageBps = estimateSlippageBps(ticker);
    if (slippageBps > this.config.guards.maxSlippageBps) {
      return { allowed: false, reason: 'Slippage guard blocked', blockedBy: 'slippage_guard' };
    }

    // ── 13. Max leverage ────────────────────────────────────────
    if (leverage !== undefined && leverage > this.maxLeverage) {
      return { allowed: false, reason: `Leverage ${leverage}x exceeds max ${this.maxLeverage}x`, blockedBy: 'max_leverage' };
    }

    // ── 14. Volatility circuit breaker ──────────────────────────
    if (candles && candles.length > 0) {
      const volCheck = this.volatilityGuard.check(candles);
      if (volCheck.blocked) {
        return { allowed: false, reason: volCheck.reason, blockedBy: 'volatility_circuit_breaker' };
      }
    }

    // ── 15. Event lockout ───────────────────────────────────────
    const eventCheck = this.eventLockout.check(nowMs);
    if (eventCheck.blocked) {
      return { allowed: false, reason: eventCheck.reason, blockedBy: 'event_lockout' };
    }

    return { allowed: true, reason: 'All 15 risk checks passed' };
  }
}
