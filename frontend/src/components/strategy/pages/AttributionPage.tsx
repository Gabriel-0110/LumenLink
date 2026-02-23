import { useEffect } from 'react';
import { Trophy, TrendingUp, Shield, Brain } from 'lucide-react';
import { useStrategyStore } from '../../../store/strategyStore';
import { StatCard, DataTable, StatusBadge } from '../../common';
import type { Column } from '../../common/DataTable';
import type {
  PerformanceByRegime,
  BlockerLeaderboardEntry,
  AlphaModelPerf,
} from '../../../types/strategy';

export function AttributionPage() {
  const data = useStrategyStore((s) => s.data);
  const fetchData = useStrategyStore((s) => s.fetchData);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  if (!data) return <div className="text-center text-muted py-12">Loading...</div>;

  const { todayExpectancy, performanceByRegime, blockerLeaderboard, alphaPerformance } = data.status;

  return (
    <div className="space-y-6">
      {/* Today's Stats */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Today's Trades"
          value={String(todayExpectancy.trades)}
          accentColor="#6366f1"
          icon={<Trophy size={16} />}
        />
        <StatCard
          label="Win Rate"
          value={todayExpectancy.trades > 0 ? `${(todayExpectancy.winRate * 100).toFixed(0)}%` : '-'}
          accentColor="#10b981"
          icon={<TrendingUp size={16} />}
        />
        <StatCard
          label="Avg Edge"
          value={`${todayExpectancy.avgEdgeBps > 0 ? '+' : ''}${todayExpectancy.avgEdgeBps}bps`}
          accentColor={todayExpectancy.avgEdgeBps >= 0 ? '#10b981' : '#ef4444'}
          valueColor={todayExpectancy.avgEdgeBps >= 0 ? '#10b981' : '#ef4444'}
        />
        <StatCard
          label="Total Blockers"
          value={String(blockerLeaderboard.reduce((s, b) => s + b.count, 0))}
          sub="Trades prevented"
          accentColor="#f59e0b"
          icon={<Shield size={16} />}
        />
      </section>

      {/* P&L by Regime */}
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">
          Performance by Regime
        </h3>
        {performanceByRegime.length > 0 ? (
          <DataTable
            columns={regimeColumns}
            data={performanceByRegime}
            rowKey={(r) => r.regime}
            emptyMessage="No regime data"
          />
        ) : (
          <div className="card text-center text-muted py-8">
            No completed trades yet. Attribution data will appear after trades close.
          </div>
        )}
      </section>

      {/* Alpha Model Performance */}
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">
          Alpha Model Ranking
        </h3>
        {alphaPerformance.length > 0 ? (
          <DataTable
            columns={alphaColumns}
            data={alphaPerformance}
            rowKey={(r) => r.modelId}
            emptyMessage="No alpha data"
          />
        ) : (
          <div className="card text-center text-muted py-8">
            Alpha models will be ranked after trades execute.
          </div>
        )}
      </section>

      {/* Blocker Leaderboard */}
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">
          Blocker Leaderboard (what saved you money)
        </h3>
        {blockerLeaderboard.length > 0 ? (
          <DataTable
            columns={blockerColumns}
            data={blockerLeaderboard}
            rowKey={(r) => r.blocker}
            emptyMessage="No blockers"
          />
        ) : (
          <div className="card text-center text-muted py-8">
            Blocker data will appear as the strategy engine runs.
          </div>
        )}
      </section>
    </div>
  );
}

const regimeColumns: Column<PerformanceByRegime>[] = [
  {
    key: 'regime',
    header: 'Regime',
    render: (r) => (
      <StatusBadge
        label={r.regime.replace(/_/g, ' ')}
        variant={r.regime.includes('vol') ? 'danger' : 'info'}
      />
    ),
  },
  {
    key: 'trades',
    header: 'Trades',
    render: (r) => <span className="text-xs font-mono">{r.tradeCount}</span>,
    className: 'text-right',
  },
  {
    key: 'winRate',
    header: 'Win Rate',
    render: (r) => (
      <span className={`text-xs font-mono ${r.winRate >= 0.5 ? 'text-profit' : 'text-loss'}`}>
        {(r.winRate * 100).toFixed(0)}%
      </span>
    ),
    className: 'text-right',
  },
  {
    key: 'avgReturn',
    header: 'Avg Return',
    render: (r) => (
      <span className={`text-xs font-mono ${r.avgReturnBps >= 0 ? 'text-profit' : 'text-loss'}`}>
        {r.avgReturnBps > 0 ? '+' : ''}{r.avgReturnBps}bps
      </span>
    ),
    className: 'text-right',
  },
  {
    key: 'sharpe',
    header: 'Sharpe',
    render: (r) => <span className="text-xs font-mono">{r.sharpeRatio.toFixed(2)}</span>,
    className: 'text-right',
  },
  {
    key: 'maxDD',
    header: 'Max DD',
    render: (r) => (
      <span className="text-xs font-mono text-loss">
        {r.maxDrawdownPct > 0 ? `-${r.maxDrawdownPct.toFixed(1)}%` : '-'}
      </span>
    ),
    className: 'text-right',
  },
];

const alphaColumns: Column<AlphaModelPerf>[] = [
  {
    key: 'model',
    header: 'Model',
    render: (r) => (
      <span className="text-xs capitalize font-semibold">
        {r.modelId.replace(/_/g, ' ')}
      </span>
    ),
  },
  {
    key: 'avgContrib',
    header: 'Avg Contrib',
    render: (r) => (
      <span className={`text-xs font-mono ${r.avgContributionBps >= 0 ? 'text-profit' : 'text-loss'}`}>
        {r.avgContributionBps > 0 ? '+' : ''}{r.avgContributionBps}bps
      </span>
    ),
    className: 'text-right',
  },
  {
    key: 'dominant',
    header: 'Dominant',
    render: (r) => <span className="text-xs font-mono">{r.dominantCount}x</span>,
    className: 'text-right',
  },
  {
    key: 'trades',
    header: 'Trades',
    render: (r) => <span className="text-xs font-mono">{r.totalTrades}</span>,
    className: 'text-right',
  },
];

const blockerColumns: Column<BlockerLeaderboardEntry>[] = [
  {
    key: 'blocker',
    header: 'Blocker',
    render: (r) => <span className="text-xs font-semibold">{r.blocker}</span>,
  },
  {
    key: 'count',
    header: 'Count',
    render: (r) => <span className="text-xs font-mono">{r.count}</span>,
    className: 'text-right',
  },
  {
    key: 'saved',
    header: 'Est. Savings',
    render: (r) => (
      <span className="text-xs font-mono text-profit">
        {r.estimatedSavingsUsd > 0 ? `+$${r.estimatedSavingsUsd.toFixed(2)}` : '-'}
      </span>
    ),
    className: 'text-right',
  },
  {
    key: 'fp',
    header: 'False Pos',
    render: (r) => (
      <span className="text-xs font-mono text-warning">
        {r.falsePositives > 0 ? r.falsePositives : '-'}
      </span>
    ),
    className: 'text-right',
  },
];
