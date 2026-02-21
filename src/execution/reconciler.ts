import type { Logger } from '../core/logger.js';
import type { Metrics } from '../core/metrics.js';
import type { ExchangeAdapter } from '../exchanges/adapter.js';
import { OrderState } from './orderState.js';

export class Reconciler {
  constructor(
    private readonly exchange: ExchangeAdapter,
    private readonly orderState: OrderState,
    private readonly logger: Logger,
    private readonly metrics: Metrics
  ) {}

  async run(symbols: string[]): Promise<void> {
    for (const symbol of symbols) {
      const localOpen = this.orderState.getOpenOrders(symbol);
      const remoteOpen = await this.exchange.listOpenOrders(symbol);
      const remoteIds = new Set(remoteOpen.map((o) => o.orderId));

      for (const local of localOpen) {
        if (!remoteIds.has(local.orderId)) {
          try {
            const latest = await this.exchange.getOrder(local.orderId);
            await this.orderState.upsert(latest);
            this.metrics.increment('reconciler.order_updated');
          } catch (err) {
            this.logger.warn('reconciliation lookup failed', {
              symbol,
              orderId: local.orderId,
              err: String(err)
            });
            this.metrics.increment('reconciler.errors');
          }
        }
      }
    }
  }
}
