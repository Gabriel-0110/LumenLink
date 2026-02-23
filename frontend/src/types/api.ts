// ── Core Trading Types ────────────────────────────────────────

export type Side = 'buy' | 'sell';
export type SignalAction = 'BUY' | 'SELL' | 'HOLD';
export type TradingMode = 'paper' | 'live';
export type Exchange = 'coinbase' | 'binance' | 'bybit';
export type StrategyName =
  | 'ema_crossover'
  | 'rsi_mean_reversion'
  | 'composite'
  | 'advanced_composite'
  | 'grid_trading'
  | 'smart_dca'
  | 'regime_aware';

// ── Position ────────────────────────────────────────────────────

export interface Position {
  symbol: string;
  quantity: number;
  avgEntryPrice: number;
  marketPrice: number;
  valueUsd: number;
  unrealizedPnlUsd: number;
  unrealizedPnlPct: number;
}

// ── Trade / Journal Entry ────────────────────────────────────────

export interface Trade {
  id?: number;
  tradeId: string;
  symbol: string;
  side: Side;
  action: 'entry' | 'exit';
  strategy: string;
  orderId: string;
  requestedPrice: number;
  filledPrice: number;
  slippageBps: number;
  quantity: number;
  notionalUsd: number;
  commissionUsd: number;
  confidence: number;
  reason: string;
  riskDecision: string;
  realizedPnlUsd?: number;
  realizedPnlPct?: number;
  holdingDurationMs?: number;
  mode: TradingMode;
  timestamp: number;
}

// ── Signal ───────────────────────────────────────────────────────

export interface Signal {
  action: SignalAction;
  confidence: number;
  reason: string;
}

// ── Daily Summary ────────────────────────────────────────────────

export interface DailySummary {
  date: string;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  grossProfitUsd: number;
  grossLossUsd: number;
  netPnlUsd: number;
  totalCommissionUsd: number;
  totalSlippageBps: number;
  bestTradeUsd: number;
  worstTradeUsd: number;
  maxDrawdownUsd: number;
}

// ── Kill Switch ──────────────────────────────────────────────────

export interface KillSwitchState {
  triggered: boolean;
  reason: string | null;
  triggeredAt: number | null;
  consecutiveLosses: number;
  spreadViolations: Array<{ timestamp: number }>;
}

// ── Risk Config ──────────────────────────────────────────────────

export interface RiskConfig {
  maxDailyLossUsd: number;
  maxPositionUsd: number;
  maxOpenPositions: number;
  cooldownMinutes: number;
  dailyPnlEstimate: number;
}

// ── Sentiment ────────────────────────────────────────────────────

export interface Sentiment {
  fearGreedIndex: number;
  fearGreedLabel: string;
  newsScore?: number;
  socialSentiment?: number;
  timestamp?: number;
}

// ── Market Overview ──────────────────────────────────────────────

export interface MarketOverview {
  btcDominance: number;
  totalMarketCap: number;
  total24hVolume?: number;
}

// ── Sparkline Candle ─────────────────────────────────────────────

export interface SparklineCandle {
  time: number;
  close: number;
  high: number;
  low: number;
  volume: number;
}

// ── Equity Curve Point ───────────────────────────────────────────

export interface EquityCurvePoint {
  date: string;
  cumPnl: number;
}

// ── Trailing Stops ───────────────────────────────────────────────

export interface TrailingStopsInfo {
  active: number;
  activated: number;
  total: number;
}

// ── Metrics Snapshot ─────────────────────────────────────────────

export interface MetricsSnapshot {
  counters: Record<string, number>;
  gauges: Record<string, number>;
}

// ── Main Dashboard Data (from /api/data) ─────────────────────────

export interface DashboardData {
  uptimeSec: number;
  mode: TradingMode;
  exchange: Exchange;
  strategy: StrategyName;
  interval: string;
  symbols: string[];
  killSwitch: boolean;
  cash: number;
  totalEquityUsd: number;
  unrealizedPnlUsd: number;
  realizedPnlUsd: number;
  positions: Position[];
  lastCandleTime: number | null;
  sentiment: Sentiment | null;
  marketOverview: MarketOverview | null;
  trailingStops: TrailingStopsInfo | null;
  risk: RiskConfig;
  today: DailySummary | null;
  weekly: DailySummary[];
  equityCurve: EquityCurvePoint[];
  recentTrades: Trade[];
  allTime: { totalTrades: number };
  sparklines: Record<string, SparklineCandle[]>;
  metricsSnap: MetricsSnapshot;
}

// ── Health Check ─────────────────────────────────────────────────

export interface HealthCheck {
  ok: boolean;
  mode: TradingMode;
  exchange: Exchange;
  uptime: number;
}
