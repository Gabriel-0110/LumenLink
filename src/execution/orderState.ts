import type { Order } from '../core/types.js';
import type { CandleStore } from '../data/candleStore.js';

export class OrderState {
  private readonly byOrderId = new Map<string, Order>();
  private readonly byClientOrderId = new Map<string, string>();

  constructor(private readonly store: CandleStore) {}

  async upsert(order: Order): Promise<void> {
    this.byOrderId.set(order.orderId, order);
    this.byClientOrderId.set(order.clientOrderId, order.orderId);
    await this.store.saveOrder(order);
  }

  getByOrderId(orderId: string): Order | undefined {
    return this.byOrderId.get(orderId);
  }

  getByClientOrderId(clientOrderId: string): Order | undefined {
    const orderId = this.byClientOrderId.get(clientOrderId);
    return orderId ? this.byOrderId.get(orderId) : undefined;
  }

  getOpenOrders(symbol?: string): Order[] {
    return Array.from(this.byOrderId.values()).filter(
      (o) => (o.status === 'pending' || o.status === 'open') && (!symbol || o.symbol === symbol)
    );
  }

  getAllOrders(): Order[] {
    return Array.from(this.byOrderId.values());
  }

  async hydrateFromStore(): Promise<void> {
    const orders = await this.store.getOrders();
    for (const order of orders) {
      this.byOrderId.set(order.orderId, order);
      this.byClientOrderId.set(order.clientOrderId, order.orderId);
    }
  }
}
