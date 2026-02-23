/**
 * Decision Intelligence — LLM-powered explainer for operator comprehension.
 *
 * The LLM is your:
 *   - Explainer (why did/didn't we trade)
 *   - Summarizer (what changed since last cycle)
 *   - Anomaly narrator (what's unusual right now)
 *   - Operator assistant (top blockers, regime narrative)
 *
 * The LLM is NOT your trader.
 *
 * Phase 1: Template-based explanations (no external LLM calls yet).
 * Phase 2: Add async LLM summarization with Anthropic API.
 */

import type {
  OperatorExplanation,
  MarketState,
  EnsembleResult,
  EdgeForecast,
  TradePlan,
  RiskOverlayDecision,
  DecisionRecord,
} from '../types.js';

export class DecisionExplainer {
  private lastMarketState: Map<string, MarketState> = new Map();
  private blockerCounts: Map<string, number> = new Map();

  /**
   * Generate a human-readable explanation of the current cycle's decision.
   */
  explain(
    cycleId: string,
    symbol: string,
    marketState: MarketState,
    ensemble: EnsembleResult,
    forecast: EdgeForecast,
    tradePlan: TradePlan | null,
    overlay: RiskOverlayDecision,
    decision: DecisionRecord,
  ): OperatorExplanation {
    const timestamp = Date.now();

    const summary = this.buildSummary(symbol, marketState, ensemble, decision);
    const topBlockers = this.buildBlockersSummary(decision);
    const whatChanged = this.buildWhatChanged(symbol, marketState);
    const whyNoTrade = decision.outcome !== 'executed'
      ? this.buildWhyNoTrade(ensemble, forecast, overlay, decision)
      : undefined;
    const riskNarrative = this.buildRiskNarrative(overlay, marketState);
    const anomalies = this.buildAnomalies(marketState);

    // Update state for next comparison
    this.lastMarketState.set(symbol, marketState);

    return {
      cycleId,
      timestamp,
      summary,
      topBlockers,
      whatChanged,
      whyNoTrade,
      riskNarrative,
      anomalies,
    };
  }

  private buildSummary(
    symbol: string,
    state: MarketState,
    ensemble: EnsembleResult,
    decision: DecisionRecord,
  ): string {
    const direction = ensemble.direction === 1 ? 'bullish' : ensemble.direction === -1 ? 'bearish' : 'neutral';
    const action = decision.outcome === 'executed' ? `Executed ${decision.action}` : `Held (${decision.outcome})`;
    return `${symbol}: ${state.regime} regime, ${direction} ensemble (${(ensemble.confidence * 100).toFixed(0)}% conf). ${action}.`;
  }

  private buildBlockersSummary(decision: DecisionRecord): string[] {
    const blockers: string[] = [];

    if (decision.blockers.length === 0) {
      return ['No blockers — trade cleared all gates'];
    }

    for (const blocker of decision.blockers) {
      // Track blocker frequency
      this.blockerCounts.set(blocker, (this.blockerCounts.get(blocker) ?? 0) + 1);
      const count = this.blockerCounts.get(blocker)!;
      blockers.push(`${blocker} (${count}x total)`);
    }

    return blockers.slice(0, 3);
  }

  private buildWhatChanged(symbol: string, current: MarketState): string[] {
    const changes: string[] = [];
    const prev = this.lastMarketState.get(symbol);

    if (!prev) {
      changes.push('First cycle — no prior state to compare');
      return changes;
    }

    if (prev.regime !== current.regime) {
      changes.push(`Regime: ${prev.regime} → ${current.regime}`);
    }

    const volDiff = Math.abs(current.volatility.atrPercent - prev.volatility.atrPercent);
    if (volDiff > 0.2) {
      const dir = current.volatility.atrPercent > prev.volatility.atrPercent ? 'increased' : 'decreased';
      changes.push(`Volatility ${dir}: ${prev.volatility.atrPercent.toFixed(2)}% → ${current.volatility.atrPercent.toFixed(2)}%`);
    }

    if (prev.liquidity.slippageRisk !== current.liquidity.slippageRisk) {
      changes.push(`Liquidity risk: ${prev.liquidity.slippageRisk} → ${current.liquidity.slippageRisk}`);
    }

    if (prev.momentum.direction !== current.momentum.direction) {
      const dirs = { 1: 'up', '-1': 'down', 0: 'neutral' } as const;
      changes.push(`Momentum: ${dirs[prev.momentum.direction]} → ${dirs[current.momentum.direction]}`);
    }

    const newWarnings = current.microstructure.flags.filter(
      f => !prev.microstructure.flags.includes(f),
    );
    if (newWarnings.length > 0) {
      changes.push(`New warnings: ${newWarnings.join(', ')}`);
    }

    if (!prev.dataIntegrity.healthy && current.dataIntegrity.healthy) {
      changes.push('Data feed restored to healthy');
    }
    if (prev.dataIntegrity.healthy && !current.dataIntegrity.healthy) {
      changes.push('Data feed health degraded');
    }

    if (changes.length === 0) {
      changes.push('No significant changes since last cycle');
    }

    return changes;
  }

  private buildWhyNoTrade(
    ensemble: EnsembleResult,
    forecast: EdgeForecast,
    overlay: RiskOverlayDecision,
    decision: DecisionRecord,
  ): string {
    const parts: string[] = [];

    if (ensemble.direction === 0) {
      parts.push('No directional consensus from alpha models');
      if (ensemble.consensusLevel < 0.5) {
        parts.push(`(models disagree, consensus: ${(ensemble.consensusLevel * 100).toFixed(0)}%)`);
      }
    }

    if (!forecast.exceedsCosts) {
      parts.push(`Expected move (${forecast.expectedReturnBps}bps) doesn't exceed costs (${forecast.costBps}bps)`);
    }

    if (overlay.mode !== 'normal') {
      parts.push(`Risk overlay in ${overlay.mode} mode: ${overlay.reasons[0]}`);
    }

    if (decision.blockers.length > 0) {
      parts.push(`Blocked by: ${decision.blockers.join(', ')}`);
    }

    return parts.join('. ') || 'Unknown reason';
  }

  private buildRiskNarrative(overlay: RiskOverlayDecision, state: MarketState): string {
    const parts: string[] = [];

    parts.push(`Risk overlay: ${overlay.mode}`);
    if (overlay.sizeMultiplier < 1) {
      parts.push(`size reduced to ${(overlay.sizeMultiplier * 100).toFixed(0)}%`);
    }
    if (overlay.stopTightenBps > 0) {
      parts.push(`stops tightened by ${overlay.stopTightenBps}bps`);
    }
    if (state.volatility.percentile > 0.8) {
      parts.push(`elevated volatility (p${(state.volatility.percentile * 100).toFixed(0)})`);
    }
    if (state.liquidity.slippageRisk !== 'low') {
      parts.push(`${state.liquidity.slippageRisk} slippage risk`);
    }

    return parts.join('. ') + '.';
  }

  private buildAnomalies(state: MarketState): string[] {
    const anomalies: string[] = [];

    if (state.microstructure.gapDetected) anomalies.push('Price gap detected');
    if (state.microstructure.churnDetected) anomalies.push('Volume churn — high activity, no movement');
    if (state.microstructure.spreadSpike) anomalies.push('Spread spike — check exchange health');
    if (state.microstructure.highWickiness) anomalies.push('Extreme wicks — possible stop hunting');
    if (!state.dataIntegrity.healthy) anomalies.push('Data feed unhealthy');
    if (state.volatility.volOfVol > 0.05) anomalies.push('Unstable volatility (high vol-of-vol)');

    return anomalies;
  }
}
