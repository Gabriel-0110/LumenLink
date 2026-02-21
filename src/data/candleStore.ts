import type { Candle, Order } from '../core/types.js';

export interface CandleStore {
  saveCandles(candles: Candle[]): Promise<void>;
  getRecentCandles(symbol: string, interval: string, limit: number): Promise<Candle[]>;
  saveOrder(order: Order): Promise<void>;
  getOrders(): Promise<Order[]>;
}
