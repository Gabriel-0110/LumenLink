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
  /** Coinbase Advanced Trade returns order_id inside success_response */
  success_response?: {
    order_id: string;
    product_id: string;
    side: string;
    client_order_id: string;
  };
  error_response?: {
    error: string;
    message?: string;
    error_details?: string;
    preview_failure_reason?: string;
    new_order_failure_reason?: string;
  };
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
    fee?: string;          // per-fill fee (often empty)
    total_fees?: string;   // total fees across all fills
    filled_value?: string; // total dollar value filled
    number_of_fills?: string;
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
