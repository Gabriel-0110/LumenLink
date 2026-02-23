import {
  ShieldCheck,
  ShieldOff,
  Layers,
  TrendingUp,
  TrendingDown,
  Clock,
} from 'lucide-react';
import { useDashboardStore } from '../../store/dashboardStore';
import { StatusBadge } from '../common';

function fmtUsd(v: number): string {
  const sign = v >= 0 ? '+' : '';
  return `${sign}$${Math.abs(v).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function ExecutionStatusBar() {
  const data = useDashboardStore((s) => s.data);
  const isLoading = useDashboardStore((s) => s.isLoading);

  if (!data) return null;

  const totalPnl = data.realizedPnlUsd + data.unrealizedPnlUsd;
  const isProfit = totalPnl >= 0;

  return (
    <div className="flex items-center gap-4 px-5 h-12 bg-surface2 border-b border-border shrink-0 overflow-x-auto">
      {/* Mode */}
      <StatusBadge
        label={data.mode.toUpperCase()}
        variant={data.mode === 'live' ? 'danger' : 'info'}
        dot
      />

      {/* Kill switch */}
      <div className="flex items-center gap-1.5 text-xs">
        {data.killSwitch ? (
          <>
            <ShieldOff size={14} className="text-loss" />
            <span className="text-loss font-bold">HALTED</span>
          </>
        ) : (
          <>
            <ShieldCheck size={14} className="text-profit" />
            <span className="text-muted">Safe</span>
          </>
        )}
      </div>

      <div className="w-px h-5 bg-border" />

      {/* Open positions */}
      <div className="flex items-center gap-1.5 text-xs text-muted">
        <Layers size={14} />
        <span>
          <span className="font-semibold text-text">{data.positions.length}</span> open
        </span>
      </div>

      <div className="w-px h-5 bg-border" />

      {/* Session P/L */}
      <div className="flex items-center gap-1.5 text-xs">
        {isProfit ? (
          <TrendingUp size={14} className="text-profit" />
        ) : (
          <TrendingDown size={14} className="text-loss" />
        )}
        <span className="font-semibold" style={{ color: isProfit ? '#10b981' : '#ef4444' }}>
          {fmtUsd(totalPnl)}
        </span>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Last update */}
      <div className="flex items-center gap-1.5 text-xs text-muted">
        <Clock size={12} />
        {isLoading ? (
          <span className="text-brand">Fetching...</span>
        ) : (
          <span>
            {data.lastCandleTime
              ? new Date(data.lastCandleTime).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })
              : 'No data'}
          </span>
        )}
      </div>
    </div>
  );
}
