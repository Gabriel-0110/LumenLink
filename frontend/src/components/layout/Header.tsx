import { Wifi, WifiOff, Clock, Activity } from 'lucide-react';
import { useDashboardStore } from '../../store/dashboardStore';

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function Header() {
  const data = useDashboardStore((s) => s.data);
  const countdown = useDashboardStore((s) => s.countdown);
  const isLoading = useDashboardStore((s) => s.isLoading);

  const mode = data?.mode ?? 'paper';
  const exchange = data?.exchange ?? '';
  const strategy = data?.strategy ?? '';
  const symbols = data?.symbols ?? [];
  const uptime = data?.uptimeSec ?? 0;

  return (
    <header className="flex items-center gap-3 px-5 h-[56px] bg-surface border-b border-border sticky top-0 z-50">
      {/* Mode badge */}
      <span
        className={`
          inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full
          text-[0.7rem] font-bold border
          ${
            mode === 'live'
              ? 'text-loss border-loss/40 bg-loss/10'
              : 'text-brand border-brand/40 bg-brand/10'
          }
        `}
      >
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            mode === 'live' ? 'bg-loss animate-pulse-dot' : 'bg-brand'
          }`}
        />
        {mode.toUpperCase()}
      </span>

      {/* Exchange */}
      <span className="text-xs text-muted font-medium uppercase">{exchange}</span>

      {/* Strategy */}
      <span className="text-xs text-brand font-medium">{strategy.replace(/_/g, ' ')}</span>

      {/* Symbols */}
      <span className="text-xs text-muted">{symbols.join(', ')}</span>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Connection status */}
      <div className="flex items-center gap-4 text-xs text-muted">
        {/* Refresh indicator */}
        <div className="flex items-center gap-1.5">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              isLoading ? 'bg-warning animate-pulse' : 'bg-profit animate-pulse-dot'
            }`}
          />
          <span>
            {isLoading ? 'Fetching...' : `Refresh in ${countdown}s`}
          </span>
        </div>

        {/* Activity */}
        <div className="flex items-center gap-1.5">
          <Activity size={14} className="text-muted" />
          <span>{data?.metricsSnap?.counters?.['market_data_poll_success'] ?? 0} polls</span>
        </div>

        {/* Uptime */}
        <div className="flex items-center gap-1.5">
          <Clock size={14} className="text-muted" />
          <span>{formatUptime(uptime)}</span>
        </div>

        {/* WebSocket indicator */}
        <div className="flex items-center gap-1.5" title="WebSocket connection">
          {data ? (
            <Wifi size={14} className="text-profit" />
          ) : (
            <WifiOff size={14} className="text-loss" />
          )}
        </div>
      </div>
    </header>
  );
}
