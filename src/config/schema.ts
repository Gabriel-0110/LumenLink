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

  MODE: z.enum(['paper', 'live']).default('paper'),
  EXCHANGE: z.enum(['coinbase', 'binance', 'bybit']).default('coinbase'),
  SYMBOLS: z.string().optional(),
  INTERVAL: z.string().default('1h'),
  STRATEGY: z.enum(['ema_crossover', 'rsi_mean_reversion', 'composite', 'advanced_composite']).default('rsi_mean_reversion'),

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

  USE_AWS_SECRETS_MANAGER: z.string().optional(),
  AWS_REGION: z.string().default('us-east-1'),

  SECRET_ID_COINBASE_KEY: z.string().default('prod/trading/coinbase/key'),
  SECRET_ID_COINBASE_SECRET: z.string().default('prod/trading/coinbase/secret'),
  SECRET_ID_COINBASE_PASSPHRASE: z.string().default('prod/trading/coinbase/passphrase'),
  SECRET_ID_BINANCE_KEY: z.string().default('prod/trading/binance/key'),
  SECRET_ID_BINANCE_SECRET: z.string().default('prod/trading/binance/secret'),
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

  return {
    nodeEnv: raw.NODE_ENV,
    logLevel: raw.LOG_LEVEL,
    httpPort: raw.HTTP_PORT,

    mode: raw.MODE,
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

    secrets: {
      useAwsSecretsManager: parseBoolean(raw.USE_AWS_SECRETS_MANAGER, false),
      awsRegion: raw.AWS_REGION,
      secretIds: {
        coinbaseKey: raw.SECRET_ID_COINBASE_KEY,
        coinbaseSecret: raw.SECRET_ID_COINBASE_SECRET,
        coinbasePassphrase: raw.SECRET_ID_COINBASE_PASSPHRASE,
        binanceKey: raw.SECRET_ID_BINANCE_KEY,
        binanceSecret: raw.SECRET_ID_BINANCE_SECRET,
        telegramToken: raw.SECRET_ID_TELEGRAM_TOKEN,
        discordWebhook: raw.SECRET_ID_DISCORD_WEBHOOK
      }
    }
  };
});
