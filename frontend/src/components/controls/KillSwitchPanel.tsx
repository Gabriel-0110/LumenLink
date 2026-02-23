import { useState, useCallback } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  RotateCcw,
  Power,
  AlertTriangle,
  Clock,
  Activity,
  X,
} from 'lucide-react';
import { useDashboardStore } from '../../store/dashboardStore';
import { triggerKillSwitch, resetKillSwitch } from '../../services/api';

export function KillSwitchPanel() {
  const data = useDashboardStore((s) => s.data);
  const fetchData = useDashboardStore((s) => s.fetchData);

  const [showConfirmReset, setShowConfirmReset] = useState(false);
  const [showConfirmTrigger, setShowConfirmTrigger] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const isTriggered = data?.killSwitch ?? false;

  const handleReset = useCallback(async () => {
    setActionLoading(true);
    setActionError(null);
    try {
      await resetKillSwitch();
      await fetchData();
      setShowConfirmReset(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to reset kill switch');
    } finally {
      setActionLoading(false);
    }
  }, [fetchData]);

  const handleTrigger = useCallback(async () => {
    setActionLoading(true);
    setActionError(null);
    try {
      await triggerKillSwitch();
      await fetchData();
      setShowConfirmTrigger(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to trigger kill switch');
    } finally {
      setActionLoading(false);
    }
  }, [fetchData]);

  if (!data) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-56px)]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-brand border-t-transparent animate-spin" />
          <span className="text-sm text-muted">Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-bold text-text flex items-center gap-2">
          <ShieldAlert size={24} className="text-brand" />
          Risk Management
        </h1>
        <p className="text-sm text-muted mt-1">
          Kill switch controls and risk monitoring
        </p>
      </div>

      {/* Kill Switch Status Card */}
      <div
        className={`card border-2 ${
          isTriggered ? 'border-loss/40' : 'border-profit/20'
        }`}
      >
        <div className="flex items-center gap-4 mb-6">
          <div
            className={`w-14 h-14 rounded-xl flex items-center justify-center ${
              isTriggered ? 'bg-loss/10' : 'bg-profit/10'
            }`}
          >
            {isTriggered ? (
              <ShieldOff size={28} className="text-loss" />
            ) : (
              <ShieldCheck size={28} className="text-profit" />
            )}
          </div>
          <div>
            <div className="text-lg font-bold">
              Kill Switch:{' '}
              <span className={isTriggered ? 'text-loss' : 'text-profit'}>
                {isTriggered ? 'TRIGGERED' : 'SAFE'}
              </span>
            </div>
            <div className="text-sm text-muted">
              {isTriggered
                ? 'All trading is halted. Manual reset required.'
                : 'Trading is active. All systems operational.'}
            </div>
          </div>
        </div>

        {/* Action error */}
        {actionError && (
          <div className="flex items-center gap-2 p-3 mb-4 bg-loss/10 border border-loss/20 rounded-input text-sm text-loss">
            <AlertTriangle size={16} />
            {actionError}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex flex-wrap gap-3">
          {isTriggered ? (
            <>
              {!showConfirmReset ? (
                <button
                  onClick={() => setShowConfirmReset(true)}
                  className="btn-primary"
                  disabled={actionLoading}
                >
                  <RotateCcw size={16} />
                  Reset Kill Switch
                </button>
              ) : (
                <div className="flex items-center gap-2 p-3 bg-surface2 rounded-input border border-border">
                  <AlertTriangle size={16} className="text-warning shrink-0" />
                  <span className="text-sm">
                    Are you sure? This will resume trading.
                  </span>
                  <button
                    onClick={handleReset}
                    className="btn-primary text-xs px-3 py-1.5 min-h-[36px]"
                    disabled={actionLoading}
                  >
                    {actionLoading ? 'Resetting...' : 'Confirm Reset'}
                  </button>
                  <button
                    onClick={() => setShowConfirmReset(false)}
                    className="btn-ghost text-xs px-2 py-1.5 min-h-[36px]"
                  >
                    <X size={14} />
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              {!showConfirmTrigger ? (
                <button
                  onClick={() => setShowConfirmTrigger(true)}
                  className="btn-danger"
                  disabled={actionLoading}
                >
                  <Power size={16} />
                  Trigger Kill Switch
                </button>
              ) : (
                <div className="flex items-center gap-2 p-3 bg-surface2 rounded-input border border-border">
                  <AlertTriangle size={16} className="text-warning shrink-0" />
                  <span className="text-sm">
                    This will halt all trading immediately.
                  </span>
                  <button
                    onClick={handleTrigger}
                    className="btn-danger text-xs px-3 py-1.5 min-h-[36px]"
                    disabled={actionLoading}
                  >
                    {actionLoading ? 'Triggering...' : 'Confirm Trigger'}
                  </button>
                  <button
                    onClick={() => setShowConfirmTrigger(false)}
                    className="btn-ghost text-xs px-2 py-1.5 min-h-[36px]"
                  >
                    <X size={14} />
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Risk Configuration */}
      <div className="card">
        <div className="section-title">Risk Configuration</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <RiskItem
            label="Max Daily Loss"
            value={`$${data.risk.maxDailyLossUsd}`}
            icon={<Activity size={14} />}
          />
          <RiskItem
            label="Max Position"
            value={`$${data.risk.maxPositionUsd}`}
            icon={<Activity size={14} />}
          />
          <RiskItem
            label="Max Open Positions"
            value={String(data.risk.maxOpenPositions)}
            icon={<Activity size={14} />}
          />
          <RiskItem
            label="Cooldown"
            value={`${data.risk.cooldownMinutes}m`}
            icon={<Clock size={14} />}
          />
        </div>
      </div>

      {/* Current Risk Status */}
      <div className="card">
        <div className="section-title">Current Risk Status</div>
        <div className="space-y-4">
          {/* Daily P&L meter */}
          <RiskMeter
            label="Daily P&L vs Limit"
            current={Math.abs(Math.min(0, data.risk.dailyPnlEstimate))}
            max={data.risk.maxDailyLossUsd}
            formatValue={(v) => `$${v.toFixed(2)}`}
            dangerThreshold={0.7}
          />

          {/* Position count meter */}
          <RiskMeter
            label="Open Positions"
            current={data.positions.length}
            max={data.risk.maxOpenPositions}
            formatValue={(v) => String(Math.round(v))}
            dangerThreshold={0.8}
          />
        </div>
      </div>

      {/* System info */}
      <div className="card">
        <div className="section-title">System Information</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
          <InfoItem label="Mode" value={data.mode.toUpperCase()} />
          <InfoItem label="Exchange" value={data.exchange.toUpperCase()} />
          <InfoItem label="Strategy" value={data.strategy.replace(/_/g, ' ')} />
          <InfoItem label="Symbols" value={data.symbols.join(', ')} />
          <InfoItem label="Interval" value={data.interval} />
          <InfoItem label="Total Trades" value={String(data.allTime.totalTrades)} />
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────

function RiskItem({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="bg-surface2 rounded-input p-3 border border-border">
      <div className="flex items-center gap-1.5 text-[0.66rem] uppercase tracking-wider text-muted mb-1">
        {icon}
        {label}
      </div>
      <div className="text-base font-bold">{value}</div>
    </div>
  );
}

function RiskMeter({
  label,
  current,
  max,
  formatValue,
  dangerThreshold,
}: {
  label: string;
  current: number;
  max: number;
  formatValue: (v: number) => string;
  dangerThreshold: number;
}) {
  const ratio = max > 0 ? current / max : 0;
  const pct = Math.min(100, ratio * 100);
  const color =
    ratio >= dangerThreshold ? '#ef4444' : ratio >= 0.4 ? '#f59e0b' : '#10b981';

  return (
    <div>
      <div className="flex justify-between text-xs mb-1.5">
        <span className="text-muted">{label}</span>
        <span style={{ color }}>
          {formatValue(current)} / {formatValue(max)}
        </span>
      </div>
      <div className="meter-bar h-2">
        <div
          className="meter-fill"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[0.66rem] uppercase tracking-wider text-muted">{label}</div>
      <div className="font-semibold mt-0.5">{value}</div>
    </div>
  );
}
