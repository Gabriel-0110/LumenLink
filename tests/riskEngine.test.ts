import { describe, expect, it } from 'vitest';
import { RiskEngine } from '../src/risk/riskEngine.js';
import type { AppConfig } from '../src/config/types.js';

const baseConfig: AppConfig = {
  nodeEnv: 'test',
  logLevel: 'info',
  httpPort: 8080,
  mode: 'paper',
  exchange: 'coinbase',
  symbols: ['BTC-USD'],
  interval: '1m',
  strategy: 'ema_crossover',
  pollIntervalMs: 1000,
  allowLiveTrading: false,
  killSwitch: true,
  risk: {
    maxDailyLossUsd: 100,
    maxPositionUsd: 250,
    maxOpenPositions: 1,
    cooldownMinutes: 15
  },
  guards: {
    maxSpreadBps: 20,
    maxSlippageBps: 20,
    minVolume: 100
  },
  data: {
    provider: 'exchange',
    pollingMs: 1000,
    fakeFallback: true
  },
  alerts: {
    telegram: { enabled: false, chatId: undefined },
    discord: { enabled: false }
  },
  killSwitchConfig: { maxDrawdownPct: 5, maxConsecutiveLosses: 5, apiErrorThreshold: 10, spreadViolationsLimit: 5, spreadViolationsWindowMin: 10 },
  retry: { maxAttempts: 3, baseDelayMs: 1000 },
  secrets: {
    useAwsSecretsManager: false,
    awsRegion: 'us-east-1',
    secretIds: {
      coinbaseKey: 'a',
      coinbaseSecret: 'b',
      coinbasePassphrase: 'c',
      binanceKey: 'prod/trading/binance/key',
      binanceSecret: 'prod/trading/binance/secret',
      cryptoPanicKey: '',
      coingeckoKey: '',
      coinmarketcapKey: '',
      twelvedataKey: '',
      newsApiKey: '',
      lunarcrushKey: '',
      glassnodeKey: '',
      nansenKey: '',
      openaiKey: '',
      etherscanKey: '',
      telegramToken: 'd',
      discordWebhook: 'e'
    }
  }
};

describe('risk engine', () => {
  it('blocks when max daily loss reached', () => {
    const engine = new RiskEngine(baseConfig);
    const decision = engine.evaluate({
      signal: { action: 'BUY', confidence: 0.8, reason: 'x' },
      symbol: 'BTC-USD',
      snapshot: {
        cashUsd: 1000,
        realizedPnlUsd: -101,
        unrealizedPnlUsd: 0,
        openPositions: [],
        lastStopOutAtBySymbol: {}
      },
      ticker: { symbol: 'BTC-USD', bid: 100, ask: 100.1, last: 100, volume24h: 1000, time: Date.now() },
      nowMs: Date.now()
    });
    expect(decision.allowed).toBe(false);
    expect(decision.blockedBy).toBe('max_daily_loss');
  });

  it('blocks when spread is too high', () => {
    const engine = new RiskEngine(baseConfig);
    const decision = engine.evaluate({
      signal: { action: 'BUY', confidence: 0.8, reason: 'x' },
      symbol: 'BTC-USD',
      snapshot: {
        cashUsd: 1000,
        realizedPnlUsd: 0,
        unrealizedPnlUsd: 0,
        openPositions: [],
        lastStopOutAtBySymbol: {}
      },
      ticker: { symbol: 'BTC-USD', bid: 100, ask: 102, last: 101, volume24h: 1000, time: Date.now() },
      nowMs: Date.now()
    });
    expect(decision.allowed).toBe(false);
    expect(decision.blockedBy).toBe('spread_guard');
  });
});
