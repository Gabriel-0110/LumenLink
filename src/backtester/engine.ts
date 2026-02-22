/**
 * Enhanced backtesting engine — reads from SQLite, realistic fills, comprehensive metrics
 */

import { ATR } from 'technicalindicators';
import { SqliteStore } from '../data/sqliteStore.js';
import { createStrategy } from '../strategies/selector.js';
import type { Candle } from '../core/types.js';
import { MultiTimeframeAnalyzer } from '../strategies/multiTimeframe.js';
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
    const mtfAnalyzer = new MultiTimeframeAnalyzer();

    /** Aggregate 1-bar candles into N-bar candles for MTF analysis */
    const aggregateCandles = (src: Candle[], factor: number): Candle[] => {
      const out: Candle[] = [];
      for (let j = 0; j + factor <= src.length; j += factor) {
        const slice = src.slice(j, j + factor);
        out.push({
          symbol: slice[0]!.symbol,
          interval: `${factor}x`,
          time: slice[slice.length - 1]!.time,
          open: slice[0]!.open,
          high: Math.max(...slice.map(c => c.high)),
          low: Math.min(...slice.map(c => c.low)),
          close: slice[slice.length - 1]!.close,
          volume: slice.reduce((s, c) => s + c.volume, 0),
        });
      }
      return out;
    };

    /** Compute ATR-based stop and take-profit distances from recent candles */
    const computeAtrLevels = (
      src: Candle[],
      fillPrice: number,
      side: 'long' | 'short',
    ): { stopLoss: number; takeProfit: number } => {
      const atrVals = ATR.calculate({
        high: src.map(c => c.high),
        low: src.map(c => c.low),
        close: src.map(c => c.close),
        period: 14,
      });
      const atr = atrVals[atrVals.length - 1];
      if (!atr || atr <= 0) {
        // Fallback to percentage-based if ATR unavailable
        return side === 'long'
          ? { stopLoss: fillPrice * (1 - config.stopLossPct), takeProfit: fillPrice * (1 + config.takeProfitPct) }
          : { stopLoss: fillPrice * (1 + config.stopLossPct), takeProfit: fillPrice * (1 - config.takeProfitPct) };
      }
      const stopDist = atr * 1.5;   // 1.5× ATR stop
      const tpDist   = atr * 3.0;   // 3.0× ATR target → 2:1 R:R
      return side === 'long'
        ? { stopLoss: fillPrice - stopDist, takeProfit: fillPrice + tpDist }
        : { stopLoss: fillPrice + stopDist, takeProfit: fillPrice - tpDist };
    };

    let position: {
      side: 'long' | 'short';
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

      // ── Multi-timeframe context (synthesize 4h + 1d candles from base timeframe) ──
      const mtfMap = new Map<string, Candle[]>();
      if (historicalCandles.length >= 8) {
        mtfMap.set('4h', aggregateCandles(historicalCandles, 4));
      }
      if (historicalCandles.length >= 48) {
        mtfMap.set('1d', aggregateCandles(historicalCandles, 24));
      }
      const mtfResult = mtfMap.size > 0 ? mtfAnalyzer.analyze(mtfMap) : undefined;

      const signal = strategy.onCandle(currentCandle, {
        candles: historicalCandles,
        symbol: config.symbol,
        mtfResult,
      });

      if (position === null) {
        if (signal.action === 'BUY') {
          // ── Enter long ────────────────────────────────────────────────
          const fillPrice = this.applySlippage(price, 'buy', config.slippageBps);
          const commission = capital * config.commission;
          const positionSizeUsd = capital - commission;
          const { stopLoss, takeProfit } = computeAtrLevels(historicalCandles, fillPrice, 'long');
          position = {
            side: 'long',
            entryPrice: fillPrice,
            positionSizeUsd,
            stopLoss,
            takeProfit,
            entryIndex: i,
            entryTime: currentCandle.time,
            entryCommission: commission,
          };
        } else if (signal.action === 'SELL') {
          // ── Enter short ───────────────────────────────────────────────
          const fillPrice = this.applySlippage(price, 'sell', config.slippageBps);
          const commission = capital * config.commission;
          const positionSizeUsd = capital - commission;
          const { stopLoss, takeProfit } = computeAtrLevels(historicalCandles, fillPrice, 'short');
          position = {
            side: 'short',
            entryPrice: fillPrice,
            positionSizeUsd,
            stopLoss,
            takeProfit,
            entryIndex: i,
            entryTime: currentCandle.time,
            entryCommission: commission,
          };
        }
      } else {
        // ── Manage open position ──────────────────────────────────────
        let exitReason: BacktestTrade['reason'] | null = null;
        const isLong = position.side === 'long';

        if (isLong) {
          // Long exit conditions
          if (currentCandle.low <= position.stopLoss)        exitReason = 'stop_loss';
          else if (currentCandle.high >= position.takeProfit) exitReason = 'take_profit';
          else if (signal.action === 'SELL')                  exitReason = 'signal';
          else if (i - position.entryIndex >= 50)             exitReason = 'timeout';
        } else {
          // Short exit conditions
          if (currentCandle.high >= position.stopLoss)        exitReason = 'stop_loss';
          else if (currentCandle.low <= position.takeProfit)  exitReason = 'take_profit';
          else if (signal.action === 'BUY')                   exitReason = 'signal';
          else if (i - position.entryIndex >= 50)             exitReason = 'timeout';
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

          const exitSide = isLong ? 'sell' : 'buy';
          exitPrice = this.applySlippage(exitPrice, exitSide, config.slippageBps);
          const exitCommission = position.positionSizeUsd * config.commission;

          // PnL: long profits when price rises; short profits when price falls
          const priceDelta = isLong
            ? (exitPrice - position.entryPrice) / position.entryPrice
            : (position.entryPrice - exitPrice) / position.entryPrice;
          const pnlUsd = position.positionSizeUsd * priceDelta - position.entryCommission - exitCommission;
          const pnlPercent = (pnlUsd / (position.positionSizeUsd + position.entryCommission)) * 100;

          capital = capital + pnlUsd;

          trades.push({
            symbol: config.symbol,
            side: position.side,
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

      // ── Record equity at each bar ─────────────────────────────────
      if (position !== null) {
        const isLong = position.side === 'long';
        const priceDelta = isLong
          ? (price - position.entryPrice) / position.entryPrice
          : (position.entryPrice - price) / position.entryPrice;
        const unrealized = position.positionSizeUsd * priceDelta;
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
