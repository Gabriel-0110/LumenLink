export const COINBASE_BASE_URL = 'https://api.coinbase.com';

export const coinbaseEndpoints = {
  product: (productId: string): string => `/api/v3/brokerage/products/${encodeURIComponent(productId)}`,
  candles: (productId: string): string =>
    `/api/v3/brokerage/products/${encodeURIComponent(productId)}/candles`,
  createOrder: (): string => `/api/v3/brokerage/orders`,
  cancelOrders: (): string => `/api/v3/brokerage/orders/batch_cancel`,
  order: (orderId: string): string => `/api/v3/brokerage/orders/historical/${encodeURIComponent(orderId)}`,
  ordersBatch: (): string => `/api/v3/brokerage/orders/historical/batch`,
  accounts: (): string => `/api/v3/brokerage/accounts`
};
