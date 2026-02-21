import * as crypto from 'node:crypto';
import type { Order, OrderRequest, Ticker } from '../core/types.js';

export class PaperBroker {
  // Simulates immediate fills at mid +/- slippage for deterministic local testing.
  async place(orderRequest: OrderRequest, ticker: Ticker, maxSlippageBps: number): Promise<Order> {
    const mid = (ticker.bid + ticker.ask) / 2;
    const slipPct = Math.min(maxSlippageBps / 10000, 0.02);
    const slip = mid * slipPct;
    const fillPrice = orderRequest.side === 'buy' ? mid + slip : mid - slip;
    const now = Date.now();

    return {
      orderId: `paper-${crypto.randomUUID()}`,
      clientOrderId: orderRequest.clientOrderId,
      symbol: orderRequest.symbol,
      side: orderRequest.side,
      type: orderRequest.type,
      quantity: orderRequest.quantity,
      price: orderRequest.price ?? undefined,
      status: 'filled' as const,
      filledQuantity: orderRequest.quantity,
      avgFillPrice: fillPrice,
      reason: null,
      createdAt: now,
      updatedAt: now
    };
  }
}
