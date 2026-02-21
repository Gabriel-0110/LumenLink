import { describe, expect, it } from 'vitest';
import { OrderManager } from '../src/execution/orderManager.js';
import { OrderState } from '../src/execution/orderState.js';
import { PaperBroker } from '../src/execution/paperBroker.js';
import { LiveBroker } from '../src/execution/liveBroker.js';
import { InMemoryStore } from '../src/data/inMemoryStore.js';
import type { AppConfig } from '../src/config/types.js';
import { JsonLogger } from '../src/core/logger.js';
import { InMemoryMetrics } from '../src/core/metrics.js';

const config: AppConfig = {
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
  risk: { maxDailyLossUsd: 100, maxPositionUsd: 200, maxOpenPositions: 2, cooldownMinutes: 10 },
  guards: { maxSpreadBps: 25, maxSlippageBps: 20, minVolume: 0 },
  data: { provider: 'exchange', pollingMs: 1000, fakeFallback: true },
  alerts: { telegram: { enabled: false, chatId: undefined }, discord: { enabled: false } },
  secrets: {
    useAwsSecretsManager: false,
    awsRegion: 'us-east-1',
    secretIds: {
      coinbaseKey: 'a',
      coinbaseSecret: 'b',
      coinbasePassphrase: 'c',
      telegramToken: 'd',
      discordWebhook: 'e'
    }
  }
};

describe('order manager', () => {
  it('returns existing order for same idempotency key', async () => {
    const store = new InMemoryStore();
    const manager = new OrderManager(
      config,
      new OrderState(store),
      new PaperBroker(),
      new LiveBroker({
        async getTicker() {
          throw new Error('unused');
        },
        async getCandles() {
          throw new Error('unused');
        },
        async placeOrder() {
          throw new Error('unused');
        },
        async cancelOrder() {
          throw new Error('unused');
        },
        async getOrder() {
          throw new Error('unused');
        },
        async listOpenOrders() {
          throw new Error('unused');
        },
        async getBalances() {
          throw new Error('unused');
        }
      }),
      new JsonLogger('error'),
      new InMemoryMetrics()
    );

    const input = {
      symbol: 'BTC-USD',
      signal: { action: 'BUY' as const, confidence: 0.8, reason: 'test' },
      ticker: { symbol: 'BTC-USD', bid: 100, ask: 100.1, last: 100, time: Date.now() },
      idempotencyKey: 'fixed-key'
    };

    const first = await manager.submitSignal(input);
    const second = await manager.submitSignal(input);

    expect(first?.orderId).toBeDefined();
    expect(second?.orderId).toBe(first?.orderId);
  });
});
