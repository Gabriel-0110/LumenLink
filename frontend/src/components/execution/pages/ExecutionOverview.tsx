import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Layers,
  ClipboardList,
  Target,
  ShieldOff,
  ShieldCheck,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';
import { useDashboardStore } from '../../../store/dashboardStore';
import { StatCard, DataTable, StatusBadge } from '../../common';
import type { Column } from '../../common';
import type { Position } from '../../../types/api';

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

function fmtPct(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

const positionColumns: Column<Position>[] = [
  {
    key: 'symbol',
    header: 'Symbol',
    render: (row) => <span className="font-semibold">{row.symbol}</span>,
  },
  {
    key: 'qty',
    header: 'Qty',
    render: (row) => <span className="text-xs">{row.quantity.toFixed(6)}</span>,
    className: 'text-right',
  },
  {
    key: 'entry',
    header: 'Entry',
    render: (row) => fmtPrice(row.avgEntryPrice),
    className: 'text-right',
  },
  {
    key: 'mark',
    header: 'Mark',
    render: (row) => fmtPrice(row.marketPrice),
    className: 'text-right',
  },
  {
    key: 'value',
    header: 'Value',
    render: (row) => fmtPrice(row.valueUsd),
    className: 'text-right',
  },
  {
    key: 'pnl',
    header: 'Unrealized P&L',
    render: (row) => {
      const isProfit = row.unrealizedPnlUsd >= 0;
      return (
        <span className="font-semibold" style={{ color: isProfit ? '#10b981' : '#ef4444' }}>
          {fmtUsd(row.unrealizedPnlUsd)} ({fmtPct(row.unrealizedPnlPct)})
        </span>
      );
    },
    className: 'text-right',
  },
];

export function ExecutionOverview() {
  const data = useDashboardStore((s) => s.data);

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-brand border-t-transparent animate-spin" />
          <span className="text-sm text-muted">Loading...</span>
        </div>
      </div>
    );
  }

  const totalPnl = data.realizedPnlUsd + data.unrealizedPnlUsd;
  const today = data.today;
  const todayWinRate = today && today.totalTrades > 0 ? (today.wins / today.totalTrades) * 100 : 0;

  return (
    <div className="flex flex-col gap-5">
      {/* Session info */}
      <div className="flex items-center gap-3 flex-wrap">
        <StatusBadge
          label={data.mode === 'live' ? 'LIVE SESSION' : 'PAPER SESSION'}
          variant={data.mode === 'live' ? 'danger' : 'info'}
          dot
        />
        <StatusBadge label={data.exchange.toUpperCase()} variant="muted" />
        <StatusBadge label={data.strategy.replace(/_/g, ' ')} variant="muted" />
        {data.symbols.map((s) => (
          <StatusBadge key={s} label={s} variant="info" />
        ))}
      </div>

      {/* Stat cards row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard
          label="Session P&L"
          value={fmtUsd(totalPnl)}
          sub={`realized: ${fmtUsd(data.realizedPnlUsd)}`}
          accentColor="#10b981"
          valueColor={totalPnl >= 0 ? '#10b981' : '#ef4444'}
          icon={totalPnl >= 0 ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
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
          label="Portfolio Value"
          value={fmtPrice(data.totalEquityUsd)}
          sub={`cash: ${fmtPrice(data.cash)}`}
          accentColor="#3b82f6"
          icon={<DollarSign size={16} />}
        />
        <StatCard
          label="Open Positions"
          value={String(data.positions.length)}
          sub={`max: ${data.risk.maxOpenPositions}`}
          accentColor="#06b6d4"
          icon={<Layers size={16} />}
        />
        <StatCard
          label="Trades Today"
          value={String(today?.totalTrades ?? 0)}
          sub={`win rate: ${todayWinRate.toFixed(0)}%`}
          accentColor="#f59e0b"
          icon={<Target size={16} />}
        />
        <StatCard
          label="Kill Switch"
          value={data.killSwitch ? 'HALTED' : 'SAFE'}
          sub={data.killSwitch ? 'Trading stopped' : 'All systems go'}
          accentColor="#ef4444"
          valueColor={data.killSwitch ? '#ef4444' : '#10b981'}
          icon={data.killSwitch ? <ShieldOff size={16} /> : <ShieldCheck size={16} />}
        />
      </div>

      {/* Active orders */}
      <div>
        <div className="section-title">
          <ClipboardList size={14} />
          Active Orders
        </div>
        <div className="card">
          <div className="flex items-center gap-3">
            <span className="text-2xl font-bold">{data.recentTrades.filter((t) => t.action === 'entry').length}</span>
            <span className="text-sm text-muted">pending entries in recent trades</span>
          </div>
        </div>
      </div>

      {/* Open positions table */}
      <div>
        <div className="section-title">
          <Layers size={14} />
          Open Positions
        </div>
        <DataTable
          columns={positionColumns}
          data={data.positions}
          rowKey={(row) => row.symbol}
          emptyMessage="No open positions"
        />
      </div>
    </div>
  );
}
