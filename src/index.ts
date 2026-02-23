import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config/load.js';
import { JsonLogger } from './core/logger.js';
import { InMemoryMetrics } from './core/metrics.js';
import { PrometheusMetrics } from './core/prometheusMetrics.js';
import { TradeJournal } from './data/tradeJournal.js';

import { InMemoryStore } from './data/inMemoryStore.js';
import { SqliteStore } from './data/sqliteStore.js';
import { MarketDataService } from './data/marketDataService.js';
import { SentimentService } from './data/sentimentService.js';
import { OnChainService } from './data/onchainService.js';
import { OrderState } from './execution/orderState.js';
import { PaperBroker } from './execution/paperBroker.js';
import { LiveBroker } from './execution/liveBroker.js';
import { OrderManager } from './execution/orderManager.js';
import { KillSwitch } from './execution/killSwitch.js';
import { RetryExecutor } from './execution/retryExecutor.js';
import { PositionStateMachine } from './execution/positionStateMachine.js';
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
import { InventoryManager } from './execution/inventoryManager.js';
import { FillReconciler } from './execution/fillReconciler.js';
import { TradeGatekeeper } from './risk/tradeGatekeeper.js';
import { HealthReport } from './core/healthReport.js';
import type { CoinbaseAuthMaterial } from './exchanges/coinbase/auth.js';
import type { Balance, Candle, Order, OrderRequest, Ticker } from './core/types.js';
import { createRouter } from '../backend/src/api/routes.js';
import { createWebSocketServer } from '../backend/src/websocket/server.js';

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

  // --- Execution engine modules ---
  let killSwitch: KillSwitch | undefined;
  let retryExecutor: RetryExecutor | undefined;
  let positionSM: PositionStateMachine | undefined;

  if (store instanceof SqliteStore) {
    const db = store.getDatabase();

    // Kill Switch — persists across restarts, halts trading on drawdown/losses/errors
    killSwitch = new KillSwitch(config.killSwitchConfig, logger, metrics);
    killSwitch.init(db);
    killSwitch.setPersistFn(() => killSwitch!.persist(db));

    // Position State Machine — tracks position lifecycle in SQLite
    positionSM = new PositionStateMachine(store, logger);
    await positionSM.init(db);

    logger.info('execution engine modules initialized', {
      killSwitchActive: killSwitch.isTriggered(),
      activePositions: positionSM.getAllActive().length,
    });
  }

  // Retry Executor — exponential backoff with circuit breaker
  retryExecutor = new RetryExecutor(config.retry, logger, metrics);

  const orderManager = new OrderManager(
    config,
    orderState,
    new PaperBroker(),
    new LiveBroker(exchange),
    logger,
    metrics,
    killSwitch,
    retryExecutor,
    positionSM
  );

  const reconciler = new Reconciler(exchange, orderState, logger, metrics);

  // ── Phase 1+2+3: Inventory, fill reconciliation, trade gates ──
  const inventoryManager = new InventoryManager(logger);
  const tradeGatekeeper = new TradeGatekeeper(logger, {
    sellCooldownMinutes: Math.max(config.risk.cooldownMinutes, config.gatekeeper.sellCooldownMinutes),
    feeRateBps: config.gatekeeper.feeRateBps,
    estimatedSlippageBps: config.gatekeeper.estimatedSlippageBps,
    safetyMarginBps: config.gatekeeper.safetyMarginBps,
    minNotionalUsd: config.gatekeeper.minNotionalUsd,
    chopAdxThreshold: config.gatekeeper.chopAdxThreshold,
  });
  const healthReport = new HealthReport(logger);

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
    onChainService,
    killSwitch,
    journal,
    inventoryManager,
    tradeGatekeeper,
    healthReport,
  );

  // ── Phase 1A: Coinbase is source of truth on startup ──
  // Pull balances, fills, open orders and rebuild local state from exchange.
  // Paper mode keeps the $10k default cash and no seeded positions.
  logger.info('startup config summary', {
    mode: config.mode,
    exchange: config.exchange,
    symbols: config.symbols,
    strategy: config.strategy,
    dryRun: config.dryRun,
    killSwitch: config.killSwitch,
    allowLiveTrading: config.allowLiveTrading,
    maxDailyLossUsd: config.risk.maxDailyLossUsd,
    maxPositionUsd: config.risk.maxPositionUsd,
    deployPercent: `${(config.risk.deployPercent * 100).toFixed(0)}%`,
    cooldownMinutes: config.risk.cooldownMinutes,
    killFileExists: fs.existsSync('./KILL'),
  });

  let coinbaseAuth: CoinbaseAuthMaterial | undefined;
  if (config.mode === 'live') {
    await inventoryManager.hydrateFromExchange(exchange, config.symbols);
    await loops.hydrateFromInventory(inventoryManager);

    // Verify startup sync health
    const { diffs } = await inventoryManager.resync(exchange, config.symbols);
    healthReport.recordStartupSync(diffs.length === 0 ? 'ok' : 'mismatch', diffs);

    // Cache auth material for FillReconciler (Coinbase-specific)
    if (config.exchange === 'coinbase') {
      const apiKey = await secrets.getSecret(config.secrets.secretIds.coinbaseKey, 'COINBASE_API_KEY');
      const apiSecret = await secrets.getSecret(config.secrets.secretIds.coinbaseSecret, 'COINBASE_API_SECRET');
      coinbaseAuth = { apiKey, apiSecret };
    }
  } else {
    logger.info('paper mode — starting with simulated $10,000 cash, no seeded positions');
  }

  // ── Phase 1E: Fill reconciler (Coinbase-specific) ──
  const fillReconciler = coinbaseAuth
    ? new FillReconciler(exchange, journal, inventoryManager, coinbaseAuth, logger)
    : undefined;

  const scheduler = new Scheduler(logger);
  scheduler.add('market-data', config.data.pollingMs, async () => loops.marketDataLoop());
  scheduler.add('strategy', config.strategyIntervalMs, async () => loops.strategyLoop());
  if (config.mode === 'live') {
    scheduler.add('reconcile', Math.max(10_000, config.pollIntervalMs), async () => loops.reconciliationLoop());
    // Phase 1E: Full fill reconciliation every 5 minutes
    if (fillReconciler) {
      loops.setFillReconciler(fillReconciler);
      scheduler.add('fill-reconcile', 300_000, async () => {
        const result = await fillReconciler.reconcile(config.symbols);
        healthReport.recordReconciliation(result);
      });
    }
  }

  // Health report every hour
  scheduler.add('health-report', 3_600_000, async () => {
    await healthReport.printSummary(
      config.mode === 'live' ? exchange : undefined,
      config.mode === 'live' ? inventoryManager : undefined,
      config.symbols,
    );
  });
  // Add sentiment loop (every 15 minutes = 900,000ms)
  if (sentimentService && onChainService) {
    scheduler.add('sentiment', 900_000, async () => loops.sentimentLoop());
  }

  const startedAt = Date.now();

  // ── Backend router (replaces monolithic inline handler) ──────────────────
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const frontendDist = path.resolve(__dirname, '..', 'frontend', 'dist');
  const hasFrontendBuild = fs.existsSync(path.join(frontendDist, 'index.html'));

  const MIME_TYPES: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.json': 'application/json',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
  };

  const apiHandler = createRouter({
    context: {
      config,
      logger,
      metrics,
      loops,
      killSwitch,
      journal,
      healthReport,
      strategy,
      startedAt,
    },
    auth: { apiKey: process.env['LUMENLINK_API_KEY'] },
  });

  const server = http.createServer(async (req, res) => {
    if (!req.url) {
      res.statusCode = 400;
      res.end('Bad request');
      return;
    }

    const pathname = (req.url ?? '').split('?')[0] ?? '';

    // API routes handled by backend router
    const isApiRoute = pathname === '/health' || pathname === '/status' ||
      pathname === '/metrics' || pathname === '/dashboard' ||
      pathname.startsWith('/api/');
    if (isApiRoute || req.method === 'OPTIONS') {
      await apiHandler(req, res);
      return;
    }

    // Serve frontend static files (production build)
    if (hasFrontendBuild && req.method === 'GET') {
      // Prevent path traversal — resolve and verify within frontendDist
      const resolved = path.resolve(frontendDist, '.' + pathname);
      if (!resolved.startsWith(frontendDist)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'forbidden' }));
        return;
      }

      let filePath = resolved;

      // SPA fallback: non-file paths serve index.html
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(frontendDist, 'index.html');
      }

      try {
        const content = fs.readFileSync(filePath);
        const ext = path.extname(filePath);
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream' });
        res.end(content);
        return;
      } catch {
        // Fall through to 404
      }
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not_found", path: pathname }));
  });

  // ── WebSocket server for real-time dashboard updates ──
  createWebSocketServer({
    httpServer: server,
    logger,
    apiKey: process.env["LUMENLINK_API_KEY"],
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
