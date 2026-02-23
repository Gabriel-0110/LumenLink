import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FillReconciler, type CoinbaseFill } from '../../src/execution/fillReconciler.js';
import type { ExchangeAdapter } from '../../src/exchanges/adapter.js';
import type { InventoryManager } from '../../src/execution/inventoryManager.js';
import type { TradeJournal, JournalEntry } from '../../src/data/tradeJournal.js';
import { createMockLogger } from '../helpers.js';

// ── Mock the HTTP layer so no real network calls fire ──────────────

const mockFills: CoinbaseFill[] = [];

vi.mock('../../src/exchanges/coinbase/auth.js', () => ({
  buildCoinbaseHeaders: vi.fn(() => ({})),
}));

vi.mock('../../src/exchanges/coinbase/client.js', () => ({
  createCoinbaseClient: vi.fn(() => ({})),
}));

vi.mock('../../src/core/http.js', () => ({
  getJson: vi.fn(async () => ({ fills: mockFills })),
}));

function makeFill(overrides: Partial<CoinbaseFill> = {}): CoinbaseFill {
  return {
    entry_id: 'fill-1',
    trade_id: 'trade-1',
    order_id: 'order-1',
    trade_time: new Date().toISOString(),
    trade_type: 'FILL',
    price: '67000',
    size: '0.005',
    commission: '4.02',
    product_id: 'BTC-USD',
    sequence_timestamp: new Date().toISOString(),
    liquidity_indicator: 'TAKER',
    size_in_quote: false,
    user_id: 'user-1',
    side: 'SELL',
    ...overrides,
  };
}

function makeJournalEntry(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id: 1,
    tradeId: 'trade-1',
    symbol: 'BTC-USD',
    side: 'sell',
    action: 'exit',
    strategy: 'regime_aware',
    orderId: 'order-1',
    requestedPrice: 67_000,
    filledPrice: 67_000,
    slippageBps: 0,
    quantity: 0.005,
    notionalUsd: 335,
    commissionUsd: 4.02,
    confidence: 0.8,
    reason: 'test',
    riskDecision: 'allowed',
    mode: 'live',
    timestamp: Date.now(),
    ...overrides,
  };
}

function mockJournal(entries: JournalEntry[]): TradeJournal {
  return {
    getRecent: vi.fn(() => entries),
    record: vi.fn(),
    getDailySummary: vi.fn(),
    getTradeCount: vi.fn(() => entries.length),
  } as unknown as TradeJournal;
}

function mockInventory(): InventoryManager {
  return {
    resync: vi.fn(async () => ({ diffs: [] })),
  } as unknown as InventoryManager;
}

function mockExchange(): ExchangeAdapter {
  return {
    getBalances: vi.fn(async () => []),
    getTicker: vi.fn(),
    listOpenOrders: vi.fn(async () => []),
    getCandles: vi.fn(async () => []),
    placeOrder: vi.fn(),
    cancelOrder: vi.fn(),
    getOrder: vi.fn(),
  } as unknown as ExchangeAdapter;
}

const fakeAuth = { apiKey: 'test-key', apiSecret: 'test-secret' };

describe('FillReconciler', () => {
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    logger = createMockLogger();
    // Reset mock fills
    mockFills.length = 0;
  });

  describe('getActualFees', () => {
    it('returns total commission from Coinbase fills', async () => {
      mockFills.push(
        makeFill({ commission: '3.50', order_id: 'ord-x' }),
        makeFill({ commission: '1.20', order_id: 'ord-x' }),
      );

      const fr = new FillReconciler(mockExchange(), mockJournal([]), mockInventory(), fakeAuth, logger);
      const result = await fr.getActualFees('ord-x');

      expect(result).toBeDefined();
      expect(result!.totalFees).toBeCloseTo(4.70);
      expect(result!.fills).toHaveLength(2);
    });

    it('returns undefined when no fills returned', async () => {
      // mockFills is empty
      const fr = new FillReconciler(mockExchange(), mockJournal([]), mockInventory(), fakeAuth, logger);
      const result = await fr.getActualFees('no-such-order');
      expect(result).toBeUndefined();
    });
  });

  describe('reconcile', () => {
    it('reports zero mismatches when journal matches fills', async () => {
      mockFills.push(makeFill({ order_id: 'order-1', commission: '4.02', size: '0.005' }));

      const journal = mockJournal([
        makeJournalEntry({ orderId: 'order-1', commissionUsd: 4.02, quantity: 0.005 }),
      ]);
      const inv = mockInventory();
      const fr = new FillReconciler(mockExchange(), journal, inv, fakeAuth, logger);

      const result = await fr.reconcile(['BTC-USD']);
      expect(result.feeMismatches).toBe(0);
      expect(result.qtyMismatches).toBe(0);
      expect(result.orphanFills).toBe(0);
    });

    it('detects orphan fills not in journal', async () => {
      mockFills.push(makeFill({ order_id: 'orphan-order' }));

      const journal = mockJournal([]); // no journal entries
      const fr = new FillReconciler(mockExchange(), journal, mockInventory(), fakeAuth, logger);

      const result = await fr.reconcile(['BTC-USD']);
      expect(result.orphanFills).toBe(1);
    });

    it('detects fee mismatch between journal and fills', async () => {
      mockFills.push(makeFill({ order_id: 'order-1', commission: '5.00' }));

      const journal = mockJournal([
        makeJournalEntry({ orderId: 'order-1', commissionUsd: 0 }), // journal says $0
      ]);
      const fr = new FillReconciler(mockExchange(), journal, mockInventory(), fakeAuth, logger);

      const result = await fr.reconcile(['BTC-USD']);
      expect(result.feeMismatches).toBe(1);
    });

    it('detects quantity mismatch', async () => {
      mockFills.push(makeFill({ order_id: 'order-1', size: '0.010' }));

      const journal = mockJournal([
        makeJournalEntry({ orderId: 'order-1', quantity: 0.005 }), // journal says 0.005
      ]);
      const fr = new FillReconciler(mockExchange(), journal, mockInventory(), fakeAuth, logger);

      const result = await fr.reconcile(['BTC-USD']);
      expect(result.qtyMismatches).toBe(1);
    });

    it('aggregates multiple fills for the same order_id', async () => {
      // Two partial fills for the same order
      mockFills.push(
        makeFill({ order_id: 'order-1', size: '0.003', commission: '2.00' }),
        makeFill({ order_id: 'order-1', size: '0.002', commission: '1.50' }),
      );

      const journal = mockJournal([
        makeJournalEntry({ orderId: 'order-1', quantity: 0.005, commissionUsd: 3.50 }),
      ]);
      const fr = new FillReconciler(mockExchange(), journal, mockInventory(), fakeAuth, logger);

      const result = await fr.reconcile(['BTC-USD']);
      // 0.003 + 0.002 = 0.005 — qty matches
      expect(result.qtyMismatches).toBe(0);
      // 2.00 + 1.50 = 3.50 — fee matches
      expect(result.feeMismatches).toBe(0);
    });

    it('calls inventory resync after checking fills', async () => {
      const inv = mockInventory();
      const fr = new FillReconciler(mockExchange(), mockJournal([]), inv, fakeAuth, logger);
      await fr.reconcile(['BTC-USD']);
      expect(inv.resync).toHaveBeenCalled();
    });

    it('updates lastReconcileMs timestamp', async () => {
      const fr = new FillReconciler(mockExchange(), mockJournal([]), mockInventory(), fakeAuth, logger);
      expect(fr.getLastReconcileMs()).toBe(0);
      await fr.reconcile(['BTC-USD']);
      expect(fr.getLastReconcileMs()).toBeGreaterThan(0);
    });
  });
});
