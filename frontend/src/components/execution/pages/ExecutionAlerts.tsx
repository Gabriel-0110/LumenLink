import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Bell,
  AlertTriangle,
  AlertOctagon,
  Info,
  RefreshCw,
} from 'lucide-react';
import { useDashboardStore } from '../../../store/dashboardStore';
import { FilterBar, StatusBadge, EmptyState } from '../../common';
import { fetchAlerts, type AlertEntry } from '../../../services/api';

type AlertLevel = 'critical' | 'warn' | 'info';
type AlertFilter = 'all' | 'critical' | 'warn' | 'info';

export function ExecutionAlerts() {
  const data = useDashboardStore((s) => s.data);
  const [serverAlerts, setServerAlerts] = useState<AlertEntry[]>([]);
  const [filter, setFilter] = useState<AlertFilter>('all');

  const loadAlerts = useCallback(async () => {
    try {
      const alerts = await fetchAlerts({ limit: 200 });
      setServerAlerts(alerts);
    } catch {
      // Server alerts unavailable — fall back to derived alerts
    }
  }, []);

  useEffect(() => {
    loadAlerts();
    const interval = setInterval(loadAlerts, 15_000);
    return () => clearInterval(interval);
  }, [loadAlerts]);

  // Derive local alerts from system state (kill switch, stale data, etc.)
  const derivedAlerts = useMemo((): AlertEntry[] => {
    if (!data) return [];
    const alerts: AlertEntry[] = [];
    const now = Date.now();
    let id = -1;

    if (data.killSwitch) {
      alerts.push({
        id: id--,
        level: 'critical',
        title: 'Kill Switch Triggered',
        message: 'All trading is halted. Manual reset required.',
        timestamp: now,
        source: 'kill_switch',
      });
    }

    if (data.lastCandleTime) {
      const staleMs = now - data.lastCandleTime;
      if (staleMs > 5 * 60_000) {
        alerts.push({
          id: id--,
          level: 'warn',
          title: 'Stale Market Data',
          message: `Last candle is ${(staleMs / 60_000).toFixed(0)} minutes old`,
          timestamp: now,
          source: 'market_data',
        });
      }
    } else {
      alerts.push({
        id: id--,
        level: 'warn',
        title: 'No Market Data',
        message: 'No candle data has been received',
        timestamp: now,
        source: 'market_data',
      });
    }

    return alerts;
  }, [data]);

  // Merge server alerts with derived alerts, deduplicate by title
  const allAlerts = useMemo(() => {
    const serverTitles = new Set(serverAlerts.map(a => a.title));
    const unique = [...serverAlerts];
    for (const d of derivedAlerts) {
      if (!serverTitles.has(d.title)) unique.push(d);
    }
    return unique.sort((a, b) => b.timestamp - a.timestamp);
  }, [serverAlerts, derivedAlerts]);

  const filtered =
    filter === 'all' ? allAlerts : allAlerts.filter((a) => a.level === filter);

  const criticalCount = allAlerts.filter((a) => a.level === 'critical').length;
  const warnCount = allAlerts.filter((a) => a.level === 'warn').length;
  const infoCount = allAlerts.filter((a) => a.level === 'info').length;

  const filterOptions = [
    { label: 'All', value: 'all', count: allAlerts.length },
    { label: 'Critical', value: 'critical', count: criticalCount },
    { label: 'Warning', value: 'warn', count: warnCount },
    { label: 'Info', value: 'info', count: infoCount },
  ];

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 rounded-full border-2 border-brand border-t-transparent animate-spin" />
      </div>
    );
  }

  const levelIcon = (level: AlertLevel) => {
    switch (level) {
      case 'critical':
        return <AlertOctagon size={14} />;
      case 'warn':
        return <AlertTriangle size={14} />;
      case 'info':
        return <Info size={14} />;
    }
  };

  const levelVariant = (level: AlertLevel): 'danger' | 'warning' | 'info' => {
    switch (level) {
      case 'critical':
        return 'danger';
      case 'warn':
        return 'warning';
      case 'info':
        return 'info';
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-base font-bold flex items-center gap-2">
          <Bell size={18} className="text-brand" />
          Alerts
          {criticalCount > 0 && (
            <span className="bg-loss/15 text-loss text-xs font-bold px-2 py-0.5 rounded-pill">
              {criticalCount} critical
            </span>
          )}
        </h2>
        <div className="flex items-center gap-3">
          <FilterBar
            options={filterOptions}
            selected={filter}
            onChange={(v) => setFilter(v as AlertFilter)}
          />
          <button onClick={loadAlerts} className="btn-ghost text-xs px-2 py-1.5 min-h-[32px]">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Bell size={28} />}
          title={filter === 'all' ? 'No alerts' : `No ${filter} alerts`}
          description="All systems are operating normally"
        />
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((alert) => (
            <div
              key={alert.id}
              className={`flex items-start gap-3 p-3 rounded-card border ${
                alert.level === 'critical'
                  ? 'bg-loss/5 border-loss/20'
                  : alert.level === 'warn'
                    ? 'bg-warning/5 border-warning/20'
                    : 'bg-brand/5 border-brand/20'
              }`}
            >
              <div className="shrink-0 mt-0.5">
                <StatusBadge
                  label={alert.level.toUpperCase()}
                  variant={levelVariant(alert.level)}
                  icon={levelIcon(alert.level)}
                />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold">{alert.title}</div>
                <div className="text-xs text-muted mt-0.5">{alert.message}</div>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <div className="text-[0.6rem] text-muted whitespace-nowrap">
                  {alert.source}
                </div>
                <div className="text-[0.6rem] text-muted whitespace-nowrap">
                  {new Date(alert.timestamp).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
