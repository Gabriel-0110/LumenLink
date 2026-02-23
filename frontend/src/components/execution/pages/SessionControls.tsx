import { useState, useCallback, useEffect } from 'react';
import {
  SlidersHorizontal,
  ShieldCheck,
  ShieldOff,
  RotateCcw,
  Power,
  AlertTriangle,
  Pause,
  Play,
  XCircle,
  Layers,
  Clock,
  Timer,
  Activity,
  DollarSign,
  Hash,
  Percent,
} from 'lucide-react';
import { useDashboardStore } from '../../../store/dashboardStore';
import {
  triggerKillSwitch,
  resetKillSwitch,
  fetchConfig,
  updateConfig,
  closePosition,
  cancelAllOrders,
  pauseSession,
  resumeSession,
} from '../../../services/api';
import { ConfirmDialog } from '../../common';

interface RiskOverride {
  key: string;
  label: string;
  icon: React.ReactNode;
  currentValue: number | string;
  unit: string;
  configKey: string;
}

export function SessionControls() {
  const data = useDashboardStore((s) => s.data);
  const fetchData = useDashboardStore((s) => s.fetchData);

  const [showConfirmReset, setShowConfirmReset] = useState(false);
  const [showConfirmTrigger, setShowConfirmTrigger] = useState(false);
  const [showConfirmFlatten, setShowConfirmFlatten] = useState(false);
  const [showConfirmCancelAll, setShowConfirmCancelAll] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Config editing state
  const [configValues, setConfigValues] = useState<Record<string, string>>({});
  const [configLoading, setConfigLoading] = useState(false);

  const isTriggered = data?.killSwitch ?? false;

  // Load current config
  useEffect(() => {
    fetchConfig()
      .then((config) => {
        setConfigValues({
          'risk.maxDailyLossUsd': String(config.risk?.maxDailyLossUsd ?? ''),
          'risk.maxPositionUsd': String(config.risk?.maxPositionUsd ?? ''),
          'risk.maxOpenPositions': String(config.risk?.maxOpenPositions ?? ''),
          'risk.cooldownMinutes': String(config.risk?.cooldownMinutes ?? ''),
          'risk.deployPercent': String(config.risk?.deployPercent ?? ''),
          'strategyIntervalMs': String(Math.round((config.strategyIntervalMs ?? 300000) / 1000)),
        });
      })
      .catch(() => {
        // Config fetch failed, use dashboard data as fallback
        if (data) {
          setConfigValues({
            'risk.maxDailyLossUsd': String(data.risk.maxDailyLossUsd),
            'risk.maxPositionUsd': String(data.risk.maxPositionUsd),
            'risk.maxOpenPositions': String(data.risk.maxOpenPositions),
            'risk.cooldownMinutes': String(data.risk.cooldownMinutes),
          });
        }
      });
  }, [data]);

  const clearMessages = () => {
    setActionError(null);
    setActionSuccess(null);
  };

  const handleReset = useCallback(async () => {
    setActionLoading('reset');
    clearMessages();
    try {
      await resetKillSwitch();
      await fetchData();
      setShowConfirmReset(false);
      setActionSuccess('Kill switch reset successfully');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to reset kill switch');
    } finally {
      setActionLoading(null);
    }
  }, [fetchData]);

  const handleTrigger = useCallback(async () => {
    setActionLoading('trigger');
    clearMessages();
    try {
      await triggerKillSwitch();
      await fetchData();
      setShowConfirmTrigger(false);
      setActionSuccess('Kill switch triggered — all trading halted');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to trigger kill switch');
    } finally {
      setActionLoading(null);
    }
  }, [fetchData]);

  const handleConfigSave = useCallback(
    async (key: string, value: string) => {
      setConfigLoading(true);
      clearMessages();
      try {
        const numValue = Number(value);
        if (isNaN(numValue) || numValue <= 0) throw new Error('Invalid number');
        // UI shows seconds for interval fields, API expects milliseconds
        const apiValue = key === 'strategyIntervalMs' ? numValue * 1000 : numValue;
        await updateConfig({ [key]: apiValue });
        await fetchData();
        setActionSuccess(`Updated ${key.replace('risk.', '')}`);
      } catch (err) {
        setActionError(err instanceof Error ? err.message : `Failed to update ${key}`);
      } finally {
        setConfigLoading(false);
      }
    },
    [fetchData],
  );

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 rounded-full border-2 border-brand border-t-transparent animate-spin" />
      </div>
    );
  }

  const riskOverrides: RiskOverride[] = [
    {
      key: 'maxDailyLoss',
      label: 'Max Daily Loss',
      icon: <DollarSign size={14} />,
      currentValue: data.risk.maxDailyLossUsd,
      unit: 'USD',
      configKey: 'risk.maxDailyLossUsd',
    },
    {
      key: 'maxPosition',
      label: 'Max Position Size',
      icon: <DollarSign size={14} />,
      currentValue: data.risk.maxPositionUsd,
      unit: 'USD',
      configKey: 'risk.maxPositionUsd',
    },
    {
      key: 'maxOpenPositions',
      label: 'Max Open Positions',
      icon: <Hash size={14} />,
      currentValue: data.risk.maxOpenPositions,
      unit: '',
      configKey: 'risk.maxOpenPositions',
    },
    {
      key: 'cooldown',
      label: 'Cooldown',
      icon: <Clock size={14} />,
      currentValue: data.risk.cooldownMinutes,
      unit: 'min',
      configKey: 'risk.cooldownMinutes',
    },
    {
      key: 'strategyInterval',
      label: 'Strategy Interval',
      icon: <Timer size={14} />,
      currentValue: configValues['strategyIntervalMs'] ?? '300',
      unit: 'sec',
      configKey: 'strategyIntervalMs',
    },
  ];

  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-5">
      {/* Page header */}
      <div>
        <h2 className="text-base font-bold flex items-center gap-2">
          <SlidersHorizontal size={18} className="text-brand" />
          Session Controls
        </h2>
        <p className="text-xs text-muted mt-1">
          Emergency controls, session overrides, and risk parameter adjustments
        </p>
      </div>

      {/* Status messages */}
      {actionError && (
        <div className="flex items-center gap-2 p-3 bg-loss/10 border border-loss/20 rounded-input text-sm text-loss">
          <AlertTriangle size={16} />
          {actionError}
        </div>
      )}
      {actionSuccess && (
        <div className="flex items-center gap-2 p-3 bg-profit/10 border border-profit/20 rounded-input text-sm text-profit">
          <ShieldCheck size={16} />
          {actionSuccess}
        </div>
      )}

      {/* Kill Switch Card */}
      <div
        className={`card border-2 ${
          isTriggered ? 'border-loss/40' : 'border-profit/20'
        }`}
      >
        <div className="flex items-center gap-4 mb-4">
          <div
            className={`w-12 h-12 rounded-xl flex items-center justify-center ${
              isTriggered ? 'bg-loss/10' : 'bg-profit/10'
            }`}
          >
            {isTriggered ? (
              <ShieldOff size={24} className="text-loss" />
            ) : (
              <ShieldCheck size={24} className="text-profit" />
            )}
          </div>
          <div>
            <div className="text-base font-bold">
              Kill Switch:{' '}
              <span className={isTriggered ? 'text-loss' : 'text-profit'}>
                {isTriggered ? 'TRIGGERED' : 'SAFE'}
              </span>
            </div>
            <div className="text-xs text-muted">
              {isTriggered
                ? 'All trading is halted. Manual reset required.'
                : 'Trading is active. All systems operational.'}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          {isTriggered ? (
            <>
              {!showConfirmReset ? (
                <button
                  onClick={() => { clearMessages(); setShowConfirmReset(true); }}
                  className="btn-primary"
                  disabled={actionLoading !== null}
                >
                  <RotateCcw size={16} />
                  Reset Kill Switch
                </button>
              ) : (
                <ConfirmDialog
                  open
                  message="Are you sure? This will resume trading."
                  confirmLabel={actionLoading === 'reset' ? 'Resetting...' : 'Confirm Reset'}
                  confirmVariant="primary"
                  loading={actionLoading === 'reset'}
                  onConfirm={handleReset}
                  onCancel={() => setShowConfirmReset(false)}
                />
              )}
            </>
          ) : (
            <>
              {!showConfirmTrigger ? (
                <button
                  onClick={() => { clearMessages(); setShowConfirmTrigger(true); }}
                  className="btn-danger"
                  disabled={actionLoading !== null}
                >
                  <Power size={16} />
                  Trigger Kill Switch
                </button>
              ) : (
                <ConfirmDialog
                  open
                  message="This will halt all trading immediately."
                  confirmLabel={actionLoading === 'trigger' ? 'Triggering...' : 'Confirm Trigger'}
                  confirmVariant="danger"
                  loading={actionLoading === 'trigger'}
                  onConfirm={handleTrigger}
                  onCancel={() => setShowConfirmTrigger(false)}
                />
              )}
            </>
          )}
        </div>
      </div>

      {/* Session Actions */}
      <div className="card">
        <div className="section-title">Session Actions</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Flatten all */}
          <div className="bg-surface2 rounded-input p-4 border border-border">
            <div className="flex items-center gap-2 mb-2">
              <Layers size={16} className="text-warning" />
              <span className="text-sm font-semibold">Flatten All Positions</span>
            </div>
            <p className="text-xs text-muted mb-3">
              Market-sell all open positions. {data.positions.length} position(s) open.
            </p>
            {!showConfirmFlatten ? (
              <button
                onClick={() => { clearMessages(); setShowConfirmFlatten(true); }}
                className="btn-danger text-xs"
                disabled={data.positions.length === 0 || actionLoading !== null}
              >
                <XCircle size={14} />
                Flatten All
              </button>
            ) : (
              <ConfirmDialog
                open
                message={`Close ${data.positions.length} position(s) at market?`}
                confirmLabel="Confirm Flatten"
                confirmVariant="danger"
                onConfirm={async () => {
                  setActionLoading('flatten');
                  clearMessages();
                  try {
                    for (const pos of data.positions) {
                      await closePosition(pos.symbol);
                    }
                    await fetchData();
                    setActionSuccess(`Closed ${data.positions.length} position(s)`);
                  } catch (err) {
                    setActionError(err instanceof Error ? err.message : 'Failed to flatten positions');
                  } finally {
                    setActionLoading(null);
                    setShowConfirmFlatten(false);
                  }
                }}
                onCancel={() => setShowConfirmFlatten(false)}
              />
            )}
          </div>

          {/* Cancel all orders */}
          <div className="bg-surface2 rounded-input p-4 border border-border">
            <div className="flex items-center gap-2 mb-2">
              <XCircle size={16} className="text-warning" />
              <span className="text-sm font-semibold">Cancel All Open Orders</span>
            </div>
            <p className="text-xs text-muted mb-3">
              Cancel all pending and open orders across all symbols.
            </p>
            {!showConfirmCancelAll ? (
              <button
                onClick={() => { clearMessages(); setShowConfirmCancelAll(true); }}
                className="btn-danger text-xs"
                disabled={actionLoading !== null}
              >
                <XCircle size={14} />
                Cancel All
              </button>
            ) : (
              <ConfirmDialog
                open
                message="Cancel all open orders?"
                confirmLabel="Confirm Cancel"
                confirmVariant="danger"
                onConfirm={async () => {
                  setActionLoading('cancelAll');
                  clearMessages();
                  try {
                    const result = await cancelAllOrders();
                    await fetchData();
                    setActionSuccess(`Cancelled ${result.cancelled} order(s)`);
                  } catch (err) {
                    setActionError(err instanceof Error ? err.message : 'Failed to cancel orders');
                  } finally {
                    setActionLoading(null);
                    setShowConfirmCancelAll(false);
                  }
                }}
                onCancel={() => setShowConfirmCancelAll(false)}
              />
            )}
          </div>
        </div>
      </div>

      {/* Risk Configuration */}
      <div className="card">
        <div className="section-title">Risk Configuration</div>
        <p className="text-xs text-muted mb-4">
          Adjust risk parameters at runtime. Changes take effect immediately.
        </p>

        {/* Current risk status meters */}
        <div className="space-y-3 mb-5">
          <RiskMeter
            label="Daily P&L vs Limit"
            current={Math.abs(Math.min(0, data.risk.dailyPnlEstimate))}
            max={data.risk.maxDailyLossUsd}
            formatValue={(v) => `$${v.toFixed(2)}`}
            dangerThreshold={0.7}
          />
          <RiskMeter
            label="Open Positions"
            current={data.positions.length}
            max={data.risk.maxOpenPositions}
            formatValue={(v) => String(Math.round(v))}
            dangerThreshold={0.8}
          />
        </div>

        {/* Editable overrides */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {riskOverrides.map((override) => (
            <div key={override.key} className="bg-surface2 rounded-input p-3 border border-border">
              <div className="flex items-center gap-1.5 text-[0.66rem] uppercase tracking-wider text-muted mb-2">
                {override.icon}
                {override.label}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={configValues[override.configKey] ?? ''}
                  onChange={(e) =>
                    setConfigValues((prev) => ({
                      ...prev,
                      [override.configKey]: e.target.value,
                    }))
                  }
                  className="flex-1 bg-bg border border-border rounded-input px-2.5 py-1.5 text-sm
                             text-text focus:border-brand focus:outline-none transition-colors"
                />
                {override.unit && (
                  <span className="text-xs text-muted">{override.unit}</span>
                )}
                <button
                  onClick={() =>
                    handleConfigSave(
                      override.configKey,
                      configValues[override.configKey] ?? '',
                    )
                  }
                  className="btn-ghost text-xs px-2 py-1 min-h-[32px]"
                  disabled={configLoading}
                >
                  Save
                </button>
              </div>
            </div>
          ))}
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
