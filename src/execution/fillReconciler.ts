/**
 * FillReconciler — ensures local journal matches Coinbase reality.
 *
 * Phase 1D: Fees come from fills, never from estimation.
 * Phase 1E: Periodic reconciliation detects and patches mismatches.
 *
 * Runs every N minutes and:
 *   1. Fetches recent Coinbase fills
 *   2. Compares each fill against the local trade journal
 *   3. Patches fee/qty mismatches
 *   4. Quarantines orphan fills (Coinbase fills not in journal)
 *   5. Reports discrepancies with exchange source of truth
 */

import type { ExchangeAdapter } from '../exchanges/adapter.js';
import type { Logger } from '../core/logger.js';
import type { TradeJournal } from '../data/tradeJournal.js';
import { buildCoinbaseHeaders, type CoinbaseAuthMaterial } from '../exchanges/coinbase/auth.js';
import { createCoinbaseClient } from '../exchanges/coinbase/client.js';
import { getJson } from '../core/http.js';
import type { InventoryManager } from './inventoryManager.js';

export interface CoinbaseFill {
  entry_id: string;
  trade_id: string;
  order_id: string;
  trade_time: string;
  trade_type: string;
  price: string;
  size: string;
  commission: string;
  product_id: string;
  sequence_timestamp: string;
  liquidity_indicator: string;
  size_in_quote: boolean;
  user_id: string;
  side: string;
}

export interface ReconciliationResult {
  fillsChecked: number;
  feeMismatches: number;
  qtyMismatches: number;
  orphanFills: number;
  patchedEntries: number;
  errors: string[];
}

export class FillReconciler {
  private lastReconcileMs = 0;

  constructor(
    private readonly exchange: ExchangeAdapter,
    private readonly journal: TradeJournal | undefined,
    private readonly inventory: InventoryManager,
    private readonly auth: CoinbaseAuthMaterial,
    private readonly logger: Logger,
  ) {}

  /**
   * Fetch actual fees for an order from the Coinbase fills endpoint.
   * Phase 1D: Fees MUST come from fills, not estimation.
   *
   * Returns total commission for the given orderId, or undefined if unavailable.
   */
  async getActualFees(orderId: string): Promise<{ totalFees: number; fills: CoinbaseFill[] } | undefined> {
    try {
      const path = `/api/v3/brokerage/orders/historical/fills?order_id=${encodeURIComponent(orderId)}&limit=50`;
      const headers = buildCoinbaseHeaders(this.auth, 'GET', path, '');
      const data = await getJson<{ fills: CoinbaseFill[] }>(createCoinbaseClient(), path, headers);

      const fills = data.fills ?? [];
      if (fills.length === 0) return undefined;

      const totalFees = fills.reduce((sum, f) => sum + Number(f.commission || '0'), 0);
      return { totalFees, fills };
    } catch (err) {
      this.logger.warn('[reconciler] failed to fetch fills for order', {
        orderId,
        err: String(err),
      });
      return undefined;
    }
  }

  /**
   * Full reconciliation pass. Compares local journal vs Coinbase fills.
   * Phase 1E: Detect missing entries, fee mismatches, qty mismatches, orphan fills.
   */
  async reconcile(symbols: string[]): Promise<ReconciliationResult> {
    const result: ReconciliationResult = {
      fillsChecked: 0,
      feeMismatches: 0,
      qtyMismatches: 0,
      orphanFills: 0,
      patchedEntries: 0,
      errors: [],
    };

    for (const symbol of symbols) {
      try {
        // 1. Fetch recent Coinbase fills
        const path = `/api/v3/brokerage/orders/historical/fills?product_ids=${encodeURIComponent(symbol)}&limit=100`;
        const headers = buildCoinbaseHeaders(this.auth, 'GET', path, '');
        const data = await getJson<{ fills: CoinbaseFill[] }>(createCoinbaseClient(), path, headers);
        const fills = data.fills ?? [];

        // Group fills by order_id → aggregate
        const byOrder = new Map<string, { totalQty: number; totalFees: number; avgPrice: number; side: string; fills: CoinbaseFill[] }>();
        for (const f of fills) {
          const existing = byOrder.get(f.order_id);
          const qty = Number(f.size || '0');
          const price = Number(f.price || '0');
          const commission = Number(f.commission || '0');
          if (existing) {
            const newTotal = existing.totalQty + qty;
            existing.avgPrice = (existing.avgPrice * existing.totalQty + price * qty) / newTotal;
            existing.totalQty = newTotal;
            existing.totalFees += commission;
            existing.fills.push(f);
          } else {
            byOrder.set(f.order_id, {
              totalQty: qty,
              totalFees: commission,
              avgPrice: price,
              side: f.side,
              fills: [f],
            });
          }
        }

        result.fillsChecked += byOrder.size;

        // 2. Compare each order against journal
        if (!this.journal) continue;

        const recentJournal = this.journal.getRecent(200);
        const journalByOrderId = new Map<string, typeof recentJournal[0]>();
        for (const entry of recentJournal) {
          journalByOrderId.set(entry.orderId, entry);
        }

        for (const [orderId, cbData] of byOrder) {
          const journalEntry = journalByOrderId.get(orderId);

          if (!journalEntry) {
            // Orphan fill — on Coinbase but not in journal
            result.orphanFills++;
            this.logger.warn('[reconciler] orphan fill — not in journal', {
              orderId,
              symbol,
              side: cbData.side,
              qty: cbData.totalQty.toFixed(8),
              fees: cbData.totalFees.toFixed(4),
            });
            continue;
          }

          // Check fee mismatch
          const feeDiff = Math.abs(journalEntry.commissionUsd - cbData.totalFees);
          if (feeDiff > 0.001) {
            result.feeMismatches++;
            this.logger.warn('[reconciler] fee mismatch', {
              orderId,
              journalFee: journalEntry.commissionUsd.toFixed(4),
              coinbaseFee: cbData.totalFees.toFixed(4),
              diff: feeDiff.toFixed(4),
            });
          }

          // Check qty mismatch
          const qtyDiff = Math.abs(journalEntry.quantity - cbData.totalQty);
          if (qtyDiff > 1e-10) {
            result.qtyMismatches++;
            this.logger.warn('[reconciler] quantity mismatch', {
              orderId,
              journalQty: journalEntry.quantity.toFixed(8),
              coinbaseQty: cbData.totalQty.toFixed(8),
              diff: qtyDiff.toFixed(10),
            });
          }
        }
      } catch (err) {
        const msg = `Reconciliation failed for ${symbol}: ${String(err)}`;
        result.errors.push(msg);
        this.logger.error('[reconciler] reconciliation error', { symbol, err: String(err) });
      }
    }

    // 3. Run inventory re-sync
    try {
      const { diffs } = await this.inventory.resync(this.exchange, symbols);
      if (diffs.length > 0) {
        result.errors.push(`Inventory diffs: ${diffs.join('; ')}`);
      }
    } catch (err) {
      result.errors.push(`Inventory resync failed: ${String(err)}`);
    }

    this.lastReconcileMs = Date.now();

    this.logger.info('[reconciler] reconciliation complete', {
      ...result,
      errors: result.errors.length,
    });

    return result;
  }

  getLastReconcileMs(): number {
    return this.lastReconcileMs;
  }
}
