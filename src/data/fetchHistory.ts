/**
 * fetch-history — Backfill 6 months of OHLCV candle data from exchange into SQLite.
 *
 * Usage:
 *   pnpm run fetch-history
 *   SYMBOLS=BTC-USD,ETH-USD,SOL-USD TIMEFRAMES=1h,4h,1d MONTHS=6 pnpm run fetch-history
 *
 * Respects .env for exchange credentials. Paginates automatically.
 */

import dotenv from 'dotenv';
dotenv.config();

import ccxt from 'ccxt';
import { SqliteStore } from './sqliteStore.js';
import type { Candle } from '../core/types.js';

// ── Config ──────────────────────────────────────────────────────────────

const EXCHANGE_ID = process.env.EXCHANGE ?? 'coinbase';
const SYMBOLS = (process.env.SYMBOLS ?? 'BTC-USD,ETH-USD').split(',').map(s => s.trim()).filter(Boolean);
const TIMEFRAMES = (process.env.TIMEFRAMES ?? '1m,5m,15m,1h,4h,1d').split(',').map(s => s.trim()).filter(Boolean);
const MONTHS = Number(process.env.MONTHS ?? '6');
const BATCH_SIZE = 300; // candles per request (exchange max is usually 300-1000)
const RATE_LIMIT_MS = 350; // ms between requests to stay under limits

// ── Helpers ─────────────────────────────────────────────────────────────

const timeframeToMs: Record<string, number> = {
  '1m': 60_000,
  '3m': 180_000,
  '5m': 300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '1h': 3_600_000,
  '2h': 7_200_000,
  '4h': 14_400_000,
  '6h': 21_600_000,
  '8h': 28_800_000,
  '12h': 43_200_000,
  '1d': 86_400_000,
  '3d': 259_200_000,
  '1w': 604_800_000,
};

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface OhlcvExchange {
  fetchOHLCV(symbol: string, timeframe: string, since?: number, limit?: number): Promise<number[][]>;
}

type ExchangeConstructor = new (options?: Record<string, unknown>) => OhlcvExchange;

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  const store = new SqliteStore('./data/runtime.sqlite');

  // Init exchange (public endpoints only — no API keys needed for OHLCV)
  const exchangeConstructors = ccxt as unknown as Record<string, ExchangeConstructor>;
  const ExchangeClass = exchangeConstructors[EXCHANGE_ID];
  if (!ExchangeClass) throw new Error(`Unknown exchange: ${EXCHANGE_ID}`);

  const exchange = new ExchangeClass({ enableRateLimit: true });

  const now = Date.now();
  const sinceMs = now - MONTHS * 30 * 24 * 60 * 60 * 1000;

  console.log(`\n📊 LumenLink Historical Data Fetcher`);
  console.log(`   Exchange:   ${EXCHANGE_ID}`);
  console.log(`   Symbols:    ${SYMBOLS.join(', ')}`);
  console.log(`   Timeframes: ${TIMEFRAMES.join(', ')}`);
  console.log(`   Period:     ${MONTHS} months (since ${new Date(sinceMs).toISOString().slice(0, 10)})`);
  console.log(`   DB:         ./data/runtime.sqlite\n`);

  let totalCandles = 0;

  for (const symbol of SYMBOLS) {
    for (const tf of TIMEFRAMES) {
      const tfMs = timeframeToMs[tf];
      if (!tfMs) {
        console.warn(`⚠️  Unknown timeframe "${tf}", skipping`);
        continue;
      }

      let cursor = sinceMs;
      let fetched = 0;

      process.stdout.write(`  ${symbol} ${tf}: `);

      while (cursor < now) {
        try {
          const ohlcv = await exchange.fetchOHLCV(symbol, tf, cursor, BATCH_SIZE) as number[][];

          if (!ohlcv || ohlcv.length === 0) break;

          const candles: Candle[] = ohlcv.map((bar: number[]) => ({
            symbol,
            interval: tf,
            time: bar[0]!,
            open: bar[1]!,
            high: bar[2]!,
            low: bar[3]!,
            close: bar[4]!,
            volume: bar[5]!,
          }));

          await store.saveCandles(candles);
          fetched += candles.length;

          // Move cursor past the last candle
          const lastTime = candles[candles.length - 1]!.time;
          if (lastTime <= cursor) break; // no progress — avoid infinite loop
          cursor = lastTime + tfMs;

          await sleep(RATE_LIMIT_MS);
        } catch (err: unknown) {
          const errorMessage = getErrorMessage(err);

          // Some exchanges don't support all timeframes for all pairs
          if (errorMessage.includes('not available') || errorMessage.includes('not supported')) {
            process.stdout.write(`(not available) `);
            break;
          }
          console.error(`\n❌ Error fetching ${symbol} ${tf}: ${errorMessage}`);
          break;
        }
      }

      console.log(`${formatNumber(fetched)} candles`);
      totalCandles += fetched;
    }
  }

  console.log(`\n✅ Done — ${formatNumber(totalCandles)} total candles saved to data/runtime.sqlite\n`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
