#!/usr/bin/env tsx

/**
 * Backtester CLI — standard backtest, walk-forward, or parameter sweep
 *
 * Usage:
 *   pnpm run backtest                          # Standard backtest
 *   WALK_FORWARD=1 WINDOWS=5 pnpm run backtest # Walk-forward test
 *   PARAM_SWEEP=1 pnpm run backtest            # Parameter sweep
 */

import dotenv from 'dotenv';
dotenv.config();

import { BacktestEngine, DEFAULT_CONFIG } from './engine.js';
import type { BacktestConfig } from './engine.js';
import { runWalkForward, printWalkForwardResult } from './walkForward.js';
import { runParamSweep, printParamSweepResult } from './paramSweep.js';
import { saveSnapshot } from './versioning.js';

async function main(): Promise<void> {
  const symbol = process.env['SYMBOL'] ?? 'BTC-USD';
  const interval = process.env['INTERVAL'] ?? '1h';
  const strategy = process.env['STRATEGY'] ?? 'advanced_composite';

  const config: BacktestConfig = {
    symbol,
    interval,
    strategy,
    initialCapital: Number(process.env['CAPITAL'] ?? DEFAULT_CONFIG.initialCapital),
    stopLossPct: Number(process.env['STOP_LOSS'] ?? DEFAULT_CONFIG.stopLossPct),
    takeProfitPct: Number(process.env['TAKE_PROFIT'] ?? DEFAULT_CONFIG.takeProfitPct),
    commission: Number(process.env['COMMISSION'] ?? DEFAULT_CONFIG.commission),
    slippageBps: Number(process.env['SLIPPAGE_BPS'] ?? DEFAULT_CONFIG.slippageBps),
    startDate: process.env['START_DATE'] ? new Date(process.env['START_DATE']).getTime() : undefined,
    endDate: process.env['END_DATE'] ? new Date(process.env['END_DATE']).getTime() : undefined,
  };

  const engine = new BacktestEngine();

  if (process.env['WALK_FORWARD'] === '1') {
    // Walk-forward testing
    const windows = Number(process.env['WINDOWS'] ?? 5);
    const trainRatio = Number(process.env['TRAIN_RATIO'] ?? 0.7);
    const candles = await engine.loadCandles(config.symbol, config.interval, config.startDate, config.endDate);

    console.log(`Loaded ${candles.length} candles for walk-forward analysis`);

    const result = runWalkForward({
      totalCandles: candles,
      trainRatio,
      windows,
      backtestConfig: config,
    });

    printWalkForwardResult(result);

    // Save aggregate test snapshot
    saveSnapshot(config, result.aggregateTestMetrics, [], []);
  } else if (process.env['PARAM_SWEEP'] === '1') {
    // Parameter sweep
    const sweepResult = await runParamSweep({
      symbol: config.symbol,
      interval: config.interval,
      strategy: config.strategy,
      params: {
        stopLossPct: [0.02, 0.03, 0.05],
        takeProfitPct: [0.04, 0.06, 0.08],
      },
      initialCapital: config.initialCapital,
    });

    printParamSweepResult(sweepResult);

    // Save best-by-Sharpe snapshot
    const bestConfig = { ...config, ...sweepResult.bestBySharpe.params };
    saveSnapshot(bestConfig, sweepResult.bestBySharpe.metrics, [], []);
  } else {
    // Standard backtest
    const result = await engine.run(config);
    engine.printResult(result);

    // Save versioned snapshot
    saveSnapshot(config, result.metrics, result.trades, result.equityCurve);
  }
}

main().catch((error) => {
  console.error('Fatal backtest error:', error);
  process.exit(1);
});
