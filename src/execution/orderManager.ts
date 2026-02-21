import * as crypto from 'node:crypto';
import type { AppConfig } from '../config/types.js';
import type { Logger } from '../core/logger.js';
import type { Metrics } from '../core/metrics.js';
import type { Order, Position, Signal, Ticker } from '../core/types.js';
import { computePositionUsd } from '../risk/positionSizing.js';
import { LiveBroker } from './liveBroker.js';
import { OrderState } from './orderState.js';
import { PaperBroker } from './paperBroker.js';
import { TrailingStopManager, type TrailingStopConfig } from './trailingStops.js';

export class OrderManager {
  private readonly trailingStops = new TrailingStopManager();

  constructor(
    private readonly config: AppConfig,
    private readonly orderState: OrderState,
    private readonly paperBroker: PaperBroker,
    private readonly liveBroker: LiveBroker,
    private readonly logger: Logger,
    private readonly metrics: Metrics
  ) {}

  createClientOrderId(symbol: string, side: 'buy' | 'sell'): string {
    return `${symbol}-${side}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  }

  async submitSignal(input: {
    symbol: string;
    signal: Signal;
    ticker: Ticker;
    idempotencyKey?: string;
  }): Promise<Order | undefined> {
    const { symbol, signal, ticker } = input;
    if (signal.action === 'HOLD') return undefined;

    const side: 'buy' | 'sell' = signal.action === 'BUY' ? 'buy' : 'sell';
    const clientOrderId = input.idempotencyKey ?? this.createClientOrderId(symbol, side);

    const existing = this.orderState.getByClientOrderId(clientOrderId);
    if (existing) {
      this.logger.info('idempotent order request matched existing order', {
        clientOrderId,
        orderId: existing.orderId
      });
      this.metrics.increment('orders.idempotent_hit');
      return existing;
    }

    const targetUsd = computePositionUsd(signal.confidence, this.config.risk.maxPositionUsd);
    const quantity = Math.max(0.000001, targetUsd / Math.max(ticker.last, 1));

    const orderReq = {
      symbol,
      side,
      type: 'market' as const,
      quantity,
      clientOrderId
    };

    const order =
      this.config.mode === 'paper'
        ? await this.paperBroker.place(orderReq, ticker, this.config.guards.maxSlippageBps)
        : await this.liveBroker.place(orderReq);

    await this.orderState.upsert(order);
    this.metrics.increment('orders.submitted');
    return order;
  }

  // Trailing Stop Management
  addTrailingStop(position: Position, config: TrailingStopConfig, currentPrice: number): void {
    const stop = this.trailingStops.addTrailingStop(position, config, currentPrice);
    this.logger.info('trailing stop added', {
      symbol: config.symbol,
      initialStopPrice: stop.currentStopPrice,
      trailPercent: config.trailPercent
    });
    this.metrics.increment('trailing_stops.added');
  }

  async processTrailingStops(ticker: Ticker): Promise<Order[]> {
    const triggeredSymbols = this.trailingStops.updateTrailingStops(ticker);
    const orders: Order[] = [];

    for (const symbol of triggeredSymbols) {
      const stop = this.trailingStops.getTrailingStop(symbol);
      if (!stop) continue;

      // Create market sell order to close position
      const side: 'buy' | 'sell' = stop.side === 'buy' ? 'sell' : 'buy';
      const clientOrderId = this.createClientOrderId(symbol, side);

      // For trailing stop triggered orders, we need to determine quantity
      // This would typically come from the position size, but for now we'll use a placeholder
      const quantity = 0.001; // This should be replaced with actual position quantity

      const orderReq = {
        symbol,
        side,
        type: 'market' as const,
        quantity,
        clientOrderId
      };

      try {
        const order = this.config.mode === 'paper'
          ? await this.paperBroker.place(orderReq, ticker, this.config.guards.maxSlippageBps)
          : await this.liveBroker.place(orderReq);

        await this.orderState.upsert(order);
        orders.push(order);

        this.logger.info('trailing stop triggered', {
          symbol,
          stopPrice: stop.currentStopPrice,
          currentPrice: ticker.last,
          orderId: order.orderId
        });

        this.metrics.increment('trailing_stops.triggered');
        
        // Remove the trailing stop after triggering
        this.trailingStops.removeTrailingStop(symbol);
      } catch (error) {
        this.logger.error('failed to execute trailing stop order', {
          symbol,
          error: error instanceof Error ? error.message : String(error)
        });
        this.metrics.increment('trailing_stops.failed');
      }
    }

    return orders;
  }

  removeTrailingStop(symbol: string): boolean {
    const removed = this.trailingStops.removeTrailingStop(symbol);
    if (removed) {
      this.logger.info('trailing stop removed', { symbol });
      this.metrics.increment('trailing_stops.removed');
    }
    return removed;
  }

  getTrailingStops() {
    return this.trailingStops.getAllTrailingStops();
  }
}
