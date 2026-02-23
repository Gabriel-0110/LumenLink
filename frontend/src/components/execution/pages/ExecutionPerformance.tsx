import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Target,
  Percent,
  ArrowDownRight,
  RefreshCw,
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
import { StatCard, FilterBar } from '../../common';
import type { Trade, DailySummary } from '../../../types/api';

type Timeframe = 'today' | 'recent50' | '7d';

function fmtUsd(v: number): string {
  const sign = v >= 0 ? '+' : '';
  return `${sign}$${Math.abs(v).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

interface WeeklyData {
  days: DailySummary[];
  aggregate: {
    totalTrades: number;
    totalPnlUsd: number;
    totalFeesUsd: number;
    wins: number;
    losses: number;
    winRate: number;
    avgDailyPnl: number;
  };
}

export function ExecutionPerformance() {
  const data = useDashboardStore((s) => s.data);
  const [timeframe, setTimeframe] = useState<Timeframe>('today');
  const [weeklyData, setWeeklyData] = useState<WeeklyData | null>(null);
  const [weeklyLoading, setWeeklyLoading] = useState(false);

  const loadWeekly = useCallback(async () => {
    setWeeklyLoading(true);
    try {
      const res = await fetch('/api/reports/weekly');
      if (res.ok) setWeeklyData(await res.json());
    } catch { /* ignore */ }
    setWeeklyLoading(false);
  }, []);

  useEffect(() => {
    if (timeframe === '7d' && !weeklyData) loadWeekly();
  }, [timeframe, weeklyData, loadWeekly]);

  const stats = useMemo(() => {
    if (!data) return null;

    if (timeframe === '7d' && weeklyData) {
      const agg = weeklyData.aggregate;
      const symbolPnl: Record<string, number> = {};
      // We don't have per-symbol breakdown from weekly, but we can compute from recent trades
      for (const t of data.recentTrades.filter(t => t.action === 'exit' && t.realizedPnlUsd != null)) {
        symbolPnl[t.symbol] = (symbolPnl[t.symbol] ?? 0) + (t.realizedPnlUsd ?? 0);
      }
      return {
        label: 'Last 7 Days',
        realizedPnl: agg.totalPnlUsd,
        unrealizedPnl: data.unrealizedPnlUsd,
        grossPnl: agg.totalPnlUsd + agg.totalFeesUsd,
        netPnl: agg.totalPnlUsd,
        totalFees: agg.totalFeesUsd,
        totalTrades: agg.totalTrades,
        winCount: agg.wins,
        lossCount: agg.losses,
        winRate: agg.winRate,
        avgWin: agg.wins > 0 ? (agg.totalPnlUsd > 0 ? agg.totalPnlUsd / agg.wins : 0) : 0,
        avgLoss: agg.losses > 0 ? Math.abs(agg.totalPnlUsd < 0 ? agg.totalPnlUsd / agg.losses : 0) : 0,
        expectancy: agg.totalTrades > 0 ? agg.totalPnlUsd / agg.totalTrades : 0,
        maxDrawdown: 0, // not available in weekly aggregate
        symbolData: Object.entries(symbolPnl).map(([symbol, pnl]) => ({ symbol, pnl })),
      };
    }

    const today = data.today;
    const trades = data.recentTrades;

    // Filter by timeframe
    let filteredTrades: Trade[];
    let label: string;

    if (timeframe === 'today') {
      const todayStr = new Date().toISOString().slice(0, 10);
      filteredTrades = trades.filter(t => new Date(t.timestamp).toISOString().slice(0, 10) === todayStr);
      label = 'Today';
    } else {
      filteredTrades = trades;
      label = `Last ${trades.length} Trades`;
    }

    const exits = filteredTrades.filter((t) => t.action === 'exit' && t.realizedPnlUsd != null);
    const wins = exits.filter((t) => (t.realizedPnlUsd ?? 0) > 0);
    const losses = exits.filter((t) => (t.realizedPnlUsd ?? 0) <= 0);

    const totalWinPnl = wins.reduce((s, t) => s + (t.realizedPnlUsd ?? 0), 0);
    const totalLossPnl = losses.reduce((s, t) => s + (t.realizedPnlUsd ?? 0), 0);
    const avgWin = wins.length > 0 ? totalWinPnl / wins.length : 0;
    const avgLoss = losses.length > 0 ? Math.abs(totalLossPnl) / losses.length : 0;
    const winRate = exits.length > 0 ? (wins.length / exits.length) * 100 : 0;

    const expectancy =
      exits.length > 0
        ? (wins.length / exits.length) * avgWin -
          (losses.length / exits.length) * avgLoss
        : 0;

    const totalFees = filteredTrades.reduce((s, t) => s + t.commissionUsd, 0);
    const realizedPnl = timeframe === 'today' ? (today?.netPnlUsd ?? 0) : data.realizedPnlUsd;
    const grossPnl = realizedPnl + totalFees;

    const pnlBySymbol: Record<string, number> = {};
    for (const t of exits) {
      pnlBySymbol[t.symbol] = (pnlBySymbol[t.symbol] ?? 0) + (t.realizedPnlUsd ?? 0);
    }

    return {
      label,
      realizedPnl,
      unrealizedPnl: data.unrealizedPnlUsd,
      grossPnl,
      netPnl: realizedPnl,
      totalFees,
      totalTrades: timeframe === 'today' ? (today?.totalTrades ?? exits.length) : exits.length,
      winCount: wins.length,
      lossCount: losses.length,
      winRate,
      avgWin,
      avgLoss,
      expectancy,
      maxDrawdown: timeframe === 'today' ? (today?.maxDrawdownUsd ?? 0) : 0,
      symbolData: Object.entries(pnlBySymbol).map(([symbol, pnl]) => ({ symbol, pnl })),
    };
  }, [data, timeframe, weeklyData]);

  if (!data || !stats) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 rounded-full border-2 border-brand border-t-transparent animate-spin" />
      </div>
    );
  }

  const timeframeOptions = [
    { label: 'Today', value: 'today' },
    { label: 'Recent Trades', value: 'recent50' },
    { label: '7 Day', value: '7d' },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-base font-bold flex items-center gap-2">
          <BarChart3 size={18} className="text-brand" />
          Performance
          <span className="text-xs font-normal text-muted ml-1">({stats.label})</span>
        </h2>
        <FilterBar
          options={timeframeOptions}
          selected={timeframe}
          onChange={(v) => setTimeframe(v as Timeframe)}
        />
      </div>

      {weeklyLoading && timeframe === '7d' && (
        <div className="flex items-center gap-2 text-xs text-muted">
          <RefreshCw size={12} className="animate-spin" /> Loading weekly data...
        </div>
      )}

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
          sub={stats.label.toLowerCase()}
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
