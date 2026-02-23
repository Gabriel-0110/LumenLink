import { useState, useEffect, useCallback } from 'react';
import {
  BellRing,
  Save,
  RefreshCw,
  Monitor,
  MessageSquare,
  Hash,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import {
  fetchNotificationPrefs,
  updateNotificationPrefs,
  type NotificationPrefs as Prefs,
  type AlertChannel,
  type AlertSeverity,
  type AlertEventType,
  type EventTypeOverride,
} from '../../../services/api';

const CHANNELS: { key: AlertChannel; label: string; icon: React.ReactNode }[] = [
  { key: 'dashboard', label: 'Dashboard', icon: <Monitor size={14} /> },
  { key: 'console', label: 'Console', icon: <Hash size={14} /> },
  { key: 'telegram', label: 'Telegram', icon: <MessageSquare size={14} /> },
  { key: 'discord', label: 'Discord', icon: <MessageSquare size={14} /> },
];

const SEVERITIES: AlertSeverity[] = ['info', 'warn', 'critical'];

const OVERRIDE_VALUES: EventTypeOverride[] = ['default', 'always', 'never'];

interface EventGroup {
  label: string;
  events: { type: AlertEventType; label: string }[];
}

const EVENT_GROUPS: EventGroup[] = [
  {
    label: 'Orders',
    events: [
      { type: 'orderFilled', label: 'Order Filled' },
      { type: 'orderRejected', label: 'Order Rejected' },
    ],
  },
  {
    label: 'Risk',
    events: [
      { type: 'killSwitchTriggered', label: 'Kill Switch Triggered' },
      { type: 'dailyLossHit', label: 'Daily Loss Limit' },
      { type: 'circuitBreakerOpen', label: 'Circuit Breaker' },
      { type: 'volatilityHalt', label: 'Volatility Halt' },
    ],
  },
  {
    label: 'Session',
    events: [
      { type: 'killSwitchReset', label: 'Kill Switch Reset' },
      { type: 'sessionPaused', label: 'Session Paused' },
      { type: 'sessionResumed', label: 'Session Resumed' },
      { type: 'strategySwitched', label: 'Strategy Switched' },
    ],
  },
  {
    label: 'Monitoring',
    events: [
      { type: 'sentimentAlert', label: 'Sentiment Alert' },
      { type: 'trailingStopTriggered', label: 'Trailing Stop' },
      { type: 'cooldownActive', label: 'Cooldown Active' },
      { type: 'eventLockout', label: 'Event Lockout' },
    ],
  },
  {
    label: 'Reports',
    events: [
      { type: 'dailySummary', label: 'Daily Summary' },
      { type: 'systemStartup', label: 'System Startup' },
      { type: 'systemShutdown', label: 'System Shutdown' },
    ],
  },
];

function SeverityPill({
  value,
  selected,
  onClick,
}: {
  value: string;
  selected: boolean;
  onClick: () => void;
}) {
  const colors: Record<string, string> = {
    info: selected ? 'bg-brand/15 text-brand border-brand/30' : '',
    warn: selected ? 'bg-warning/15 text-warning border-warning/30' : '',
    critical: selected ? 'bg-loss/15 text-loss border-loss/30' : '',
  };
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 text-[0.65rem] font-semibold uppercase rounded-pill border transition-colors cursor-pointer
        ${selected ? colors[value] ?? 'bg-brand/15 text-brand border-brand/30' : 'border-border text-muted hover:text-text hover:border-text/30'}`}
    >
      {value}
    </button>
  );
}

function OverridePill({
  value,
  selected,
  onClick,
}: {
  value: EventTypeOverride;
  selected: boolean;
  onClick: () => void;
}) {
  const colors: Record<EventTypeOverride, string> = {
    default: selected ? 'bg-surface2 text-text border-border' : '',
    always: selected ? 'bg-profit/15 text-profit border-profit/30' : '',
    never: selected ? 'bg-loss/15 text-loss border-loss/30' : '',
  };
  return (
    <button
      onClick={onClick}
      className={`px-1.5 py-0.5 text-[0.6rem] font-semibold rounded-pill border transition-colors cursor-pointer
        ${selected ? colors[value] : 'border-transparent text-muted hover:text-text'}`}
    >
      {value === 'default' ? 'Def' : value === 'always' ? 'On' : 'Off'}
    </button>
  );
}

export function NotificationPrefs() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [overridesOpen, setOverridesOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchNotificationPrefs();
      setPrefs(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load preferences');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const saveChannelPrefs = useCallback(
    async (channel: AlertChannel) => {
      if (!prefs) return;
      setSaving(true);
      setError(null);
      setSuccess(null);
      try {
        const result = await updateNotificationPrefs({
          channels: { [channel]: prefs.channels[channel] } as Prefs['channels'],
        });
        setPrefs(result);
        setSuccess(`${channel} preferences saved`);
        setTimeout(() => setSuccess(null), 2000);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save');
      } finally {
        setSaving(false);
      }
    },
    [prefs],
  );

  const saveAllOverrides = useCallback(async () => {
    if (!prefs) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await updateNotificationPrefs(prefs);
      setPrefs(result);
      setSuccess('All overrides saved');
      setTimeout(() => setSuccess(null), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }, [prefs]);

  const updateChannel = (channel: AlertChannel, field: string, value: unknown) => {
    if (!prefs) return;
    setPrefs({
      ...prefs,
      channels: {
        ...prefs.channels,
        [channel]: { ...prefs.channels[channel], [field]: value },
      },
    });
  };

  const updateOverride = (
    channel: AlertChannel,
    eventType: AlertEventType,
    value: EventTypeOverride,
  ) => {
    if (!prefs) return;
    const current = prefs.channels[channel];
    const newOverrides = { ...current.overrides };
    if (value === 'default') {
      delete newOverrides[eventType];
    } else {
      newOverrides[eventType] = value;
    }
    setPrefs({
      ...prefs,
      channels: {
        ...prefs.channels,
        [channel]: { ...current, overrides: newOverrides },
      },
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 rounded-full border-2 border-brand border-t-transparent animate-spin" />
      </div>
    );
  }

  if (error && !prefs) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <p className="text-sm text-loss">{error}</p>
        <button onClick={load} className="btn-ghost text-xs">
          <RefreshCw size={14} /> Retry
        </button>
      </div>
    );
  }

  if (!prefs) return null;

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold flex items-center gap-2">
          <BellRing size={18} className="text-brand" />
          Notification Preferences
        </h2>
        <button onClick={load} className="btn-ghost text-xs px-2 py-1.5 min-h-[32px]">
          <RefreshCw size={14} />
        </button>
      </div>

      {/* Status messages */}
      {error && <div className="text-xs text-loss bg-loss/10 px-3 py-2 rounded-card">{error}</div>}
      {success && (
        <div className="text-xs text-profit bg-profit/10 px-3 py-2 rounded-card">{success}</div>
      )}

      {/* Channel Threshold Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {CHANNELS.map(({ key, label, icon }) => (
          <div
            key={key}
            className="bg-surface border border-border rounded-card p-4 flex flex-col gap-3"
          >
            {/* Channel header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold">
                {icon}
                {label}
              </div>
              <button
                onClick={() => updateChannel(key, 'enabled', !prefs.channels[key].enabled)}
                className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer ${
                  prefs.channels[key].enabled ? 'bg-brand' : 'bg-border'
                }`}
              >
                <div
                  className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                    prefs.channels[key].enabled ? 'left-[18px]' : 'left-0.5'
                  }`}
                />
              </button>
            </div>

            {/* Min severity selector */}
            <div className="flex items-center gap-2">
              <span className="text-[0.65rem] text-muted uppercase tracking-wider">
                Min Severity:
              </span>
              <div className="flex gap-1">
                {SEVERITIES.map((sev) => (
                  <SeverityPill
                    key={sev}
                    value={sev}
                    selected={prefs.channels[key].minSeverity === sev}
                    onClick={() => updateChannel(key, 'minSeverity', sev)}
                  />
                ))}
              </div>
            </div>

            {/* Save button */}
            <div className="flex justify-end">
              <button
                onClick={() => saveChannelPrefs(key)}
                disabled={saving}
                className="btn-ghost text-xs px-3 py-1.5 min-h-[28px] flex items-center gap-1"
              >
                <Save size={12} />
                Save
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Event-Type Overrides (collapsible) */}
      <div className="bg-surface border border-border rounded-card overflow-hidden">
        <button
          onClick={() => setOverridesOpen(!overridesOpen)}
          className="flex items-center justify-between w-full px-4 py-3 text-sm font-semibold hover:bg-surface2 transition-colors cursor-pointer"
        >
          <span>Event-Type Overrides</span>
          {overridesOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>

        {overridesOpen && (
          <div className="px-4 pb-4">
            <p className="text-[0.65rem] text-muted mb-3">
              Override per-event routing. "On" always sends, "Off" never sends, "Def" uses the
              channel threshold above.
            </p>

            {/* Override table */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-1.5 pr-4 text-muted font-medium">Event</th>
                    {CHANNELS.map((ch) => (
                      <th
                        key={ch.key}
                        className="text-center py-1.5 px-1 text-muted font-medium min-w-[80px]"
                      >
                        {ch.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {EVENT_GROUPS.map((group) => (
                    <>
                      <tr key={group.label}>
                        <td
                          colSpan={CHANNELS.length + 1}
                          className="pt-3 pb-1 text-[0.6rem] uppercase tracking-wider text-muted font-bold"
                        >
                          {group.label}
                        </td>
                      </tr>
                      {group.events.map((evt) => (
                        <tr key={evt.type} className="border-b border-border/50">
                          <td className="py-1.5 pr-4 text-text whitespace-nowrap">
                            {evt.label}
                          </td>
                          {CHANNELS.map((ch) => (
                            <td key={ch.key} className="py-1.5 px-1">
                              <div className="flex justify-center gap-0.5">
                                {OVERRIDE_VALUES.map((ov) => (
                                  <OverridePill
                                    key={ov}
                                    value={ov}
                                    selected={
                                      (prefs.channels[ch.key].overrides[evt.type] ?? 'default') ===
                                      ov
                                    }
                                    onClick={() => updateOverride(ch.key, evt.type, ov)}
                                  />
                                ))}
                              </div>
                            </td>
                          ))}
                        </tr>
                      ))}
                    </>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Save all overrides */}
            <div className="flex justify-end mt-3">
              <button
                onClick={saveAllOverrides}
                disabled={saving}
                className="btn-ghost text-xs px-3 py-1.5 min-h-[28px] flex items-center gap-1"
              >
                <Save size={12} />
                Save All Overrides
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
