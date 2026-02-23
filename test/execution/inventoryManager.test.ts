import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InventoryManager } from '../../src/execution/inventoryManager.js';
import type { ExchangeAdapter } from '../../src/exchanges/adapter.js';
import { createMockLogger, makeOrder } from '../helpers.js';
import type { Balance, Ticker, Order } from '../../src/core/types.js';

/**
 * Minimal mock exchange that returns configurable balances / open orders.
 */
function mockExchange(overrides: Partial<ExchangeAdapter> = {}): ExchangeAdapter {
  return {
    getBalances: vi.fn(async (): Promise<Balance[]> => [
      { asset: 'USD', free: 1500, locked: 0 },
      { asset: 'BTC', free: 0.01, locked: 0.002 },
    ]),
    getTicker: vi.fn(async (): Promise<Ticker> => ({
      symbol: 'BTC-USD', bid: 67_000, ask: 67_100, last: 67_050, time: Date.now(),
    })),
    listOpenOrders: vi.fn(async () => []),
    getCandles: vi.fn(async () => []),
    placeOrder: vi.fn(),
    cancelOrder: vi.fn(),
    getOrder: vi.fn(),
    ...overrides,
  } as unknown as ExchangeAdapter;
}

describe('InventoryManager', () => {
  let inv: InventoryManager;
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    logger = createMockLogger();
    inv = new InventoryManager(logger);
  });

  // ── Phase 1A: Startup hydration ────────────────────────────

  describe('hydrateFromExchange', () => {
    it('loads cash and inventory from exchange balances', async () => {
      const state = await inv.hydrateFromExchange(mockExchange(), ['BTC-USD']);
      expect(state.cashUsd).toBe(1500);
      expect(state.available.get('BTC-USD')).toBe(0.01);
      expect(state.reserved.get('BTC-USD')).toBe(0.002);
      expect(state.positions).toHaveLength(1);
      expect(state.positions[0]!.symbol).toBe('BTC-USD');
      expect(state.positions[0]!.quantity).toBeCloseTo(0.012);
    });

    it('sums USD and USDC into cashUsd', async () => {
      const ex = mockExchange({
        getBalances: vi.fn(async () => [
          { asset: 'USD', free: 500, locked: 0 },
          { asset: 'USDC', free: 300, locked: 0 },
        ]),
      });
      const state = await inv.hydrateFromExchange(ex, ['BTC-USD']);
      expect(state.cashUsd).toBe(800);
    });

    it('imports open sell orders as reservations', async () => {
      const openSell: Order = makeOrder({
        orderId: 'open-sell-1',
        side: 'sell',
        status: 'open',
        quantity: 0.003,
        filledQuantity: 0,
      });
      const ex = mockExchange({ listOpenOrders: vi.fn(async () => [openSell]) });
      const state = await inv.hydrateFromExchange(ex, ['BTC-USD']);

      // 0.01 free − 0.003 reserved = 0.007
      expect(state.available.get('BTC-USD')).toBeCloseTo(0.007);
      // 0.002 exchange‐locked + 0.003 open sell = 0.005
      expect(state.reserved.get('BTC-USD')).toBeCloseTo(0.005);
    });

    it('handles symbol with no exchange balance', async () => {
      const ex = mockExchange({
        getBalances: vi.fn(async () => [{ asset: 'USD', free: 1000, locked: 0 }]),
        getTicker: vi.fn(async () => { throw new Error('no ticker'); }),
      });
      const state = await inv.hydrateFromExchange(ex, ['ETH-USD']);
      expect(state.available.get('ETH-USD')).toBe(0);
    });
  });

  // ── Phase 1B: Hard inventory guard ─────────────────────────

  describe('canSell', () => {
    it('allows sell when inventory is sufficient', async () => {
      await inv.hydrateFromExchange(mockExchange(), ['BTC-USD']);
      expect(inv.canSell('BTC-USD', 0.005).allowed).toBe(true);
    });

    it('rejects sell that exceeds available', async () => {
      await inv.hydrateFromExchange(mockExchange(), ['BTC-USD']);
      const result = inv.canSell('BTC-USD', 0.02);
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/exceeds available/i);
    });

    it('rejects sell when no inventory exists', () => {
      const result = inv.canSell('ETH-USD', 0.1);
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/No inventory/i);
    });
  });

  describe('clampSellQty', () => {
    it('clamps to available minus dust buffer when desired exceeds available', async () => {
      await inv.hydrateFromExchange(mockExchange(), ['BTC-USD']);
      const clamped = inv.clampSellQty('BTC-USD', 1.0);
      expect(clamped).toBeLessThanOrEqual(0.01);
      expect(clamped).toBeGreaterThan(0);
    });

    it('returns 0 when no inventory', () => {
      expect(inv.clampSellQty('ETH-USD', 1.0)).toBe(0);
    });
  });

  // ── Phase 1C: Reservation management ──────────────────────

  describe('reserve / releaseReservation', () => {
    beforeEach(async () => {
      await inv.hydrateFromExchange(mockExchange(), ['BTC-USD']);
    });

    it('moves qty from available → reserved', () => {
      const avail = inv.getAvailable('BTC-USD');
      expect(inv.reserve('BTC-USD', 0.004, 'ord-1')).toBe(true);
      expect(inv.getAvailable('BTC-USD')).toBeCloseTo(avail - 0.004);
      expect(inv.getReserved('BTC-USD')).toBeCloseTo(0.002 + 0.004);
    });

    it('rejects reservation exceeding available', () => {
      expect(inv.reserve('BTC-USD', 0.5, 'ord-big')).toBe(false);
    });

    it('releaseReservation moves qty back to available', () => {
      inv.reserve('BTC-USD', 0.003, 'ord-2');
      const avail = inv.getAvailable('BTC-USD');
      inv.releaseReservation('BTC-USD', 0.003, 'ord-2');
      expect(inv.getAvailable('BTC-USD')).toBeCloseTo(avail + 0.003);
    });

    it('releaseReservation caps at reserved amount', () => {
      inv.reserve('BTC-USD', 0.001, 'ord-3');
      const totalBefore = inv.getTotalHolding('BTC-USD');
      inv.releaseReservation('BTC-USD', 1.0, 'ord-3'); // ask to release more than reserved
      expect(inv.getTotalHolding('BTC-USD')).toBeCloseTo(totalBefore); // total unchanged
    });
  });

  // ── confirmFill ────────────────────────────────────────────

  describe('confirmFill', () => {
    beforeEach(async () => {
      await inv.hydrateFromExchange(mockExchange(), ['BTC-USD']);
    });

    it('buy fill adds inventory and deducts cash (with fees)', () => {
      const prevCash = inv.getCashUsd();
      const prevAvail = inv.getAvailable('BTC-USD');
      const px = 67_000;
      const qty = 0.005;
      const fee = 6.0;

      inv.confirmFill(makeOrder({ side: 'buy', filledQuantity: qty, symbol: 'BTC-USD' }), px, fee);

      expect(inv.getAvailable('BTC-USD')).toBeCloseTo(prevAvail + qty);
      expect(inv.getCashUsd()).toBeCloseTo(prevCash - qty * px - fee);
    });

    it('sell fill removes from reserved and credits cash', () => {
      inv.reserve('BTC-USD', 0.003, 'sell-ord');
      const prevCash = inv.getCashUsd();
      const px = 67_000;
      const fee = 3.5;

      inv.confirmFill(
        makeOrder({ side: 'sell', filledQuantity: 0.003, symbol: 'BTC-USD' }),
        px, fee,
      );

      expect(inv.getCashUsd()).toBeCloseTo(prevCash + 0.003 * px - fee);
    });

    it('updates internal position record on buy', () => {
      inv.confirmFill(makeOrder({ side: 'buy', filledQuantity: 0.005, symbol: 'BTC-USD' }), 65_000, 0);
      const pos = inv.getPositions().find(p => p.symbol === 'BTC-USD');
      expect(pos).toBeDefined();
      expect(pos!.quantity).toBeGreaterThan(0.012);   // 0.012 + 0.005
    });

    it('removes position when fully sold', () => {
      // Sell entire holding
      const total = inv.getTotalHolding('BTC-USD');
      inv.reserve('BTC-USD', inv.getAvailable('BTC-USD'), 'sell-all');
      inv.confirmFill(
        makeOrder({ side: 'sell', filledQuantity: total, symbol: 'BTC-USD' }),
        67_000, 0,
      );
      expect(inv.getPositions().find(p => p.symbol === 'BTC-USD')).toBeUndefined();
    });
  });

  // ── Resync ─────────────────────────────────────────────────

  describe('resync', () => {
    it('detects and corrects cash diff', async () => {
      await inv.hydrateFromExchange(mockExchange(), ['BTC-USD']);
      const ex2 = mockExchange({
        getBalances: vi.fn(async () => [
          { asset: 'USD', free: 2000, locked: 0 },
          { asset: 'BTC', free: 0.01, locked: 0.002 },
        ]),
      });
      const { diffs } = await inv.resync(ex2, ['BTC-USD']);
      expect(diffs.some(d => d.includes('Cash'))).toBe(true);
      expect(inv.getCashUsd()).toBe(2000);
    });

    it('detects and corrects BTC diff', async () => {
      await inv.hydrateFromExchange(mockExchange(), ['BTC-USD']);
      const ex2 = mockExchange({
        getBalances: vi.fn(async () => [
          { asset: 'USD', free: 1500, locked: 0 },
          { asset: 'BTC', free: 0.02, locked: 0 },
        ]),
      });
      const { diffs } = await inv.resync(ex2, ['BTC-USD']);
      expect(diffs.length).toBeGreaterThan(0);
      expect(inv.getAvailable('BTC-USD')).toBe(0.02);
    });

    it('returns empty diffs when in sync', async () => {
      await inv.hydrateFromExchange(mockExchange(), ['BTC-USD']);
      const { diffs } = await inv.resync(mockExchange(), ['BTC-USD']);
      expect(diffs).toHaveLength(0);
    });
  });
});
