import { useState, useEffect, useCallback } from 'react';
import {
  GitCompare,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Database,
  Cloud,
} from 'lucide-react';
import { useDashboardStore } from '../../../store/dashboardStore';
import { DataTable, StatusBadge, EmptyState } from '../../common';
import type { Column } from '../../common';

interface HealthCounters {
  startupSyncStatus: string;
  startupDiffs: string[];
  chopGuardBlocks: number;
  oversoldVetoBlocks: number;
  minEdgeBlocks: number;
  minNotionalBlocks: number;
  inventoryGuardBlocks: number;
  feeReconciledTrades: number;
  orphanFills: number;
  feeMismatches: number;
  qtyMismatches: number;
  signalsEvaluated: number;
  signalsProfitableAfterFees: number;
  signalsUnprofitableAfterFees: number;
  ordersPlaced: number;
  ordersFilled: number;
  totalFeesUsd: number;
  errors: string[];
}

async function fetchHealthCounters(): Promise<HealthCounters | null> {
  try {
    const res = await fetch('/api/health/counters');
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export function ExecutionReconciliation() {
  const data = useDashboardStore((s) => s.data);
  const [health, setHealth] = useState<HealthCounters | null>(null);
  const [loading, setLoading] = useState(true);

  const loadHealth = useCallback(async () => {
    setLoading(true);
    const counters = await fetchHealthCounters();
    setHealth(counters);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadHealth();
  }, [loadHealth]);

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 rounded-full border-2 border-brand border-t-transparent animate-spin" />
      </div>
    );
  }

  const hasMismatches =
    health && (health.orphanFills > 0 || health.feeMismatches > 0 || health.qtyMismatches > 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold flex items-center gap-2">
          <GitCompare size={18} className="text-brand" />
          Reconciliation
        </h2>
        <button onClick={loadHealth} className="btn-ghost text-xs px-2 py-1.5 min-h-[32px]">
          <RefreshCw size={14} />
        </button>
      </div>

      {/* Sync status */}
      <div className={`card border-2 ${hasMismatches ? 'border-warning/40' : 'border-profit/20'}`}>
        <div className="flex items-center gap-3 mb-3">
          {hasMismatches ? (
            <AlertTriangle size={20} className="text-warning" />
          ) : (
            <CheckCircle2 size={20} className="text-profit" />
          )}
          <div>
            <div className="text-sm font-bold">
              {hasMismatches ? 'Mismatches Detected (Cumulative)' : 'In Sync'}
            </div>
            <div className="text-xs text-muted">
              {health
                ? hasMismatches
                  ? `Session totals: ${health.orphanFills} orphan fill(s), ${health.feeMismatches} fee mismatch(es), ${health.qtyMismatches} qty mismatch(es). These are cumulative since boot — startup sync: ${health.startupSyncStatus}`
                  : `Startup sync: ${health.startupSyncStatus}. No mismatches since boot.`
                : loading
                  ? 'Loading health data...'
                  : 'Health endpoint unavailable'}
            </div>
          </div>
        </div>

        {health?.startupDiffs && health.startupDiffs.length > 0 && (
          <div className="bg-surface2 rounded-input p-3 border border-border">
            <div className="text-[0.66rem] uppercase tracking-wider text-muted mb-2">Startup Diffs</div>
            {health.startupDiffs.map((diff, i) => (
              <div key={i} className="text-xs text-warning">{diff}</div>
            ))}
          </div>
        )}
      </div>

      {/* Position comparison */}
      <div className="card">
        <div className="section-title">
          <Database size={14} />
          Local Positions
        </div>
        {data.positions.length === 0 ? (
          <div className="text-sm text-muted">No open positions</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {data.positions.map((pos) => (
              <div key={pos.symbol} className="bg-surface2 rounded-input p-3 border border-border">
                <div className="flex justify-between items-center">
                  <span className="font-bold text-sm">{pos.symbol}</span>
                  <span className="text-xs text-muted">{pos.quantity.toFixed(6)}</span>
                </div>
                <div className="flex justify-between text-xs text-muted mt-1">
                  <span>Value: ${pos.valueUsd.toFixed(2)}</span>
                  <span
                    style={{ color: pos.unrealizedPnlUsd >= 0 ? '#10b981' : '#ef4444' }}
                    className="font-semibold"
                  >
                    {pos.unrealizedPnlUsd >= 0 ? '+' : ''}${pos.unrealizedPnlUsd.toFixed(2)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="text-xs text-muted mt-3">
          Full local-vs-exchange comparison requires backend /api/reconciliation/status endpoint.
        </div>
      </div>

      {/* Health counters */}
      {health && (
        <>
          <div className="card">
            <div className="section-title">Reconciliation Counters</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <CounterCard
                label="Reconciled Trades"
                value={health.feeReconciledTrades}
                variant="info"
              />
              <CounterCard
                label="Orphan Fills"
                value={health.orphanFills}
                variant={health.orphanFills > 0 ? 'danger' : 'success'}
              />
              <CounterCard
                label="Fee Mismatches"
                value={health.feeMismatches}
                variant={health.feeMismatches > 0 ? 'warning' : 'success'}
              />
              <CounterCard
                label="Qty Mismatches"
                value={health.qtyMismatches}
                variant={health.qtyMismatches > 0 ? 'warning' : 'success'}
              />
            </div>
          </div>

          <div className="card">
            <div className="section-title">Gatekeeper Blocks</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              <CounterCard label="Chop Guard" value={health.chopGuardBlocks} variant="muted" />
              <CounterCard label="Oversold Veto" value={health.oversoldVetoBlocks} variant="muted" />
              <CounterCard label="Min Edge" value={health.minEdgeBlocks} variant="muted" />
              <CounterCard label="Min Notional" value={health.minNotionalBlocks} variant="muted" />
              <CounterCard label="Inventory Guard" value={health.inventoryGuardBlocks} variant="muted" />
            </div>
          </div>

          <div className="card">
            <div className="section-title">Execution Stats</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <CounterCard label="Orders Placed" value={health.ordersPlaced} variant="info" />
              <CounterCard label="Orders Filled" value={health.ordersFilled} variant="info" />
              <CounterCard label="Total Fees" value={`$${health.totalFeesUsd.toFixed(2)}`} variant="warning" />
              <CounterCard label="Signals Evaluated" value={health.signalsEvaluated} variant="info" />
            </div>
          </div>

          {/* Errors */}
          {health.errors.length > 0 && (
            <div className="card border-2 border-loss/30">
              <div className="section-title">
                <AlertTriangle size={14} className="text-loss" />
                Errors ({health.errors.length})
              </div>
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {health.errors.map((err, i) => (
                  <div key={i} className="text-xs text-loss bg-loss/5 rounded-input p-2 border border-loss/10">
                    {err}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CounterCard({
  label,
  value,
  variant,
}: {
  label: string;
  value: number | string;
  variant: 'success' | 'danger' | 'warning' | 'info' | 'muted';
}) {
  const colors = {
    success: 'text-profit',
    danger: 'text-loss',
    warning: 'text-warning',
    info: 'text-brand',
    muted: 'text-text',
  };

  return (
    <div className="bg-surface2 rounded-input p-3 border border-border">
      <div className="text-[0.66rem] uppercase tracking-wider text-muted mb-1">{label}</div>
      <div className={`text-base font-bold ${colors[variant]}`}>{value}</div>
    </div>
  );
}
