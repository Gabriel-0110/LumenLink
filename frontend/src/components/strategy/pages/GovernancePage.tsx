import { useEffect } from 'react';
import {
  Settings2,
  GitBranch,
  ToggleLeft,
  ToggleRight,
  Clock,
  User,
} from 'lucide-react';
import { useStrategyStore } from '../../../store/strategyStore';
import { StatusBadge } from '../../common';

const STAGE_LABELS: Record<string, string> = {
  shadow: 'Shadow (score only)',
  paper: 'Paper Trading',
  small_live: 'Small Live (25% size)',
  full_live: 'Full Live',
};

const STAGE_VARIANTS: Record<string, 'muted' | 'info' | 'warning' | 'success'> = {
  shadow: 'muted',
  paper: 'info',
  small_live: 'warning',
  full_live: 'success',
};

export function GovernancePage() {
  const data = useStrategyStore((s) => s.data);
  const fetchData = useStrategyStore((s) => s.fetchData);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  if (!data) return <div className="text-center text-muted py-12">Loading...</div>;

  const gov = data.status.governance;

  return (
    <div className="space-y-6">
      {/* Strategy Identity */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Settings2 size={20} className="text-brand" />
            <div>
              <h3 className="text-sm font-bold text-text">{gov.name}</h3>
              <span className="text-xs text-muted">Version {gov.version}</span>
            </div>
          </div>
          <StatusBadge
            label={STAGE_LABELS[gov.stage] ?? gov.stage}
            variant={STAGE_VARIANTS[gov.stage] ?? 'muted'}
            dot
          />
        </div>

        {/* Rollout Stage Pipeline */}
        <div className="mb-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
            Rollout Pipeline
          </h4>
          <div className="flex items-center gap-1">
            {(['shadow', 'paper', 'small_live', 'full_live'] as const).map((stage, i) => {
              const isCurrent = gov.stage === stage;
              const isPast = ['shadow', 'paper', 'small_live', 'full_live'].indexOf(gov.stage) >
                             ['shadow', 'paper', 'small_live', 'full_live'].indexOf(stage);
              return (
                <div key={stage} className="flex items-center gap-1 flex-1">
                  <div className={`flex-1 h-2 rounded-full ${
                    isCurrent ? 'bg-brand' : isPast ? 'bg-brand/40' : 'bg-border'
                  }`} />
                  {i < 3 && <div className="w-1" />}
                </div>
              );
            })}
          </div>
          <div className="flex justify-between mt-1">
            {(['shadow', 'paper', 'small_live', 'full_live'] as const).map((stage) => (
              <span key={stage} className={`text-[10px] ${
                gov.stage === stage ? 'text-brand font-semibold' : 'text-muted'
              }`}>
                {stage.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        </div>

        {/* Last Change */}
        <div className="flex items-center gap-4 text-xs text-muted bg-bg rounded-lg px-3 py-2">
          <div className="flex items-center gap-1.5">
            <User size={12} />
            <span>{gov.changedBy}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Clock size={12} />
            <span>{new Date(gov.updatedAt).toLocaleString()}</span>
          </div>
          <span className="text-text">{gov.changeReason}</span>
        </div>
      </div>

      {/* Feature Flags */}
      <div className="card">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted mb-3 flex items-center gap-2">
          <GitBranch size={14} />
          Feature Flags
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {Object.entries(gov.featureFlags).map(([flag, enabled]) => (
            <div key={flag} className="flex items-center justify-between bg-bg rounded-lg px-3 py-2">
              <span className="text-xs text-text capitalize">{flag.replace(/_/g, ' ')}</span>
              <div className="flex items-center gap-1.5">
                {enabled ? (
                  <ToggleRight size={18} className="text-profit" />
                ) : (
                  <ToggleLeft size={18} className="text-muted" />
                )}
                <span className={`text-xs ${enabled ? 'text-profit' : 'text-muted'}`}>
                  {enabled ? 'ON' : 'OFF'}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Parameters */}
      <div className="card">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">
          Strategy Parameters
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {Object.entries(gov.parameters).map(([key, value]) => (
            <div key={key} className="flex items-center justify-between bg-bg rounded-lg px-3 py-2">
              <span className="text-xs text-muted capitalize">{key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ')}</span>
              <span className="text-xs font-mono text-text">{String(value)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
