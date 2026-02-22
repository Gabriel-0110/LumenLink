import { z } from 'zod';

const parseBoolean = (v: unknown, fallback: boolean): boolean => {
  if (typeof v !== 'string') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
};

const parseNumber = (v: unknown, fallback: number): number => {
  if (typeof v !== 'string' || v.trim() === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const parseSymbols = (v: unknown, fallback: string[]): string[] => {
  if (typeof v !== 'string' || v.trim() === '') return fallback;
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
};

const rawSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  HTTP_PORT: z.coerce.number().int().positive().default(8080),

  // Support both MODE and PAPER_TRADING for backward compatibility
  MODE: z.enum(['paper', 'live']).optional(),
  PAPER_TRADING: z.string().optional(),
  EXCHANGE: z.enum(['coinbase', 'binance', 'bybit']).default('coinbase'),
  SYMBOLS: z.string().optional(),
  INTERVAL: z.string().default('1h'),
  STRATEGY: z.enum(['ema_crossover', 'rsi_mean_reversion', 'composite', 'advanced_composite', 'grid_trading', 'smart_dca']).default('rsi_mean_reversion'),

  POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  ALLOW_LIVE_TRADING: z.string().optional(),
  KILL_SWITCH: z.string().optional(),

  RISK_MAX_DAILY_LOSS_USD: z.string().optional(),
  RISK_MAX_POSITION_USD: z.string().optional(),
  RISK_MAX_OPEN_POSITIONS: z.coerce.number().int().positive().default(2),
  RISK_COOLDOWN_MINUTES: z.coerce.number().int().nonnegative().default(15),

  GUARD_MAX_SPREAD_BPS: z.string().optional(),
  GUARD_MAX_SLIPPAGE_BPS: z.string().optional(),
  GUARD_MIN_VOLUME: z.string().optional(),

  DATA_PROVIDER: z.enum(['exchange', 'coingecko', 'cmc']).optional(),
  DATA_POLLING_MS: z.coerce.number().int().positive().default(5000),
  DATA_FAKE_FALLBACK: z.string().optional(),

  ALERT_TELEGRAM_ENABLED: z.string().optional(),
  ALERT_TELEGRAM_CHAT_ID: z.string().optional(),
  ALERT_DISCORD_ENABLED: z.string().optional(),

  SECRETS_PROVIDER: z.enum(['env', '1password', 'op', 'aws']).optional(),
  USE_AWS_SECRETS_MANAGER: z.string().optional(),
  OP_VAULT: z.string().default('Trading'),
  AWS_REGION: z.string().default('us-east-1'),

  // Core trading API secrets
  SECRET_ID_COINBASE_KEY: z.string().default('prod/trading/coinbase/key'),
  SECRET_ID_COINBASE_SECRET: z.string().default('prod/trading/coinbase/secret'),
  SECRET_ID_COINBASE_PASSPHRASE: z.string().default('prod/trading/coinbase/passphrase'),
  SECRET_ID_BINANCE_KEY: z.string().default('prod/trading/binance/key'),
  SECRET_ID_BINANCE_SECRET: z.string().default('prod/trading/binance/secret'),
  
  // Data API secrets (optional)
  SECRET_ID_CRYPTOPANIC_KEY: z.string().default('prod/data/cryptopanic/key'),
  SECRET_ID_COINGECKO_KEY: z.string().default('prod/data/coingecko/key'),
  SECRET_ID_COINMARKETCAP_KEY: z.string().default('prod/data/coinmarketcap/key'),
  SECRET_ID_TWELVEDATA_KEY: z.string().default('prod/data/twelvedata/key'),
  SECRET_ID_NEWS_API_KEY: z.string().default('prod/data/newsapi/key'),
  SECRET_ID_LUNARCRUSH_KEY: z.string().default('prod/data/lunarcrush/key'),
  SECRET_ID_GLASSNODE_KEY: z.string().default('prod/data/glassnode/key'),
  SECRET_ID_NANSEN_KEY: z.string().default('prod/data/nansen/key'),
  SECRET_ID_OPENAI_KEY: z.string().default('prod/ai/openai/key'),
  SECRET_ID_ETHERSCAN_KEY: z.string().default('prod/data/etherscan/key'),
  
  // Kill switch thresholds
  KILL_SWITCH_MAX_DRAWDOWN_PCT: z.string().optional(),
  KILL_SWITCH_MAX_CONSECUTIVE_LOSSES: z.string().optional(),
  KILL_SWITCH_API_ERROR_THRESHOLD: z.string().optional(),
  KILL_SWITCH_SPREAD_VIOLATIONS_LIMIT: z.string().optional(),
  KILL_SWITCH_SPREAD_VIOLATIONS_WINDOW_MIN: z.string().optional(),

  // Retry config
  RETRY_MAX_ATTEMPTS: z.string().optional(),
  RETRY_BASE_DELAY_MS: z.string().optional(),

  // Alert secrets
  SECRET_ID_TELEGRAM_TOKEN: z.string().default('prod/alerts/telegram/token'),
  SECRET_ID_DISCORD_WEBHOOK: z.string().default('prod/alerts/discord/webhook')
});

export const configSchema = rawSchema.transform((raw) => {
  const symbols = parseSymbols(raw.SYMBOLS, raw.EXCHANGE === 'binance' || raw.EXCHANGE === 'bybit' ? ['BTC/USDT', 'ETH/USDT'] : ['BTC-USD', 'ETH-USD']);
  const maxDailyLossUsd = parseNumber(raw.RISK_MAX_DAILY_LOSS_USD, 150);
  const maxPositionUsd = parseNumber(raw.RISK_MAX_POSITION_USD, 250);
  const maxSpreadBps = parseNumber(raw.GUARD_MAX_SPREAD_BPS, 25);
  const maxSlippageBps = parseNumber(raw.GUARD_MAX_SLIPPAGE_BPS, 20);
  const minVolume = parseNumber(raw.GUARD_MIN_VOLUME, 0);

  // Handle MODE vs PAPER_TRADING compatibility
  let mode: 'paper' | 'live' = 'paper';
  if (raw.MODE) {
    mode = raw.MODE;
  } else if (raw.PAPER_TRADING) {
    // Convert PAPER_TRADING boolean to MODE enum
    mode = parseBoolean(raw.PAPER_TRADING, true) ? 'paper' : 'live';
  }

  return {
    nodeEnv: raw.NODE_ENV,
    logLevel: raw.LOG_LEVEL,
    httpPort: raw.HTTP_PORT,

    mode,
    exchange: raw.EXCHANGE,
    symbols,
    interval: raw.INTERVAL,
    strategy: raw.STRATEGY,

    pollIntervalMs: raw.POLL_INTERVAL_MS,
    allowLiveTrading: parseBoolean(raw.ALLOW_LIVE_TRADING, false),
    killSwitch: parseBoolean(raw.KILL_SWITCH, true),

    risk: {
      maxDailyLossUsd,
      maxPositionUsd,
      maxOpenPositions: raw.RISK_MAX_OPEN_POSITIONS,
      cooldownMinutes: raw.RISK_COOLDOWN_MINUTES
    },

    guards: {
      maxSpreadBps,
      maxSlippageBps,
      minVolume
    },

    data: {
      provider: raw.DATA_PROVIDER,
      pollingMs: raw.DATA_POLLING_MS,
      fakeFallback: parseBoolean(raw.DATA_FAKE_FALLBACK, true)
    },

    alerts: {
      telegram: {
        enabled: parseBoolean(raw.ALERT_TELEGRAM_ENABLED, false),
        chatId: raw.ALERT_TELEGRAM_CHAT_ID
      },
      discord: {
        enabled: parseBoolean(raw.ALERT_DISCORD_ENABLED, false)
      }
    },

    killSwitchConfig: {
      maxDrawdownPct: parseNumber(raw.KILL_SWITCH_MAX_DRAWDOWN_PCT, 5),
      maxConsecutiveLosses: parseNumber(raw.KILL_SWITCH_MAX_CONSECUTIVE_LOSSES, 5),
      apiErrorThreshold: parseNumber(raw.KILL_SWITCH_API_ERROR_THRESHOLD, 10),
      spreadViolationsLimit: parseNumber(raw.KILL_SWITCH_SPREAD_VIOLATIONS_LIMIT, 5),
      spreadViolationsWindowMin: parseNumber(raw.KILL_SWITCH_SPREAD_VIOLATIONS_WINDOW_MIN, 10),
    },

    retry: {
      maxAttempts: parseNumber(raw.RETRY_MAX_ATTEMPTS, 3),
      baseDelayMs: parseNumber(raw.RETRY_BASE_DELAY_MS, 1000),
    },

    secrets: {
      useAwsSecretsManager: parseBoolean(raw.USE_AWS_SECRETS_MANAGER, false),
      awsRegion: raw.AWS_REGION,
      secretIds: {
        // Core trading APIs
        coinbaseKey: raw.SECRET_ID_COINBASE_KEY,
        coinbaseSecret: raw.SECRET_ID_COINBASE_SECRET,
        coinbasePassphrase: raw.SECRET_ID_COINBASE_PASSPHRASE,
        binanceKey: raw.SECRET_ID_BINANCE_KEY,
        binanceSecret: raw.SECRET_ID_BINANCE_SECRET,
        
        // Data APIs (optional)
        cryptoPanicKey: raw.SECRET_ID_CRYPTOPANIC_KEY,
        coingeckoKey: raw.SECRET_ID_COINGECKO_KEY,
        coinmarketcapKey: raw.SECRET_ID_COINMARKETCAP_KEY,
        twelvedataKey: raw.SECRET_ID_TWELVEDATA_KEY,
        newsApiKey: raw.SECRET_ID_NEWS_API_KEY,
        lunarcrushKey: raw.SECRET_ID_LUNARCRUSH_KEY,
        glassnodeKey: raw.SECRET_ID_GLASSNODE_KEY,
        nansenKey: raw.SECRET_ID_NANSEN_KEY,
        openaiKey: raw.SECRET_ID_OPENAI_KEY,
        etherscanKey: raw.SECRET_ID_ETHERSCAN_KEY,
        
        // Alerts
        telegramToken: raw.SECRET_ID_TELEGRAM_TOKEN,
        discordWebhook: raw.SECRET_ID_DISCORD_WEBHOOK
      }
    }
  };
});
