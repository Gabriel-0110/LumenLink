import type { ExchangeAdapter } from '../exchanges/adapter.js';
import type { Order, OrderRequest } from '../core/types.js';

export class LiveBroker {
  constructor(private readonly exchange: ExchangeAdapter) {}

  async place(orderRequest: OrderRequest): Promise<Order> {
    return this.exchange.placeOrder(orderRequest);
  }
}
