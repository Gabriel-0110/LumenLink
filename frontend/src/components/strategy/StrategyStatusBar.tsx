import {
  Brain,
  Activity,
  Shield,
  Zap,
  Clock,
} from 'lucide-react';
import { useStrategyStore } from '../../store/strategyStore';
import { StatusBadge } from '../common';

const OVERLAY_VARIANTS = {
  normal: 'success',
  reduced: 'warning',
  no_new_entries: 'danger',
  flatten_only: 'danger',
} as const;

const STAGE_VARIANTS = {
  shadow: 'muted',
  paper: 'info',
  small_live: 'warning',
  full_live: 'success',
} as const;

export function StrategyStatusBar() {
  const data = useStrategyStore((s) => s.data);
  const isLoading = useStrategyStore((s) => s.isLoading);

  if (!data) return null;

  const { governance, todayExpectancy } = data.status;

  // Find the latest overlay mode from recent decisions
  const latestDecision = data.decisions[data.decisions.length - 1];
  const overlayMode = latestDecision?.overlay.mode ?? 'normal';

  return (
    <div className="flex items-center gap-4 px-5 h-12 bg-surface2 border-b border-border shrink-0 overflow-x-auto">
      {/* Stage */}
      <StatusBadge
        label={governance.stage.replace('_', ' ').toUpperCase()}
        variant={STAGE_VARIANTS[governance.stage]}
        dot
      />

      {/* Version */}
      <div className="flex items-center gap-1.5 text-xs text-muted">
        <Brain size={14} />
        <span>v{governance.version}</span>
      </div>

      <div className="w-px h-5 bg-border" />

      {/* Overlay mode */}
      <div className="flex items-center gap-1.5 text-xs">
        <Shield size={14} className={overlayMode === 'normal' ? 'text-profit' : 'text-warning'} />
        <StatusBadge
          label={overlayMode.replace(/_/g, ' ')}
          variant={OVERLAY_VARIANTS[overlayMode]}
        />
      </div>

      <div className="w-px h-5 bg-border" />

      {/* Today's stats */}
      <div className="flex items-center gap-1.5 text-xs text-muted">
        <Zap size={14} />
        <span>
          <span className="font-semibold text-text">{todayExpectancy.trades}</span> trades
        </span>
        {todayExpectancy.trades > 0 && (
          <span className={todayExpectancy.avgEdgeBps >= 0 ? 'text-profit' : 'text-loss'}>
            ({todayExpectancy.avgEdgeBps > 0 ? '+' : ''}{todayExpectancy.avgEdgeBps}bps avg)
          </span>
        )}
      </div>

      <div className="w-px h-5 bg-border" />

      {/* Cycle count */}
      <div className="flex items-center gap-1.5 text-xs text-muted">
        <Activity size={14} />
        <span>{data.status.cycleCount} cycles</span>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Loading indicator */}
      <div className="flex items-center gap-1.5 text-xs text-muted">
        <Clock size={12} />
        {isLoading ? (
          <span className="text-brand">Fetching...</span>
        ) : (
          <span>
            {latestDecision
              ? new Date(latestDecision.timestamp).toLocaleTimeString([], {
                  hour: '2-digit', minute: '2-digit', second: '2-digit',
                })
              : 'No data'}
          </span>
        )}
      </div>
    </div>
  );
}
