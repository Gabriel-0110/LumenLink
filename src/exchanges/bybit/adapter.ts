import type { Balance, Candle, Order, OrderRequest, Ticker } from '../../core/types.js';
import type { ExchangeAdapter } from '../adapter.js';

// TODO: implement full Bybit adapter.
export class BybitAdapter implements ExchangeAdapter {
  async getTicker(_symbol: string): Promise<Ticker> {
    throw new Error('BybitAdapter.getTicker not implemented');
  }
  async getCandles(_symbol: string, _interval: string, _limit: number): Promise<Candle[]> {
    throw new Error('BybitAdapter.getCandles not implemented');
  }
  async placeOrder(_orderRequest: OrderRequest): Promise<Order> {
    throw new Error('BybitAdapter.placeOrder not implemented');
  }
  async cancelOrder(_orderId: string): Promise<void> {
    throw new Error('BybitAdapter.cancelOrder not implemented');
  }
  async getOrder(_orderId: string): Promise<Order> {
    throw new Error('BybitAdapter.getOrder not implemented');
  }
  async listOpenOrders(_symbol?: string): Promise<Order[]> {
    throw new Error('BybitAdapter.listOpenOrders not implemented');
  }
  async getBalances(): Promise<Balance[]> {
    throw new Error('BybitAdapter.getBalances not implemented');
  }
}
