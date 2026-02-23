import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  BookOpen,
  ArrowUp,
  ArrowDown,
  TrendingUp,
  TrendingDown,
  ShieldOff,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import { EmptyState, StatusBadge } from '../../common';
import { fetchTimeline, type TimelineEvent } from '../../../services/api';

interface DisplayEvent {
  id: string;
  type: string;
  timestamp: number;
  title: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  meta?: Record<string, string>;
}

function fmtUsd(v: number): string {
  const sign = v >= 0 ? '+' : '';
  return `${sign}$${Math.abs(v).toFixed(2)}`;
}

function buildDisplayEvents(events: TimelineEvent[]): DisplayEvent[] {
  return events.map((event, i): DisplayEvent => {
    const data = event.data as Record<string, any>;

    if (event.type === 'trade_entry') {
      return {
        id: `entry-${data.orderId ?? i}`,
        type: event.type,
        timestamp: event.timestamp,
        title: `${(data.side as string).toUpperCase()} ${data.symbol}`,
        description: `Entry at $${Number(data.filledPrice).toLocaleString()} — ${(data.strategy as string).replace(/_/g, ' ')}`,
        icon: data.side === 'buy' ? <ArrowUp size={16} /> : <ArrowDown size={16} />,
        color: data.side === 'buy' ? '#10b981' : '#ef4444',
        meta: {
          Quantity: Number(data.quantity).toFixed(6),
          Confidence: `${(Number(data.confidence) * 100).toFixed(0)}%`,
          Slippage: `${Number(data.slippageBps).toFixed(1)} bps`,
        },
      };
    }

    if (event.type === 'trade_exit') {
      const pnl = data.realizedPnlUsd != null ? fmtUsd(data.realizedPnlUsd) : '--';
      const isProfit = (data.realizedPnlUsd ?? 0) >= 0;
      return {
        id: `exit-${data.orderId ?? i}`,
        type: event.type,
        timestamp: event.timestamp,
        title: `Closed ${data.symbol}`,
        description: `Exit at $${Number(data.filledPrice).toLocaleString()} — P&L: ${pnl}`,
        icon: isProfit ? <TrendingUp size={16} /> : <TrendingDown size={16} />,
        color: isProfit ? '#10b981' : '#ef4444',
        meta: {
          'P&L': pnl,
          Duration: data.holdingDurationMs
            ? `${(data.holdingDurationMs / 3_600_000).toFixed(1)}h`
            : '--',
          Fee: `$${Number(data.commissionUsd).toFixed(4)}`,
        },
      };
    }

    if (event.type === 'signal_blocked') {
      return {
        id: `blocked-${data.id ?? i}`,
        type: event.type,
        timestamp: event.timestamp,
        title: `${data.action} ${data.symbol} blocked`,
        description: data.riskReason ?? data.blockedBy ?? data.outcome,
        icon: <ShieldOff size={16} />,
        color: '#f59e0b',
        meta: {
          Gate: data.blockedBy ?? data.outcome,
          Confidence: `${(Number(data.confidence) * 100).toFixed(0)}%`,
          Strategy: (data.strategy as string).replace(/_/g, ' '),
        },
      };
    }

    if (event.type === 'alert') {
      const alertColor = data.level === 'critical' ? '#ef4444' : data.level === 'warn' ? '#f59e0b' : '#6366f1';
      return {
        id: `alert-${data.id ?? i}`,
        type: event.type,
        timestamp: event.timestamp,
        title: data.title ?? 'Alert',
        description: data.message ?? '',
        icon: <AlertTriangle size={16} />,
        color: alertColor,
        meta: {
          Level: (data.level as string).toUpperCase(),
          Source: data.source ?? '--',
        },
      };
    }

    // Fallback
    return {
      id: `event-${i}`,
      type: event.type,
      timestamp: event.timestamp,
      title: event.type,
      description: JSON.stringify(data).slice(0, 100),
      icon: <BookOpen size={16} />,
      color: '#64748b',
    };
  });
}

export function ExecutionJournal() {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchTimeline({ limit: 200 });
      setEvents(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load timeline');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  const displayEvents = useMemo(() => buildDisplayEvents(events), [events]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 rounded-full border-2 border-brand border-t-transparent animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <p className="text-sm text-loss">{error}</p>
        <button onClick={loadEvents} className="btn-ghost text-xs">
          <RefreshCw size={14} /> Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold flex items-center gap-2">
          <BookOpen size={18} className="text-brand" />
          Journal / Timeline
        </h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted">{displayEvents.length} events</span>
          <button onClick={loadEvents} className="btn-ghost text-xs px-2 py-1.5 min-h-[32px]">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {displayEvents.length === 0 ? (
        <EmptyState
          icon={<BookOpen size={28} />}
          title="No events yet"
          description="Events will appear here as the bot trades and evaluates signals"
        />
      ) : (
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-5 top-0 bottom-0 w-px bg-border" />

          <div className="flex flex-col gap-0.5">
            {displayEvents.map((event) => (
              <div key={event.id} className="relative flex items-start gap-4 pl-3">
                {/* Icon dot */}
                <div
                  className="relative z-10 w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border border-border"
                  style={{ background: `${event.color}15`, color: event.color }}
                >
                  {event.icon}
                </div>

                {/* Content */}
                <div className="flex-1 bg-surface border border-border rounded-card p-3 mb-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-semibold">{event.title}</span>
                    <span className="text-[0.65rem] text-muted whitespace-nowrap">
                      {new Date(event.timestamp).toLocaleString([], {
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </span>
                  </div>
                  <p className="text-xs text-muted mb-2">{event.description}</p>
                  {event.meta && (
                    <div className="flex flex-wrap gap-3">
                      {Object.entries(event.meta).map(([key, value]) => (
                        <div key={key} className="text-[0.65rem]">
                          <span className="text-muted">{key}: </span>
                          <span className="font-semibold text-text">{value}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
