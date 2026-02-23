import { useMemo } from 'react';
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Target,
  Percent,
  ArrowDownRight,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { useDashboardStore } from '../../../store/dashboardStore';
import { StatCard } from '../../common';

function fmtUsd(v: number): string {
  const sign = v >= 0 ? '+' : '';
  return `${sign}$${Math.abs(v).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function ExecutionPerformance() {
  const data = useDashboardStore((s) => s.data);

  const stats = useMemo(() => {
    if (!data) return null;

    const today = data.today;
    const trades = data.recentTrades;

    // Compute from trades
    const exits = trades.filter((t) => t.action === 'exit' && t.realizedPnlUsd != null);
    const wins = exits.filter((t) => (t.realizedPnlUsd ?? 0) > 0);
    const losses = exits.filter((t) => (t.realizedPnlUsd ?? 0) <= 0);

    const totalWinPnl = wins.reduce((s, t) => s + (t.realizedPnlUsd ?? 0), 0);
    const totalLossPnl = losses.reduce((s, t) => s + (t.realizedPnlUsd ?? 0), 0);
    const avgWin = wins.length > 0 ? totalWinPnl / wins.length : 0;
    const avgLoss = losses.length > 0 ? Math.abs(totalLossPnl) / losses.length : 0;
    const winRate = exits.length > 0 ? (wins.length / exits.length) * 100 : 0;

    // Expectancy: (WinRate * AvgWin) - (LossRate * AvgLoss)
    const expectancy =
      exits.length > 0
        ? (wins.length / exits.length) * avgWin -
          (losses.length / exits.length) * avgLoss
        : 0;

    const totalFees = trades.reduce((s, t) => s + t.commissionUsd, 0);
    const grossPnl = data.realizedPnlUsd + totalFees;

    // P/L by symbol
    const pnlBySymbol: Record<string, number> = {};
    for (const t of exits) {
      const sym = t.symbol;
      pnlBySymbol[sym] = (pnlBySymbol[sym] ?? 0) + (t.realizedPnlUsd ?? 0);
    }

    const symbolData = Object.entries(pnlBySymbol).map(([symbol, pnl]) => ({
      symbol,
      pnl,
    }));

    return {
      realizedPnl: data.realizedPnlUsd,
      unrealizedPnl: data.unrealizedPnlUsd,
      grossPnl,
      netPnl: data.realizedPnlUsd,
      totalFees,
      totalTrades: today?.totalTrades ?? exits.length,
      winCount: wins.length,
      lossCount: losses.length,
      winRate,
      avgWin,
      avgLoss,
      expectancy,
      maxDrawdown: today?.maxDrawdownUsd ?? 0,
      symbolData,
    };
  }, [data]);

  if (!data || !stats) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 rounded-full border-2 border-brand border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-base font-bold flex items-center gap-2">
        <BarChart3 size={18} className="text-brand" />
        Session Performance
      </h2>

      {/* P/L Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard
          label="Realized P&L"
          value={fmtUsd(stats.realizedPnl)}
          sub="closed trades"
          accentColor="#10b981"
          valueColor={stats.realizedPnl >= 0 ? '#10b981' : '#ef4444'}
          icon={stats.realizedPnl >= 0 ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
        />
        <StatCard
          label="Unrealized P&L"
          value={fmtUsd(stats.unrealizedPnl)}
          sub="open positions"
          accentColor="#8b5cf6"
          valueColor={stats.unrealizedPnl >= 0 ? '#10b981' : '#ef4444'}
          icon={<DollarSign size={16} />}
        />
        <StatCard
          label="Total Fees"
          value={`$${stats.totalFees.toFixed(2)}`}
          sub={`${stats.totalTrades} trades`}
          accentColor="#f59e0b"
          icon={<Percent size={16} />}
        />
        <StatCard
          label="Win Rate"
          value={`${stats.winRate.toFixed(1)}%`}
          sub={`${stats.winCount}W / ${stats.lossCount}L`}
          accentColor="#06b6d4"
          valueColor={stats.winRate >= 50 ? '#10b981' : '#f59e0b'}
          icon={<Target size={16} />}
        />
        <StatCard
          label="Expectancy"
          value={fmtUsd(stats.expectancy)}
          sub="per trade"
          accentColor="#3b82f6"
          valueColor={stats.expectancy >= 0 ? '#10b981' : '#ef4444'}
          icon={<TrendingUp size={16} />}
        />
        <StatCard
          label="Max Drawdown"
          value={`$${stats.maxDrawdown.toFixed(2)}`}
          sub="session"
          accentColor="#ef4444"
          valueColor="#ef4444"
          icon={<ArrowDownRight size={16} />}
        />
      </div>

      {/* Avg Win / Avg Loss */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="card">
          <div className="section-title">Avg Win vs Avg Loss</div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-xs text-muted mb-1">Avg Win</div>
              <div className="text-xl font-bold text-profit">{fmtUsd(stats.avgWin)}</div>
            </div>
            <div>
              <div className="text-xs text-muted mb-1">Avg Loss</div>
              <div className="text-xl font-bold text-loss">-${stats.avgLoss.toFixed(2)}</div>
            </div>
          </div>
          {stats.avgLoss > 0 && (
            <div className="mt-3 text-xs text-muted">
              Risk/Reward: <span className="font-semibold text-text">{(stats.avgWin / stats.avgLoss).toFixed(2)}:1</span>
            </div>
          )}
        </div>

        <div className="card">
          <div className="section-title">Gross vs Net</div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-xs text-muted mb-1">Gross P&L</div>
              <div
                className="text-xl font-bold"
                style={{ color: stats.grossPnl >= 0 ? '#10b981' : '#ef4444' }}
              >
                {fmtUsd(stats.grossPnl)}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted mb-1">Net P&L</div>
              <div
                className="text-xl font-bold"
                style={{ color: stats.netPnl >= 0 ? '#10b981' : '#ef4444' }}
              >
                {fmtUsd(stats.netPnl)}
              </div>
            </div>
          </div>
          <div className="mt-3 text-xs text-muted">
            Fees: <span className="font-semibold text-warning">${stats.totalFees.toFixed(2)}</span>
          </div>
        </div>
      </div>

      {/* P/L by Symbol Chart */}
      {stats.symbolData.length > 0 && (
        <div className="card">
          <div className="section-title">P&L by Symbol</div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.symbolData} margin={{ top: 10, right: 10, bottom: 0, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e2d40" />
                <XAxis
                  dataKey="symbol"
                  tick={{ fill: '#64748b', fontSize: 11 }}
                  axisLine={{ stroke: '#1e2d40' }}
                />
                <YAxis
                  tick={{ fill: '#64748b', fontSize: 11 }}
                  axisLine={{ stroke: '#1e2d40' }}
                  tickFormatter={(v) => `$${v}`}
                />
                <Tooltip
                  contentStyle={{
                    background: '#111827',
                    border: '1px solid #1e2d40',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={(value: number) => [fmtUsd(value), 'P&L']}
                />
                <Bar dataKey="pnl" radius={[4, 4, 0, 0]}>
                  {stats.symbolData.map((entry, i) => (
                    <Cell key={i} fill={entry.pnl >= 0 ? '#10b981' : '#ef4444'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
