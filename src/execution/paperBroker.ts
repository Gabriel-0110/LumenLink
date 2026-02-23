import * as crypto from 'node:crypto';
import type { Order, OrderRequest, Ticker } from '../core/types.js';
import type { AdvancedOrderRequest } from './orderTypes.js';

export class PaperBroker {
  // Simulates immediate fills at mid +/- slippage for deterministic local testing.
  async place(orderRequest: OrderRequest | AdvancedOrderRequest, ticker: Ticker, maxSlippageBps: number): Promise<Order> {
    const mid = (ticker.bid + ticker.ask) / 2;
    const slipPct = Math.min(maxSlippageBps / 10000, 0.02);
    const slip = mid * slipPct;
    const type = 'type' in orderRequest ? orderRequest.type : 'market';

    // For limit orders: only fill if price is favorable
    if (type === 'limit' && orderRequest.price != null) {
      if (orderRequest.side === 'buy' && ticker.ask > orderRequest.price) {
        return this.pendingOrder(orderRequest);
      }
      if (orderRequest.side === 'sell' && ticker.bid < orderRequest.price) {
        return this.pendingOrder(orderRequest);
      }
      // Fill at limit price (favorable)
      return this.filledOrder(orderRequest, orderRequest.price);
    }

    // For stop orders: only fill if price crosses stop
    if ((type === 'stop' || type === 'stop_limit') && 'stopPrice' in orderRequest && orderRequest.stopPrice != null) {
      if (orderRequest.side === 'buy' && ticker.last < orderRequest.stopPrice) {
        return this.pendingOrder(orderRequest);
      }
      if (orderRequest.side === 'sell' && ticker.last > orderRequest.stopPrice) {
        return this.pendingOrder(orderRequest);
      }
      // Stop triggered — fill at stop price + slippage for stop-market, or at limit for stop-limit
      const fillPrice = type === 'stop_limit' && orderRequest.price != null
        ? orderRequest.price
        : orderRequest.stopPrice + (orderRequest.side === 'buy' ? slip : -slip);
      return this.filledOrder(orderRequest, fillPrice);
    }

    // Market order: fill at mid +/- slippage
    const fillPrice = orderRequest.side === 'buy' ? mid + slip : mid - slip;
    return this.filledOrder(orderRequest, fillPrice);
  }

  private filledOrder(req: OrderRequest | AdvancedOrderRequest, fillPrice: number): Order {
    const now = Date.now();
    return {
      orderId: `paper-${crypto.randomUUID()}`,
      clientOrderId: req.clientOrderId,
      symbol: req.symbol,
      side: req.side,
      type: req.type === 'stop' || req.type === 'stop_limit' ? 'market' : (req.type as 'market' | 'limit'),
      quantity: req.quantity,
      price: req.price ?? undefined,
      status: 'filled',
      filledQuantity: req.quantity,
      avgFillPrice: fillPrice,
      reason: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  private pendingOrder(req: OrderRequest | AdvancedOrderRequest): Order {
    const now = Date.now();
    return {
      orderId: `paper-${crypto.randomUUID()}`,
      clientOrderId: req.clientOrderId,
      symbol: req.symbol,
      side: req.side,
      type: req.type === 'stop' || req.type === 'stop_limit' ? 'market' : (req.type as 'market' | 'limit'),
      quantity: req.quantity,
      price: req.price ?? undefined,
      status: 'pending',
      filledQuantity: 0,
      avgFillPrice: undefined,
      reason: null,
      createdAt: now,
      updatedAt: now,
    };
  }
}
