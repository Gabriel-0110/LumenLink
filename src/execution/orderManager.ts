import crypto from 'node:crypto';
import type { AppConfig } from '../config/types.js';
import type { Logger } from '../core/logger.js';
import type { Metrics } from '../core/metrics.js';
import type { Order, Signal, Ticker } from '../core/types.js';
import { computePositionUsd } from '../risk/positionSizing.js';
import { LiveBroker } from './liveBroker.js';
import { OrderState } from './orderState.js';
import { PaperBroker } from './paperBroker.js';

export class OrderManager {
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

    const side = signal.action === 'BUY' ? 'buy' : 'sell';
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
}
