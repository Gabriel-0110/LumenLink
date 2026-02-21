import http from 'node:http';
import { loadConfig } from './config/load.js';
import { JsonLogger } from './core/logger.js';
import { InMemoryMetrics } from './core/metrics.js';
import { InMemoryStore } from './data/inMemoryStore.js';
import { SqliteStore } from './data/sqliteStore.js';
import { MarketDataService } from './data/marketDataService.js';
import { OrderState } from './execution/orderState.js';
import { PaperBroker } from './execution/paperBroker.js';
import { LiveBroker } from './execution/liveBroker.js';
import { OrderManager } from './execution/orderManager.js';
import { Reconciler } from './execution/reconciler.js';
import { RiskEngine } from './risk/riskEngine.js';
import { EmaCrossoverStrategy } from './strategies/emaCrossover.js';
import { RsiMeanReversionStrategy } from './strategies/rsiMeanReversion.js';
import { CompositeExampleStrategy } from './strategies/compositeExample.js';
import type { Strategy } from './strategies/interface.js';
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
  const metrics = new InMemoryMetrics();

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

  const store = config.nodeEnv === 'test' ? new InMemoryStore() : new SqliteStore();
  const marketData = new MarketDataService(exchange, store, logger, metrics);
  const riskEngine = new RiskEngine(config);
  const orderState = new OrderState(store);
  await orderState.hydrateFromStore();

  const strategy: Strategy =
    config.strategy === 'ema_crossover'
      ? new EmaCrossoverStrategy()
      : config.strategy === 'rsi_mean_reversion'
        ? new RsiMeanReversionStrategy()
        : new CompositeExampleStrategy();

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

  const loops = new TradingLoops(
    config,
    marketData,
    store,
    strategy,
    riskEngine,
    orderManager,
    reconciler,
    alertMux,
    logger
  );

  const scheduler = new Scheduler(logger);
  scheduler.add('market-data', config.data.pollingMs, async () => loops.marketDataLoop());
  scheduler.add('strategy', config.pollIntervalMs, async () => loops.strategyLoop());
  if (config.mode === 'live') {
    scheduler.add('reconcile', Math.max(10_000, config.pollIntervalMs), async () => loops.reconciliationLoop());
  }

  const startedAt = Date.now();
  const server = http.createServer((req, res) => {
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
