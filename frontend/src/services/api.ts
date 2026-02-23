import type { DashboardData, HealthCheck } from '../types/api';

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

export { ApiError };
