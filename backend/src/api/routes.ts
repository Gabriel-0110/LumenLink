/**
 * HTTP API routes — wraps existing trading engine endpoints and adds new ones.
 *
 * All routes are pure functions that take a context object containing references
 * to the running trading engine modules. This file does NOT import from src/index.ts;
 * instead, the caller (the bootstrap entrypoint) passes pre-built dependencies.
 *
 * Uses raw Node.js http (IncomingMessage / ServerResponse) — no Express required.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Logger } from '../../../src/core/logger.js';
import type { Metrics } from '../../../src/core/metrics.js';
import type { AppConfig } from '../../../src/config/types.js';
import type { TradingLoops } from '../../../src/jobs/loops.js';
import type { KillSwitch } from '../../../src/execution/killSwitch.js';
import type { TradeJournal } from '../../../src/data/tradeJournal.js';
import type { HealthReport } from '../../../src/core/healthReport.js';
import type { Strategy } from '../../../src/strategies/interface.js';
import { createAuthMiddleware, type AuthConfig } from '../middleware/auth.js';
import { createCorsMiddleware, type CorsConfig } from '../middleware/cors.js';
import { eventBus } from '../services/eventBus.js';

// ── Route context (injected dependencies) ────────────────────────────────────

export interface RouteContext {
  config: AppConfig;
  logger: Logger;
  metrics: Metrics;
  loops: TradingLoops;
  killSwitch?: KillSwitch;
  journal?: TradeJournal;
  healthReport?: HealthReport;
  strategy: Strategy;
  startedAt: number;
  /** Callback to swap the active strategy at runtime. */
  onStrategySwitch?: (name: string) => Strategy | null;
  /** Callback to update runtime config (risk limits etc). */
  onConfigUpdate?: (patch: Record<string, unknown>) => { applied: Record<string, unknown>; rejected: string[] };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function json(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data, null, 0));
}

function jsonPretty(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data, null, 2));
}

const MAX_BODY_SIZE = 64 * 1024; // 64 KB

function readBody(req: IncomingMessage, timeoutMs = 10_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalLen = 0;
    const timer = setTimeout(() => { req.destroy(); reject(new Error('Body read timeout')); }, timeoutMs);
    req.on('data', (chunk: Buffer) => {
      totalLen += chunk.length;
      if (totalLen > MAX_BODY_SIZE) {
        clearTimeout(timer);
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => { clearTimeout(timer); resolve(Buffer.concat(chunks).toString()); });
    req.on('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

async function parseJsonBody<T = Record<string, unknown>>(req: IncomingMessage): Promise<T | null> {
  try {
    const raw = await readBody(req);
    return raw.length > 0 ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** Sanitize config for API response — strip secrets, credentials, and internal paths. */
function sanitizeConfig(config: AppConfig): Record<string, unknown> {
  return {
    mode: config.mode,
    exchange: config.exchange,
    symbols: config.symbols,
    interval: config.interval,
    strategy: config.strategy,
    pollIntervalMs: config.pollIntervalMs,
    allowLiveTrading: config.allowLiveTrading,
    killSwitch: config.killSwitch,
    dryRun: config.dryRun,
    risk: config.risk,
    guards: config.guards,
    gatekeeper: config.gatekeeper,
    alerts: {
      telegram: { enabled: config.alerts.telegram.enabled },
      discord: { enabled: config.alerts.discord.enabled },
    },
    killSwitchConfig: config.killSwitchConfig,
    retry: config.retry,
  };
}

// ── Available strategies list ────────────────────────────────────────────────

const AVAILABLE_STRATEGIES = [
  { name: 'regime_aware', description: 'Regime-aware composite strategy with dynamic sub-strategy selection' },
  { name: 'advanced_composite', description: 'Multi-indicator composite with adaptive thresholds' },
  { name: 'composite', description: 'Basic composite of EMA + RSI signals' },
  { name: 'ema_crossover', description: 'Exponential moving average crossover' },
  { name: 'rsi_mean_reversion', description: 'RSI-based mean reversion' },
  { name: 'grid_trading', description: 'Grid trading with configurable levels' },
  { name: 'smart_dca', description: 'Smart dollar-cost averaging' },
];

// ── Route table ──────────────────────────────────────────────────────────────

type RouteHandler = (req: IncomingMessage, res: ServerResponse, ctx: RouteContext) => Promise<void> | void;

interface Route {
  method: string;
  path: string;
  handler: RouteHandler;
}

const routes: Route[] = [
  // ── Existing endpoints (migrated from index.ts) ──────────────────────────

  {
    method: 'GET',
    path: '/health',
    handler: (_req, res, ctx) => {
      json(res, {
        ok: true,
        mode: ctx.config.mode,
        exchange: ctx.config.exchange,
        uptime: Math.floor((Date.now() - ctx.startedAt) / 1000),
      });
    },
  },

  {
    method: 'GET',
    path: '/status',
    handler: (_req, res, ctx) => {
      const status = ctx.loops.getStatus();
      json(res, {
        lastCandleTime: status.lastCandleTime ?? null,
        openPositions: status.openPositions,
        dailyPnlEstimate: status.dailyPnlEstimate,
        killSwitch: ctx.config.killSwitch,
      });
    },
  },

  {
    method: 'GET',
    path: '/metrics',
    handler: (_req, res, ctx) => {
      // Check if we have a PrometheusMetrics instance with render()
      const asAny = ctx.metrics as { render?: () => string };
      if (typeof asAny.render === 'function') {
        res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
        res.end(asAny.render());
      } else {
        json(res, ctx.metrics.snapshot());
      }
    },
  },

  {
    method: 'GET',
    path: '/dashboard',
    handler: async (_req, res, ctx) => {
      const status = ctx.loops.getStatus();
      const today = new Date().toISOString().slice(0, 10);
      const dailySummary = ctx.journal?.getDailySummary(today);
      const recentTrades = ctx.journal?.getRecent(20);
      jsonPretty(res, {
        uptime: Math.floor((Date.now() - ctx.startedAt) / 1000),
        mode: ctx.config.mode,
        exchange: ctx.config.exchange,
        strategy: ctx.strategy.name,
        symbols: ctx.config.symbols,
        status,
        today: dailySummary ?? null,
        recentTrades: recentTrades ?? [],
        metricsSnapshot: ctx.metrics.snapshot(),
      });
    },
  },

  {
    method: 'GET',
    path: '/api/data',
    handler: async (_req, res, ctx) => {
      try {
        const rich = await ctx.loops.getRichStatus(ctx.journal);
        const uptimeSec = Math.floor((Date.now() - ctx.startedAt) / 1000);
        const metricsSnap = ctx.metrics.snapshot();
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
        res.end(JSON.stringify({ ...rich, uptimeSec, metricsSnap }, null, 0));
      } catch (err) {
        ctx.logger.error('/api/data handler error', { error: String(err) });
        json(res, { error: 'internal_error' }, 500);
      }
    },
  },

  // ── New API endpoints ────────────────────────────────────────────────────

  // Kill switch controls
  {
    method: 'POST',
    path: '/api/kill-switch/reset',
    handler: (_req, res, ctx) => {
      if (!ctx.killSwitch) {
        return json(res, { error: 'kill_switch_unavailable', message: 'Kill switch not initialized' }, 503);
      }
      ctx.killSwitch.reset();
      eventBus.emit('alerts', {
        level: 'info',
        title: 'Kill Switch Reset',
        message: 'Kill switch manually reset via API',
        timestamp: Date.now(),
      });
      ctx.logger.info('kill switch reset via API');
      json(res, { ok: true, state: ctx.killSwitch.getState() });
    },
  },

  {
    method: 'POST',
    path: '/api/kill-switch/trigger',
    handler: async (req, res, ctx) => {
      if (!ctx.killSwitch) {
        return json(res, { error: 'kill_switch_unavailable', message: 'Kill switch not initialized' }, 503);
      }
      const body = await parseJsonBody<{ reason?: string }>(req);
      const reason = body?.reason ?? 'Manual trigger via API';
      ctx.killSwitch.trigger(reason);
      eventBus.emit('alerts', {
        level: 'critical',
        title: 'Kill Switch Triggered',
        message: reason,
        timestamp: Date.now(),
      });
      json(res, { ok: true, state: ctx.killSwitch.getState() });
    },
  },

  // Positions
  {
    method: 'GET',
    path: '/api/positions',
    handler: async (_req, res, ctx) => {
      try {
        const rich = await ctx.loops.getRichStatus(ctx.journal);
        json(res, {
          positions: rich.positions,
          cashUsd: rich.cash,
          totalEquityUsd: rich.totalEquityUsd,
          unrealizedPnlUsd: rich.unrealizedPnlUsd,
          realizedPnlUsd: rich.realizedPnlUsd,
        });
      } catch (err) {
        json(res, { error: String(err) }, 500);
      }
    },
  },

  // Orders / trade history
  {
    method: 'GET',
    path: '/api/orders',
    handler: (_req, res, ctx) => {
      if (!ctx.journal) {
        return json(res, { orders: [], message: 'Trade journal not available' });
      }
      const recent = ctx.journal.getRecent(100);
      json(res, { orders: recent, count: recent.length });
    },
  },

  // Config (read)
  {
    method: 'GET',
    path: '/api/config',
    handler: (_req, res, ctx) => {
      json(res, sanitizeConfig(ctx.config));
    },
  },

  // Config (update runtime params) — whitelisted fields only
  {
    method: 'POST',
    path: '/api/config',
    handler: async (req, res, ctx) => {
      const body = await parseJsonBody(req);
      if (!body) {
        return json(res, { error: 'invalid_body', message: 'Expected JSON body' }, 400);
      }
      if (!ctx.onConfigUpdate) {
        return json(res, { error: 'not_supported', message: 'Runtime config update not wired' }, 501);
      }
      // Whitelist: only allow safe runtime-mutable fields
      const MUTABLE_FIELDS = new Set([
        'pollIntervalMs',
        'risk.maxDailyLossUsd', 'risk.maxPositionUsd', 'risk.maxOpenPositions',
        'risk.cooldownMinutes', 'risk.deployPercent',
        'guards.trailingStopPct', 'guards.maxSpreadBps',
      ]);
      const rejected: string[] = [];
      const sanitized: Record<string, unknown> = {};
      for (const key of Object.keys(body)) {
        if (MUTABLE_FIELDS.has(key)) {
          sanitized[key] = (body as Record<string, unknown>)[key];
        } else {
          rejected.push(key);
        }
      }
      if (rejected.length > 0) {
        ctx.logger.warn('config update rejected immutable fields', { rejected });
      }
      if (Object.keys(sanitized).length === 0) {
        return json(res, { error: 'no_valid_fields', rejected }, 400);
      }
      const result = ctx.onConfigUpdate(sanitized);
      ctx.logger.info('runtime config updated via API', { applied: result.applied, rejected: [...rejected, ...result.rejected] });
      json(res, { ...result, rejected: [...rejected, ...result.rejected] });
    },
  },

  // Strategies list
  {
    method: 'GET',
    path: '/api/strategies',
    handler: (_req, res, ctx) => {
      json(res, {
        active: ctx.strategy.name,
        available: AVAILABLE_STRATEGIES,
      });
    },
  },

  // Strategy switch
  {
    method: 'POST',
    path: '/api/strategy/switch',
    handler: async (req, res, ctx) => {
      const body = await parseJsonBody<{ strategy: string }>(req);
      if (!body?.strategy) {
        return json(res, { error: 'missing_field', message: 'Provide { "strategy": "<name>" }' }, 400);
      }
      const name = body.strategy;
      const known = AVAILABLE_STRATEGIES.find(s => s.name === name);
      if (!known) {
        return json(res, {
          error: 'unknown_strategy',
          message: `Unknown strategy: ${name}`,
          available: AVAILABLE_STRATEGIES.map(s => s.name),
        }, 400);
      }

      if (ctx.onStrategySwitch) {
        const newStrategy = ctx.onStrategySwitch(name);
        if (!newStrategy) {
          return json(res, { error: 'switch_failed', message: `Failed to switch to ${name}` }, 500);
        }
        ctx.logger.info('strategy switched via API', { from: ctx.strategy.name, to: newStrategy.name });
        eventBus.emit('alerts', {
          level: 'info',
          title: 'Strategy Switched',
          message: `Switched from ${ctx.strategy.name} to ${newStrategy.name}`,
          timestamp: Date.now(),
        });
        json(res, { ok: true, previous: ctx.strategy.name, active: newStrategy.name });
      } else {
        // Fallback: just validate and acknowledge, actual switch not wired
        json(res, {
          ok: true,
          message: 'Strategy switch acknowledged but runtime swap not wired',
          requested: name,
        });
      }
    },
  },

  // Backtest results (placeholder — reads from journal for now)
  {
    method: 'GET',
    path: '/api/backtest/results',
    handler: (_req, res, _ctx) => {
      // Future: read from a backtest results store
      json(res, {
        message: 'Backtest results endpoint — run `pnpm backtest` and results will appear here',
        results: [],
      });
    },
  },

  // Daily report
  {
    method: 'GET',
    path: '/api/reports/daily',
    handler: (_req, res, ctx) => {
      if (!ctx.journal) {
        return json(res, { error: 'journal_unavailable' }, 503);
      }
      const today = new Date().toISOString().slice(0, 10);
      const summary = ctx.journal.getDailySummary(today);
      const trades = ctx.journal.getRecent(50);
      const health = ctx.healthReport?.getCounters();
      json(res, {
        date: today,
        summary,
        trades: trades.filter(t => {
          const d = new Date(t.timestamp).toISOString().slice(0, 10);
          return d === today;
        }),
        health: health ?? null,
      });
    },
  },

  // Weekly report
  {
    method: 'GET',
    path: '/api/reports/weekly',
    handler: (_req, res, ctx) => {
      if (!ctx.journal) {
        return json(res, { error: 'journal_unavailable' }, 503);
      }
      const days = ctx.journal.getMultiDaySummary(7);
      const totalTrades = days.reduce((s, d) => s + d.totalTrades, 0);
      const totalPnl = days.reduce((s, d) => s + d.netPnlUsd, 0);
      const totalFees = days.reduce((s, d) => s + d.totalCommissionUsd, 0);
      const wins = days.reduce((s, d) => s + d.wins, 0);
      const losses = days.reduce((s, d) => s + d.losses, 0);
      json(res, {
        period: '7d',
        days,
        aggregate: {
          totalTrades,
          totalPnlUsd: totalPnl,
          totalFeesUsd: totalFees,
          wins,
          losses,
          winRate: totalTrades > 0 ? (wins / totalTrades) * 100 : 0,
          avgDailyPnl: days.length > 0 ? totalPnl / days.length : 0,
        },
      });
    },
  },
];

// ── Router factory ───────────────────────────────────────────────────────────

export interface RouterOptions {
  context: RouteContext;
  auth?: AuthConfig;
  cors?: CorsConfig;
}

/**
 * Creates a request handler function compatible with `http.createServer()`.
 * Handles CORS, auth, and routes requests to the appropriate handler.
 */
export function createRouter(options: RouterOptions) {
  const { context } = options;
  const authorize = createAuthMiddleware(options.auth ?? {});
  const handleCors = createCorsMiddleware(options.cors ?? {});

  // Build a lookup map for O(1) route matching
  const routeMap = new Map<string, RouteHandler>();
  for (const route of routes) {
    routeMap.set(`${route.method}:${route.path}`, route.handler);
  }

  return async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // CORS (handles OPTIONS preflight)
    if (handleCors(req, res)) return;

    // Auth
    if (!authorize(req, res)) return;

    const method = req.method ?? 'GET';
    const pathname = (req.url ?? '').split('?')[0] ?? '';

    const handler = routeMap.get(`${method}:${pathname}`);
    if (handler) {
      try {
        await handler(req, res, context);
      } catch (err) {
        context.logger.error('route handler error', { method, path: pathname, error: String(err) });
        if (!res.headersSent) {
          json(res, { error: 'internal_error' }, 500);
        }
      }
      return;
    }

    // 404
    json(res, { error: 'not_found', path: pathname }, 404);
  };
}
