/**
 * EventBus — typed pub/sub bridge between the trading engine and WebSocket clients.
 *
 * The trading engine emits domain events (price ticks, trade fills, position changes,
 * risk alerts, metrics snapshots, sentiment updates) and the WebSocket server forwards
 * them to subscribed clients.
 */

import { EventEmitter } from 'node:events';
import type { Ticker, Position, Order, KillSwitchState } from '../../../src/core/types.js';
import type { SentimentData } from '../../../src/data/sentimentService.js';

// ── Channel payload types ────────────────────────────────────────────────────

export interface PriceEvent {
  symbol: string;
  bid: number;
  ask: number;
  last: number;
  volume24h?: number;
  time: number;
}

export interface TradeEvent {
  orderId: string;
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  price: number;
  fees: number;
  realizedPnlUsd?: number;
  timestamp: number;
}

export interface PositionEvent {
  positions: Array<Position & {
    valueUsd: number;
    unrealizedPnlUsd: number;
    unrealizedPnlPct: number;
  }>;
  cashUsd: number;
  totalEquityUsd: number;
}

export interface AlertEvent {
  level: 'info' | 'warn' | 'critical';
  title: string;
  message: string;
  context?: Record<string, unknown>;
  timestamp: number;
}

export interface MetricsEvent {
  counters: Record<string, number>;
  gauges: Record<string, number>;
  uptimeSec: number;
}

export interface SentimentEvent {
  fearGreedIndex: number;
  fearGreedLabel: string;
  newsScore?: number;
  socialSentiment?: number;
  timestamp: number;
}

// ── Channel map ──────────────────────────────────────────────────────────────

export interface ChannelPayloads {
  price: PriceEvent;
  trades: TradeEvent;
  positions: PositionEvent;
  alerts: AlertEvent;
  metrics: MetricsEvent;
  sentiment: SentimentEvent;
}

export type Channel = keyof ChannelPayloads;
export const ALL_CHANNELS: Channel[] = ['price', 'trades', 'positions', 'alerts', 'metrics', 'sentiment'];

// ── EventBus class ───────────────────────────────────────────────────────────

export class EventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    // Raise limit — many WebSocket clients may subscribe concurrently.
    this.emitter.setMaxListeners(200);
  }

  /** Publish an event on a channel. */
  emit<C extends Channel>(channel: C, payload: ChannelPayloads[C]): void {
    this.emitter.emit(channel, payload);
  }

  /** Subscribe to a channel. Returns an unsubscribe function. */
  on<C extends Channel>(channel: C, handler: (payload: ChannelPayloads[C]) => void): () => void {
    this.emitter.on(channel, handler);
    return () => this.emitter.off(channel, handler);
  }

  /** One-shot subscribe. */
  once<C extends Channel>(channel: C, handler: (payload: ChannelPayloads[C]) => void): void {
    this.emitter.once(channel, handler);
  }

  /** Current listener count for a channel. */
  listenerCount(channel: Channel): number {
    return this.emitter.listenerCount(channel);
  }
}

/** Singleton event bus shared between trading engine and backend server. */
export const eventBus = new EventBus();
