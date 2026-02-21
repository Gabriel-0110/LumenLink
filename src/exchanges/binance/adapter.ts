import type { Balance, Candle, Order, OrderRequest, Ticker } from '../../core/types.js';
import type { ExchangeAdapter } from '../adapter.js';

// TODO: implement full Binance Spot adapter.
export class BinanceAdapter implements ExchangeAdapter {
  async getTicker(_symbol: string): Promise<Ticker> {
    throw new Error('BinanceAdapter.getTicker not implemented');
  }
  async getCandles(_symbol: string, _interval: string, _limit: number): Promise<Candle[]> {
    throw new Error('BinanceAdapter.getCandles not implemented');
  }
  async placeOrder(_orderRequest: OrderRequest): Promise<Order> {
    throw new Error('BinanceAdapter.placeOrder not implemented');
  }
  async cancelOrder(_orderId: string): Promise<void> {
    throw new Error('BinanceAdapter.cancelOrder not implemented');
  }
  async getOrder(_orderId: string): Promise<Order> {
    throw new Error('BinanceAdapter.getOrder not implemented');
  }
  async listOpenOrders(_symbol?: string): Promise<Order[]> {
    throw new Error('BinanceAdapter.listOpenOrders not implemented');
  }
  async getBalances(): Promise<Balance[]> {
    throw new Error('BinanceAdapter.getBalances not implemented');
  }
}
