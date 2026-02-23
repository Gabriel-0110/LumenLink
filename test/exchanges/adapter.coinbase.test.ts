import { describe, expect, it, vi, beforeEach } from 'vitest';
import { CoinbaseAdapter } from '../../src/exchanges/coinbase/adapter.js';

// Mock the HTTP layer so no real API calls are made
vi.mock('../../src/core/http.js', () => ({
  getJson: vi.fn(),
  postJson: vi.fn(),
}));

// Mock the client factory — adapter calls createCoinbaseClient() internally
vi.mock('../../src/exchanges/coinbase/client.js', () => ({
  createCoinbaseClient: vi.fn(() => ({})),
}));

// Mock auth header builder so adapter tests stay focused on mapping logic
vi.mock('../../src/exchanges/coinbase/auth.js', () => ({
  buildCoinbaseHeaders: vi.fn(() => ({})),
}));

import { getJson, postJson } from '../../src/core/http.js';
const mockGetJson = vi.mocked(getJson);
const mockPostJson = vi.mocked(postJson);

const AUTH = { apiKey: 'test-key', apiSecret: 'test-secret' };

describe('CoinbaseAdapter', () => {
  let adapter: CoinbaseAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new CoinbaseAdapter(AUTH);
  });

  // ── getTicker ─────────────────────────────────────────────────

  describe('getTicker', () => {
    it('parses product response into Ticker', async () => {
      mockGetJson.mockResolvedValueOnce({
        product_id: 'BTC-USD',
        price: '67500.00',
        best_bid: '67498.50',
        best_ask: '67501.50',
        volume_24h: '12345.67',
      });

      const ticker = await adapter.getTicker('BTC-USD');

      expect(ticker.symbol).toBe('BTC-USD');
      expect(ticker.last).toBe(67500);
      expect(ticker.bid).toBe(67498.5);
      expect(ticker.ask).toBe(67501.5);
      expect(ticker.volume24h).toBe(12345.67);
      expect(ticker.time).toBeGreaterThan(0);
    });

    it('falls back to price when bid/ask are missing', async () => {
      mockGetJson.mockResolvedValueOnce({
        product_id: 'ETH-USD',
        price: '3200.00',
      });

      const ticker = await adapter.getTicker('ETH-USD');

      expect(ticker.bid).toBe(3200);
      expect(ticker.ask).toBe(3200);
      expect(ticker.volume24h).toBe(0);
    });
  });

  // ── getCandles ────────────────────────────────────────────────

  describe('getCandles', () => {
    it('maps candle response and converts granularity', async () => {
      mockGetJson.mockResolvedValueOnce({
        candles: [
          { start: '1700000000', open: '100', high: '110', low: '95', close: '105', volume: '500' },
          { start: '1700000060', open: '105', high: '108', low: '102', close: '107', volume: '300' },
        ],
      });

      const candles = await adapter.getCandles('BTC-USD', '1m', 2);

      expect(candles).toHaveLength(2);
      expect(candles[0]).toEqual({
        symbol: 'BTC-USD',
        interval: '1m',
        time: 1700000000000,
        open: 100,
        high: 110,
        low: 95,
        close: 105,
        volume: 500,
      });

      // Verify granularity mapping was used in the request path
      const callPath = mockGetJson.mock.calls[0]![1] as string;
      expect(callPath).toContain('granularity=ONE_MINUTE');
    });
  });

  // ── placeOrder ────────────────────────────────────────────────

  describe('placeOrder', () => {
    it('places a market buy and polls until filled', async () => {
      // postJson → order create response
      mockPostJson.mockResolvedValueOnce({
        success: true,
        order_id: 'ord-123',
        success_response: { order_id: 'ord-123', product_id: 'BTC-USD', side: 'BUY', client_order_id: 'coid-1' },
      });

      // First getOrder poll → still open
      mockGetJson.mockResolvedValueOnce({
        order: {
          order_id: 'ord-123',
          client_order_id: 'coid-1',
          product_id: 'BTC-USD',
          side: 'BUY',
          status: 'OPEN',
          filled_size: '0',
          total_size: '0.001',
          order_configuration: { market_market_ioc: { base_size: '0.001' } },
        },
      });

      // Second poll → filled
      mockGetJson.mockResolvedValueOnce({
        order: {
          order_id: 'ord-123',
          client_order_id: 'coid-1',
          product_id: 'BTC-USD',
          side: 'BUY',
          status: 'FILLED',
          filled_size: '0.001',
          total_size: '0.001',
          average_filled_price: '67500.00',
          total_fees: '0.50',
          order_configuration: { market_market_ioc: { base_size: '0.001' } },
        },
      });

      const order = await adapter.placeOrder({
        symbol: 'BTC-USD',
        side: 'buy',
        type: 'market',
        quantity: 0.001,
        clientOrderId: 'coid-1',
      });

      expect(order.orderId).toBe('ord-123');
      expect(order.status).toBe('filled');
      expect(order.filledQuantity).toBe(0.001);
      expect(order.avgFillPrice).toBe(67500);
      expect(order.totalFees).toBe(0.5);
      expect(order.side).toBe('buy');
      expect(order.type).toBe('market');
    });

    it('places a limit order', async () => {
      mockPostJson.mockResolvedValueOnce({
        success: true,
        order_id: 'ord-456',
      });

      mockGetJson.mockResolvedValueOnce({
        order: {
          order_id: 'ord-456',
          client_order_id: 'coid-2',
          product_id: 'BTC-USD',
          side: 'SELL',
          status: 'FILLED',
          filled_size: '0.01',
          total_size: '0.01',
          average_filled_price: '70000.00',
          total_fees: '1.00',
          order_configuration: { limit_limit_gtc: { base_size: '0.01', limit_price: '70000' } },
        },
      });

      const order = await adapter.placeOrder({
        symbol: 'BTC-USD',
        side: 'sell',
        type: 'limit',
        quantity: 0.01,
        price: 70000,
        clientOrderId: 'coid-2',
      });

      expect(order.type).toBe('limit');
      expect(order.price).toBe(70000);
      expect(order.side).toBe('sell');

      // Verify the POST body included limit config
      const postBody = mockPostJson.mock.calls[0]![2] as Record<string, unknown>;
      expect(postBody).toHaveProperty('order_configuration.limit_limit_gtc');
    });

    it('throws on rejected order', async () => {
      mockPostJson.mockResolvedValueOnce({
        success: false,
        error_response: { error: 'INSUFFICIENT_FUNDS', message: 'Not enough USD' },
      });

      await expect(
        adapter.placeOrder({ symbol: 'BTC-USD', side: 'buy', type: 'market', quantity: 100, clientOrderId: 'coid-3' })
      ).rejects.toThrow('Coinbase order rejected');
    });
  });

  // ── cancelOrder ───────────────────────────────────────────────

  describe('cancelOrder', () => {
    it('sends batch cancel with order ID', async () => {
      mockPostJson.mockResolvedValueOnce({});

      await adapter.cancelOrder('ord-789');

      expect(mockPostJson).toHaveBeenCalledOnce();
      const body = mockPostJson.mock.calls[0]![2] as Record<string, unknown>;
      expect(body).toEqual({ order_ids: ['ord-789'] });
    });
  });

  // ── getOrder ──────────────────────────────────────────────────

  describe('getOrder', () => {
    it('maps order status correctly', async () => {
      const statuses = [
        ['FILLED', 'filled'],
        ['CANCELLED', 'canceled'],
        ['REJECTED', 'rejected'],
        ['OPEN', 'open'],
        ['PENDING', 'open'],
        ['UNKNOWN_STATUS', 'pending'],
      ] as const;

      for (const [cbStatus, expected] of statuses) {
        mockGetJson.mockResolvedValueOnce({
          order: {
            order_id: 'ord-1',
            client_order_id: 'coid-1',
            product_id: 'BTC-USD',
            side: 'BUY',
            status: cbStatus,
            filled_size: '0',
            order_configuration: { market_market_ioc: { base_size: '0.001' } },
          },
        });

        const order = await adapter.getOrder('ord-1');
        expect(order.status).toBe(expected);
      }
    });
  });

  // ── listOpenOrders ────────────────────────────────────────────

  describe('listOpenOrders', () => {
    it('returns mapped orders with symbol filter', async () => {
      mockGetJson.mockResolvedValueOnce({
        orders: [
          {
            order_id: 'ord-a',
            client_order_id: 'coid-a',
            product_id: 'BTC-USD',
            side: 'BUY',
            status: 'OPEN',
            filled_size: '0',
            total_size: '0.01',
            order_configuration: { limit_limit_gtc: { base_size: '0.01', limit_price: '60000' } },
          },
        ],
      });

      const orders = await adapter.listOpenOrders('BTC-USD');

      expect(orders).toHaveLength(1);
      expect(orders[0]!.orderId).toBe('ord-a');
      expect(orders[0]!.status).toBe('open');

      const callPath = mockGetJson.mock.calls[0]![1] as string;
      expect(callPath).toContain('product_id=BTC-USD');
    });

    it('returns empty array when no orders', async () => {
      mockGetJson.mockResolvedValueOnce({ orders: undefined });

      const orders = await adapter.listOpenOrders();
      expect(orders).toEqual([]);
    });
  });

  // ── getBalances ───────────────────────────────────────────────

  describe('getBalances', () => {
    it('maps account balances', async () => {
      mockGetJson.mockResolvedValueOnce({
        accounts: [
          { currency: 'USD', available_balance: { value: '5000.00' }, hold: { value: '100.00' } },
          { currency: 'BTC', available_balance: { value: '0.5' }, hold: { value: '0.01' } },
        ],
      });

      const balances = await adapter.getBalances();

      expect(balances).toHaveLength(2);
      expect(balances[0]).toEqual({ asset: 'USD', free: 5000, locked: 100 });
      expect(balances[1]).toEqual({ asset: 'BTC', free: 0.5, locked: 0.01 });
    });
  });
});
