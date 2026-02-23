/**
 * HealthReport — daily operator dashboard showing reconciliation health.
 *
 * Accumulates counters through the day and prints a concise summary
 * on demand or on a schedule (e.g. every hour + end of day).
 *
 * Counters reset at midnight UTC.
 */

import type { Logger } from '../core/logger.js';
import type { InventoryManager } from '../execution/inventoryManager.js';
import type { ExchangeAdapter } from '../exchanges/adapter.js';

export interface HealthCounters {
  // Startup
  startupSyncStatus: 'ok' | 'mismatch' | 'not_run';
  startupDiffs: string[];

  // Gatekeeper blocks
  chopGuardBlocks: number;
  oversoldVetoBlocks: number;
  minEdgeBlocks: number;
  minNotionalBlocks: number;
  inventoryGuardBlocks: number;

  // Reconciliation
  feeReconciledTrades: number;
  orphanFills: number;
  feeMismatches: number;
  qtyMismatches: number;

  // Edge analysis
  signalsEvaluated: number;
  signalsProfitableAfterFees: number;
  signalsUnprofitableAfterFees: number;

  // Trades
  ordersPlaced: number;
  ordersFilled: number;
  totalFeesUsd: number;

  // Errors
  errors: string[];
}

function freshCounters(): HealthCounters {
  return {
    startupSyncStatus: 'not_run',
    startupDiffs: [],
    chopGuardBlocks: 0,
    oversoldVetoBlocks: 0,
    minEdgeBlocks: 0,
    minNotionalBlocks: 0,
    inventoryGuardBlocks: 0,
    feeReconciledTrades: 0,
    orphanFills: 0,
    feeMismatches: 0,
    qtyMismatches: 0,
    signalsEvaluated: 0,
    signalsProfitableAfterFees: 0,
    signalsUnprofitableAfterFees: 0,
    ordersPlaced: 0,
    ordersFilled: 0,
    totalFeesUsd: 0,
    errors: [],
  };
}

export class HealthReport {
  private counters: HealthCounters = freshCounters();
  private lastResetDate: string = this.todayUTC();

  constructor(private readonly logger: Logger) {}

  // ─── Counter updates (called from loops.ts / index.ts) ────────

  recordStartupSync(status: 'ok' | 'mismatch', diffs: string[] = []): void {
    this.counters.startupSyncStatus = status;
    this.counters.startupDiffs = diffs;
  }

  recordGateBlock(gate: string): void {
    this.maybeRotate();
    switch (gate) {
      case 'chop_sell_guard': this.counters.chopGuardBlocks++; break;
      case 'oversold_veto': this.counters.oversoldVetoBlocks++; break;
      case 'min_edge': this.counters.minEdgeBlocks++; break;
      case 'min_notional': this.counters.minNotionalBlocks++; break;
      default: break;
    }
  }

  recordInventoryBlock(): void {
    this.maybeRotate();
    this.counters.inventoryGuardBlocks++;
  }

  recordEdgeEval(profitable: boolean): void {
    this.maybeRotate();
    this.counters.signalsEvaluated++;
    if (profitable) this.counters.signalsProfitableAfterFees++;
    else this.counters.signalsUnprofitableAfterFees++;
  }

  recordOrderPlaced(): void { this.maybeRotate(); this.counters.ordersPlaced++; }
  recordOrderFilled(fees: number): void {
    this.maybeRotate();
    this.counters.ordersFilled++;
    this.counters.totalFeesUsd += fees;
  }

  recordReconciliation(result: {
    feeMismatches: number;
    qtyMismatches: number;
    orphanFills: number;
    patchedEntries?: number;
  }): void {
    this.maybeRotate();
    this.counters.feeReconciledTrades += (result.patchedEntries ?? 0);
    this.counters.feeMismatches += result.feeMismatches;
    this.counters.qtyMismatches += result.qtyMismatches;
    this.counters.orphanFills += result.orphanFills;
  }

  recordError(msg: string): void {
    this.maybeRotate();
    if (this.counters.errors.length < 50) {
      this.counters.errors.push(`${new Date().toISOString()} ${msg}`);
    }
  }

  // ─── Print summary ───────────────────────────────────────────

  /**
   * Print a concise health summary to the logger and optionally to stdout.
   * If an exchange + inventory are provided, also log local vs exchange balance diff.
   */
  async printSummary(
    exchange?: ExchangeAdapter,
    inventory?: InventoryManager,
    symbols?: string[],
  ): Promise<void> {
    const c = this.counters;

    // Optional live balance comparison
    let balanceDiff = 'N/A';
    if (exchange && inventory && symbols) {
      try {
        const { diffs } = await inventory.resync(exchange, symbols);
        balanceDiff = diffs.length === 0 ? 'OK (in sync)' : diffs.join('; ');
      } catch {
        balanceDiff = 'ERROR (resync failed)';
      }
    }

    const summary = {
      date: this.todayUTC(),
      startupSync: c.startupSyncStatus,
      startupDiffs: c.startupDiffs.length > 0 ? c.startupDiffs : 'none',
      gateBlocks: {
        chopGuard: c.chopGuardBlocks,
        oversoldVeto: c.oversoldVetoBlocks,
        minEdge: c.minEdgeBlocks,
        minNotional: c.minNotionalBlocks,
        inventory: c.inventoryGuardBlocks,
        total: c.chopGuardBlocks + c.oversoldVetoBlocks + c.minEdgeBlocks + c.minNotionalBlocks + c.inventoryGuardBlocks,
      },
      reconciliation: {
        feeMismatches: c.feeMismatches,
        qtyMismatches: c.qtyMismatches,
        orphanFills: c.orphanFills,
        feeReconciledTrades: c.feeReconciledTrades,
      },
      edgeAnalysis: {
        evaluated: c.signalsEvaluated,
        profitableAfterFees: c.signalsProfitableAfterFees,
        unprofitableAfterFees: c.signalsUnprofitableAfterFees,
        profitableRate: c.signalsEvaluated > 0
          ? `${((c.signalsProfitableAfterFees / c.signalsEvaluated) * 100).toFixed(0)}%`
          : 'N/A',
      },
      trades: {
        placed: c.ordersPlaced,
        filled: c.ordersFilled,
        totalFeesUsd: `$${c.totalFeesUsd.toFixed(2)}`,
      },
      balanceDiff,
      errors: c.errors.length,
    };

    this.logger.info('═══ DAILY HEALTH REPORT ═══', summary);

    // Also write a human-readable version to stdout
    const lines = [
      '',
      '╔══════════════════════════════════════════════════════════╗',
      '║           RECONCILIATION HEALTH REPORT                  ║',
      `║  Date: ${this.todayUTC()}                                    ║`,
      '╠══════════════════════════════════════════════════════════╣',
      `║  Startup Sync: ${c.startupSyncStatus.toUpperCase().padEnd(40)}║`,
      `║  Balance Diff: ${(typeof balanceDiff === 'string' ? balanceDiff : 'N/A').slice(0, 40).padEnd(40)}║`,
      '╠══════════════════════════════════════════════════════════╣',
      '║  GATE BLOCKS:                                           ║',
      `║    Chop guard:      ${String(c.chopGuardBlocks).padEnd(36)}║`,
      `║    Oversold veto:   ${String(c.oversoldVetoBlocks).padEnd(36)}║`,
      `║    Min edge:        ${String(c.minEdgeBlocks).padEnd(36)}║`,
      `║    Min notional:    ${String(c.minNotionalBlocks).padEnd(36)}║`,
      `║    Inventory guard: ${String(c.inventoryGuardBlocks).padEnd(36)}║`,
      '╠══════════════════════════════════════════════════════════╣',
      '║  RECONCILIATION:                                        ║',
      `║    Fee mismatches:  ${String(c.feeMismatches).padEnd(36)}║`,
      `║    Qty mismatches:  ${String(c.qtyMismatches).padEnd(36)}║`,
      `║    Orphan fills:    ${String(c.orphanFills).padEnd(36)}║`,
      '╠══════════════════════════════════════════════════════════╣',
      '║  EDGE ANALYSIS:                                         ║',
      `║    Signals evaluated:       ${String(c.signalsEvaluated).padEnd(28)}║`,
      `║    Profitable after fees:   ${String(c.signalsProfitableAfterFees).padEnd(28)}║`,
      `║    Unprofitable after fees: ${String(c.signalsUnprofitableAfterFees).padEnd(28)}║`,
      '╠══════════════════════════════════════════════════════════╣',
      '║  TRADES:                                                ║',
      `║    Orders placed:   ${String(c.ordersPlaced).padEnd(36)}║`,
      `║    Orders filled:   ${String(c.ordersFilled).padEnd(36)}║`,
      `║    Total fees:      $${c.totalFeesUsd.toFixed(2).padEnd(35)}║`,
      '╠══════════════════════════════════════════════════════════╣',
      `║  Errors: ${String(c.errors.length).padEnd(46)}║`,
      '╚══════════════════════════════════════════════════════════╝',
      '',
    ];
    process.stdout.write(lines.join('\n') + '\n');
  }

  getCounters(): Readonly<HealthCounters> {
    return { ...this.counters };
  }

  // ─── Internal ─────────────────────────────────────────────────

  private todayUTC(): string {
    return new Date().toISOString().slice(0, 10);
  }

  /** Reset counters at midnight UTC boundary. */
  private maybeRotate(): void {
    const today = this.todayUTC();
    if (today !== this.lastResetDate) {
      this.logger.info('health report: rotating counters for new day', {
        previousDate: this.lastResetDate,
        newDate: today,
      });
      this.counters = freshCounters();
      this.lastResetDate = today;
    }
  }
}
