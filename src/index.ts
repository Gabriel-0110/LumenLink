import http from 'node:http';
import { loadConfig } from './config/load.js';
import { JsonLogger } from './core/logger.js';
import { InMemoryMetrics } from './core/metrics.js';
import { PrometheusMetrics } from './core/prometheusMetrics.js';
import { TradeJournal } from './data/tradeJournal.js';
import { AlertMultiplexer, alertTemplates } from './alerts/alertTemplates.js';
import { InMemoryStore } from './data/inMemoryStore.js';
import { SqliteStore } from './data/sqliteStore.js';
import { MarketDataService } from './data/marketDataService.js';
import { SentimentService } from './data/sentimentService.js';
import { OnChainService } from './data/onchainService.js';
import { OrderState } from './execution/orderState.js';
import { PaperBroker } from './execution/paperBroker.js';
import { LiveBroker } from './execution/liveBroker.js';
import { OrderManager } from './execution/orderManager.js';
import { Reconciler } from './execution/reconciler.js';
import { RiskEngine } from './risk/riskEngine.js';
import { createStrategy } from './strategies/selector.js';
import type { ExchangeAdapter } from './exchanges/adapter.js';
import { CoinbaseAdapter } from './exchanges/coinbase/adapter.js';
import { CCXTAdapter } from './exchanges/ccxt/adapter.js';
import { Scheduler } from './jobs/scheduler.js';
import { ConsoleAlertService } from './alerts/console.js';
import { DiscordAlertService } from './alerts/discord.js';
import { TelegramAlertService } from './alerts/telegram.js';
import { buildSecretsProvider } from './secrets/provider.js';
import { TradingLoops } from './jobs/loops.js';
import type { Balance, Candle, Order, OrderRequest, Ticker } from './core/types.js';

class UnavailableExchangeAdapter implements ExchangeAdapter {
  async getTicker(_symbol: string): Promise<Ticker> {
    throw new Error('exchange adapter unavailable in fallback mode');
  }
  async getCandles(_symbol: string, _interval: string, _limit: number): Promise<Candle[]> {
    throw new Error('exchange adapter unavailable in fallback mode');
  }
  async placeOrder(_orderRequest: OrderRequest): Promise<Order> {
    throw new Error('exchange adapter unavailable in fallback mode');
  }
  async cancelOrder(_orderId: string): Promise<void> {
    throw new Error('exchange adapter unavailable in fallback mode');
  }
  async getOrder(_orderId: string): Promise<Order> {
    throw new Error('exchange adapter unavailable in fallback mode');
  }
  async listOpenOrders(_symbol?: string): Promise<Order[]> {
    return [];
  }
  async getBalances(): Promise<Balance[]> {
    return [];
  }
}

const main = async (): Promise<void> => {
  const config = loadConfig();
  const logger = new JsonLogger(config.logLevel);
  const metrics = config.nodeEnv === 'test' ? new InMemoryMetrics() : new PrometheusMetrics();
  const dbPath = config.mode === 'paper' ? './data/paper-runtime.sqlite' : './data/runtime.sqlite';
  // Paper shares candle store with live (market data is read-only), separate journal for trades
  const candleDbPath = './data/runtime.sqlite';
  const journal = config.nodeEnv === 'test' ? undefined : new TradeJournal(dbPath);

  const secrets = buildSecretsProvider(config);
  let telegramToken: string | undefined;
  let discordWebhook: string | undefined;

  if (config.alerts.telegram.enabled) {
    telegramToken = await secrets.getSecret(config.secrets.secretIds.telegramToken, 'TELEGRAM_BOT_TOKEN');
  }
  if (config.alerts.discord.enabled) {
    discordWebhook = await secrets.getSecret(config.secrets.secretIds.discordWebhook, 'DISCORD_WEBHOOK_URL');
  }

  let exchange: ExchangeAdapter = new UnavailableExchangeAdapter();
  
  if (config.exchange === 'coinbase') {
    try {
      const apiKey = await secrets.getSecret(config.secrets.secretIds.coinbaseKey, 'COINBASE_API_KEY');
      const apiSecret = await secrets.getSecret(config.secrets.secretIds.coinbaseSecret, 'COINBASE_API_SECRET');
      const passphrase = await secrets.getSecret(
        config.secrets.secretIds.coinbasePassphrase,
        'COINBASE_API_PASSPHRASE'
      );
      exchange = new CoinbaseAdapter({ apiKey, apiSecret, passphrase });
    } catch (err) {
      if (config.mode === 'paper') {
        logger.warn('coinbase credentials unavailable, using fake market fallback', {
          err: String(err)
        });
      } else {
        throw err;
      }
    }
  } else if (config.exchange === 'binance') {
    try {
      const apiKey = await secrets.getSecret(config.secrets.secretIds.binanceKey, 'BINANCE_API_KEY');
      const secret = await secrets.getSecret(config.secrets.secretIds.binanceSecret, 'BINANCE_API_SECRET');
      exchange = new CCXTAdapter({ 
        exchange: 'binance', 
        apiKey, 
        secret, 
        sandbox: config.mode === 'paper'
      });
    } catch (err) {
      if (config.mode === 'paper') {
        logger.warn('binance credentials unavailable, using fake market fallback', {
          err: String(err)
        });
      } else {
        throw err;
      }
    }
  } else if (config.exchange === 'bybit') {
    try {
      const apiKey = await secrets.getSecret('prod/trading/bybit/key', 'BYBIT_API_KEY');
      const secret = await secrets.getSecret('prod/trading/bybit/secret', 'BYBIT_API_SECRET');
      exchange = new CCXTAdapter({ 
        exchange: 'bybit', 
        apiKey, 
        secret, 
        sandbox: config.mode === 'paper'
      });
    } catch (err) {
      if (config.mode === 'paper') {
        logger.warn('bybit credentials unavailable, using fake market fallback', {
          err: String(err)
        });
      } else {
        throw err;
      }
    }
  }

  const store = config.nodeEnv === 'test' ? new InMemoryStore() : new SqliteStore(candleDbPath);
  const marketData = new MarketDataService(exchange, store, logger, metrics);
  const riskEngine = new RiskEngine(config);
  const orderState = new OrderState(store);
  await orderState.hydrateFromStore();

  const strategy = createStrategy(config.strategy);

  const orderManager = new OrderManager(
    config,
    orderState,
    new PaperBroker(),
    new LiveBroker(exchange),
    logger,
    metrics
  );

  const reconciler = new Reconciler(exchange, orderState, logger, metrics);

  const alertServices = [new ConsoleAlertService()];
  if (telegramToken && config.alerts.telegram.chatId) {
    alertServices.push(new TelegramAlertService(telegramToken, config.alerts.telegram.chatId));
  }
  if (discordWebhook) {
    alertServices.push(new DiscordAlertService(discordWebhook));
  }

  const alertMux = {
    async notify(title: string, message: string, context?: Record<string, unknown>): Promise<void> {
      await Promise.all(alertServices.map((a) => a.notify(title, message, context)));
    }
  };

  // Initialize sentiment and on-chain data services
  let sentimentService: SentimentService | undefined;
  let onChainService: OnChainService | undefined;

  try {
    const cryptoPanicKey = await secrets.getSecret(
      config.secrets.secretIds.cryptoPanicKey,
      'CRYPTOPANIC_API_KEY'
    );
    sentimentService = new SentimentService(cryptoPanicKey);
    onChainService = new OnChainService();
    logger.info('sentiment and on-chain services initialized');
  } catch (err) {
    logger.warn('failed to initialize sentiment services, continuing without them', {
      err: String(err)
    });
  }

  const loops = new TradingLoops(
    config,
    marketData,
    store,
    strategy,
    riskEngine,
    orderManager,
    reconciler,
    alertMux,
    logger,
    sentimentService,
    onChainService
  );

  // Seed snapshot with real exchange balances so pre-existing holdings
  // (e.g. BTC already in account) are visible to the risk engine at start,
  // allowing SELL signals to fire without being blocked as 'phantom sells'.
  // Paper mode keeps the $10k default cash and no seeded positions.
  if (config.mode === 'live') {
    await loops.hydrateFromExchange(exchange);
  } else {
    logger.info('paper mode — starting with simulated $10,000 cash, no seeded positions');
  }

  const scheduler = new Scheduler(logger);
  scheduler.add('market-data', config.data.pollingMs, async () => loops.marketDataLoop());
  scheduler.add('strategy', config.pollIntervalMs, async () => loops.strategyLoop());
  if (config.mode === 'live') {
    scheduler.add('reconcile', Math.max(10_000, config.pollIntervalMs), async () => loops.reconciliationLoop());
  }
  // Add sentiment loop (every 15 minutes = 900,000ms)
  if (sentimentService && onChainService) {
    scheduler.add('sentiment', 900_000, async () => loops.sentimentLoop());
  }

  const startedAt = Date.now();
  const server = http.createServer(async (req, res) => {
    if (!req.url) {
      res.statusCode = 400;
      res.end('Bad request');
      return;
    }

    if (req.method === 'GET' && req.url === '/health') {
      const body = {
        ok: true,
        mode: config.mode,
        exchange: config.exchange,
        uptime: Math.floor((Date.now() - startedAt) / 1000)
      };
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body));
      return;
    }

    if (req.method === 'GET' && req.url === '/status') {
      const status = loops.getStatus();
      const body = {
        lastCandleTime: status.lastCandleTime ?? null,
        openPositions: status.openPositions,
        dailyPnlEstimate: status.dailyPnlEstimate,
        killSwitch: config.killSwitch
      };
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body));
      return;
    }

    if (req.method === 'GET' && req.url === '/metrics') {
      if (metrics instanceof PrometheusMetrics) {
        res.setHeader('Content-Type', 'text/plain; version=0.0.4');
        res.end(metrics.render());
      } else {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify((metrics as InMemoryMetrics).snapshot()));
      }
      return;
    }

    if (req.method === 'GET' && req.url === '/dashboard') {
      const status = loops.getStatus();
      const today = new Date().toISOString().slice(0, 10);
      const dailySummary = journal?.getDailySummary(today);
      const recentTrades = journal?.getRecent(20);
      const body = {
        uptime: Math.floor((Date.now() - startedAt) / 1000),
        mode: config.mode,
        exchange: config.exchange,
        strategy: strategy.name,
        symbols: config.symbols,
        status,
        today: dailySummary ?? null,
        recentTrades: recentTrades ?? [],
        metricsSnapshot: 'snapshot' in metrics ? (metrics as any).snapshot() : null,
      };
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body, null, 2));
      return;
    }

    if (req.method === 'GET' && req.url === '/api/data') {
      try {
        const rich = await loops.getRichStatus(journal);
        const uptimeSec = Math.floor((Date.now() - startedAt) / 1000);
        const metricsSnap = 'snapshot' in metrics ? (metrics as any).snapshot() : null;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-cache');
        res.end(JSON.stringify({ ...rich, uptimeSec, metricsSnap }, null, 0));
      } catch (err) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: String(err) }));
      }
      return;
    }

    if (req.method === 'GET' && (req.url === '/' || req.url === '/ui')) {
      const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>LumenLink Dashboard</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"></script>
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0a0e17;--surface:#111827;--surface2:#1a2235;--border:#1e2d40;
  --text:#e2e8f0;--muted:#64748b;--green:#10b981;--red:#ef4444;
  --yellow:#f59e0b;--blue:#3b82f6;--purple:#8b5cf6;--cyan:#06b6d4;
}
body{background:var(--bg);color:var(--text);font-family:'Segoe UI',system-ui,sans-serif;min-height:100vh}
a{color:inherit;text-decoration:none}

/* ── Header ───────────────────────────────────────────────── */
.header{
  display:flex;align-items:center;gap:12px;
  padding:14px 24px;background:var(--surface);
  border-bottom:1px solid var(--border);position:sticky;top:0;z-index:100
}
.logo{font-size:1.1rem;font-weight:800;letter-spacing:.5px;color:var(--cyan)}
.logo span{color:var(--text)}
.badge{
  display:inline-flex;align-items:center;gap:5px;
  padding:3px 10px;border-radius:20px;font-size:.7rem;font-weight:700;
  border:1px solid currentColor
}
.badge-live{color:var(--red);background:#ef444415}
.badge-paper{color:var(--blue);background:#3b82f615}
.hbar{font-size:.75rem;color:var(--muted);margin-left:auto}
.refresh-dot{
  display:inline-block;width:7px;height:7px;border-radius:50%;
  background:var(--green);animation:pulse 2s infinite;vertical-align:middle;margin-right:4px
}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
#countdown{color:var(--muted);font-size:.72rem}

/* ── Layout ───────────────────────────────────────────────── */
.main{padding:20px 24px;display:flex;flex-direction:column;gap:20px}
.row{display:grid;gap:16px}
.r2{grid-template-columns:repeat(auto-fit,minmax(160px,1fr))}
.r3{grid-template-columns:2fr 1fr 1fr}
.r4{grid-template-columns:3fr 1fr}
@media(max-width:900px){.r3,.r4{grid-template-columns:1fr}}

/* ── Cards ────────────────────────────────────────────────── */
.card{
  background:var(--surface);border:1px solid var(--border);
  border-radius:12px;padding:18px 20px;position:relative;overflow:hidden
}
.card-label{font-size:.68rem;text-transform:uppercase;letter-spacing:.8px;color:var(--muted);margin-bottom:6px}
.card-value{font-size:1.55rem;font-weight:700;line-height:1}
.card-sub{font-size:.72rem;color:var(--muted);margin-top:5px}
.card-accent{position:absolute;top:0;left:0;width:3px;height:100%;border-radius:12px 0 0 12px}

/* ── Section header ───────────────────────────────────────── */
.sec-title{
  font-size:.72rem;text-transform:uppercase;letter-spacing:.8px;
  color:var(--muted);font-weight:600;margin-bottom:10px;display:flex;
  align-items:center;gap:8px
}
.sec-title::after{content:'';flex:1;height:1px;background:var(--border)}

/* ── Tables ───────────────────────────────────────────────── */
.tbl-wrap{overflow-x:auto;border-radius:12px;border:1px solid var(--border)}
table{width:100%;border-collapse:collapse;font-size:.82rem}
thead th{
  background:var(--surface2);padding:9px 14px;text-align:left;
  font-size:.68rem;text-transform:uppercase;letter-spacing:.6px;
  color:var(--muted);font-weight:600;white-space:nowrap
}
tbody td{padding:9px 14px;border-top:1px solid var(--border);vertical-align:middle}
tbody tr:hover td{background:#ffffff08}
.pill{
  display:inline-block;padding:2px 8px;border-radius:6px;
  font-size:.7rem;font-weight:700;white-space:nowrap
}
.pill-buy{background:#10b98120;color:var(--green)}
.pill-sell{background:#ef444415;color:var(--red)}
.pill-hold{background:#64748b20;color:var(--muted)}
.pill-regime{background:#8b5cf620;color:var(--purple)}
.pill-ranging{background:#f59e0b20;color:var(--yellow)}
.pill-breakout{background:#06b6d420;color:var(--cyan)}
.reason-cell{max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted);font-size:.75rem}

/* ── Gauge (Fear & Greed) ─────────────────────────────────── */
.fg-wrap{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:16px 10px}
.fg-label-top{font-size:.68rem;text-transform:uppercase;letter-spacing:.8px;color:var(--muted)}
.fg-number{font-size:2.2rem;font-weight:800;line-height:1}
.fg-classification{font-size:.8rem;font-weight:600;margin-top:2px}
svg.gauge{overflow:visible}

/* ── Position meters ─────────────────────────────────────── */
.meter-row{display:flex;flex-direction:column;gap:10px}
.meter-item .meter-label{display:flex;justify-content:space-between;font-size:.75rem;color:var(--muted);margin-bottom:4px}
.meter-bar{height:6px;background:var(--surface2);border-radius:4px;overflow:hidden}
.meter-fill{height:100%;border-radius:4px;transition:width .5s ease}

/* ── Chart containers ─────────────────────────────────────── */
.chart-wrap{position:relative;height:220px}
.chart-wrap-tall{position:relative;height:260px}

/* ── Price ticker ─────────────────────────────────────────── */
.ticker-val{font-size:2rem;font-weight:800;letter-spacing:-.5px}
.ticker-change{font-size:.85rem;font-weight:600;margin-left:8px}

/* ── Positions ────────────────────────────────────────────── */
.pos-card{
  display:flex;align-items:center;justify-content:space-between;
  padding:14px 16px;background:var(--surface2);border-radius:8px;
  border:1px solid var(--border);gap:16px;flex-wrap:wrap
}
.pos-sym{font-weight:700;font-size:.9rem}
.pos-qty{font-size:.78rem;color:var(--muted)}
.pos-pnl{font-weight:700;font-size:.95rem}
.pos-bar{flex:1;min-width:100px}

/* ── Risk panel ───────────────────────────────────────────── */
.risk-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.risk-item{background:var(--surface2);border-radius:8px;padding:12px 14px;border:1px solid var(--border)}
.risk-item .rl{font-size:.66rem;text-transform:uppercase;letter-spacing:.7px;color:var(--muted)}
.risk-item .rv{font-size:1.1rem;font-weight:700;margin-top:3px}

/* ── System row ───────────────────────────────────────────── */
.sysrow{display:flex;flex-wrap:wrap;gap:12px;font-size:.72rem;color:var(--muted);
  background:var(--surface);border-radius:10px;border:1px solid var(--border);padding:12px 16px}
.sysrow span{display:flex;align-items:center;gap:5px}
.sysrow b{color:var(--text)}

/* ── Scrollbar ────────────────────────────────────────────── */
::-webkit-scrollbar{width:6px;height:6px}
::-webkit-scrollbar-track{background:var(--surface)}
::-webkit-scrollbar-thumb{background:#334155;border-radius:3px}
</style>
</head>
<body>

<div class="header">
  <div class="logo">⚡ Lumen<span>Link</span></div>
  <span id="mode-badge" class="badge">—</span>
  <span id="hdr-exchange" style="font-size:.8rem;color:var(--muted)"></span>
  <span id="hdr-strategy" style="font-size:.8rem;color:var(--cyan)"></span>
  <span id="hdr-symbol" style="font-size:.8rem;color:var(--muted)"></span>
  <div class="hbar">
    <span class="refresh-dot"></span>
    <span id="countdown">next refresh in 15s</span>
    &nbsp;·&nbsp; <span id="uptime-lbl">uptime —</span>
  </div>
</div>

<div class="main">

  <!-- ── Row 1: Price + Sentiment ───────────────────────── -->
  <div class="row" style="grid-template-columns:1fr 1fr 280px">
    <!-- Price sparkline -->
    <div class="card">
      <div class="card-label" id="spark-label">BTC-USD · 1h</div>
      <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:12px">
        <span class="ticker-val" id="price-now">—</span>
        <span class="ticker-change" id="price-change">—</span>
      </div>
      <div class="chart-wrap"><canvas id="sparkChart"></canvas></div>
    </div>

    <!-- Equity curve -->
    <div class="card">
      <div class="card-label">Cumulative P&amp;L (14d)</div>
      <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:12px">
        <span class="ticker-val" style="font-size:1.4rem" id="equity-total">—</span>
        <span class="ticker-change" id="equity-change">all-time realized</span>
      </div>
      <div class="chart-wrap"><canvas id="equityChart"></canvas></div>
    </div>

    <!-- Fear & Greed gauge -->
    <div class="card" style="display:flex;flex-direction:column">
      <div class="card-label">Market Sentiment</div>
      <div class="fg-wrap" style="flex:1">
        <svg class="gauge" width="180" height="100" viewBox="0 0 200 110">
          <!-- Background arcs: extreme fear → fear → neutral → greed → extreme greed -->
          <path d="M20,100 A80,80 0 0,1 54,30" fill="none" stroke="#1e3a5f" stroke-width="14" stroke-linecap="round"/>
          <path d="M54,30 A80,80 0 0,1 100,20" fill="none" stroke="#1e3a5f" stroke-width="14" stroke-linecap="round"/>
          <path d="M100,20 A80,80 0 0,1 146,30" fill="none" stroke="#1e3a5f" stroke-width="14" stroke-linecap="round"/>
          <path d="M146,30 A80,80 0 0,1 180,100" fill="none" stroke="#1e3a5f" stroke-width="14" stroke-linecap="round"/>
          <!-- Coloured fill arcs (clipped by JS) -->
          <path id="fg-arc-fill" d="" fill="none" stroke="#10b981" stroke-width="14" stroke-linecap="round"/>
          <!-- Needle -->
          <line id="fg-needle" x1="100" y1="100" x2="100" y2="28" stroke="#e2e8f0" stroke-width="2.5" stroke-linecap="round" transform="rotate(0,100,100)"/>
          <circle cx="100" cy="100" r="5" fill="#e2e8f0"/>
          <!-- Zone labels -->
          <text x="13" y="116" font-size="8" fill="#64748b">E.Fear</text>
          <text x="83" y="14" font-size="8" fill="#64748b" text-anchor="middle">Neutral</text>
          <text x="168" y="116" font-size="8" fill="#64748b" text-anchor="end">E.Greed</text>
        </svg>
        <div class="fg-number" id="fg-number">—</div>
        <div class="fg-classification" id="fg-class" style="color:var(--muted)">—</div>
        <div style="font-size:.68rem;color:var(--muted);margin-top:6px" id="fg-news">—</div>
      </div>
    </div>
  </div>

  <!-- ── Row 2: Stat cards ──────────────────────────────── -->
  <div class="row r2" id="stat-cards">
    <div class="card"><div class="card-accent" style="background:var(--green)"></div>
      <div class="card-label">Daily P&amp;L</div>
      <div class="card-value" id="stat-pnl">—</div>
      <div class="card-sub" id="stat-pnl-sub">—</div>
    </div>
    <div class="card"><div class="card-accent" style="background:var(--blue)"></div>
      <div class="card-label">Portfolio Value</div>
      <div class="card-value" id="stat-equity">—</div>
      <div class="card-sub" id="stat-equity-sub">cash: —</div>
    </div>
    <div class="card"><div class="card-accent" style="background:var(--purple)"></div>
      <div class="card-label">Unrealized P&amp;L</div>
      <div class="card-value" id="stat-unrealized">—</div>
      <div class="card-sub" id="stat-unrealized-sub">—</div>
    </div>
    <div class="card"><div class="card-accent" style="background:var(--cyan)"></div>
      <div class="card-label">Trades Today</div>
      <div class="card-value" id="stat-trades">—</div>
      <div class="card-sub" id="stat-trades-sub">—</div>
    </div>
    <div class="card"><div class="card-accent" style="background:var(--yellow)"></div>
      <div class="card-label">Win Rate</div>
      <div class="card-value" id="stat-winrate">—</div>
      <div class="card-sub" id="stat-winrate-sub">all-time</div>
    </div>
    <div class="card"><div class="card-accent" style="background:var(--red)"></div>
      <div class="card-label">Kill Switch</div>
      <div class="card-value" id="stat-ks">—</div>
      <div class="card-sub" id="stat-ks-sub">—</div>
    </div>
  </div>

  <!-- ── Row 3: 7-day bars + Win/Loss donut + Risk panel ── -->
  <div class="row r3">
    <div class="card">
      <div class="sec-title">7-Day P&amp;L</div>
      <div class="chart-wrap-tall"><canvas id="weeklyChart"></canvas></div>
    </div>
    <div class="card" style="display:flex;flex-direction:column">
      <div class="sec-title">Win / Loss</div>
      <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px">
        <div style="position:relative;width:150px;height:150px">
          <canvas id="donutChart"></canvas>
          <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center">
            <div style="font-size:1.5rem;font-weight:800" id="donut-center">—</div>
            <div style="font-size:.7rem;color:var(--muted)">win rate</div>
          </div>
        </div>
        <div style="display:flex;gap:16px;font-size:.75rem">
          <span><span style="color:var(--green)">●</span> <span id="donut-wins">0</span> wins</span>
          <span><span style="color:var(--red)">●</span> <span id="donut-losses">0</span> losses</span>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="sec-title">Risk / Limits</div>
      <div class="risk-grid" id="risk-grid" style="margin-bottom:14px"></div>
      <div class="sec-title" style="margin-top:10px">Utilisation</div>
      <div class="meter-row" id="meter-row"></div>
    </div>
  </div>

  <!-- ── Open Positions ─────────────────────────────────── -->
  <div>
    <div class="sec-title">Open Positions</div>
    <div id="positions-wrap"></div>
  </div>

  <!-- ── Recent Trades ──────────────────────────────────── -->
  <div>
    <div class="sec-title">Recent Trades</div>
    <div class="tbl-wrap">
      <table>
        <thead>
          <tr>
            <th>Time</th><th>Symbol</th><th>Side</th>
            <th>Entry</th><th>Exit</th><th>P&amp;L</th>
            <th>Conf</th><th>Reason</th><th>Duration</th>
          </tr>
        </thead>
        <tbody id="trades-tbody">
          <tr><td colspan="9" style="text-align:center;color:var(--muted);padding:24px">Loading…</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <!-- ── System info ────────────────────────────────────── -->
  <div class="sysrow" id="sysrow"></div>

</div><!-- /main -->

<script>
// ── Chart instances ──────────────────────────────────────────
let sparkChart, equityChart, weeklyChart, donutChart;
let countdown = 15;

// ── Colour helpers ───────────────────────────────────────────
const $c = (id) => document.getElementById(id);
const fmtUsd = (v) => (v >= 0 ? '+' : '') + '$' + Math.abs(v).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
const fmtPrice = (v) => '$' + v.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
const fmtPct = (v) => (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
const col = (v) => v >= 0 ? '#10b981' : '#ef4444';
const uptimeFmt = (s) => { const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=s%60; return h>0?\`\${h}h \${m}m\`:\`\${m}m \${sec}s\`};

// ── Chart defaults ───────────────────────────────────────────
Chart.defaults.color = '#64748b';
Chart.defaults.borderColor = '#1e2d40';
Chart.defaults.font.family = "'Segoe UI', system-ui, sans-serif";
Chart.defaults.font.size = 11;

function initCharts() {
  const baseLineOpts = {
    responsive:true, maintainAspectRatio:false,
    plugins:{legend:{display:false},tooltip:{
      backgroundColor:'#1a2235',borderColor:'#1e2d40',borderWidth:1,
      titleColor:'#e2e8f0',bodyColor:'#94a3b8',padding:10,
    }},
    scales:{
      x:{grid:{color:'#1e2d40'},ticks:{maxTicksLimit:6}},
      y:{grid:{color:'#1e2d40'},ticks:{maxTicksLimit:5}}
    },
    elements:{point:{radius:0,hoverRadius:4}}
  };

  // Sparkline
  sparkChart = new Chart($c('sparkChart').getContext('2d'), {
    type:'line',
    data:{labels:[],datasets:[{data:[],borderColor:'#06b6d4',borderWidth:2,
      fill:true,backgroundColor:'rgba(6,182,212,.06)',tension:.3}]},
    options:{...baseLineOpts}
  });

  // Equity curve
  equityChart = new Chart($c('equityChart').getContext('2d'), {
    type:'line',
    data:{labels:[],datasets:[{data:[],borderColor:'#10b981',borderWidth:2,
      fill:true,backgroundColor:'rgba(16,185,129,.06)',tension:.3}]},
    options:{...baseLineOpts}
  });

  // Weekly bar
  weeklyChart = new Chart($c('weeklyChart').getContext('2d'), {
    type:'bar',
    data:{labels:[],datasets:[{data:[],backgroundColor:[],borderRadius:5,borderSkipped:false}]},
    options:{
      responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{
        backgroundColor:'#1a2235',borderColor:'#1e2d40',borderWidth:1,
        titleColor:'#e2e8f0',bodyColor:'#94a3b8',padding:10,
        callbacks:{label:(ctx)=>( (ctx.raw >= 0 ? '+' : '') + '$' + Math.abs(ctx.raw).toFixed(2))}
      }},
      scales:{
        x:{grid:{display:false}},
        y:{grid:{color:'#1e2d40'},ticks:{callback:(v)=>(v>=0?'+':'')+'\$'+Math.abs(v).toFixed(0)}}
      }
    }
  });

  // Donut
  donutChart = new Chart($c('donutChart').getContext('2d'), {
    type:'doughnut',
    data:{labels:['Wins','Losses'],datasets:[{data:[0,1],
      backgroundColor:['#10b981','#ef4444'],borderWidth:0,hoverBorderWidth:0}]},
    options:{
      responsive:true,maintainAspectRatio:false,cutout:'72%',
      plugins:{legend:{display:false},tooltip:{
        backgroundColor:'#1a2235',borderColor:'#1e2d40',borderWidth:1,
        titleColor:'#e2e8f0',bodyColor:'#94a3b8',padding:10,
      }}
    }
  });
}

// ── Fear & Greed needle ──────────────────────────────────────
function updateGauge(val) {
  // needle: 0→-90deg (extreme fear), 100→+90deg (extreme greed)
  const deg = (val / 100) * 180 - 90;
  $c('fg-needle').setAttribute('transform', \`rotate(\${deg},100,100)\`);
  // Arc fill colour
  const arcCol = val <= 25 ? '#ef4444' : val <= 45 ? '#f59e0b' : val <= 55 ? '#64748b' : val <= 75 ? '#10b981' : '#06b6d4';
  $c('fg-needle').setAttribute('stroke', arcCol);
  $c('fg-number').style.color = arcCol;
}

// ── Main data refresh ────────────────────────────────────────
async function fetchData() {
  let d;
  try { d = await fetch('/api/data').then(r=>r.json()); }
  catch(e) { console.error('fetch failed', e); return; }

  // ── Header
  const modeEl = $c('mode-badge');
  modeEl.textContent = (d.mode === 'live' ? '🔴 LIVE' : '🟦 PAPER');
  modeEl.className = 'badge ' + (d.mode === 'live' ? 'badge-live' : 'badge-paper');
  $c('hdr-exchange').textContent = (d.exchange||'').toUpperCase();
  $c('hdr-strategy').textContent = '⚙ ' + (d.strategy||'');
  $c('hdr-symbol').textContent = (d.symbols||[]).join(', ');
  $c('uptime-lbl').textContent = 'uptime ' + uptimeFmt(d.uptimeSec||0);

  // ── Price sparkline
  const sym = (d.symbols||['BTC-USD'])[0];
  const sp = d.sparklines?.[sym] || [];
  $c('spark-label').textContent = sym + ' · ' + (d.interval||'1h');
  if (sp.length >= 2) {
    const first = sp[0].close, last = sp[sp.length-1].close;
    const chg = ((last - first) / first) * 100;
    $c('price-now').textContent = fmtPrice(last);
    $c('price-change').textContent = fmtPct(chg);
    $c('price-change').style.color = col(chg);
    sparkChart.data.labels = sp.map(c => new Date(c.time).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}));
    sparkChart.data.datasets[0].data = sp.map(c => c.close);
    sparkChart.data.datasets[0].borderColor = col(chg);
    sparkChart.data.datasets[0].backgroundColor = chg >= 0 ? 'rgba(16,185,129,.07)' : 'rgba(239,68,68,.07)';
    sparkChart.update('none');
  }

  // ── Equity curve
  const ec = d.equityCurve || [];
  const totalPnl = ec.length ? ec[ec.length-1].cumPnl : (d.realizedPnlUsd||0);
  $c('equity-total').textContent = fmtUsd(totalPnl);
  $c('equity-total').style.color = col(totalPnl);
  if (ec.length >= 1) {
    equityChart.data.labels = ec.map(p => p.date);
    equityChart.data.datasets[0].data = ec.map(p => +p.cumPnl.toFixed(2));
    equityChart.update('none');
  }

  // ── Stat cards
  const pnl = d.realizedPnlUsd + d.unrealizedPnlUsd;
  $c('stat-pnl').textContent = fmtUsd(pnl);
  $c('stat-pnl').style.color = col(pnl);
  $c('stat-pnl-sub').textContent = 'limit: -\$' + (d.risk?.maxDailyLossUsd||0);
  $c('stat-equity').textContent = '\$' + (d.totalEquityUsd||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  $c('stat-equity-sub').textContent = 'cash: \$' + (d.cash||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const unr = d.unrealizedPnlUsd||0;
  $c('stat-unrealized').textContent = fmtUsd(unr);
  $c('stat-unrealized').style.color = col(unr);
  $c('stat-unrealized-sub').textContent = (d.positions||[]).length + ' open position(s)';
  const td = d.today || {};
  $c('stat-trades').textContent = td.totalTrades||0;
  $c('stat-trades-sub').textContent = 'gross: '+fmtUsd(td.grossProfitUsd||0);
  const allWr = d.allTime?.totalTrades > 0 ? ((td.wins||0) / Math.max(d.allTime.totalTrades,1)*100) : 0;
  const todayWr = td.totalTrades > 0 ? (((td.wins||0)/td.totalTrades)*100) : 0;
  $c('stat-winrate').textContent = todayWr.toFixed(0) + '%';
  $c('stat-winrate').style.color = todayWr >= 50 ? '#10b981' : '#f59e0b';
  $c('stat-winrate-sub').textContent = 'today · ' + (d.allTime?.totalTrades||0) + ' total';
  const ks = d.killSwitch;
  $c('stat-ks').textContent = ks ? '🛑 ON' : '✅ OFF';
  $c('stat-ks').style.color = ks ? '#ef4444' : '#10b981';
  $c('stat-ks-sub').textContent = 'last candle: ' + (d.lastCandleTime ? new Date(d.lastCandleTime).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) : '—');

  // ── Weekly bar
  const weekly = (d.weekly||[]).slice().reverse();
  weeklyChart.data.labels = weekly.map(w=>w.date?.slice(5)||'');
  weeklyChart.data.datasets[0].data = weekly.map(w=> +( (w.netPnlUsd)||0).toFixed(2));
  weeklyChart.data.datasets[0].backgroundColor = weekly.map(w=> (w.netPnlUsd||0) >= 0 ? 'rgba(16,185,129,.7)' : 'rgba(239,68,68,.7)');
  weeklyChart.update('none');

  // ── Win/Loss donut
  const wins = (d.weekly||[]).reduce((s,w)=>s+(w.wins||0),0) + (td.wins||0);
  const losses = (d.weekly||[]).reduce((s,w)=>s+(w.losses||0),0) + (td.losses||0);
  const wr = wins+losses > 0 ? (wins/(wins+losses)*100) : 0;
  donutChart.data.datasets[0].data = [wins||0.001, losses||0.001];
  donutChart.update('none');
  $c('donut-center').textContent = wr.toFixed(0)+'%';
  $c('donut-center').style.color = col(wr-50);
  $c('donut-wins').textContent = wins;
  $c('donut-losses').textContent = losses;

  // ── Fear & Greed
  const sent = d.sentiment;
  if (sent) {
    const fg = sent.fearGreedIndex ?? 50;
    $c('fg-number').textContent = fg;
    $c('fg-class').textContent = sent.fearGreedLabel || '';
    $c('fg-class').style.color = fg<=25?'#ef4444':fg<=45?'#f59e0b':fg<=55?'#94a3b8':fg<=75?'#10b981':'#06b6d4';
    const ns = sent.newsScore;
    $c('fg-news').textContent = ns != null ? 'News: ' + (ns>0?'+':'') + (ns*100).toFixed(0) + '%' : 'News: —';
    updateGauge(fg);
  }

  // ── Risk panel
  const rg = $c('risk-grid');
  const risk = d.risk || {};
  const lossUsedPct = risk.maxDailyLossUsd > 0 ? Math.min(100, Math.abs(Math.min(0,pnl)) / risk.maxDailyLossUsd * 100) : 0;
  rg.innerHTML = [
    ['Max Position','$'+(risk.maxPositionUsd||0)],
    ['Max Daily Loss','$'+(risk.maxDailyLossUsd||0)],
    ['Max Open Pos',(risk.maxOpenPositions||0)],
    ['Cooldown',(risk.cooldownMinutes||0)+'m'],
  ].map(([l,v])=>\`<div class="risk-item"><div class="rl">\${l}</div><div class="rv">\${v}</div></div>\`).join('');

  const mr = $c('meter-row');
  mr.innerHTML = [
    ['Daily Loss', lossUsedPct, lossUsedPct>70?'#ef4444':lossUsedPct>40?'#f59e0b':'#10b981', lossUsedPct.toFixed(0)+'%'],
    ['Open Positions', ((d.positions||[]).length/(risk.maxOpenPositions||1))*100,
      ((d.positions||[]).length/(risk.maxOpenPositions||1))>=1?'#ef4444':'#3b82f6',
      (d.positions||[]).length+'/'+(risk.maxOpenPositions||1)],
  ].map(([l,pct,c,label])=>\`
    <div class="meter-item">
      <div class="meter-label"><span>\${l}</span><span style="color:\${c}">\${label}</span></div>
      <div class="meter-bar"><div class="meter-fill" style="width:\${pct}%;background:\${c}"></div></div>
    </div>\`).join('');

  // ── Open Positions
  const pw = $c('positions-wrap');
  const positions = d.positions || [];
  if (positions.length === 0) {
    pw.innerHTML = '<div style="color:var(--muted);padding:16px;font-size:.85rem;text-align:center;background:var(--surface);border-radius:10px;border:1px solid var(--border)">No open positions</div>';
  } else {
    pw.innerHTML = positions.map(p => {
      const upnl = p.unrealizedPnlUsd||0;
      const upct = p.unrealizedPnlPct||0;
      const pct = Math.min(100,Math.abs(upct)*5); // 20% = full bar
      return \`<div class="pos-card">
        <div>
          <div class="pos-sym">\${p.symbol}</div>
          <div class="pos-qty">\${p.quantity.toFixed(6)} × \${fmtPrice(p.marketPrice)}</div>
        </div>
        <div>
          <div style="font-size:.72rem;color:var(--muted)">entry</div>
          <div style="font-weight:600">\${fmtPrice(p.avgEntryPrice)}</div>
        </div>
        <div>
          <div style="font-size:.72rem;color:var(--muted)">value</div>
          <div style="font-weight:600">$\${p.valueUsd.toLocaleString('en-US',{maximumFractionDigits:2})}</div>
        </div>
        <div class="pos-bar">
          <div style="font-size:.7rem;color:var(--muted);margin-bottom:4px">unrealized P&amp;L</div>
          <div class="meter-bar">
            <div class="meter-fill" style="width:\${pct}%;background:\${col(upnl)}"></div>
          </div>
        </div>
        <div class="pos-pnl" style="color:\${col(upnl)}">\${fmtUsd(upnl)} (\${fmtPct(upct)})</div>
      </div>\`;
    }).join('');
  }

  // ── Recent trades
  const trades = d.recentTrades || [];
  const tb = $c('trades-tbody');
  if (trades.length === 0) {
    tb.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--muted);padding:24px">No trades yet</td></tr>';
  } else {
    tb.innerHTML = trades.slice(0,30).map(t => {
      const isExit = t.action === 'exit';
      const pnlVal = t.realizedPnlUsd;
      const pnlStr = pnlVal != null ? \`<span style="color:\${col(pnlVal)};font-weight:600">\${fmtUsd(pnlVal)}</span>\` : '—';
      const conf = t.confidence != null ? (t.confidence*100).toFixed(0)+'%' : '—';
      const confColor = t.confidence >= .7 ? 'var(--green)' : t.confidence >= .4 ? 'var(--yellow)' : 'var(--muted)';
      const dur = t.holdingDurationMs ? (t.holdingDurationMs/3600000).toFixed(1)+'h' : '—';
      const ts = new Date(t.timestamp).toLocaleString([],{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
      const side = (t.side==='buy')
        ? '<span class="pill pill-buy">▲ BUY</span>'
        : '<span class="pill pill-sell">▼ SELL</span>';
      const reason = (t.reason||'').length > 60 ? (t.reason||'').slice(0,58)+'…' : (t.reason||'—');
      return \`<tr>
        <td style="white-space:nowrap;font-size:.75rem;color:var(--muted)">\${ts}</td>
        <td style="font-weight:600">\${t.symbol||'—'}</td>
        <td>\${side}</td>
        <td>\${t.filledPrice ? fmtPrice(t.filledPrice) : '—'}</td>
        <td>\${isExit && t.filledPrice ? fmtPrice(t.filledPrice) : '—'}</td>
        <td>\${isExit ? pnlStr : '<span style="color:var(--muted)">open</span>'}</td>
        <td style="color:\${confColor}">\${conf}</td>
        <td class="reason-cell" title="\${(t.reason||'').replace(/"/g,'&quot;')}">\${reason}</td>
        <td style="color:var(--muted)">\${dur}</td>
      </tr>\`;
    }).join('');
  }

  // ── System row
  const mc = d.metricsSnap?.counters || {};
  $c('sysrow').innerHTML = [
    ['Interval', d.interval||'—'],
    ['Candle polls', mc.market_data_poll_success||0],
    ['Last candle', d.lastCandleTime ? new Date(d.lastCandleTime).toLocaleTimeString() : '—'],
    ['BTC dominance', d.marketOverview?.btcDominance ? d.marketOverview.btcDominance.toFixed(1)+'%' : '—'],
    ['Market cap', d.marketOverview?.totalMarketCap ? '\$'+Math.round(d.marketOverview.totalMarketCap/1e9)+'B' : '—'],
    ['Trailing stops', (d.trailingStops?.total||0)+' total / '+(d.trailingStops?.active||0)+' active'],
    ['All-time trades', d.allTime?.totalTrades||0],
  ].map(([l,v])=>\`<span><b>\${v}</b> \${l}</span>\`).join('');
}

// ── Countdown & auto-refresh ─────────────────────────────────
function tick() {
  countdown--;
  $c('countdown').textContent = 'next refresh in ' + countdown + 's';
  if (countdown <= 0) { countdown = 15; fetchData(); }
}

// ── Boot ─────────────────────────────────────────────────────
initCharts();
fetchData();
setInterval(tick, 1000);
</script>
</body>
</html>`;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(html);
      return;
    }

    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'not_found' }));
  });

  server.listen(config.httpPort, () => {
    logger.info('service started', {
      port: config.httpPort,
      mode: config.mode,
      exchange: config.exchange,
      strategy: strategy.name
    });
  });

  const shutdown = (): void => {
    logger.info('shutdown initiated');
    scheduler.shutdown();
    server.close(() => {
      logger.info('http server closed');
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
};

void main().catch((err) => {
  process.stderr.write(`Fatal startup error: ${String(err)}\n`);
  process.exit(1);
});
