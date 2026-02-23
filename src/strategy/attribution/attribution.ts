/**
 * Performance Attribution — tracks what worked, what didn't, and why.
 *
 * Every decision is tracked:
 *   - Predicted edge vs realized return
 *   - Slippage estimate vs actual
 *   - Fee impact
 *   - Which alpha models contributed
 *   - Regime at decision time
 *
 * Outputs:
 *   - P&L by regime
 *   - Win rate + expectancy by signal type
 *   - Blocker leaderboard (what saved money)
 */

import type {
  TradeAttribution,
  StrategyPerformanceByRegime,
  BlockerLeaderboard,
  DecisionRecord,
  AlphaModelId,
  Regime,
} from '../types.js';

export class PerformanceAttribution {
  private attributions: TradeAttribution[] = [];
  private blockerLog: Array<{ blocker: string; wouldHaveWon: boolean; savedUsd: number }> = [];

  /**
   * Record a completed trade's attribution data.
   */
  recordTrade(decision: DecisionRecord): void {
    if (decision.outcome !== 'executed' || !decision.fillPrice) return;

    const predictedEdgeBps = decision.expectedEdgeBps;
    const entryPrice = decision.fillPrice;

    // Compute alpha contributions from ensemble votes
    const alphaContributions: Record<AlphaModelId, number> = {
      trend_continuation: 0,
      mean_reversion: 0,
      volatility_breakout: 0,
      momentum_divergence: 0,
      sentiment_tilt: 0,
    };

    const totalWeight = decision.ensemble.votes
      .filter(v => v.direction !== 0)
      .reduce((s, v) => s + v.weight * v.confidence, 0);

    for (const vote of decision.ensemble.votes) {
      if (vote.direction === 0 || totalWeight === 0) continue;
      const contrib = (vote.weight * vote.confidence / totalWeight) * vote.expectedReturnBps;
      alphaContributions[vote.modelId] = Math.round(contrib);
    }

    const dominantAlpha = decision.ensemble.dominantModel;

    // Actual slippage (entry vs requested)
    const requestedPrice = decision.tradePlan?.entry.price ?? entryPrice;
    const actualSlippageBps = requestedPrice > 0
      ? Math.round(Math.abs(entryPrice - requestedPrice) / requestedPrice * 10000)
      : 0;
    const estimatedSlippageBps = 10; // default estimate

    const feeImpactBps = decision.fillFeesUsd && entryPrice > 0
      ? Math.round(decision.fillFeesUsd / (entryPrice * (decision.tradePlan?.sizing.quantity ?? 1)) * 10000)
      : 0;

    // Realized return (will be updated when trade closes)
    const realizedReturnBps = decision.realizedPnlUsd !== undefined && decision.tradePlan
      ? Math.round(decision.realizedPnlUsd / decision.tradePlan.sizing.notionalUsd * 10000)
      : 0;

    const attr: TradeAttribution = {
      decisionId: decision.id,
      symbol: decision.symbol,
      timestamp: decision.timestamp,
      predictedEdgeBps,
      realizedReturnBps,
      edgeAccuracy: predictedEdgeBps !== 0
        ? 1 - Math.abs(realizedReturnBps - predictedEdgeBps) / Math.abs(predictedEdgeBps)
        : 0,
      estimatedSlippageBps,
      actualSlippageBps,
      feeImpactBps,
      alphaContributions,
      dominantAlpha,
      regimeAtDecision: decision.marketState.regime,
      volatilityAtDecision: decision.marketState.volatility.atrPercent,
    };

    this.attributions.push(attr);
  }

  /**
   * Record a blocked trade for blocker leaderboard tracking.
   */
  recordBlockedTrade(
    blockers: string[],
    wouldHaveWon: boolean,
    estimatedPnlUsd: number,
  ): void {
    for (const blocker of blockers) {
      this.blockerLog.push({
        blocker,
        wouldHaveWon,
        savedUsd: wouldHaveWon ? 0 : Math.abs(estimatedPnlUsd),
      });
    }
  }

  /**
   * Update a trade's realized return (called when position closes).
   */
  updateRealized(decisionId: string, realizedReturnBps: number): void {
    const attr = this.attributions.find(a => a.decisionId === decisionId);
    if (!attr) return;

    attr.realizedReturnBps = realizedReturnBps;
    attr.edgeAccuracy = attr.predictedEdgeBps !== 0
      ? 1 - Math.abs(realizedReturnBps - attr.predictedEdgeBps) / Math.abs(attr.predictedEdgeBps)
      : 0;
  }

  /**
   * Get P&L breakdown by regime.
   */
  getPerformanceByRegime(): StrategyPerformanceByRegime[] {
    const byRegime = new Map<Regime, TradeAttribution[]>();

    for (const attr of this.attributions) {
      const list = byRegime.get(attr.regimeAtDecision) ?? [];
      list.push(attr);
      byRegime.set(attr.regimeAtDecision, list);
    }

    const results: StrategyPerformanceByRegime[] = [];

    for (const [regime, attrs] of byRegime) {
      const returns = attrs.map(a => a.realizedReturnBps);
      const wins = returns.filter(r => r > 0).length;
      const avgReturn = returns.length > 0
        ? returns.reduce((a, b) => a + b, 0) / returns.length
        : 0;

      // Simple Sharpe approximation
      const mean = avgReturn;
      const stdDev = returns.length > 1
        ? Math.sqrt(returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1))
        : 1;
      const sharpe = stdDev > 0 ? mean / stdDev : 0;

      // Max drawdown from cumulative returns
      let peak = 0, maxDD = 0, cumReturn = 0;
      for (const r of returns) {
        cumReturn += r;
        peak = Math.max(peak, cumReturn);
        maxDD = Math.max(maxDD, peak - cumReturn);
      }

      results.push({
        regime,
        tradeCount: attrs.length,
        winRate: attrs.length > 0 ? wins / attrs.length : 0,
        avgReturnBps: Math.round(avgReturn),
        totalPnlUsd: 0, // would need position sizes to compute
        sharpeRatio: Math.round(sharpe * 100) / 100,
        maxDrawdownPct: Math.round(maxDD) / 100,
      });
    }

    return results;
  }

  /**
   * Get the blocker leaderboard.
   */
  getBlockerLeaderboard(): BlockerLeaderboard[] {
    const byBlocker = new Map<string, { count: number; saved: number; fp: number }>();

    for (const entry of this.blockerLog) {
      const current = byBlocker.get(entry.blocker) ?? { count: 0, saved: 0, fp: 0 };
      current.count++;
      current.saved += entry.savedUsd;
      if (entry.wouldHaveWon) current.fp++;
      byBlocker.set(entry.blocker, current);
    }

    return Array.from(byBlocker.entries())
      .map(([blocker, data]) => ({
        blocker,
        count: data.count,
        estimatedSavingsUsd: Math.round(data.saved * 100) / 100,
        falsePositives: data.fp,
      }))
      .sort((a, b) => b.estimatedSavingsUsd - a.estimatedSavingsUsd);
  }

  /**
   * Get today's expectancy (average edge per trade).
   */
  getTodayExpectancy(): { trades: number; avgEdgeBps: number; winRate: number } {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayMs = today.getTime();

    const todayAttrs = this.attributions.filter(a => a.timestamp >= todayMs);
    if (todayAttrs.length === 0) return { trades: 0, avgEdgeBps: 0, winRate: 0 };

    const returns = todayAttrs.map(a => a.realizedReturnBps);
    const wins = returns.filter(r => r > 0).length;

    return {
      trades: todayAttrs.length,
      avgEdgeBps: Math.round(returns.reduce((a, b) => a + b, 0) / returns.length),
      winRate: wins / todayAttrs.length,
    };
  }

  /**
   * Get all attributions (for API/UI).
   */
  getAttributions(): ReadonlyArray<TradeAttribution> {
    return this.attributions;
  }

  /**
   * Get alpha model performance ranking.
   */
  getAlphaModelPerformance(): Array<{
    modelId: AlphaModelId;
    avgContributionBps: number;
    dominantCount: number;
    totalTrades: number;
  }> {
    const modelStats = new Map<AlphaModelId, { totalContrib: number; dominant: number; count: number }>();

    for (const attr of this.attributions) {
      for (const [modelId, contrib] of Object.entries(attr.alphaContributions)) {
        const id = modelId as AlphaModelId;
        const stats = modelStats.get(id) ?? { totalContrib: 0, dominant: 0, count: 0 };
        stats.totalContrib += contrib;
        stats.count++;
        if (attr.dominantAlpha === id) stats.dominant++;
        modelStats.set(id, stats);
      }
    }

    return Array.from(modelStats.entries())
      .map(([modelId, stats]) => ({
        modelId,
        avgContributionBps: stats.count > 0 ? Math.round(stats.totalContrib / stats.count) : 0,
        dominantCount: stats.dominant,
        totalTrades: stats.count,
      }))
      .sort((a, b) => b.avgContributionBps - a.avgContributionBps);
  }
}
