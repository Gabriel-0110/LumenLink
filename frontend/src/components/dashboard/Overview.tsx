import { useMemo } from 'react';
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  BarChart2,
  Target,
  ShieldOff,
  ShieldCheck,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';
import { useDashboardStore } from '../../store/dashboardStore';
import { PriceChart } from './PriceChart';
import { EquityChart } from './EquityChart';
import { FearGreedGauge } from './FearGreedGauge';
import { WeeklyPnlChart } from './WeeklyPnlChart';
import { WinLossDonut } from './WinLossDonut';
import { RiskMeters } from './RiskMeters';
import { PositionsCards } from './PositionsCards';
import { TradesTable } from './TradesTable';
import type { DashboardData } from '../../types/api';

// ── Helpers ──────────────────────────────────────────────────────

function fmtUsd(v: number): string {
  const sign = v >= 0 ? '+' : '';
  return `${sign}$${Math.abs(v).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtPrice(v: number): string {
  return `$${v.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function colorClass(v: number): string {
  return v >= 0 ? 'text-profit' : 'text-loss';
}

// ── Stat Card ────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: string;
  sub: string;
  accentColor: string;
  valueColor?: string;
  icon: React.ReactNode;
}

function StatCard({ label, value, sub, accentColor, valueColor, icon }: StatCardProps) {
  return (
    <div className="card">
      <div className="stat-accent" style={{ background: accentColor }} />
      <div className="flex items-start justify-between mb-2">
        <span className="card-label">{label}</span>
        <span className="text-muted">{icon}</span>
      </div>
      <div className="card-value" style={valueColor ? { color: valueColor } : undefined}>
        {value}
      </div>
      <div className="card-sub">{sub}</div>
    </div>
  );
}

// ── Overview Page ────────────────────────────────────────────────

export function Overview() {
  const data = useDashboardStore((s) => s.data);
  const error = useDashboardStore((s) => s.error);

  if (error && !data) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-56px)]">
        <div className="text-center">
          <ShieldOff size={48} className="mx-auto mb-4 text-loss" />
          <h2 className="text-lg font-bold text-text mb-2">Connection Error</h2>
          <p className="text-sm text-muted max-w-md">{error}</p>
          <p className="text-xs text-muted mt-3">
            Make sure the trading bot is running on port 8080
          </p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-56px)]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-brand border-t-transparent animate-spin" />
          <span className="text-sm text-muted">Loading dashboard...</span>
        </div>
      </div>
    );
  }

  return <OverviewContent data={data} />;
}

function OverviewContent({ data }: { data: DashboardData }) {
  const pnl = data.realizedPnlUsd + data.unrealizedPnlUsd;
  const today = data.today;
  const todayWinRate = today && today.totalTrades > 0 ? (today.wins / today.totalTrades) * 100 : 0;

  // Compute total wins/losses from weekly + today
  const stats = useMemo(() => {
    const wins = (data.weekly ?? []).reduce((s, w) => s + w.wins, 0) + (today?.wins ?? 0);
    const losses = (data.weekly ?? []).reduce((s, w) => s + w.losses, 0) + (today?.losses ?? 0);
    return { wins, losses };
  }, [data.weekly, today]);

  return (
    <div className="flex flex-col gap-5">
      {/* Row 1: Price Chart + Equity Curve + Fear & Greed */}
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_2fr_280px] gap-4">
        <PriceChart data={data} />
        <EquityChart data={data} />
        <FearGreedGauge sentiment={data.sentiment} />
      </div>

      {/* Row 2: Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard
          label="Daily P&L"
          value={fmtUsd(pnl)}
          sub={`limit: -$${data.risk.maxDailyLossUsd}`}
          accentColor="#10b981"
          valueColor={pnl >= 0 ? '#10b981' : '#ef4444'}
          icon={pnl >= 0 ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
        />
        <StatCard
          label="Portfolio Value"
          value={fmtPrice(data.totalEquityUsd)}
          sub={`cash: ${fmtPrice(data.cash)}`}
          accentColor="#3b82f6"
          icon={<DollarSign size={16} />}
        />
        <StatCard
          label="Unrealized P&L"
          value={fmtUsd(data.unrealizedPnlUsd)}
          sub={`${data.positions.length} open position(s)`}
          accentColor="#8b5cf6"
          valueColor={data.unrealizedPnlUsd >= 0 ? '#10b981' : '#ef4444'}
          icon={
            data.unrealizedPnlUsd >= 0 ? (
              <ArrowUpRight size={16} />
            ) : (
              <ArrowDownRight size={16} />
            )
          }
        />
        <StatCard
          label="Trades Today"
          value={String(today?.totalTrades ?? 0)}
          sub={`gross: ${fmtUsd(today?.grossProfitUsd ?? 0)}`}
          accentColor="#06b6d4"
          icon={<BarChart2 size={16} />}
        />
        <StatCard
          label="Win Rate"
          value={`${todayWinRate.toFixed(0)}%`}
          sub={`today / ${data.allTime.totalTrades} total`}
          accentColor="#f59e0b"
          valueColor={todayWinRate >= 50 ? '#10b981' : '#f59e0b'}
          icon={<Target size={16} />}
        />
        <StatCard
          label="Kill Switch"
          value={data.killSwitch ? 'ACTIVE' : 'OFF'}
          sub={
            data.lastCandleTime
              ? `last candle: ${new Date(data.lastCandleTime).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}`
              : 'no candle data'
          }
          accentColor="#ef4444"
          valueColor={data.killSwitch ? '#ef4444' : '#10b981'}
          icon={data.killSwitch ? <ShieldOff size={16} /> : <ShieldCheck size={16} />}
        />
      </div>

      {/* Row 3: 7-day P&L + Win/Loss Donut + Risk Meters */}
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr_1fr] gap-4">
        <WeeklyPnlChart weekly={data.weekly} />
        <WinLossDonut wins={stats.wins} losses={stats.losses} />
        <RiskMeters data={data} />
      </div>

      {/* Row 4: Open Positions */}
      <div>
        <div className="section-title">Open Positions</div>
        <PositionsCards positions={data.positions} />
      </div>

      {/* Row 5: Recent Trades */}
      <div>
        <div className="section-title">Recent Trades</div>
        <TradesTable trades={data.recentTrades} />
      </div>
    </div>
  );
}
