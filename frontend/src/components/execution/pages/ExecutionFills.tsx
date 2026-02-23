import { useState, useEffect, useCallback } from 'react';
import { Receipt, ArrowUp, ArrowDown, RefreshCw } from 'lucide-react';
import { DataTable, FilterBar, StatusBadge, EmptyState } from '../../common';
import type { Column } from '../../common';
import { fetchOrders } from '../../../services/api';
import type { Trade } from '../../../types/api';

function fmtUsd(v: number): string {
  const sign = v >= 0 ? '+' : '';
  return `${sign}$${Math.abs(v).toFixed(2)}`;
}

function fmtPrice(v: number): string {
  return `$${v.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

type FillFilter = 'all' | 'profitable' | 'losing';

export function ExecutionFills() {
  const [fills, setFills] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FillFilter>('all');

  const loadFills = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchOrders();
      setFills(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load fills');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFills();
  }, [loadFills]);

  const exits = fills.filter((f) => f.action === 'exit');
  const entries = fills.filter((f) => f.action === 'entry');

  const profitableFills = exits.filter((f) => (f.realizedPnlUsd ?? 0) > 0);
  const losingFills = exits.filter((f) => (f.realizedPnlUsd ?? 0) <= 0);

  const displayFills =
    filter === 'all'
      ? fills
      : filter === 'profitable'
        ? profitableFills
        : losingFills;

  const totalFees = fills.reduce((s, f) => s + f.commissionUsd, 0);
  const avgSlippage =
    fills.length > 0
      ? fills.reduce((s, f) => s + Math.abs(f.slippageBps), 0) / fills.length
      : 0;

  const filterOptions = [
    { label: 'All Fills', value: 'all', count: fills.length },
    { label: 'Profitable Exits', value: 'profitable', count: profitableFills.length },
    { label: 'Losing Exits', value: 'losing', count: losingFills.length },
  ];

  const columns: Column<Trade>[] = [
    {
      key: 'time',
      header: 'Time',
      render: (row) => (
        <span className="text-xs text-muted whitespace-nowrap">
          {new Date(row.timestamp).toLocaleString([], {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          })}
        </span>
      ),
    },
    {
      key: 'symbol',
      header: 'Symbol',
      render: (row) => <span className="font-semibold">{row.symbol}</span>,
    },
    {
      key: 'side',
      header: 'Side',
      render: (row) =>
        row.side === 'buy' ? (
          <StatusBadge label="BUY" variant="success" icon={<ArrowUp size={12} />} />
        ) : (
          <StatusBadge label="SELL" variant="danger" icon={<ArrowDown size={12} />} />
        ),
    },
    {
      key: 'action',
      header: 'Type',
      render: (row) => (
        <StatusBadge
          label={row.action.toUpperCase()}
          variant={row.action === 'entry' ? 'info' : 'muted'}
        />
      ),
    },
    {
      key: 'filledPrice',
      header: 'Fill Price',
      render: (row) => fmtPrice(row.filledPrice),
      className: 'text-right',
    },
    {
      key: 'qty',
      header: 'Quantity',
      render: (row) => <span className="font-mono text-xs">{row.quantity.toFixed(6)}</span>,
      className: 'text-right',
    },
    {
      key: 'notional',
      header: 'Notional',
      render: (row) => fmtPrice(row.notionalUsd),
      className: 'text-right',
    },
    {
      key: 'fee',
      header: 'Fee',
      render: (row) => (
        <span className="text-warning text-xs">${row.commissionUsd.toFixed(4)}</span>
      ),
      className: 'text-right',
    },
    {
      key: 'slippage',
      header: 'Slippage',
      render: (row) => {
        const abs = Math.abs(row.slippageBps);
        const color = abs > 10 ? '#ef4444' : abs > 5 ? '#f59e0b' : '#64748b';
        return (
          <span className="text-xs" style={{ color }}>
            {row.slippageBps >= 0 ? '+' : ''}{row.slippageBps.toFixed(1)} bps
          </span>
        );
      },
      className: 'text-right',
    },
    {
      key: 'pnl',
      header: 'P&L',
      render: (row) => {
        if (row.action !== 'exit' || row.realizedPnlUsd == null) {
          return <span className="text-muted text-xs">--</span>;
        }
        return (
          <span
            className="font-semibold"
            style={{ color: row.realizedPnlUsd >= 0 ? '#10b981' : '#ef4444' }}
          >
            {fmtUsd(row.realizedPnlUsd)}
          </span>
        );
      },
      className: 'text-right',
    },
    {
      key: 'strategy',
      header: 'Strategy',
      render: (row) => (
        <span className="text-xs text-muted">{row.strategy.replace(/_/g, ' ')}</span>
      ),
    },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 rounded-full border-2 border-brand border-t-transparent animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <p className="text-sm text-loss">{error}</p>
        <button onClick={loadFills} className="btn-ghost text-xs">
          <RefreshCw size={14} /> Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-base font-bold flex items-center gap-2">
          <Receipt size={18} className="text-brand" />
          Executions (Fills)
        </h2>
        <div className="flex items-center gap-3">
          <FilterBar
            options={filterOptions}
            selected={filter}
            onChange={(v) => setFilter(v as FillFilter)}
          />
          <button onClick={loadFills} className="btn-ghost text-xs px-2 py-1.5 min-h-[32px]">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-surface2 rounded-input p-3 border border-border">
          <div className="text-[0.66rem] uppercase tracking-wider text-muted mb-1">Total Fills</div>
          <div className="text-base font-bold">{fills.length}</div>
        </div>
        <div className="bg-surface2 rounded-input p-3 border border-border">
          <div className="text-[0.66rem] uppercase tracking-wider text-muted mb-1">Entries / Exits</div>
          <div className="text-base font-bold">
            <span className="text-brand">{entries.length}</span>
            {' / '}
            <span className="text-muted">{exits.length}</span>
          </div>
        </div>
        <div className="bg-surface2 rounded-input p-3 border border-border">
          <div className="text-[0.66rem] uppercase tracking-wider text-muted mb-1">Total Fees</div>
          <div className="text-base font-bold text-warning">${totalFees.toFixed(4)}</div>
        </div>
        <div className="bg-surface2 rounded-input p-3 border border-border">
          <div className="text-[0.66rem] uppercase tracking-wider text-muted mb-1">Avg Slippage</div>
          <div className="text-base font-bold">{avgSlippage.toFixed(1)} bps</div>
        </div>
      </div>

      {displayFills.length === 0 ? (
        <EmptyState
          icon={<Receipt size={28} />}
          title="No fills"
          description="No fills match the current filter"
        />
      ) : (
        <DataTable
          columns={columns}
          data={displayFills}
          rowKey={(row, i) => `${row.orderId}-${i}`}
          maxRows={100}
          emptyMessage="No fills"
        />
      )}
    </div>
  );
}
