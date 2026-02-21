export type Side = 'buy' | 'sell';
export type OrderType = 'market' | 'limit';
export type SignalAction = 'BUY' | 'SELL' | 'HOLD';

export interface Candle {
  symbol: string;
  interval: string;
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Ticker {
  symbol: string;
  bid: number;
  ask: number;
  last: number;
  volume24h?: number;
  time: number;
}

export interface OrderRequest {
  symbol: string;
  side: Side;
  type: OrderType;
  quantity: number;
  price?: number;
  clientOrderId: string;
}

export interface Order {
  orderId: string;
  clientOrderId: string;
  symbol: string;
  side: Side;
  type: OrderType;
  quantity: number;
  price?: number;
  status: 'pending' | 'open' | 'filled' | 'canceled' | 'rejected';
  filledQuantity: number;
  avgFillPrice?: number;
  reason?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Balance {
  asset: string;
  free: number;
  locked: number;
}

export interface Signal {
  action: SignalAction;
  confidence: number;
  reason: string;
}

export interface Position {
  symbol: string;
  quantity: number;
  avgEntryPrice: number;
  marketPrice: number;
}

export interface AccountSnapshot {
  cashUsd: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  openPositions: Position[];
  lastStopOutAtBySymbol: Record<string, number | undefined>;
}

export interface RiskDecision {
  allowed: boolean;
  reason: string;
  blockedBy?:
    | 'kill_switch'
    | 'live_disabled'
    | 'max_daily_loss'
    | 'max_position_usd'
    | 'max_open_positions'
    | 'cooldown'
    | 'spread_guard'
    | 'slippage_guard'
    | 'min_volume';
}
