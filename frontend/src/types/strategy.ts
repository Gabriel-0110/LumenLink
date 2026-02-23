import type { ReactNode } from 'react';

// ── Strategy Tab ─────────────────────────────────────────────────────────────

export interface StrategyTab {
  label: string;
  path: string;
  icon: ReactNode;
}

// ── Strategy API Types (mirrors backend) ─────────────────────────────────────

export type Regime =
  | 'trending_up' | 'trending_down' | 'mean_revert'
  | 'high_vol' | 'low_liquidity' | 'news_risk' | 'breakout';

export type AlphaModelId =
  | 'trend_continuation' | 'mean_reversion' | 'volatility_breakout'
  | 'momentum_divergence' | 'sentiment_tilt';

export type OverlayMode = 'normal' | 'reduced' | 'no_new_entries' | 'flatten_only';
export type RolloutStage = 'shadow' | 'paper' | 'small_live' | 'full_live';
export type DecisionOutcome = 'executed' | 'blocked' | 'skipped' | 'deferred';

export interface MarketStateData {
  symbol: string;
  timestamp: number;
  regime: Regime;
  regimeConfidence: number;
  volatility: {
    atrPercent: number;
    realizedVol: number;
    volOfVol: number;
    percentile: number;
  };
  liquidity: {
    spreadPercent: number;
    depthProxy: number;
    slippageRisk: 'low' | 'medium' | 'high' | 'extreme';
    volumeRatio: number;
  };
  momentum: {
    trendSlope: number;
    strength: number;
    persistence: number;
    direction: 1 | 0 | -1;
  };
  microstructure: {
    gapDetected: boolean;
    highWickiness: boolean;
    churnDetected: boolean;
    spreadSpike: boolean;
    flags: string[];
  };
  dataIntegrity: {
    staleFeed: boolean;
    missingCandles: number;
    exchangeJitter: boolean;
    lastUpdateMs: number;
    healthy: boolean;
  };
  summary: string;
}

export interface AlphaVoteData {
  modelId: AlphaModelId;
  direction: 1 | 0 | -1;
  confidence: number;
  expectedReturnBps: number;
  expectedRiskBps: number;
  regime: Regime;
  weight: number;
  reason: string;
}

export interface DecisionRecordData {
  id: string;
  symbol: string;
  timestamp: number;
  outcome: DecisionOutcome;
  action: 'buy' | 'sell' | 'hold';
  confidence: number;
  expectedEdgeBps: number;
  blockers: string[];
  ensemble: {
    direction: 1 | 0 | -1;
    confidence: number;
    expectedEdgeBps: number;
    expectedRiskBps: number;
    edgeRatio: number;
    consensusLevel: number;
    dominantModel: AlphaModelId | null;
    votes: AlphaVoteData[];
  };
  forecast: {
    probabilityUp: number;
    probabilityDown: number;
    expectedReturnBps: number;
    exceedsCosts: boolean;
    costBps: number;
    calibrationScore: number;
  };
  overlay: {
    mode: OverlayMode;
    sizeMultiplier: number;
    stopTightenBps: number;
    edgeThresholdBoostBps: number;
    reasons: string[];
  };
  tradePlan: {
    side: 'buy' | 'sell';
    sizing: { notionalUsd: number; riskPercent: number };
    exit: { stopLossBps: number; takeProfitBps: number };
    expectedPnlUsd: number;
    rewardRiskRatio: number;
  } | null;
  explanation: {
    summary: string;
    topBlockers: string[];
    whatChanged: string[];
    whyNoTrade?: string;
    riskNarrative: string;
    anomalies: string[];
  };
  marketState: MarketStateData;
}

export interface PerformanceByRegime {
  regime: Regime;
  tradeCount: number;
  winRate: number;
  avgReturnBps: number;
  totalPnlUsd: number;
  sharpeRatio: number;
  maxDrawdownPct: number;
}

export interface BlockerLeaderboardEntry {
  blocker: string;
  count: number;
  estimatedSavingsUsd: number;
  falsePositives: number;
}

export interface AlphaModelPerf {
  modelId: AlphaModelId;
  avgContributionBps: number;
  dominantCount: number;
  totalTrades: number;
}

export interface GovernanceData {
  version: string;
  name: string;
  stage: RolloutStage;
  featureFlags: Record<string, boolean>;
  parameters: Record<string, number | string | boolean>;
  updatedAt: number;
  changedBy: string;
  changeReason: string;
}

export interface StrategyEngineStatus {
  cycleCount: number;
  governance: GovernanceData;
  todayExpectancy: { trades: number; avgEdgeBps: number; winRate: number };
  performanceByRegime: PerformanceByRegime[];
  blockerLeaderboard: BlockerLeaderboardEntry[];
  alphaPerformance: AlphaModelPerf[];
  recentDecisionCount: number;
}

export interface StrategyDashboardData {
  status: StrategyEngineStatus;
  decisions: DecisionRecordData[];
  marketStates: Record<string, MarketStateData>;
}
