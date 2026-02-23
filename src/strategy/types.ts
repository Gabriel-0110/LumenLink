/**
 * Strategy Engine Type System
 *
 * Every cycle produces:
 *   MarketState → AlphaVotes[] → EdgeForecast → TradePlan → RiskOverlayDecision
 *   → DecisionRecord → OperatorExplanation
 *
 * This is the professional strategy engine's contract.
 */

import type { Candle, Ticker, Side, OrderType, TimeInForce } from '../core/types.js';

// ── Market State ─────────────────────────────────────────────────────────────

export type Regime = 'trending_up' | 'trending_down' | 'mean_revert' | 'high_vol' | 'low_liquidity' | 'news_risk' | 'breakout';

export interface VolatilityState {
  atrPercent: number;          // ATR as % of price
  realizedVol: number;         // annualized realized volatility
  volOfVol: number;            // volatility-of-volatility (stability of vol)
  percentile: number;          // 0-1, where current vol sits in recent history
}

export interface LiquidityState {
  spreadPercent: number;       // bid-ask spread as % of mid
  depthProxy: number;          // orderbook depth estimate (0-1 normalized)
  slippageRisk: 'low' | 'medium' | 'high' | 'extreme';
  volumeRatio: number;         // current vol / avg vol
}

export interface MomentumState {
  trendSlope: number;          // linear regression slope (annualized)
  strength: number;            // 0-1
  persistence: number;         // autocorrelation proxy (0-1)
  direction: 1 | 0 | -1;
}

export interface MicrostructureWarnings {
  gapDetected: boolean;        // price gap > 2 ATR
  highWickiness: boolean;      // wick/body ratio extreme
  churnDetected: boolean;      // high volume, no net movement
  spreadSpike: boolean;        // spread > 2x normal
  flags: string[];             // human-readable warning labels
}

export interface DataIntegrity {
  staleFeed: boolean;          // last candle older than expected
  missingCandles: number;      // gaps in candle sequence
  exchangeJitter: boolean;     // timestamp irregularities
  lastUpdateMs: number;        // ms since last fresh data
  healthy: boolean;
}

export interface MarketState {
  symbol: string;
  timestamp: number;
  regime: Regime;
  regimeConfidence: number;    // 0-1
  volatility: VolatilityState;
  liquidity: LiquidityState;
  momentum: MomentumState;
  microstructure: MicrostructureWarnings;
  dataIntegrity: DataIntegrity;
  summary: string;             // one-line human description
}

// ── Alpha Model ──────────────────────────────────────────────────────────────

export type AlphaModelId =
  | 'trend_continuation'
  | 'mean_reversion'
  | 'volatility_breakout'
  | 'momentum_divergence'
  | 'sentiment_tilt';

export interface AlphaVote {
  modelId: AlphaModelId;
  direction: 1 | 0 | -1;      // +1 long, -1 short, 0 neutral
  confidence: number;          // 0-1
  expectedReturnBps: number;   // basis points expected return
  expectedRiskBps: number;     // basis points expected risk
  regime: Regime;              // what regime this model was tuned for
  weight: number;              // regime-adjusted weight in ensemble
  reason: string;
  metrics: Record<string, number>; // model-specific diagnostics
}

export interface EnsembleResult {
  direction: 1 | 0 | -1;
  confidence: number;          // combined confidence
  expectedEdgeBps: number;     // weighted expected return
  expectedRiskBps: number;     // weighted expected risk
  edgeRatio: number;           // edge / risk
  votes: AlphaVote[];
  consensusLevel: number;      // 0-1 how much models agree
  dominantModel: AlphaModelId | null;
}

// ── Forecasting / Edge Scorer ────────────────────────────────────────────────

export interface EdgeForecast {
  symbol: string;
  timestamp: number;
  horizonMs: number;           // forecast horizon in ms
  probabilityUp: number;       // P(price goes up by threshold)
  probabilityDown: number;     // P(price goes down by threshold)
  expectedReturnBps: number;   // E[return] in bps
  uncertainty: number;         // confidence interval width
  exceedsCosts: boolean;       // P(move) > fees + slippage
  costBps: number;             // estimated total cost (fees + slippage)
  calibrationScore: number;    // reliability of this forecast (0-1)
  method: 'statistical' | 'ml' | 'hybrid';
}

// ── Trade Construction ───────────────────────────────────────────────────────

export interface EntryPlan {
  type: OrderType;
  price: number | null;        // null for market orders
  timeInForce: TimeInForce;
  limitOffsetBps?: number;     // offset from mid for limit orders
}

export interface ExitPlan {
  stopLossPrice: number;
  stopLossBps: number;         // distance from entry in bps
  takeProfitPrice: number;
  takeProfitBps: number;
  trailingStopBps: number | null;
  maxTimeInTradeMs: number;    // max holding period
  exitType: 'stop' | 'target' | 'trailing' | 'time';
}

export interface SizingPlan {
  notionalUsd: number;
  quantity: number;
  riskBudgetUsd: number;       // max loss on this trade
  riskPercent: number;         // % of account risked
  volatilityScaled: boolean;   // was size adjusted for vol?
  liquidityScaled: boolean;    // was size adjusted for liquidity?
  feeAdjusted: boolean;        // was edge vs cost checked?
}

export interface TradeConstraints {
  maxExposureUsd: number;
  perSymbolCapUsd: number;
  minEdgeBps: number;          // minimum edge threshold
  correlationCheck: boolean;   // correlated exposure checked?
}

export interface TradePlan {
  symbol: string;
  side: Side;
  entry: EntryPlan;
  exit: ExitPlan;
  sizing: SizingPlan;
  constraints: TradeConstraints;
  expectedPnlUsd: number;      // E[PnL] net of costs
  rewardRiskRatio: number;     // R:R ratio
  timestamp: number;
}

// ── Risk Overlay ─────────────────────────────────────────────────────────────

export type OverlayMode =
  | 'normal'           // full trading
  | 'reduced'          // reduced size + tighter stops
  | 'no_new_entries'   // only manage existing
  | 'flatten_only';    // close everything, no new trades

export interface RiskOverlayInputs {
  portfolioExposureUsd: number;
  concentrationPct: number;    // % of portfolio in largest position
  realizedDrawdownUsd: number;
  drawdownPercent: number;
  volatilityRegimeShift: boolean;
  correlationSpike: boolean;   // correlated exposure risk
  eventRiskWindow: boolean;    // FOMC, CPI, etc.
  operationalRisk: {
    apiErrorRate: number;      // recent API error %
    reconDriftUsd: number;     // reconciliation mismatch
    openOrderBacklog: number;
  };
}

export interface RiskOverlayDecision {
  mode: OverlayMode;
  sizeMultiplier: number;      // 0-1, reduces position size
  stopTightenBps: number;      // extra tightening on stops
  edgeThresholdBoostBps: number; // raised edge threshold
  reasons: string[];
  inputs: RiskOverlayInputs;
  timestamp: number;
}

// ── Decision Record (audit-ready) ────────────────────────────────────────────

export type DecisionOutcome = 'executed' | 'blocked' | 'skipped' | 'deferred';

export interface DecisionRecord {
  id: string;                   // unique decision ID
  symbol: string;
  timestamp: number;
  cycleId: string;              // links to strategy cycle

  // Pipeline outputs
  marketState: MarketState;
  ensemble: EnsembleResult;
  forecast: EdgeForecast;
  tradePlan: TradePlan | null;  // null if blocked/skipped
  overlay: RiskOverlayDecision;

  // Final decision
  outcome: DecisionOutcome;
  action: Side | 'hold';
  confidence: number;
  expectedEdgeBps: number;
  blockers: string[];           // what blocked this trade

  // Execution (filled after order)
  executionId?: string;
  fillPrice?: number;
  fillSlippageBps?: number;
  fillFeesUsd?: number;
  realizedPnlUsd?: number;

  // LLM explanation
  explanation?: string;
}

// ── Strategy Governance ──────────────────────────────────────────────────────

export type RolloutStage = 'shadow' | 'paper' | 'small_live' | 'full_live';

export interface StrategyConfig {
  version: string;             // semver
  name: string;
  description: string;
  stage: RolloutStage;
  featureFlags: Record<string, boolean>;
  parameters: Record<string, number | string | boolean>;
  createdAt: number;
  updatedAt: number;
  changedBy: string;           // who made the change
  changeReason: string;        // why
}

export interface StrategyChangeLog {
  version: string;
  timestamp: number;
  changedBy: string;
  reason: string;
  diff: Record<string, { from: unknown; to: unknown }>;
}

// ── Performance Attribution ──────────────────────────────────────────────────

export interface TradeAttribution {
  decisionId: string;
  symbol: string;
  timestamp: number;

  // Predicted vs actual
  predictedEdgeBps: number;
  realizedReturnBps: number;
  edgeAccuracy: number;        // how close prediction was

  // Cost analysis
  estimatedSlippageBps: number;
  actualSlippageBps: number;
  feeImpactBps: number;

  // Alpha contribution
  alphaContributions: Record<AlphaModelId, number>;  // bps contribution per model
  dominantAlpha: AlphaModelId | null;

  // Context
  regimeAtDecision: Regime;
  volatilityAtDecision: number;
}

export interface StrategyPerformanceByRegime {
  regime: Regime;
  tradeCount: number;
  winRate: number;
  avgReturnBps: number;
  totalPnlUsd: number;
  sharpeRatio: number;
  maxDrawdownPct: number;
}

export interface BlockerLeaderboard {
  blocker: string;
  count: number;
  estimatedSavingsUsd: number; // how much loss the blocker prevented
  falsePositives: number;      // times it blocked a would-be winner
}

// ── Operator Explanation ─────────────────────────────────────────────────────

export interface OperatorExplanation {
  cycleId: string;
  timestamp: number;
  summary: string;             // 1-2 sentence overview
  topBlockers: string[];       // "Top 3 reasons we didn't trade"
  whatChanged: string[];       // "What changed since last cycle"
  whyNoTrade?: string;        // "Signal fired but..." explanation
  riskNarrative: string;      // current risk posture explanation
  anomalies: string[];        // unusual observations
}

// ── Strategy Engine Cycle Output ─────────────────────────────────────────────

export interface StrategyCycleOutput {
  cycleId: string;
  timestamp: number;
  symbol: string;
  marketState: MarketState;
  alphaVotes: AlphaVote[];
  ensemble: EnsembleResult;
  forecast: EdgeForecast;
  tradePlan: TradePlan | null;
  overlay: RiskOverlayDecision;
  decision: DecisionRecord;
  explanation: OperatorExplanation;
}
