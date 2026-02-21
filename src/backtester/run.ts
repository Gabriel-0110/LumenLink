#!/usr/bin/env tsx

/**
 * Backtester - runs strategies against historical OHLCV data
 * Usage: pnpm run backtest
 */

import { loadConfig } from '../config/load.js';
import { CCXTAdapter } from '../exchanges/ccxt/adapter.js';
import { RsiMeanReversionStrategy } from '../strategies/rsiMeanReversion.js';
import { EmaCrossoverStrategy } from '../strategies/emaCrossover.js';
import type { Strategy } from '../strategies/interface.js';
import type { Candle } from '../core/types.js';
import { JsonLogger } from '../core/logger.js';

interface BacktestTrade {
  symbol: string;
  entryPrice: number;
  exitPrice: number;
  pnlPercent: number;
  reason: 'stop_loss' | 'take_profit' | 'signal' | 'timeout';
  barsHeld: number;
  entryTime: number;
  exitTime: number;
}

interface BacktestResult {
  symbol: string;
  totalTrades: number;
  winRate: number;
  avgPnlPercent: number;
  totalPnlPercent: number;
  bestTrade: number;
  worstTrade: number;
  avgBarsHeld: number;
  trades: BacktestTrade[];
}

class Backtester {
  private logger = new JsonLogger('info');
  private stopLossPercent = 0.03; // 3%
  private takeProfitPercent = 0.06; // 6%

  constructor(
    private strategy: Strategy,
    private exchange: CCXTAdapter
  ) {}

  async backtest(symbol: string, interval: string, limit: number = 500): Promise<BacktestResult> {
    this.logger.info('starting backtest', { symbol, interval, limit, strategy: this.strategy.name });

    // Fetch historical data
    const candles = await this.exchange.getCandles(symbol, interval, limit);
    
    if (candles.length < 50) {
      throw new Error(`Not enough historical data: ${candles.length} candles`);
    }

    const trades: BacktestTrade[] = [];
    let position: {
      entryPrice: number;
      stopLoss: number;
      takeProfit: number;
      entryIndex: number;
      entryTime: number;
    } | null = null;

    // Run backtest
    for (let i = 30; i < candles.length; i++) {
      const historicalCandles = candles.slice(0, i + 1);
      const currentCandle = candles[i];
      const price = currentCandle.close;

      // Get strategy signal
      const signalResult = this.strategy.onCandle(currentCandle, { candles: historicalCandles, symbol });
      const signal = signalResult.action === 'BUY' ? 'buy' : signalResult.action === 'SELL' ? 'sell' : 'hold';

      if (position === null && signal === 'buy') {
        // Open position
        position = {
          entryPrice: price,
          stopLoss: price * (1 - this.stopLossPercent),
          takeProfit: price * (1 + this.takeProfitPercent),
          entryIndex: i,
          entryTime: currentCandle.time,
        };
      } else if (position !== null) {
        // Check exit conditions
        let exitReason: BacktestTrade['reason'] | null = null;

        if (price <= position.stopLoss) {
          exitReason = 'stop_loss';
        } else if (price >= position.takeProfit) {
          exitReason = 'take_profit';
        } else if (signal === 'sell') {
          exitReason = 'signal';
        } else if (i - position.entryIndex >= 50) { // Max 50 bars
          exitReason = 'timeout';
        }

        if (exitReason) {
          const pnlPercent = ((price - position.entryPrice) / position.entryPrice) * 100;
          
          trades.push({
            symbol,
            entryPrice: position.entryPrice,
            exitPrice: price,
            pnlPercent,
            reason: exitReason,
            barsHeld: i - position.entryIndex,
            entryTime: position.entryTime,
            exitTime: currentCandle.time,
          });

          position = null;
        }
      }
    }

    // Calculate results
    const winningTrades = trades.filter(t => t.pnlPercent > 0);
    const winRate = trades.length > 0 ? (winningTrades.length / trades.length) * 100 : 0;
    const avgPnlPercent = trades.length > 0 ? trades.reduce((sum, t) => sum + t.pnlPercent, 0) / trades.length : 0;
    const totalPnlPercent = trades.reduce((sum, t) => sum + t.pnlPercent, 0);
    const bestTrade = trades.length > 0 ? Math.max(...trades.map(t => t.pnlPercent)) : 0;
    const worstTrade = trades.length > 0 ? Math.min(...trades.map(t => t.pnlPercent)) : 0;
    const avgBarsHeld = trades.length > 0 ? trades.reduce((sum, t) => sum + t.barsHeld, 0) / trades.length : 0;

    return {
      symbol,
      totalTrades: trades.length,
      winRate,
      avgPnlPercent,
      totalPnlPercent,
      bestTrade,
      worstTrade,
      avgBarsHeld,
      trades,
    };
  }

  printResults(result: BacktestResult): void {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Backtest Results: ${result.symbol}`);
    console.log(`Strategy: ${this.strategy.name}`);
    console.log(`${'='.repeat(60)}`);
    console.log(`Total trades:     ${result.totalTrades}`);
    console.log(`Win rate:         ${result.winRate.toFixed(1)}%`);
    console.log(`Avg PnL:          ${result.avgPnlPercent.toFixed(2)}%`);
    console.log(`Total PnL:        ${result.totalPnlPercent.toFixed(2)}%`);
    console.log(`Best trade:       ${result.bestTrade.toFixed(2)}%`);
    console.log(`Worst trade:      ${result.worstTrade.toFixed(2)}%`);
    console.log(`Avg bars held:    ${result.avgBarsHeld.toFixed(1)}`);
    console.log(`${'='.repeat(60)}\n`);

    if (result.trades.length > 0) {
      console.log('Recent trades:');
      console.log('Entry Price | Exit Price | PnL%   | Reason     | Bars');
      console.log('-'.repeat(55));
      result.trades.slice(-10).forEach(trade => {
        const pnlColor = trade.pnlPercent > 0 ? '🟢' : '🔴';
        console.log(
          `${pnlColor} $${trade.entryPrice.toFixed(2)}     | $${trade.exitPrice.toFixed(2)}     | ${trade.pnlPercent.toFixed(2)}% | ${trade.reason.padEnd(10)} | ${trade.barsHeld}`
        );
      });
    }
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = new JsonLogger(config.logLevel);

  try {
    // Create exchange adapter (no auth needed for public data)
    const exchange = new CCXTAdapter({
      exchange: config.exchange,
      sandbox: true, // Use sandbox for backtesting
    });

    // Create strategy
    const strategy: Strategy = config.strategy === 'ema_crossover' 
      ? new EmaCrossoverStrategy()
      : new RsiMeanReversionStrategy();

    const backtester = new Backtester(strategy, exchange);

    // Run backtest for each symbol
    for (const symbol of config.symbols) {
      try {
        const result = await backtester.backtest(symbol, config.interval, 1000);
        backtester.printResults(result);
      } catch (error) {
        logger.error('backtest failed for symbol', { symbol, error: String(error) });
        console.error(`❌ Backtest failed for ${symbol}: ${String(error)}`);
      }
    }
  } catch (error) {
    logger.error('backtest initialization failed', { error: String(error) });
    console.error(`❌ Backtest initialization failed: ${String(error)}`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Fatal backtest error:', error);
    process.exit(1);
  });
}