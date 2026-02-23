/**
 * Strategy Engine — orchestrates the full professional strategy pipeline.
 *
 * Every cycle produces:
 *   MarketState → AlphaVotes[] → EdgeForecast → TradePlan
 *   → RiskOverlayDecision → DecisionRecord → OperatorExplanation
 */

import { randomUUID } from 'node:crypto';
import type { Candle, Ticker, AccountSnapshot } from '../core/types.js';
import type {
  StrategyCycleOutput,
  MarketState,
  DecisionRecord,
  DecisionOutcome,
  RiskOverlayInputs,
} from './types.js';
import { MarketStateEngine } from './marketState.js';
import { AlphaEnsemble } from './alpha/ensemble.js';
import { EdgeScorer } from './forecast/edgeScorer.js';
import { TradeConstructionEngine } from './construction/tradePlan.js';
import { RiskOverlay } from './overlay/riskOverlay.js';
import { DecisionExplainer } from './intelligence/explainer.js';
import { StrategyGovernance } from './governance/governance.js';
import { PerformanceAttribution } from './attribution/attribution.js';

export interface StrategyEngineConfig {
  intervalMs: number;        // candle interval in ms
  feeRateBps?: number;
  initialStage?: 'shadow' | 'paper' | 'small_live' | 'full_live';
}

export class StrategyEngine {
  readonly marketState: MarketStateEngine;
  readonly ensemble: AlphaEnsemble;
  readonly edgeScorer: EdgeScorer;
  readonly construction: TradeConstructionEngine;
  readonly riskOverlay: RiskOverlay;
  readonly explainer: DecisionExplainer;
  readonly governance: StrategyGovernance;
  readonly attribution: PerformanceAttribution;

  private readonly intervalMs: number;
  private recentDecisions: DecisionRecord[] = [];
  private cycleCount = 0;

  constructor(config: StrategyEngineConfig) {
    this.intervalMs = config.intervalMs;
    const feeRate = config.feeRateBps ?? 60;

    this.marketState = new MarketStateEngine({
      expectedIntervalMs: config.intervalMs,
    });
    this.ensemble = new AlphaEnsemble();
    this.edgeScorer = new EdgeScorer({ feeRateBps: feeRate });
    this.construction = new TradeConstructionEngine({ feeRateBps: feeRate });
    this.riskOverlay = new RiskOverlay();
    this.explainer = new DecisionExplainer();
    this.governance = new StrategyGovernance(
      config.initialStage ? { stage: config.initialStage } : undefined,
    );
    this.attribution = new PerformanceAttribution();
  }

  /**
   * Run a full strategy cycle for a single symbol.
   *
   * This is the main entry point called by the trading loop.
   * It does NOT execute orders — it returns a decision for the order manager.
   */
  runCycle(
    symbol: string,
    candles: Candle[],
    ticker: Ticker | undefined,
    snapshot: AccountSnapshot,
    overlayInputs: Partial<RiskOverlayInputs>,
    fearGreedIndex?: number,
    newsSentiment?: number,
  ): StrategyCycleOutput {
    const cycleId = `cycle-${++this.cycleCount}-${randomUUID().slice(0, 8)}`;
    const timestamp = Date.now();

    // ── 1. Market State ──────────────────────────────────────────────────
    const state = this.marketState.compute(symbol, candles, ticker);

    // ── 2. Alpha Ensemble ────────────────────────────────────────────────
    const ensembleResult = this.governance.isFeatureEnabled('alpha_ensemble')
      ? this.ensemble.evaluate(candles, state, ticker, fearGreedIndex, newsSentiment)
      : { direction: 0 as const, confidence: 0, expectedEdgeBps: 0, expectedRiskBps: 0, edgeRatio: 0, votes: [], consensusLevel: 0, dominantModel: null };

    // ── 3. Edge Forecast ─────────────────────────────────────────────────
    const forecast = this.governance.isFeatureEnabled('edge_scorer')
      ? this.edgeScorer.score(symbol, candles, ensembleResult, state, this.intervalMs)
      : { symbol, timestamp, horizonMs: 0, probabilityUp: 0.5, probabilityDown: 0.5, expectedReturnBps: 0, uncertainty: 999, exceedsCosts: false, costBps: 120, calibrationScore: 0, method: 'statistical' as const };

    // ── 4. Risk Overlay ──────────────────────────────────────────────────
    const fullOverlayInputs: RiskOverlayInputs = {
      portfolioExposureUsd: snapshot.openPositions.reduce(
        (s, p) => s + Math.abs(p.quantity * p.marketPrice), 0,
      ),
      concentrationPct: this.computeConcentration(snapshot),
      realizedDrawdownUsd: Math.abs(Math.min(0, snapshot.realizedPnlUsd)),
      drawdownPercent: snapshot.cashUsd > 0
        ? Math.abs(Math.min(0, snapshot.realizedPnlUsd + snapshot.unrealizedPnlUsd)) / snapshot.cashUsd * 100
        : 0,
      volatilityRegimeShift: overlayInputs.volatilityRegimeShift ?? false,
      correlationSpike: overlayInputs.correlationSpike ?? false,
      eventRiskWindow: overlayInputs.eventRiskWindow ?? false,
      operationalRisk: overlayInputs.operationalRisk ?? {
        apiErrorRate: 0,
        reconDriftUsd: 0,
        openOrderBacklog: 0,
      },
    };

    // Get all recent market states for multi-symbol overlay
    const allStates: MarketState[] = [state];
    const overlayDecision = this.governance.isFeatureEnabled('risk_overlay')
      ? this.riskOverlay.evaluate(fullOverlayInputs, allStates)
      : { mode: 'normal' as const, sizeMultiplier: 1, stopTightenBps: 0, edgeThresholdBoostBps: 0, reasons: ['Overlay disabled'], inputs: fullOverlayInputs, timestamp };

    // ── 5. Trade Construction ────────────────────────────────────────────
    const currentExposureUsd = fullOverlayInputs.portfolioExposureUsd;
    const accountEquity = snapshot.cashUsd + snapshot.unrealizedPnlUsd;

    const tradePlan = this.governance.isFeatureEnabled('trade_construction')
      ? this.construction.construct(
          symbol, ensembleResult, forecast, state, overlayDecision,
          ticker, accountEquity, currentExposureUsd,
        )
      : null;

    // ── 6. Decision Record ───────────────────────────────────────────────
    const blockers: string[] = [];
    let outcome: DecisionOutcome;

    if (this.governance.isShadowMode()) {
      outcome = 'skipped';
      blockers.push('shadow_mode');
    } else if (ensembleResult.direction === 0) {
      outcome = 'skipped';
      blockers.push('no_direction');
    } else if (!forecast.exceedsCosts && forecast.calibrationScore > 0.5) {
      outcome = 'blocked';
      blockers.push('edge_below_costs');
    } else if (overlayDecision.mode === 'no_new_entries' || overlayDecision.mode === 'flatten_only') {
      outcome = 'blocked';
      blockers.push(`overlay_${overlayDecision.mode}`);
      blockers.push(...overlayDecision.reasons.slice(0, 2));
    } else if (!tradePlan) {
      outcome = 'blocked';
      blockers.push('construction_rejected');
    } else if (!this.governance.canExecute()) {
      outcome = 'deferred';
      blockers.push(`stage_${this.governance.getStage()}`);
    } else {
      outcome = 'executed';
    }

    const decision: DecisionRecord = {
      id: cycleId,
      symbol,
      timestamp,
      cycleId,
      marketState: state,
      ensemble: ensembleResult,
      forecast,
      tradePlan,
      overlay: overlayDecision,
      outcome,
      action: tradePlan ? tradePlan.side : 'hold',
      confidence: ensembleResult.confidence,
      expectedEdgeBps: forecast.expectedReturnBps,
      blockers,
    };

    this.recentDecisions.push(decision);
    if (this.recentDecisions.length > 200) {
      this.recentDecisions = this.recentDecisions.slice(-100);
    }

    // Track blocked trades for attribution
    if (outcome === 'blocked' && this.governance.isFeatureEnabled('performance_attribution')) {
      this.attribution.recordBlockedTrade(
        blockers, false, tradePlan?.expectedPnlUsd ?? 0,
      );
    }

    // ── 7. Explanation ───────────────────────────────────────────────────
    const explanation = this.governance.isFeatureEnabled('llm_explainer')
      ? this.explainer.explain(
          cycleId, symbol, state, ensembleResult, forecast,
          tradePlan, overlayDecision, decision,
        )
      : {
          cycleId, timestamp,
          summary: `${symbol}: ${outcome}`,
          topBlockers: blockers,
          whatChanged: [],
          riskNarrative: overlayDecision.mode,
          anomalies: [],
        };

    return {
      cycleId,
      timestamp,
      symbol,
      marketState: state,
      alphaVotes: ensembleResult.votes,
      ensemble: ensembleResult,
      forecast,
      tradePlan,
      overlay: overlayDecision,
      decision,
      explanation,
    };
  }

  /**
   * Record execution results back into the attribution system.
   */
  recordExecution(
    decisionId: string,
    fillPrice: number,
    fillSlippageBps: number,
    fillFeesUsd: number,
  ): void {
    const decision = this.recentDecisions.find(d => d.id === decisionId);
    if (!decision) return;

    decision.executionId = `exec-${randomUUID().slice(0, 8)}`;
    decision.fillPrice = fillPrice;
    decision.fillSlippageBps = fillSlippageBps;
    decision.fillFeesUsd = fillFeesUsd;
  }

  /**
   * Record realized P&L when a position closes.
   */
  recordRealized(decisionId: string, realizedPnlUsd: number): void {
    const decision = this.recentDecisions.find(d => d.id === decisionId);
    if (!decision) return;

    decision.realizedPnlUsd = realizedPnlUsd;

    if (this.governance.isFeatureEnabled('performance_attribution')) {
      this.attribution.recordTrade(decision);
      if (decision.tradePlan) {
        const returnBps = Math.round(
          realizedPnlUsd / decision.tradePlan.sizing.notionalUsd * 10000,
        );
        this.attribution.updateRealized(decisionId, returnBps);
      }
    }
  }

  /**
   * Get recent decisions for the UI.
   */
  getRecentDecisions(limit = 50): ReadonlyArray<DecisionRecord> {
    return this.recentDecisions.slice(-limit);
  }

  /**
   * Get strategy engine status snapshot for the API.
   */
  getStatus(): {
    cycleCount: number;
    governance: ReturnType<StrategyGovernance['toJSON']>;
    todayExpectancy: ReturnType<PerformanceAttribution['getTodayExpectancy']>;
    performanceByRegime: ReturnType<PerformanceAttribution['getPerformanceByRegime']>;
    blockerLeaderboard: ReturnType<PerformanceAttribution['getBlockerLeaderboard']>;
    alphaPerformance: ReturnType<PerformanceAttribution['getAlphaModelPerformance']>;
    recentDecisionCount: number;
  } {
    return {
      cycleCount: this.cycleCount,
      governance: this.governance.toJSON(),
      todayExpectancy: this.attribution.getTodayExpectancy(),
      performanceByRegime: this.attribution.getPerformanceByRegime(),
      blockerLeaderboard: this.attribution.getBlockerLeaderboard(),
      alphaPerformance: this.attribution.getAlphaModelPerformance(),
      recentDecisionCount: this.recentDecisions.length,
    };
  }

  private computeConcentration(snapshot: AccountSnapshot): number {
    if (snapshot.openPositions.length === 0) return 0;
    const totalValue = snapshot.openPositions.reduce(
      (s, p) => s + Math.abs(p.quantity * p.marketPrice), 0,
    );
    if (totalValue === 0) return 0;
    const maxPosition = Math.max(
      ...snapshot.openPositions.map(p => Math.abs(p.quantity * p.marketPrice)),
    );
    return (maxPosition / totalValue) * 100;
  }
}
