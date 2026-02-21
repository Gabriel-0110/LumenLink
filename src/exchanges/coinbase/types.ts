export interface CoinbaseProduct {
  product_id: string;
  price: string;
  price_percentage_change_24h?: string;
  volume_24h?: string;
  best_bid?: string;
  best_ask?: string;
}

export interface CoinbaseCandlesResponse {
  candles: Array<{
    start: string;
    low: string;
    high: string;
    open: string;
    close: string;
    volume: string;
  }>;
}

export interface CoinbaseOrderCreateResponse {
  success: boolean;
  order_id?: string;
  error_response?: { error: string };
}

export interface CoinbaseOrderResponse {
  order: {
    order_id: string;
    client_order_id: string;
    product_id: string;
    side: 'BUY' | 'SELL';
    status: string;
    filled_size: string;
    total_size?: string;  // Original order quantity
    average_filled_price?: string;
    order_configuration?: Record<string, unknown> & {
      limit_limit_gtc?: {
        base_size: string;
        limit_price: string;
      };
      market_market_ioc?: {
        base_size: string;
      };
    };
  };
}
