/**
 * InventoryManager — single source of truth for position & cash state.
 *
 * Responsibilities:
 *   1A  On boot: pull balances + recent fills from exchange, rebuild state
 *   1B  Hard inventory guard: reject sells that exceed available BTC
 *   1C  Reserve inventory: lock BTC when a sell is placed, release on fill/cancel
 *
 * Coinbase is always the source of truth. Local state defers to it.
 */

import type { ExchangeAdapter } from '../exchanges/adapter.js';
import type { Logger } from '../core/logger.js';
import type { Balance, Order, Position } from '../core/types.js';

export interface InventoryState {
  /** Spendable USD (after any pending buy reservations). */
  cashUsd: number;
  /** Spendable BTC per symbol, after reservations. */
  available: Map<string, number>;
  /** Amounts reserved for pending sell orders. */
  reserved: Map<string, number>;
  /** Known positions rebuilt from exchange. */
  positions: Position[];
  /** Timestamp of last exchange sync. */
  lastSyncMs: number;
}

/** Minimum BTC to guard against dust sells. Coinbase min is 0.00001 BTC. */
const BTC_DUST_BUFFER = 0.000001;

export class InventoryManager {
  private state: InventoryState = {
    cashUsd: 0,
    available: new Map(),
    reserved: new Map(),
    positions: [],
    lastSyncMs: 0,
  };

  constructor(private readonly logger: Logger) {}

  // ─── 1A: Startup reconciliation ────────────────────────────────

  /**
   * Hydrate local state from exchange. Coinbase is source of truth.
   * Call this once at startup, before any trading begins.
   */
  async hydrateFromExchange(
    exchange: ExchangeAdapter,
    symbols: string[],
  ): Promise<InventoryState> {
    this.logger.info('[inventory] hydrating from exchange…');

    // 1. Pull balances
    const balances = await exchange.getBalances();
    const balanceMap = new Map<string, Balance>();
    for (const b of balances) {
      balanceMap.set(b.asset, b);
    }

    // 2. Seed cash
    const usd = balanceMap.get('USD')?.free ?? 0;
    const usdc = balanceMap.get('USDC')?.free ?? 0;
    this.state.cashUsd = usd + usdc;

    // 3. Seed positions & available inventory per symbol
    const positions: Position[] = [];
    for (const symbol of symbols) {
      const base = symbol.split(/[-/]/)[0];
      if (!base) continue;

      const holding = balanceMap.get(base);
      const free = holding?.free ?? 0;
      const locked = holding?.locked ?? 0;

      // Set available to free balance *only* (locked is already reserved on exchange)
      this.state.available.set(symbol, free);
      this.state.reserved.set(symbol, locked);

      if (free + locked <= 0) continue;

      try {
        const ticker = await exchange.getTicker(symbol);
        positions.push({
          symbol,
          quantity: free + locked,
          avgEntryPrice: ticker.last, // best guess; true entry unknown on cold boot
          marketPrice: ticker.last,
        });
      } catch (err) {
        this.logger.warn('[inventory] ticker fetch failed during hydration', {
          symbol,
          err: String(err),
        });
      }
    }

    this.state.positions = positions;

    // 4. Pull open orders and account for their reservations
    for (const symbol of symbols) {
      try {
        const openOrders = await exchange.listOpenOrders(symbol);
        for (const o of openOrders) {
          if (o.side === 'sell' && o.status === 'open') {
            const remaining = o.quantity - o.filledQuantity;
            if (remaining > 0) {
              this.reserve(symbol, remaining, o.orderId);
              this.logger.info('[inventory] imported open sell reservation', {
                symbol,
                orderId: o.orderId,
                reserved: remaining,
              });
            }
          }
        }
      } catch (err) {
        this.logger.warn('[inventory] failed to fetch open orders for reservation import', {
          symbol,
          err: String(err),
        });
      }
    }

    this.state.lastSyncMs = Date.now();

    this.logger.info('[inventory] hydration complete', {
      cashUsd: this.state.cashUsd.toFixed(2),
      positions: this.state.positions.map(p => ({
        symbol: p.symbol,
        qty: p.quantity,
        available: this.state.available.get(p.symbol)?.toFixed(8),
        reserved: this.state.reserved.get(p.symbol)?.toFixed(8),
      })),
    });

    return this.state;
  }

  // ─── 1B: Hard inventory guard ─────────────────────────────────

  /**
   * Check whether we can sell `qty` of `symbol`.
   * Returns { allowed, reason, availableQty }.
   */
  canSell(symbol: string, qty: number): { allowed: boolean; reason: string; availableQty: number } {
    const available = this.getAvailable(symbol);

    if (available <= BTC_DUST_BUFFER) {
      return {
        allowed: false,
        reason: `No inventory to sell: available=${available.toFixed(8)} BTC`,
        availableQty: 0,
      };
    }

    const maxSellable = available - BTC_DUST_BUFFER;
    if (qty > maxSellable) {
      return {
        allowed: false,
        reason: `Sell qty ${qty.toFixed(8)} exceeds available ${maxSellable.toFixed(8)} BTC (after buffer)`,
        availableQty: maxSellable,
      };
    }

    return { allowed: true, reason: 'Inventory check passed', availableQty: available };
  }

  /**
   * Clamp a sell quantity to what's actually available (minus buffer).
   * Returns 0 if nothing is sellable.
   */
  clampSellQty(symbol: string, desiredQty: number): number {
    const available = this.getAvailable(symbol);
    const maxSellable = Math.max(0, available - BTC_DUST_BUFFER);
    if (maxSellable <= 0) return 0;
    return Math.min(desiredQty, maxSellable);
  }

  // ─── 1C: Reservation management ──────────────────────────────

  /**
   * Reserve `qty` BTC for a pending sell order.
   * Moves qty from available → reserved.
   */
  reserve(symbol: string, qty: number, orderId: string): boolean {
    const available = this.getAvailable(symbol);
    if (qty > available) {
      this.logger.warn('[inventory] cannot reserve — exceeds available', {
        symbol,
        orderId,
        requested: qty.toFixed(8),
        available: available.toFixed(8),
      });
      return false;
    }
    this.state.available.set(symbol, available - qty);
    this.state.reserved.set(symbol, this.getReserved(symbol) + qty);
    this.logger.info('[inventory] reserved', {
      symbol,
      orderId,
      qty: qty.toFixed(8),
      newAvailable: (available - qty).toFixed(8),
    });
    return true;
  }

  /**
   * Release a reservation (order canceled / expired / rejected).
   * Moves qty from reserved → available.
   */
  releaseReservation(symbol: string, qty: number, orderId: string): void {
    const reserved = this.getReserved(symbol);
    const release = Math.min(qty, reserved);
    this.state.reserved.set(symbol, reserved - release);
    this.state.available.set(symbol, this.getAvailable(symbol) + release);
    this.logger.info('[inventory] reservation released', {
      symbol,
      orderId,
      released: release.toFixed(8),
    });
  }

  /**
   * Confirm a fill: remove from reserved (sell) or add to available (buy).
   * Also updates cash tracking.
   */
  confirmFill(order: Order, fillPrice: number, fees: number): void {
    const symbol = order.symbol;
    const qty = order.filledQuantity;

    if (order.side === 'sell') {
      // Remove from reserved
      const reserved = this.getReserved(symbol);
      const release = Math.min(qty, reserved);
      this.state.reserved.set(symbol, reserved - release);

      // If we somehow sold more than reserved (shouldn't happen), also reduce available
      const overSold = qty - release;
      if (overSold > 0) {
        this.state.available.set(symbol, Math.max(0, this.getAvailable(symbol) - overSold));
      }

      // Credit cash
      this.state.cashUsd += qty * fillPrice - fees;
    } else {
      // Buy: add to available, debit cash
      this.state.available.set(symbol, this.getAvailable(symbol) + qty);
      this.state.cashUsd -= qty * fillPrice + fees;
    }

    // Update position record
    this.updatePosition(symbol, order.side, qty, fillPrice);

    this.logger.info('[inventory] fill confirmed', {
      symbol,
      side: order.side,
      qty: qty.toFixed(8),
      price: fillPrice.toFixed(2),
      fees: fees.toFixed(4),
      newCash: this.state.cashUsd.toFixed(2),
      newAvailable: this.getAvailable(symbol).toFixed(8),
    });
  }

  // ─── Accessors ────────────────────────────────────────────────

  getAvailable(symbol: string): number {
    return this.state.available.get(symbol) ?? 0;
  }

  getReserved(symbol: string): number {
    return this.state.reserved.get(symbol) ?? 0;
  }

  getTotalHolding(symbol: string): number {
    return this.getAvailable(symbol) + this.getReserved(symbol);
  }

  getCashUsd(): number {
    return this.state.cashUsd;
  }

  getPositions(): Position[] {
    return [...this.state.positions];
  }

  getState(): Readonly<InventoryState> {
    return this.state;
  }

  /**
   * Re-sync with exchange. Use periodically to heal any drift.
   */
  async resync(exchange: ExchangeAdapter, symbols: string[]): Promise<{ diffs: string[] }> {
    const diffs: string[] = [];
    const balances = await exchange.getBalances();
    const balanceMap = new Map<string, Balance>();
    for (const b of balances) balanceMap.set(b.asset, b);

    // Check cash
    const exchangeCash = (balanceMap.get('USD')?.free ?? 0) + (balanceMap.get('USDC')?.free ?? 0);
    if (Math.abs(exchangeCash - this.state.cashUsd) > 0.01) {
      diffs.push(`Cash: local=$${this.state.cashUsd.toFixed(2)} exchange=$${exchangeCash.toFixed(2)}`);
      this.state.cashUsd = exchangeCash;
    }

    // Check each symbol
    for (const symbol of symbols) {
      const base = symbol.split(/[-/]/)[0];
      if (!base) continue;
      const holding = balanceMap.get(base);
      const exchangeFree = holding?.free ?? 0;
      const exchangeLocked = holding?.locked ?? 0;
      const localTotal = this.getTotalHolding(symbol);
      const exchangeTotal = exchangeFree + exchangeLocked;

      if (Math.abs(localTotal - exchangeTotal) > 1e-10) {
        diffs.push(`${symbol}: local=${localTotal.toFixed(8)} exchange=${exchangeTotal.toFixed(8)}`);
        // Trust exchange
        this.state.available.set(symbol, exchangeFree);
        this.state.reserved.set(symbol, exchangeLocked);
      }
    }

    if (diffs.length > 0) {
      this.logger.warn('[inventory] re-sync found discrepancies — trusting exchange', { diffs });
    }

    this.state.lastSyncMs = Date.now();
    return { diffs };
  }

  // ─── Internal ─────────────────────────────────────────────────

  private updatePosition(symbol: string, side: 'buy' | 'sell', qty: number, fillPrice: number): void {
    const existing = this.state.positions.find(p => p.symbol === symbol);

    if (side === 'buy') {
      if (!existing) {
        this.state.positions.push({ symbol, quantity: qty, avgEntryPrice: fillPrice, marketPrice: fillPrice });
      } else {
        const totalQty = existing.quantity + qty;
        existing.avgEntryPrice = (existing.avgEntryPrice * existing.quantity + fillPrice * qty) / totalQty;
        existing.quantity = totalQty;
        existing.marketPrice = fillPrice;
      }
    } else {
      if (!existing) return;
      existing.quantity -= qty;
      existing.marketPrice = fillPrice;
      if (existing.quantity <= 1e-12) {
        this.state.positions = this.state.positions.filter(p => p.symbol !== symbol);
      }
    }
  }
}
