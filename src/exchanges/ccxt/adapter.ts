import ccxt from 'ccxt';
import type { Balance, Candle, Order, OrderRequest, Ticker } from '../../core/types.js';
import type { ExchangeAdapter } from '../adapter.js';

interface CCXTConfig {
  exchange: string;
  apiKey?: string;
  secret?: string;
  sandbox?: boolean;
  options?: Record<string, unknown>;
}

// Define CCXT types
interface CCXTTicker {
  symbol: string;
  bid?: number;
  ask?: number;
  last?: number;
  baseVolume?: number;
  timestamp?: number;
}

interface CCXTOrder {
  id: string;
  clientOrderId?: string;
  symbol: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit';
  amount: number;
  price?: number;
  status: string;
  filled?: number;
  average?: number;
  timestamp?: number;
  lastTradeTimestamp?: number;
}

interface CCXTBalance {
  free: Record<string, number>;
  used: Record<string, number>;
  total: Record<string, number>;
}

export class CCXTAdapter implements ExchangeAdapter {
  private exchange: any;

  constructor(config: CCXTConfig) {
    const ExchangeClass = (ccxt as any)[config.exchange];
    if (!ExchangeClass) {
      throw new Error(`Unsupported exchange: ${config.exchange}`);
    }

    this.exchange = new ExchangeClass({
      apiKey: config.apiKey,
      secret: config.secret,
      sandbox: config.sandbox || false,
      enableRateLimit: true,
      options: {
        defaultType: 'spot', // Use spot trading by default
        ...config.options,
      },
    });
  }

  private toOrderStatus(status: string): Order['status'] {
    switch (status.toLowerCase()) {
      case 'filled':
      case 'closed':
        return 'filled';
      case 'canceled':
      case 'cancelled':
        return 'canceled';
      case 'rejected':
        return 'rejected';
      case 'open':
      case 'pending':
        return 'open';
      default:
        return 'pending';
    }
  }

  async getTicker(symbol: string): Promise<Ticker> {
    const ticker = await this.exchange.fetchTicker(symbol) as CCXTTicker;
    return {
      symbol,
      bid: ticker.bid ?? ticker.last ?? 0,
      ask: ticker.ask ?? ticker.last ?? 0,
      last: ticker.last ?? 0,
      volume24h: ticker.baseVolume ?? 0,
      time: ticker.timestamp ?? Date.now(),
    };
  }

  async getCandles(symbol: string, interval: string, limit: number): Promise<Candle[]> {
    const timeframe = this.mapIntervalToTimeframe(interval);
    const ohlcv = await this.exchange.fetchOHLCV(symbol, timeframe, undefined, limit) as number[][];

    return ohlcv.map((bar: number[]) => ({
      symbol,
      interval,
      time: bar[0] ?? Date.now(),
      open: bar[1] ?? 0,
      high: bar[2] ?? 0,
      low: bar[3] ?? 0,
      close: bar[4] ?? 0,
      volume: bar[5] ?? 0,
    }));
  }

  async placeOrder(orderRequest: OrderRequest): Promise<Order> {
    const order = await this.exchange.createOrder(
      orderRequest.symbol,
      orderRequest.type,
      orderRequest.side,
      orderRequest.quantity,
      orderRequest.price
    ) as CCXTOrder;

    return {
      orderId: order.id,
      clientOrderId: orderRequest.clientOrderId,
      symbol: orderRequest.symbol,
      side: orderRequest.side,
      type: orderRequest.type,
      quantity: orderRequest.quantity,
      price: orderRequest.price,
      status: this.toOrderStatus(order.status),
      filledQuantity: order.filled ?? 0,
      avgFillPrice: order.average,
      createdAt: order.timestamp ?? Date.now(),
      updatedAt: order.lastTradeTimestamp ?? Date.now(),
    };
  }

  async cancelOrder(orderId: string, symbol?: string): Promise<void> {
    await this.exchange.cancelOrder(orderId, symbol);
  }

  async getOrder(orderId: string, symbol?: string): Promise<Order> {
    const order = await this.exchange.fetchOrder(orderId, symbol) as CCXTOrder;

    return {
      orderId: order.id,
      clientOrderId: order.clientOrderId ?? '',
      symbol: order.symbol,
      side: order.side,
      type: order.type,
      quantity: order.amount,
      price: order.price,
      status: this.toOrderStatus(order.status),
      filledQuantity: order.filled ?? 0,
      avgFillPrice: order.average,
      createdAt: order.timestamp ?? Date.now(),
      updatedAt: order.lastTradeTimestamp ?? Date.now(),
    };
  }

  async listOpenOrders(symbol?: string): Promise<Order[]> {
    const orders = await this.exchange.fetchOpenOrders(symbol) as CCXTOrder[];

    return orders.map((order: CCXTOrder) => ({
      orderId: order.id,
      clientOrderId: order.clientOrderId ?? '',
      symbol: order.symbol,
      side: order.side,
      type: order.type,
      quantity: order.amount,
      price: order.price,
      status: this.toOrderStatus(order.status),
      filledQuantity: order.filled ?? 0,
      avgFillPrice: order.average,
      createdAt: order.timestamp ?? Date.now(),
      updatedAt: order.lastTradeTimestamp ?? Date.now(),
    }));
  }

  async getBalances(): Promise<Balance[]> {
    const balance = await this.exchange.fetchBalance() as CCXTBalance;
    
    return Object.entries(balance.free).map(([asset, free]) => ({
      asset,
      free: free ?? 0,
      locked: balance.used[asset] ?? 0,
    }));
  }

  private mapIntervalToTimeframe(interval: string): string {
    const mapping: Record<string, string> = {
      '1m': '1m',
      '3m': '3m',
      '5m': '5m',
      '15m': '15m',
      '30m': '30m',
      '1h': '1h',
      '2h': '2h',
      '4h': '4h',
      '6h': '6h',
      '8h': '8h',
      '12h': '12h',
      '1d': '1d',
      '3d': '3d',
      '1w': '1w',
      '1M': '1M',
    };
    return mapping[interval] ?? interval;
  }
}