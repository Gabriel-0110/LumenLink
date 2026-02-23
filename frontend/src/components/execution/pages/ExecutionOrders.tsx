import { useState, useEffect, useCallback } from 'react';
import { ClipboardList, ArrowUp, ArrowDown, RefreshCw } from 'lucide-react';
import { DataTable, FilterBar, StatusBadge, EmptyState } from '../../common';
import type { Column } from '../../common';
import { fetchOrders } from '../../../services/api';
import type { Trade } from '../../../types/api';

function fmtPrice(v: number): string {
  return `$${v.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtSlippage(bps: number): string {
  if (bps === 0) return '0 bps';
  const sign = bps >= 0 ? '+' : '';
  return `${sign}${bps.toFixed(1)} bps`;
}

type OrderFilter = 'all' | 'entry' | 'exit';

export function ExecutionOrders() {
  const [orders, setOrders] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<OrderFilter>('all');

  const loadOrders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchOrders();
      setOrders(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load orders');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  const filtered =
    filter === 'all' ? orders : orders.filter((o) => o.action === filter);

  const entryCount = orders.filter((o) => o.action === 'entry').length;
  const exitCount = orders.filter((o) => o.action === 'exit').length;

  const filterOptions = [
    { label: 'All', value: 'all', count: orders.length },
    { label: 'Entries', value: 'entry', count: entryCount },
    { label: 'Exits', value: 'exit', count: exitCount },
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
      header: 'Action',
      render: (row) => (
        <StatusBadge
          label={row.action.toUpperCase()}
          variant={row.action === 'entry' ? 'info' : 'muted'}
        />
      ),
    },
    {
      key: 'requestedPrice',
      header: 'Requested',
      render: (row) => fmtPrice(row.requestedPrice),
      className: 'text-right',
    },
    {
      key: 'filledPrice',
      header: 'Filled',
      render: (row) => fmtPrice(row.filledPrice),
      className: 'text-right',
    },
    {
      key: 'slippage',
      header: 'Slippage',
      render: (row) => (
        <span
          className="text-xs"
          style={{
            color:
              Math.abs(row.slippageBps) > 10
                ? '#ef4444'
                : Math.abs(row.slippageBps) > 5
                  ? '#f59e0b'
                  : '#64748b',
          }}
        >
          {fmtSlippage(row.slippageBps)}
        </span>
      ),
      className: 'text-right',
    },
    {
      key: 'qty',
      header: 'Quantity',
      render: (row) => <span className="font-mono text-xs">{row.quantity.toFixed(6)}</span>,
      className: 'text-right',
    },
    {
      key: 'confidence',
      header: 'Conf',
      render: (row) => {
        const pct = (row.confidence * 100).toFixed(0);
        const color =
          row.confidence >= 0.7 ? '#10b981' : row.confidence >= 0.4 ? '#f59e0b' : '#64748b';
        return <span style={{ color }}>{pct}%</span>;
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
    {
      key: 'reason',
      header: 'Reason',
      render: (row) => (
        <span
          className="text-xs text-muted max-w-[200px] truncate block"
          title={row.reason}
        >
          {row.reason}
        </span>
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
        <button onClick={loadOrders} className="btn-ghost text-xs">
          <RefreshCw size={14} /> Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-base font-bold flex items-center gap-2">
          <ClipboardList size={18} className="text-brand" />
          Orders
        </h2>
        <div className="flex items-center gap-3">
          <FilterBar
            options={filterOptions}
            selected={filter}
            onChange={(v) => setFilter(v as OrderFilter)}
          />
          <button onClick={loadOrders} className="btn-ghost text-xs px-2 py-1.5 min-h-[32px]">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<ClipboardList size={28} />}
          title="No orders"
          description="No orders match the current filter"
        />
      ) : (
        <DataTable
          columns={columns}
          data={filtered}
          rowKey={(row, i) => `${row.orderId}-${i}`}
          maxRows={100}
          emptyMessage="No orders"
        />
      )}
    </div>
  );
}
