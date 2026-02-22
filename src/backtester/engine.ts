/**
 * Enhanced backtesting engine — reads from SQLite, realistic fills, comprehensive metrics
 */

import { SqliteStore } from '../data/sqliteStore.js';
import { createStrategy } from '../strategies/selector.js';
import type { Candle } from '../core/types.js';
import { computeMetrics, formatMetrics } from './metrics.js';
import type { BacktestMetrics, BacktestTrade } from './metrics.js';

export interface BacktestConfig {
  symbol: string;
  interval: string;
  strategy: string;
  startDate?: number;
  endDate?: number;
  initialCapital: number;
  stopLossPct: number;
  takeProfitPct: number;
  commission: number;
  slippageBps: number;
}

export const DEFAULT_CONFIG: Omit<BacktestConfig, 'symbol' | 'interval' | 'strategy'> = {
  initialCapital: 10000,
  stopLossPct: 0.03,
  takeProfitPct: 0.06,
  commission: 0.001,
  slippageBps: 10,
};

export interface BacktestResult {
  config: BacktestConfig;
  metrics: BacktestMetrics;
  trades: BacktestTrade[];
  equityCurve: Array<{ time: number; equity: number }>;
}

export class BacktestEngine {
  private store: SqliteStore;

  constructor(dbPath = './data/runtime.sqlite') {
    this.store = new SqliteStore(dbPath);
  }

  async loadCandles(symbol: string, interval: string, startDate?: number, endDate?: number): Promise<Candle[]> {
    // Get all candles (large limit), then filter by date
    const allCandles = await this.store.getRecentCandles(symbol, interval, 200000);
    return allCandles.filter(c => {
      if (startDate && c.time < startDate) return false;
      if (endDate && c.time > endDate) return false;
      return true;
    });
  }

  private applySlippage(price: number, side: 'buy' | 'sell', slippageBps: number): number {
    const slippage = price * (slippageBps / 10000);
    return side === 'buy' ? price + slippage : price - slippage;
  }

  async run(config: BacktestConfig): Promise<BacktestResult> {
    const candles = await this.loadCandles(config.symbol, config.interval, config.startDate, config.endDate);
    return this.runOnCandles(candles, config);
  }

  runOnCandles(candles: Candle[], config: BacktestConfig): BacktestResult {
    if (candles.length < 50) {
      throw new Error(`Not enough candles: ${candles.length} (need >= 50)`);
    }

    const strategy = createStrategy(config.strategy);
    const trades: BacktestTrade[] = [];
    const equityCurve: Array<{ time: number; equity: number }> = [];

    let capital = config.initialCapital;
    let position: {
      entryPrice: number;
      positionSizeUsd: number;
      stopLoss: number;
      takeProfit: number;
      entryIndex: number;
      entryTime: number;
      entryCommission: number;
    } | null = null;

    const lookback = 30;

    for (let i = lookback; i < candles.length; i++) {
      const currentCandle = candles[i]!;
      const historicalCandles = candles.slice(0, i + 1);
      const price = currentCandle.close;

      const signal = strategy.onCandle(currentCandle, {
        candles: historicalCandles,
        symbol: config.symbol,
      });

      if (position === null && signal.action === 'BUY') {
        // Enter long
        const fillPrice = this.applySlippage(price, 'buy', config.slippageBps);
        const commission = capital * config.commission;
        const positionSizeUsd = capital - commission;

        position = {
          entryPrice: fillPrice,
          positionSizeUsd,
          stopLoss: fillPrice * (1 - config.stopLossPct),
          takeProfit: fillPrice * (1 + config.takeProfitPct),
          entryIndex: i,
          entryTime: currentCandle.time,
          entryCommission: commission,
        };
      } else if (position !== null) {
        let exitReason: BacktestTrade['reason'] | null = null;

        // Check SL/TP against high/low for realism
        if (currentCandle.low <= position.stopLoss) {
          exitReason = 'stop_loss';
        } else if (currentCandle.high >= position.takeProfit) {
          exitReason = 'take_profit';
        } else if (signal.action === 'SELL') {
          exitReason = 'signal';
        } else if (i - position.entryIndex >= 50) {
          exitReason = 'timeout';
        }

        if (exitReason) {
          let exitPrice: number;
          if (exitReason === 'stop_loss') {
            exitPrice = position.stopLoss;
          } else if (exitReason === 'take_profit') {
            exitPrice = position.takeProfit;
          } else {
            exitPrice = price;
          }

          exitPrice = this.applySlippage(exitPrice, 'sell', config.slippageBps);
          const exitCommission = (position.positionSizeUsd * (exitPrice / position.entryPrice)) * config.commission;
          const pnlUsd = position.positionSizeUsd * ((exitPrice - position.entryPrice) / position.entryPrice) - position.entryCommission - exitCommission;
          const pnlPercent = (pnlUsd / (position.positionSizeUsd + position.entryCommission)) * 100;

          capital = capital + pnlUsd;

          trades.push({
            symbol: config.symbol,
            side: 'long',
            entryPrice: position.entryPrice,
            exitPrice,
            entryTime: position.entryTime,
            exitTime: currentCandle.time,
            pnlUsd,
            pnlPercent,
            positionSizeUsd: position.positionSizeUsd,
            commission: position.entryCommission + exitCommission,
            slippage: config.slippageBps,
            reason: exitReason,
            barsHeld: i - position.entryIndex,
          });

          position = null;
        }
      }

      // Record equity at each bar
      if (position !== null) {
        const unrealized = position.positionSizeUsd * ((price - position.entryPrice) / position.entryPrice);
        equityCurve.push({ time: currentCandle.time, equity: capital + unrealized });
      } else {
        equityCurve.push({ time: currentCandle.time, equity: capital });
      }
    }

    const totalBars = candles.length - lookback;
    const metrics = computeMetrics(trades, equityCurve, config.initialCapital, totalBars);

    return { config, metrics, trades, equityCurve };
  }

  printResult(result: BacktestResult): void {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`Backtest: ${result.config.symbol} | ${result.config.interval} | ${result.config.strategy}`);
    console.log(`Capital: $${result.config.initialCapital} | SL: ${(result.config.stopLossPct * 100).toFixed(1)}% | TP: ${(result.config.takeProfitPct * 100).toFixed(1)}%`);
    console.log(`${'═'.repeat(60)}`);
    console.log(formatMetrics(result.metrics));
    console.log(`${'═'.repeat(60)}\n`);
  }
}
