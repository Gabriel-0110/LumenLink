import type { Candle, Ticker } from '../core/types.js';
import type { Logger } from '../core/logger.js';
import type { Metrics } from '../core/metrics.js';
import type { ExchangeAdapter } from '../exchanges/adapter.js';
import type { CandleStore } from './candleStore.js';

export class MarketDataService {
  private lastCandleBySymbol = new Map<string, Candle>();
  private fakePriceBySymbol = new Map<string, number>();

  constructor(
    private readonly exchange: ExchangeAdapter,
    private readonly store: CandleStore,
    private readonly logger: Logger,
    private readonly metrics: Metrics
  ) {}

  async poll(symbols: string[], interval: string, limit: number, useFakeFallback: boolean): Promise<void> {
    for (const symbol of symbols) {
      try {
        const candles = await this.exchange.getCandles(symbol, interval, limit);
        if (candles.length > 0) {
          await this.store.saveCandles(candles);
          const last = candles[candles.length - 1];
          this.lastCandleBySymbol.set(symbol, last);
          this.metrics.increment('market_data.poll.success');
          continue;
        }
      } catch (err) {
        this.logger.warn('exchange candle polling failed', { symbol, err: String(err) });
        this.metrics.increment('market_data.poll.error');
      }

      if (useFakeFallback) {
        const fake = this.generateFakeCandle(symbol, interval);
        await this.store.saveCandles([fake]);
        this.lastCandleBySymbol.set(symbol, fake);
        this.logger.info('using fake candle fallback', { symbol });
      }
    }
  }

  async getTickerOrSynthetic(symbol: string): Promise<Ticker> {
    try {
      return await this.exchange.getTicker(symbol);
    } catch {
      const last = this.lastCandleBySymbol.get(symbol);
      const px = last?.close ?? this.fakePriceBySymbol.get(symbol) ?? 50000;
      return { symbol, bid: px * 0.9995, ask: px * 1.0005, last: px, time: Date.now() };
    }
  }

  getLastCandleTime(): number | undefined {
    const all = Array.from(this.lastCandleBySymbol.values());
    return all.length ? Math.max(...all.map((c) => c.time)) : undefined;
  }

  private generateFakeCandle(symbol: string, interval: string): Candle {
    const previous = this.fakePriceBySymbol.get(symbol) ?? 50000;
    const drift = (Math.random() - 0.5) * 120;
    const close = Math.max(100, previous + drift);
    const open = previous;
    const high = Math.max(open, close) + Math.random() * 30;
    const low = Math.min(open, close) - Math.random() * 30;
    const candle: Candle = {
      symbol,
      interval,
      time: Date.now(),
      open,
      high,
      low,
      close,
      volume: 1 + Math.random() * 5
    };
    this.fakePriceBySymbol.set(symbol, close);
    return candle;
  }
}
