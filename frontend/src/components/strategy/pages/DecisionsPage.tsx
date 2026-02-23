import { useEffect, useState } from 'react';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Filter,
} from 'lucide-react';
import { useStrategyStore } from '../../../store/strategyStore';
import { DataTable, StatusBadge } from '../../common';
import type { Column } from '../../common/DataTable';
import type { DecisionRecordData, DecisionOutcome } from '../../../types/strategy';

const OUTCOME_BADGES: Record<string, { variant: 'success' | 'danger' | 'warning' | 'muted'; label: string }> = {
  executed: { variant: 'success', label: 'Exec' },
  blocked: { variant: 'danger', label: 'Blocked' },
  skipped: { variant: 'muted', label: 'Skip' },
  deferred: { variant: 'warning', label: 'Defer' },
};

export function DecisionsPage() {
  const data = useStrategyStore((s) => s.data);
  const fetchData = useStrategyStore((s) => s.fetchData);
  const selectDecision = useStrategyStore((s) => s.selectDecision);
  const [outcomeFilter, setOutcomeFilter] = useState<DecisionOutcome | 'all'>('all');

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  if (!data) return <div className="text-center text-muted py-12">Loading...</div>;

  const filtered = outcomeFilter === 'all'
    ? data.decisions
    : data.decisions.filter(d => d.outcome === outcomeFilter);

  const columns: Column<DecisionRecordData>[] = [
    {
      key: 'time',
      header: 'Time',
      render: (d) => (
        <span className="font-mono text-xs text-muted">
          {new Date(d.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </span>
      ),
      className: 'w-20',
    },
    {
      key: 'symbol',
      header: 'Symbol',
      render: (d) => <span className="font-bold text-xs">{d.symbol}</span>,
      className: 'w-24',
    },
    {
      key: 'action',
      header: 'Action',
      render: (d) => (
        <div className="flex items-center gap-1">
          {d.action === 'buy' && <TrendingUp size={12} className="text-profit" />}
          {d.action === 'sell' && <TrendingDown size={12} className="text-loss" />}
          {d.action === 'hold' && <Minus size={12} className="text-muted" />}
          <span className="uppercase text-xs font-semibold">{d.action}</span>
        </div>
      ),
      className: 'w-16',
    },
    {
      key: 'outcome',
      header: 'Outcome',
      render: (d) => {
        const b = OUTCOME_BADGES[d.outcome]!;
        return <StatusBadge label={b.label} variant={b.variant} />;
      },
      className: 'w-20',
    },
    {
      key: 'confidence',
      header: 'Conf',
      render: (d) => (
        <span className="text-xs font-mono">{(d.confidence * 100).toFixed(0)}%</span>
      ),
      className: 'w-14 text-right',
    },
    {
      key: 'edge',
      header: 'Edge',
      render: (d) => (
        <span className={`text-xs font-mono ${d.expectedEdgeBps >= 0 ? 'text-profit' : 'text-loss'}`}>
          {d.expectedEdgeBps > 0 ? '+' : ''}{d.expectedEdgeBps}bps
        </span>
      ),
      className: 'w-16 text-right',
    },
    {
      key: 'consensus',
      header: 'Cons',
      render: (d) => (
        <span className="text-xs font-mono text-muted">
          {(d.ensemble.consensusLevel * 100).toFixed(0)}%
        </span>
      ),
      className: 'w-14 text-right',
    },
    {
      key: 'dominant',
      header: 'Dominant',
      render: (d) => (
        <span className="text-xs text-muted capitalize">
          {d.ensemble.dominantModel?.replace(/_/g, ' ') ?? '-'}
        </span>
      ),
    },
    {
      key: 'regime',
      header: 'Regime',
      render: (d) => (
        <StatusBadge
          label={d.marketState.regime.replace(/_/g, ' ')}
          variant={d.marketState.regime.includes('vol') ? 'danger' : 'info'}
        />
      ),
    },
    {
      key: 'blockers',
      header: 'Blockers',
      render: (d) => (
        <span className="text-xs text-warning">
          {d.blockers.length > 0 ? d.blockers.join(', ') : '-'}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {/* Filter */}
      <div className="flex items-center gap-2">
        <Filter size={14} className="text-muted" />
        {(['all', 'executed', 'blocked', 'skipped', 'deferred'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setOutcomeFilter(f)}
            className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
              outcomeFilter === f
                ? 'bg-brand/20 text-brand font-semibold'
                : 'text-muted hover:text-text hover:bg-white/[0.05]'
            }`}
          >
            {f === 'all' ? `All (${data.decisions.length})` : `${f} (${data.decisions.filter(d => d.outcome === f).length})`}
          </button>
        ))}
      </div>

      <DataTable
        columns={columns}
        data={[...filtered].reverse()}
        rowKey={(d) => d.id}
        emptyMessage="No decisions to show"
        onRowClick={(d) => selectDecision(d)}
      />
    </div>
  );
}
