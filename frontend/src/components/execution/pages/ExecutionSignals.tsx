import { useState, useEffect, useCallback, useMemo } from 'react';
import { Signal, ArrowUp, ArrowDown, Minus, ShieldCheck, ShieldOff, RefreshCw } from 'lucide-react';
import { DataTable, FilterBar, StatusBadge, EmptyState } from '../../common';
import type { Column } from '../../common';
import { fetchSignals, type SignalLogEntry } from '../../../services/api';

type SignalFilter = 'all' | 'executed' | 'blocked';

export function ExecutionSignals() {
  const [signals, setSignals] = useState<SignalLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<SignalFilter>('all');

  const loadSignals = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchSignals({ limit: 300 });
      setSignals(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load signals');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSignals();
  }, [loadSignals]);

  const filtered = useMemo(() => {
    if (filter === 'all') return signals.filter(s => s.action !== 'HOLD');
    if (filter === 'executed') return signals.filter(s => s.outcome === 'executed');
    return signals.filter(s => s.outcome !== 'executed' && s.outcome !== 'hold');
  }, [signals, filter]);

  const executedCount = signals.filter(s => s.outcome === 'executed').length;
  const blockedCount = signals.filter(s => s.outcome !== 'executed' && s.outcome !== 'hold').length;

  const filterOptions = [
    { label: 'All', value: 'all', count: executedCount + blockedCount },
    { label: 'Executed', value: 'executed', count: executedCount },
    { label: 'Blocked', value: 'blocked', count: blockedCount },
  ];

  const columns: Column<SignalLogEntry>[] = [
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
      key: 'action',
      header: 'Signal',
      render: (row) => {
        if (row.action === 'BUY') {
          return <StatusBadge label="BUY" variant="success" icon={<ArrowUp size={12} />} />;
        }
        if (row.action === 'SELL') {
          return <StatusBadge label="SELL" variant="danger" icon={<ArrowDown size={12} />} />;
        }
        return <StatusBadge label="HOLD" variant="muted" icon={<Minus size={12} />} />;
      },
    },
    {
      key: 'confidence',
      header: 'Confidence',
      render: (row) => {
        const pct = (row.confidence * 100).toFixed(0);
        const color =
          row.confidence >= 0.7 ? '#10b981' : row.confidence >= 0.4 ? '#f59e0b' : '#64748b';
        return (
          <div className="flex items-center gap-2">
            <div className="w-16 meter-bar h-1.5">
              <div
                className="meter-fill"
                style={{ width: `${row.confidence * 100}%`, background: color }}
              />
            </div>
            <span className="text-xs font-semibold" style={{ color }}>
              {pct}%
            </span>
          </div>
        );
      },
    },
    {
      key: 'outcome',
      header: 'Decision',
      render: (row) =>
        row.outcome === 'executed' ? (
          <StatusBadge label="EXECUTED" variant="success" icon={<ShieldCheck size={12} />} />
        ) : (
          <StatusBadge label="BLOCKED" variant="warning" icon={<ShieldOff size={12} />} />
        ),
    },
    {
      key: 'blockedBy',
      header: 'Gate',
      render: (row) => (
        <span className="text-xs text-muted">
          {row.outcome === 'executed' ? 'all gates passed' : row.blockedBy ?? row.outcome}
        </span>
      ),
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
        <span className="text-xs text-muted whitespace-normal break-words">
          {row.riskReason ?? row.reason}
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
        <button onClick={loadSignals} className="btn-ghost text-xs">
          <RefreshCw size={14} /> Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-base font-bold flex items-center gap-2">
          <Signal size={18} className="text-brand" />
          Signals
        </h2>
        <div className="flex items-center gap-3">
          <FilterBar
            options={filterOptions}
            selected={filter}
            onChange={(v) => setFilter(v as SignalFilter)}
          />
          <button onClick={loadSignals} className="btn-ghost text-xs px-2 py-1.5 min-h-[32px]">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-surface2 rounded-input p-3 border border-border">
          <div className="text-[0.66rem] uppercase tracking-wider text-muted mb-1">Total Signals</div>
          <div className="text-base font-bold">{executedCount + blockedCount}</div>
        </div>
        <div className="bg-surface2 rounded-input p-3 border border-border">
          <div className="text-[0.66rem] uppercase tracking-wider text-muted mb-1">Executed</div>
          <div className="text-base font-bold text-profit">{executedCount}</div>
        </div>
        <div className="bg-surface2 rounded-input p-3 border border-border">
          <div className="text-[0.66rem] uppercase tracking-wider text-muted mb-1">Blocked</div>
          <div className="text-base font-bold text-loss">{blockedCount}</div>
        </div>
        <div className="bg-surface2 rounded-input p-3 border border-border">
          <div className="text-[0.66rem] uppercase tracking-wider text-muted mb-1">Avg Confidence</div>
          <div className="text-base font-bold">
            {filtered.length > 0
              ? ((filtered.reduce((s, sig) => s + sig.confidence, 0) / filtered.length) * 100).toFixed(0)
              : 0}%
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Signal size={28} />}
          title="No signals recorded"
          description="Signals will appear here as the bot evaluates strategies"
        />
      ) : (
        <DataTable
          columns={columns}
          data={filtered}
          rowKey={(row, i) => `${row.id ?? row.timestamp}-${i}`}
          maxRows={200}
        />
      )}
    </div>
  );
}
