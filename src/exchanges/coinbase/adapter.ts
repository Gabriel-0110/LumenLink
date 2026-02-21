import { getJson, postJson } from '../../core/http.js';
import type { Balance, Candle, Order, OrderRequest, Ticker } from '../../core/types.js';
import type { ExchangeAdapter } from '../adapter.js';
import { buildCoinbaseHeaders, type CoinbaseAuthMaterial } from './auth.js';
import { createCoinbaseClient } from './client.js';
import { coinbaseEndpoints } from './endpoints.js';
import type {
  CoinbaseCandlesResponse,
  CoinbaseOrderCreateResponse,
  CoinbaseOrderResponse,
  CoinbaseProduct
} from './types.js';

const toOrderStatus = (status: string): Order['status'] => {
  const normalized = status.toUpperCase();
  if (normalized.includes('FILLED')) return 'filled';
  if (normalized.includes('CANCEL')) return 'canceled';
  if (normalized.includes('REJECT')) return 'rejected';
  if (normalized.includes('OPEN') || normalized.includes('PENDING')) return 'open';
  return 'pending';
};

/**
 * Coinbase Advanced Trade v3 uses string enum granularity, not shorthand.
 */
const GRANULARITY_MAP: Record<string, string> = {
  '1m': 'ONE_MINUTE',
  '5m': 'FIVE_MINUTE',
  '15m': 'FIFTEEN_MINUTE',
  '30m': 'THIRTY_MINUTE',
  '1h': 'ONE_HOUR',
  '2h': 'TWO_HOUR',
  '6h': 'SIX_HOUR',
  '1d': 'ONE_DAY',
};

const toCoinbaseGranularity = (interval: string): string =>
  GRANULARITY_MAP[interval] ?? interval; // pass through if already in Coinbase format

export class CoinbaseAdapter implements ExchangeAdapter {
  constructor(private readonly auth: CoinbaseAuthMaterial) {}

  async getTicker(symbol: string): Promise<Ticker> {
    const path = coinbaseEndpoints.product(symbol);
    const headers = buildCoinbaseHeaders(this.auth, 'GET', path, '');
    const data = await getJson<{ product: CoinbaseProduct }>(createCoinbaseClient(), path, headers);
    const product = data.product;
    const bid = Number(product.best_bid ?? product.price);
    const ask = Number(product.best_ask ?? product.price);
    return {
      symbol,
      bid,
      ask,
      last: Number(product.price),
      volume24h: Number(product.volume_24h ?? 0),
      time: Date.now()
    };
  }

  async getCandles(symbol: string, interval: string, limit: number): Promise<Candle[]> {
    const granularity = toCoinbaseGranularity(interval);
    const path = `${coinbaseEndpoints.candles(symbol)}?granularity=${encodeURIComponent(granularity)}&limit=${limit}`;
    const headers = buildCoinbaseHeaders(this.auth, 'GET', path, '');
    const data = await getJson<CoinbaseCandlesResponse>(createCoinbaseClient(), path, headers);
    return data.candles.map((c) => ({
      symbol,
      interval,
      time: Number(c.start) * 1000,
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
      volume: Number(c.volume)
    }));
  }

  async placeOrder(orderRequest: OrderRequest): Promise<Order> {
    const path = coinbaseEndpoints.createOrder();
    const bodyObj = {
      client_order_id: orderRequest.clientOrderId,
      product_id: orderRequest.symbol,
      side: orderRequest.side.toUpperCase(),
      order_configuration:
        orderRequest.type === 'market'
          ? {
              market_market_ioc: {
                base_size: orderRequest.quantity.toString()
              }
            }
          : {
              limit_limit_gtc: {
                base_size: orderRequest.quantity.toString(),
                limit_price: String(orderRequest.price ?? 0)
              }
            }
    };
    const body = JSON.stringify(bodyObj);
    const headers = buildCoinbaseHeaders(this.auth, 'POST', path, body);
    const data = await postJson<typeof bodyObj, CoinbaseOrderCreateResponse>(
      createCoinbaseClient(),
      path,
      bodyObj,
      headers
    );

    if (!data.success || !data.order_id) {
      throw new Error(`Coinbase order rejected: ${data.error_response?.error ?? 'unknown_error'}`);
    }

    return this.getOrder(data.order_id);
  }

  async cancelOrder(orderId: string): Promise<void> {
    const path = coinbaseEndpoints.cancelOrders();
    const bodyObj = { order_ids: [orderId] };
    const body = JSON.stringify(bodyObj);
    const headers = buildCoinbaseHeaders(this.auth, 'POST', path, body);
    await postJson<typeof bodyObj, unknown>(createCoinbaseClient(), path, bodyObj, headers);
  }

  async getOrder(orderId: string): Promise<Order> {
    const path = coinbaseEndpoints.order(orderId);
    const headers = buildCoinbaseHeaders(this.auth, 'GET', path, '');
    const data = await getJson<CoinbaseOrderResponse>(createCoinbaseClient(), path, headers);
    const o = data.order;
    const originalQuantity = o.total_size || 
      o.order_configuration?.limit_limit_gtc?.base_size ||
      o.order_configuration?.market_market_ioc?.base_size ||
      o.filled_size;
      
    return {
      orderId: o.order_id,
      clientOrderId: o.client_order_id,
      symbol: o.product_id,
      side: o.side.toLowerCase() as 'buy' | 'sell',
      type: o.order_configuration?.limit_limit_gtc ? 'limit' : 'market',
      quantity: Number(originalQuantity || '0'),
      price: o.order_configuration?.limit_limit_gtc ? Number(o.order_configuration.limit_limit_gtc.limit_price) : undefined,
      status: toOrderStatus(o.status),
      filledQuantity: Number(o.filled_size || '0'),
      avgFillPrice: Number(o.average_filled_price ?? 0) || undefined,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
  }

  async listOpenOrders(symbol?: string): Promise<Order[]> {
    const query = symbol ? `?product_id=${encodeURIComponent(symbol)}&order_status=OPEN` : '?order_status=OPEN';
    const path = `${coinbaseEndpoints.ordersBatch()}${query}`;
    const headers = buildCoinbaseHeaders(this.auth, 'GET', path, '');
    const data = await getJson<{ orders?: CoinbaseOrderResponse['order'][] }>(
      createCoinbaseClient(),
      path,
      headers
    );

    return (data.orders ?? []).map((o) => {
      const originalQuantity = o.total_size || 
        o.order_configuration?.limit_limit_gtc?.base_size ||
        o.order_configuration?.market_market_ioc?.base_size ||
        o.filled_size;
        
      return {
        orderId: o.order_id,
        clientOrderId: o.client_order_id,
        symbol: o.product_id,
        side: o.side.toLowerCase() as 'buy' | 'sell',
        type: o.order_configuration?.limit_limit_gtc ? 'limit' : 'market',
        quantity: Number(originalQuantity || '0'),
        price: o.order_configuration?.limit_limit_gtc ? Number(o.order_configuration.limit_limit_gtc.limit_price) : undefined,
        status: toOrderStatus(o.status),
        filledQuantity: Number(o.filled_size || '0'),
        avgFillPrice: Number(o.average_filled_price ?? 0) || undefined,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
    });
  }

  async getBalances(): Promise<Balance[]> {
    const path = coinbaseEndpoints.accounts();
    const headers = buildCoinbaseHeaders(this.auth, 'GET', path, '');
    const data = await getJson<{
      accounts: Array<{ currency: string; available_balance?: { value: string }; hold?: { value: string } }>;
    }>(createCoinbaseClient(), path, headers);

    return data.accounts.map((a) => ({
      asset: a.currency,
      free: Number(a.available_balance?.value ?? 0),
      locked: Number(a.hold?.value ?? 0)
    }));
  }
}
