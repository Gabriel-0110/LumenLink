import type { Candle, Order } from '../core/types.js';
import type { CandleStore } from './candleStore.js';

export class InMemoryStore implements CandleStore {
  private readonly candlesByKey = new Map<string, Candle[]>();
  private readonly orders = new Map<string, Order>();

  async saveCandles(candles: Candle[]): Promise<void> {
    for (const candle of candles) {
      const key = `${candle.symbol}:${candle.interval}`;
      const arr = this.candlesByKey.get(key) ?? [];
      arr.push(candle);
      arr.sort((a, b) => a.time - b.time);
      this.candlesByKey.set(key, arr.slice(-2000));
    }
  }

  async getRecentCandles(symbol: string, interval: string, limit: number): Promise<Candle[]> {
    const key = `${symbol}:${interval}`;
    const arr = this.candlesByKey.get(key) ?? [];
    return arr.slice(-limit);
  }

  async saveOrder(order: Order): Promise<void> {
    this.orders.set(order.orderId, order);
  }

  async getOrders(): Promise<Order[]> {
    return Array.from(this.orders.values());
  }
}
