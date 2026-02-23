/**
 * Trade Construction Engine
 *
 * Outputs a complete trade plan: entry, exit, sizing as ONE system.
 * Sizing is volatility-normalized, liquidity-aware, and fee-aware.
 */

import type { Ticker } from '../../core/types.js';
import type {
  TradePlan, EntryPlan, ExitPlan, SizingPlan, TradeConstraints,
  EnsembleResult, EdgeForecast, MarketState, RiskOverlayDecision,
} from '../types.js';

interface ConstructionConfig {
  // Sizing
  maxRiskPerTradePct: number;   // max % of account risked per trade
  basePositionUsd: number;      // base position size
  minPositionUsd: number;
  maxPositionUsd: number;
  // Entry
  preferLimitOrders: boolean;
  limitOffsetBps: number;       // limit order offset from mid
  // Exit
  defaultStopBps: number;       // default stop-loss in bps
  defaultTargetBps: number;     // default take-profit in bps
  trailingStopBps: number | null;
  maxTimeInTradeMs: number;     // max holding period
  // Constraints
  maxExposureUsd: number;
  perSymbolCapUsd: number;
  minEdgeBps: number;
  // Fees
  feeRateBps: number;
}

const DEFAULT_CONFIG: ConstructionConfig = {
  maxRiskPerTradePct: 2,
  basePositionUsd: 200,
  minPositionUsd: 50,
  maxPositionUsd: 500,
  preferLimitOrders: false,
  limitOffsetBps: 5,
  defaultStopBps: 150,
  defaultTargetBps: 300,
  trailingStopBps: 100,
  maxTimeInTradeMs: 4 * 60 * 60 * 1000, // 4 hours
  maxExposureUsd: 1000,
  perSymbolCapUsd: 500,
  minEdgeBps: 30,
  feeRateBps: 60,
};

export class TradeConstructionEngine {
  private readonly cfg: ConstructionConfig;

  constructor(config: Partial<ConstructionConfig> = {}) {
    this.cfg = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Build a complete trade plan given the pipeline outputs.
   * Returns null if the trade shouldn't be taken.
   */
  construct(
    symbol: string,
    ensemble: EnsembleResult,
    forecast: EdgeForecast,
    marketState: MarketState,
    overlay: RiskOverlayDecision,
    ticker: Ticker | undefined,
    accountEquityUsd: number,
    currentExposureUsd: number,
  ): TradePlan | null {
    // Gate: no trade if overlay blocks new entries
    if (overlay.mode === 'no_new_entries' || overlay.mode === 'flatten_only') {
      return null;
    }

    // Gate: no direction
    if (ensemble.direction === 0) return null;

    // Gate: edge doesn't exceed costs
    if (!forecast.exceedsCosts && forecast.calibrationScore > 0.3) {
      return null;
    }

    // Gate: minimum edge
    if (forecast.expectedReturnBps < this.cfg.minEdgeBps && forecast.calibrationScore > 0.3) {
      return null;
    }

    const side = ensemble.direction === 1 ? 'buy' as const : 'sell' as const;
    const price = ticker?.last ?? 0;
    if (price <= 0) return null;

    const entry = this.buildEntry(ticker, side);
    const exit = this.buildExit(price, side, marketState, overlay);
    const sizing = this.buildSizing(
      price, marketState, overlay, forecast, exit,
      accountEquityUsd, currentExposureUsd,
    );
    const constraints = this.buildConstraints(currentExposureUsd);

    // Final check: position size viable?
    if (sizing.notionalUsd < this.cfg.minPositionUsd) return null;

    // Expected PnL (net of costs)
    const roundTripFeeBps = this.cfg.feeRateBps * 2;
    const expectedPnlBps = forecast.expectedReturnBps - roundTripFeeBps;
    const expectedPnlUsd = (expectedPnlBps / 10000) * sizing.notionalUsd;

    const rewardRiskRatio = exit.stopLossBps > 0
      ? exit.takeProfitBps / exit.stopLossBps
      : 0;

    return {
      symbol,
      side,
      entry,
      exit,
      sizing,
      constraints,
      expectedPnlUsd,
      rewardRiskRatio,
      timestamp: Date.now(),
    };
  }

  private buildEntry(ticker: Ticker | undefined, side: 'buy' | 'sell'): EntryPlan {
    if (!this.cfg.preferLimitOrders || !ticker) {
      return { type: 'market', price: null, timeInForce: 'IOC' };
    }

    const mid = (ticker.bid + ticker.ask) / 2;
    const offset = mid * (this.cfg.limitOffsetBps / 10000);
    const limitPrice = side === 'buy' ? mid - offset : mid + offset;

    return {
      type: 'limit',
      price: limitPrice,
      timeInForce: 'GTC',
      limitOffsetBps: this.cfg.limitOffsetBps,
    };
  }

  private buildExit(
    entryPrice: number, side: 'buy' | 'sell',
    marketState: MarketState, overlay: RiskOverlayDecision,
  ): ExitPlan {
    // Volatility-adjusted stops: wider in high vol, tighter in low vol
    const volMultiplier = Math.max(0.5, Math.min(2.0,
      marketState.volatility.atrPercent / 1.0, // normalize to 1% ATR
    ));

    let stopBps = Math.round(this.cfg.defaultStopBps * volMultiplier);
    let targetBps = Math.round(this.cfg.defaultTargetBps * volMultiplier);

    // Overlay tightening
    stopBps = Math.max(50, stopBps - overlay.stopTightenBps);
    targetBps = Math.max(stopBps * 1.5, targetBps); // maintain min R:R

    const stopOffset = entryPrice * (stopBps / 10000);
    const targetOffset = entryPrice * (targetBps / 10000);

    const stopLossPrice = side === 'buy'
      ? entryPrice - stopOffset
      : entryPrice + stopOffset;
    const takeProfitPrice = side === 'buy'
      ? entryPrice + targetOffset
      : entryPrice - targetOffset;

    const trailingStopBps = this.cfg.trailingStopBps
      ? Math.round(this.cfg.trailingStopBps * volMultiplier)
      : null;

    return {
      stopLossPrice,
      stopLossBps: stopBps,
      takeProfitPrice,
      takeProfitBps: targetBps,
      trailingStopBps,
      maxTimeInTradeMs: this.cfg.maxTimeInTradeMs,
      exitType: trailingStopBps ? 'trailing' : 'stop',
    };
  }

  private buildSizing(
    price: number,
    marketState: MarketState,
    overlay: RiskOverlayDecision,
    forecast: EdgeForecast,
    exit: ExitPlan,
    accountEquityUsd: number,
    currentExposureUsd: number,
  ): SizingPlan {
    // Start with base position
    let notionalUsd = this.cfg.basePositionUsd;

    // Risk budget: max % of account per trade
    const riskBudgetUsd = accountEquityUsd * (this.cfg.maxRiskPerTradePct / 100);
    const riskPerUnit = exit.stopLossBps / 10000; // % risk per unit
    const riskBasedSize = riskPerUnit > 0 ? riskBudgetUsd / riskPerUnit : notionalUsd;
    notionalUsd = Math.min(notionalUsd, riskBasedSize);

    // Volatility scaling: smaller in high vol
    let volatilityScaled = false;
    if (marketState.volatility.percentile > 0.7) {
      const volScale = 1 - (marketState.volatility.percentile - 0.7) / 0.3 * 0.5; // up to 50% reduction
      notionalUsd *= Math.max(0.5, volScale);
      volatilityScaled = true;
    }

    // Liquidity scaling: smaller when spread/slippage is high
    let liquidityScaled = false;
    if (marketState.liquidity.slippageRisk === 'high') {
      notionalUsd *= 0.6;
      liquidityScaled = true;
    } else if (marketState.liquidity.slippageRisk === 'extreme') {
      notionalUsd *= 0.3;
      liquidityScaled = true;
    }

    // Overlay size multiplier
    notionalUsd *= overlay.sizeMultiplier;

    // Fee-aware: block if edge < costs
    let feeAdjusted = false;
    if (!forecast.exceedsCosts) {
      notionalUsd *= 0.5; // reduce but don't zero (forecast may have low calibration)
      feeAdjusted = true;
    }

    // Exposure cap
    const remainingCap = Math.max(0, this.cfg.maxExposureUsd - currentExposureUsd);
    notionalUsd = Math.min(notionalUsd, remainingCap, this.cfg.perSymbolCapUsd);

    // Floor and ceiling
    notionalUsd = Math.max(this.cfg.minPositionUsd, Math.min(this.cfg.maxPositionUsd, notionalUsd));
    notionalUsd = Math.round(notionalUsd * 100) / 100;

    const quantity = price > 0 ? notionalUsd / price : 0;
    const riskPercent = accountEquityUsd > 0
      ? (notionalUsd * riskPerUnit / accountEquityUsd) * 100
      : 0;

    return {
      notionalUsd,
      quantity,
      riskBudgetUsd: Math.round(notionalUsd * riskPerUnit * 100) / 100,
      riskPercent: Math.round(riskPercent * 100) / 100,
      volatilityScaled,
      liquidityScaled,
      feeAdjusted,
    };
  }

  private buildConstraints(currentExposureUsd: number): TradeConstraints {
    return {
      maxExposureUsd: this.cfg.maxExposureUsd,
      perSymbolCapUsd: this.cfg.perSymbolCapUsd,
      minEdgeBps: this.cfg.minEdgeBps,
      correlationCheck: false, // Phase 2: implement correlation checking
    };
  }
}
