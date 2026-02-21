import type { Candle, Ticker } from '../core/types.js';
import type { Logger } from '../core/logger.js';
import type { Metrics } from '../core/metrics.js';
import type { ExchangeAdapter } from '../exchanges/adapter.js';
import type { CandleStore } from './candleStore.js';

// Symbol mapping for different exchange formats
const SYMBOL_MAPPINGS = {
  coingecko: {
    'BTC/USDT': 'bitcoin',
    'BTC-USD': 'bitcoin',
    'BTC/USD': 'bitcoin',
    'BTCUSD': 'bitcoin',
    'ETH/USDT': 'ethereum',
    'ETH-USD': 'ethereum', 
    'ETH/USD': 'ethereum',
    'ETHUSD': 'ethereum',
  },
  coinbase_public: {
    'BTC/USDT': 'BTC-USD',
    'BTC-USD': 'BTC-USD',
    'BTC/USD': 'BTC-USD',
    'BTCUSD': 'BTC-USD',
    'ETH/USDT': 'ETH-USD', 
    'ETH-USD': 'ETH-USD',
    'ETH/USD': 'ETH-USD',
    'ETHUSD': 'ETH-USD',
  }
} as const;

type CoinGeckoCandle = [number, number, number, number, number]; // [timestamp, open, high, low, close]

type CoinbasePublicCandle = [number, number, number, number, number, number]; // [timestamp, low, high, open, close, volume]

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
          const last = candles[candles.length - 1]!;
          this.lastCandleBySymbol.set(symbol, last);
          this.metrics.increment('market_data.poll.success');
          continue;
        }
      } catch (err) {
        this.logger.warn('exchange candle polling failed', { symbol, err: String(err) });
        this.metrics.increment('market_data.poll.error');
      }

      if (useFakeFallback) {
        // Try real free APIs first, then fall back to fake data
        const realCandles = await this.fetchRealCandlesFromFreeAPI(symbol, interval, limit);
        if (realCandles && realCandles.length > 0) {
          await this.store.saveCandles(realCandles);
          const last = realCandles[realCandles.length - 1]!;
          this.lastCandleBySymbol.set(symbol, last);
          this.logger.info('using free API candle data', { symbol, source: 'coinbase_public', count: realCandles.length });
          this.metrics.increment('market_data.poll.free_api_success');
        } else {
          // Final fallback to fake data
          const fake = this.generateFakeCandle(symbol, interval);
          await this.store.saveCandles([fake]);
          this.lastCandleBySymbol.set(symbol, fake);
          this.logger.warn('using fake candle fallback (free APIs failed)', { symbol });
          this.metrics.increment('market_data.poll.fake_fallback');
        }
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

  /**
   * Fetch real candles from free public APIs (no authentication needed)
   */
  private async fetchRealCandlesFromFreeAPI(symbol: string, interval: string, limit: number): Promise<Candle[] | null> {
    // Try Coinbase public API first (more reliable for US symbols)
    const coinbaseCandles = await this.fetchCoinbasePublicCandles(symbol, interval, limit);
    if (coinbaseCandles && coinbaseCandles.length > 0) {
      return coinbaseCandles;
    }

    // Fall back to CoinGecko API
    const coingeckoCandles = await this.fetchCoinGeckoCandles(symbol, interval, limit);
    if (coingeckoCandles && coingeckoCandles.length > 0) {
      return coingeckoCandles;
    }

    return null;
  }

  /**
   * Fetch candles from Coinbase public API (no auth required)
   */
  private async fetchCoinbasePublicCandles(symbol: string, interval: string, limit: number): Promise<Candle[] | null> {
    try {
      const coinbaseSymbol = SYMBOL_MAPPINGS.coinbase_public[symbol as keyof typeof SYMBOL_MAPPINGS.coinbase_public];
      if (!coinbaseSymbol) {
        this.logger.debug('symbol not supported by coinbase public api', { symbol });
        return null;
      }

      // Map intervals to Coinbase granularity (in seconds)
      const granularityMap: Record<string, number> = {
        '1m': 60,
        '5m': 300,
        '15m': 900,
        '1h': 3600,
        '4h': 14400,
        '1d': 86400
      };

      const granularity = granularityMap[interval];
      if (!granularity) {
        this.logger.debug('interval not supported by coinbase public api', { interval });
        return null;
      }

      const endTime = Math.floor(Date.now() / 1000);
      const startTime = endTime - (limit * granularity);

      const url = `https://api.exchange.coinbase.com/products/${coinbaseSymbol}/candles?start=${startTime}&end=${endTime}&granularity=${granularity}`;
      
      const response = await fetch(url);
      if (!response.ok) {
        this.logger.warn('coinbase public api request failed', { status: response.status, symbol, interval });
        return null;
      }

      const rawCandles: CoinbasePublicCandle[] = await response.json();
      
      // Coinbase returns candles in reverse chronological order, so reverse them
      const candles: Candle[] = rawCandles.reverse().map((candle) => ({
        symbol,
        interval,
        time: candle[0] * 1000, // Convert to milliseconds
        open: candle[3],
        high: candle[2],
        low: candle[1],
        close: candle[4],
        volume: candle[5]
      }));

      this.logger.debug('fetched candles from coinbase public api', { symbol, count: candles.length });
      return candles;

    } catch (error) {
      this.logger.warn('coinbase public api error', { symbol, error: String(error) });
      return null;
    }
  }

  /**
   * Fetch candles from CoinGecko API (free tier, no auth required)
   */
  private async fetchCoinGeckoCandles(symbol: string, interval: string, limit: number): Promise<Candle[] | null> {
    try {
      const coinGeckoId = SYMBOL_MAPPINGS.coingecko[symbol as keyof typeof SYMBOL_MAPPINGS.coingecko];
      if (!coinGeckoId) {
        this.logger.debug('symbol not supported by coingecko api', { symbol });
        return null;
      }

      // CoinGecko OHLC endpoint only supports daily candles for free tier
      if (interval !== '1d') {
        this.logger.debug('coingecko free tier only supports daily candles', { interval });
        return null;
      }

      const days = Math.min(limit, 30); // Free tier limited to 30 days
      const url = `https://api.coingecko.com/api/v3/coins/${coinGeckoId}/ohlc?vs_currency=usd&days=${days}`;
      
      const response = await fetch(url);
      if (!response.ok) {
        this.logger.warn('coingecko api request failed', { status: response.status, symbol, interval });
        return null;
      }

      const rawCandles: CoinGeckoCandle[] = await response.json();
      
      const candles: Candle[] = rawCandles.map((candle) => ({
        symbol,
        interval,
        time: candle[0],
        open: candle[1],
        high: candle[2],
        low: candle[3],
        close: candle[4],
        volume: 1000 // CoinGecko OHLC doesn't include volume, use placeholder
      }));

      this.logger.debug('fetched candles from coingecko api', { symbol, count: candles.length });
      return candles;

    } catch (error) {
      this.logger.warn('coingecko api error', { symbol, error: String(error) });
      return null;
    }
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
