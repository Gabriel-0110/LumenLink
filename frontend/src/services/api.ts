import type { DashboardData, HealthCheck, Trade } from '../types/api';

const BASE_URL = import.meta.env.VITE_API_URL ?? '';
const REQUEST_TIMEOUT_MS = 10_000;

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const method = options?.method ?? 'GET';
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        ...(method !== 'GET' ? { 'Content-Type': 'application/json' } : {}),
        ...options?.headers,
      },
      ...options,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => 'Unknown error');
      throw new ApiError(res.status, `${res.status} ${res.statusText}: ${body}`);
    }

    return res.json() as Promise<T>;
  } finally {
    clearTimeout(timeout);
  }
}

// ── API Methods ──────────────────────────────────────────────────

export async function fetchDashboardData(): Promise<DashboardData> {
  return request<DashboardData>('/api/data');
}

export async function fetchHealth(): Promise<HealthCheck> {
  return request<HealthCheck>('/health');
}

export async function triggerKillSwitch(): Promise<void> {
  await request('/api/kill-switch/trigger', { method: 'POST' });
}

export async function resetKillSwitch(): Promise<void> {
  await request('/api/kill-switch/reset', { method: 'POST' });
}

export async function fetchOrders(): Promise<Trade[]> {
  const data = await request<{ orders: Trade[] }>('/api/orders');
  return data.orders ?? [];
}

export async function fetchConfig(): Promise<Record<string, any>> {
  return request<Record<string, any>>('/api/config');
}

export async function updateConfig(patch: Record<string, unknown>): Promise<{ applied: Record<string, unknown>; rejected: string[] }> {
  return request('/api/config', {
    method: 'POST',
    body: JSON.stringify(patch),
  });
}

// ── Phase 3: Execution dashboard endpoints ──────────────────────

export interface SignalLogEntry {
  id: number;
  symbol: string;
  action: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  reason: string;
  strategy: string;
  outcome: string;
  blockedBy: string | null;
  riskReason: string | null;
  edgeDataJson: string | null;
  timestamp: number;
}

export interface AlertEntry {
  id: number;
  level: 'critical' | 'warn' | 'info';
  title: string;
  message: string;
  source: string;
  timestamp: number;
}

export interface TimelineEvent {
  type: string;
  timestamp: number;
  data: unknown;
}

export async function fetchSignals(opts?: { limit?: number; outcome?: string; symbol?: string }): Promise<SignalLogEntry[]> {
  const params = new URLSearchParams();
  if (opts?.limit) params.set('limit', String(opts.limit));
  if (opts?.outcome) params.set('outcome', opts.outcome);
  if (opts?.symbol) params.set('symbol', opts.symbol);
  const qs = params.toString();
  const data = await request<{ signals: SignalLogEntry[] }>(`/api/signals/history${qs ? `?${qs}` : ''}`);
  return data.signals ?? [];
}

export async function fetchAlerts(opts?: { limit?: number; level?: string }): Promise<AlertEntry[]> {
  const params = new URLSearchParams();
  if (opts?.limit) params.set('limit', String(opts.limit));
  if (opts?.level) params.set('level', opts.level);
  const qs = params.toString();
  const data = await request<{ alerts: AlertEntry[] }>(`/api/alerts/history${qs ? `?${qs}` : ''}`);
  return data.alerts ?? [];
}

export async function fetchTimeline(opts?: { limit?: number; since?: number }): Promise<TimelineEvent[]> {
  const params = new URLSearchParams();
  if (opts?.limit) params.set('limit', String(opts.limit));
  if (opts?.since) params.set('since', String(opts.since));
  const qs = params.toString();
  const data = await request<{ events: TimelineEvent[] }>(`/api/events/timeline${qs ? `?${qs}` : ''}`);
  return data.events ?? [];
}

export async function pauseSession(): Promise<void> {
  await request('/api/session/pause', { method: 'POST' });
}

export async function resumeSession(): Promise<void> {
  await request('/api/session/resume', { method: 'POST' });
}

export async function closePosition(symbol: string): Promise<void> {
  await request('/api/positions/close', {
    method: 'POST',
    body: JSON.stringify({ symbol }),
  });
}

export async function cancelAllOrders(): Promise<{ cancelled: number }> {
  return request('/api/orders/cancel-all', { method: 'POST' });
}

export { ApiError };
