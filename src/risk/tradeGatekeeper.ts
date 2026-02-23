/**
 * TradeGatekeeper — Phase 2 + Phase 3 risk gates.
 *
 * Layered on top of the existing RiskEngine. These are discipline rules
 * that prevent the strategy from making economically foolish trades.
 *
 *   2.1  No repeated sells in chop (ranging regime anti-spiral)
 *   2.2  Oversold veto for discretionary exits
 *   2.3  Minimum expected edge filter (fees + slippage > edge → skip)
 *   3.0  Fee-aware minimum notional
 */

import type { Logger } from '../core/logger.js';
import type { Signal, Candle, Ticker } from '../core/types.js';

export interface EdgeAnalysis {
  expectedMoveBps: number;
  totalCostBps: number;
  feesBps: number;
  slippageBps: number;
  safetyBps: number;
  atr: number | undefined;
  profitable: boolean;
}

export interface GatekeeperDecision {
  allowed: boolean;
  reason: string;
  gate?: 'chop_sell_guard' | 'oversold_veto' | 'min_edge' | 'min_notional';
  /** Edge vs cost breakdown — attached on every SELL evaluation. */
  edgeAnalysis?: EdgeAnalysis;
}

export interface GatekeeperConfig {
  /** Minimum minutes between consecutive sells for the same symbol (default: 15). */
  sellCooldownMinutes: number;
  /** Minimum ATR multiples the price must move from last sell before another sell is allowed (default: 0.5). */
  sellMinAtrMoveFromLast: number;
  /** Round-trip fee rate in bps (buy + sell). Coinbase taker = 120bps/side → 240 round-trip. */
  feeRateBps: number;
  /** Safety margin bps added to fee+slippage for edge filter (default: 20). */
  safetyMarginBps: number;
  /** Fraction of ATR expected to be captured at full confidence (default: 0.5). */
  atrCaptureRatio: number;
  /** Estimated slippage in bps (default: 5). */
  estimatedSlippageBps: number;
  /** Minimum notional USD per trade to avoid fee drag (default: 50). */
  minNotionalUsd: number;
  /** ADX threshold below which the chop guard is active (default: 25). */
  chopAdxThreshold: number;
}

const DEFAULT_CONFIG: GatekeeperConfig = {
  sellCooldownMinutes: 15,
  sellMinAtrMoveFromLast: 0.5,
  feeRateBps: 240,       // round-trip: 120bps buy + 120bps sell (Coinbase taker <$10k tier)
  safetyMarginBps: 20,
  atrCaptureRatio: 0.5,
  estimatedSlippageBps: 5,
  minNotionalUsd: 50,
  chopAdxThreshold: 25,
};

interface SellRecord {
  timestamp: number;
  price: number;
}

export class TradeGatekeeper {
  private readonly config: GatekeeperConfig;
  /** Recent sell records per symbol — for chop guard. */
  private readonly lastSells = new Map<string, SellRecord>();

  constructor(
    private readonly logger: Logger,
    config?: Partial<GatekeeperConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Run ALL Phase 2 + 3 gates. Returns first failure or { allowed: true }.
   */
  evaluate(input: {
    signal: Signal;
    symbol: string;
    ticker: Ticker;
    candles: Candle[];
    positionQty: number;
    nowMs: number;
  }): GatekeeperDecision {
    const { signal, symbol, ticker, candles, positionQty, nowMs } = input;

    // Only gate sells (exits)
    if (signal.action !== 'SELL') {
      return { allowed: true, reason: 'Buy/hold — gates not applicable' };
    }

    const price = ticker.last;

    // ── 2.1  No repeated sells in chop ──────────────────────────

    const chopResult = this.checkChopSellGuard(symbol, price, candles, signal, nowMs);
    if (!chopResult.allowed) return chopResult;

    // ── 2.2  Oversold veto ──────────────────────────────────────

    const oversoldResult = this.checkOversoldVeto(signal);
    if (!oversoldResult.allowed) return oversoldResult;

    // ── 2.3  Minimum expected edge ──────────────────────────────

    const edgeResult = this.checkMinEdge(signal, candles, price);

    // Always compute edge analysis for logging, even when passing
    const edgeAnalysis = this.buildEdgeAnalysis(signal, candles, price);

    if (!edgeResult.allowed) return { ...edgeResult, edgeAnalysis };

    // ── 3.0  Minimum notional ───────────────────────────────────

    const notionalResult = this.checkMinNotional(positionQty, price);
    if (!notionalResult.allowed) return { ...notionalResult, edgeAnalysis };

    return { allowed: true, reason: 'All trade gates passed', edgeAnalysis };
  }

  /**
   * Record that a sell was executed (call after fill confirmation).
   */
  recordSell(symbol: string, price: number, timestamp: number): void {
    this.lastSells.set(symbol, { price, timestamp });
  }

  // ─── Gate implementations ─────────────────────────────────────

  private checkChopSellGuard(
    symbol: string,
    currentPrice: number,
    candles: Candle[],
    signal: Signal,
    nowMs: number,
  ): GatekeeperDecision {
    const lastSell = this.lastSells.get(symbol);
    if (!lastSell) return { allowed: true, reason: 'No prior sell — chop guard not relevant' };

    // Parse ADX from signal reason if available
    const adxMatch = signal.reason.match(/ADX[:\s]*(\d+)/i);
    const adx = adxMatch ? Number(adxMatch[1]) : undefined;

    // Only enforce in ranging/chop regimes (low ADX)
    if (adx !== undefined && adx > this.config.chopAdxThreshold) {
      return { allowed: true, reason: `ADX ${adx} > ${this.config.chopAdxThreshold} — trending, chop guard inactive` };
    }

    // Time cooldown
    const elapsedMs = nowMs - lastSell.timestamp;
    const cooldownMs = this.config.sellCooldownMinutes * 60_000;
    if (elapsedMs < cooldownMs) {
      return {
        allowed: false,
        reason: `Chop guard: only ${(elapsedMs / 60_000).toFixed(1)}min since last sell (need ${this.config.sellCooldownMinutes}min)`,
        gate: 'chop_sell_guard',
      };
    }

    // Price movement check (must move > N × ATR from last sell price)
    const atr = this.computeATR(candles, 14);
    if (atr && atr > 0) {
      const priceMoveFromLastSell = Math.abs(currentPrice - lastSell.price);
      const requiredMove = atr * this.config.sellMinAtrMoveFromLast;
      if (priceMoveFromLastSell < requiredMove) {
        return {
          allowed: false,
          reason: `Chop guard: price moved $${priceMoveFromLastSell.toFixed(2)} < ${this.config.sellMinAtrMoveFromLast}×ATR ($${requiredMove.toFixed(2)})`,
          gate: 'chop_sell_guard',
        };
      }
    }

    return { allowed: true, reason: 'Chop guard passed' };
  }

  private checkOversoldVeto(signal: Signal): GatekeeperDecision {
    const reason = signal.reason.toLowerCase();

    // Count oversold indicators in the reason string
    const oversoldIndicators: string[] = [];

    if (reason.includes('stochrsi oversold'))  oversoldIndicators.push('StochRSI');
    if (reason.includes('cci oversold'))       oversoldIndicators.push('CCI');
    if (reason.includes('lower bb') || reason.includes('at lower bb')) oversoldIndicators.push('BB');
    if (reason.includes('williams oversold') || reason.includes('will%r oversold')) oversoldIndicators.push('Williams%R');
    if (/rsi\s*(low|oversold)/i.test(reason))  oversoldIndicators.push('RSI');

    // Veto if 2+ oscillators say oversold (strong consensus)
    if (oversoldIndicators.length >= 2) {
      return {
        allowed: false,
        reason: `Oversold veto: ${oversoldIndicators.join(', ')} all indicate oversold — selling into weakness`,
        gate: 'oversold_veto',
      };
    }

    return { allowed: true, reason: 'Oversold veto not triggered' };
  }

  private checkMinEdge(signal: Signal, candles: Candle[], price: number): GatekeeperDecision {
    // Total round-trip cost in bps (buy + sell)
    const totalCostBps = this.config.feeRateBps + this.config.estimatedSlippageBps + this.config.safetyMarginBps;

    // Estimate expected move from ATR
    const atr = this.computeATR(candles, 14);
    if (!atr || atr <= 0 || price <= 0) {
      // Can't compute edge — allow but log
      return { allowed: true, reason: 'Edge filter: ATR unavailable, skipping' };
    }

    // Expected move = fraction of ATR based on confidence
    // Capture ratio is configurable (default 0.5 = 50% of 1 ATR at full confidence)
    const expectedMoveBps = (atr / price) * 10_000 * signal.confidence * this.config.atrCaptureRatio;

    if (expectedMoveBps < totalCostBps) {
      return {
        allowed: false,
        reason: `Min edge: expected ${expectedMoveBps.toFixed(0)}bps < cost ${totalCostBps.toFixed(0)}bps (fee:${this.config.feeRateBps} + slip:${this.config.estimatedSlippageBps} + margin:${this.config.safetyMarginBps})`,
        gate: 'min_edge',
      };
    }

    return { allowed: true, reason: `Edge filter passed: expected ${expectedMoveBps.toFixed(0)}bps > cost ${totalCostBps.toFixed(0)}bps` };
  }

  private checkMinNotional(positionQty: number, price: number): GatekeeperDecision {
    const notionalUsd = positionQty * price;
    if (notionalUsd < this.config.minNotionalUsd) {
      return {
        allowed: false,
        reason: `Min notional: $${notionalUsd.toFixed(2)} < $${this.config.minNotionalUsd} — trade too small for fee drag`,
        gate: 'min_notional',
      };
    }
    return { allowed: true, reason: 'Notional sufficient' };
  }

  /**
   * Build edge analysis breakdown for logging/dashboard.
   * Non-blocking — always returns a result.
   */
  private buildEdgeAnalysis(signal: Signal, candles: Candle[], price: number): EdgeAnalysis {
    const atr = this.getATR(candles, 14);
    const totalCostBps = this.config.feeRateBps + this.config.estimatedSlippageBps + this.config.safetyMarginBps;
    let expectedMoveBps = 0;
    if (atr && atr > 0 && price > 0) {
      expectedMoveBps = (atr / price) * 10_000 * signal.confidence * this.config.atrCaptureRatio;
    }
    return {
      expectedMoveBps: Math.round(expectedMoveBps),
      totalCostBps,
      feesBps: this.config.feeRateBps,
      slippageBps: this.config.estimatedSlippageBps,
      safetyBps: this.config.safetyMarginBps,
      atr,
      profitable: expectedMoveBps > totalCostBps,
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────

  /** ATR for external callers (dashboard, tuning). */
  getATR(candles: Candle[], period = 14): number | undefined {
    return this.computeATR(candles, period);
  }

  private computeATR(candles: Candle[], period: number): number | undefined {
    if (candles.length < period + 1) return undefined;
    const recent = candles.slice(-Math.min(candles.length, 50));
    const trueRanges: number[] = [];
    for (let i = 1; i < recent.length; i++) {
      const curr = recent[i]!;
      const prev = recent[i - 1]!;
      const tr = Math.max(
        curr.high - curr.low,
        Math.abs(curr.high - prev.close),
        Math.abs(curr.low - prev.close),
      );
      trueRanges.push(tr);
    }
    if (trueRanges.length < period) return undefined;
    // Simple moving average of last `period` true ranges
    const atrSlice = trueRanges.slice(-period);
    return atrSlice.reduce((a, b) => a + b, 0) / atrSlice.length;
  }
}
