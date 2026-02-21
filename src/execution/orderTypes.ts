import type { AdvancedOrderType, Side, TimeInForce } from '../core/types.js';

/** Extended order request supporting limit, stop, and stop-limit orders. */
export interface AdvancedOrderRequest {
  symbol: string;
  side: Side;
  type: AdvancedOrderType;
  quantity: number;
  /** Limit price (required for limit and stop_limit). */
  price?: number;
  /** Trigger price for stop and stop_limit orders. */
  stopPrice?: number;
  clientOrderId: string;
  timeInForce?: TimeInForce;
}

/** Convert an AdvancedOrderRequest to the basic OrderRequest for brokers that only support market/limit. */
export function toBasicOrderRequest(req: AdvancedOrderRequest) {
  return {
    symbol: req.symbol,
    side: req.side,
    type: (req.type === 'stop' ? 'market' : req.type === 'stop_limit' ? 'limit' : req.type) as 'market' | 'limit',
    quantity: req.quantity,
    price: req.price,
    clientOrderId: req.clientOrderId,
  };
}
