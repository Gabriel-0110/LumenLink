import type { Balance, Candle, Order, OrderRequest, Ticker } from '../core/types.js';

export interface ExchangeAdapter {
  getTicker(symbol: string): Promise<Ticker>;
  getCandles(symbol: string, interval: string, limit: number): Promise<Candle[]>;
  placeOrder(orderRequest: OrderRequest): Promise<Order>;
  cancelOrder(orderId: string): Promise<void>;
  getOrder(orderId: string): Promise<Order>;
  listOpenOrders(symbol?: string): Promise<Order[]>;
  getBalances(): Promise<Balance[]>;
}
