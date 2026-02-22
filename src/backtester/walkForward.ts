/**
 * Walk-forward testing — splits data into train/test windows to detect overfitting
 */

import type { Candle } from '../core/types.js';
import type { BacktestConfig } from './engine.js';
import { BacktestEngine } from './engine.js';
import { computeMetrics, formatMetrics } from './metrics.js';
import type { BacktestMetrics, BacktestTrade } from './metrics.js';

export interface WalkForwardConfig {
  totalCandles: Candle[];
  trainRatio: number;
  windows: number;
  backtestConfig: BacktestConfig;
}

export interface WalkForwardWindow {
  trainStart: number;
  trainEnd: number;
  testStart: number;
  testEnd: number;
  trainMetrics: BacktestMetrics;
  testMetrics: BacktestMetrics;
}

export interface WalkForwardResult {
  windows: WalkForwardWindow[];
  aggregateTestMetrics: BacktestMetrics;
  overfit: boolean;
}

export function runWalkForward(config: WalkForwardConfig): WalkForwardResult {
  const { totalCandles, trainRatio, windows: numWindows, backtestConfig } = config;
  const n = totalCandles.length;
  const windowSize = Math.floor(n / numWindows);
  const trainSize = Math.floor(windowSize * trainRatio);
  const testSize = windowSize - trainSize;

  if (trainSize < 50 || testSize < 10) {
    throw new Error(`Window too small: train=${trainSize}, test=${testSize} candles`);
  }

  const engine = new BacktestEngine();
  const windowResults: WalkForwardWindow[] = [];
  const allTestTrades: BacktestTrade[] = [];
  const allTestEquity: Array<{ time: number; equity: number }> = [];
  let runningCapital = backtestConfig.initialCapital;

  for (let w = 0; w < numWindows; w++) {
    const start = w * windowSize;
    const trainEnd = start + trainSize;
    const testEnd = Math.min(trainEnd + testSize, n);

    const trainCandles = totalCandles.slice(start, trainEnd);
    const testCandles = totalCandles.slice(trainEnd, testEnd);

    if (trainCandles.length < 50 || testCandles.length < 10) continue;

    const trainResult = engine.runOnCandles(trainCandles, backtestConfig);
    const testResult = engine.runOnCandles(testCandles, {
      ...backtestConfig,
      initialCapital: runningCapital,
    });

    // Update running capital for next window
    if (testResult.equityCurve.length > 0) {
      runningCapital = testResult.equityCurve[testResult.equityCurve.length - 1]!.equity;
    }

    allTestTrades.push(...testResult.trades);
    allTestEquity.push(...testResult.equityCurve);

    windowResults.push({
      trainStart: trainCandles[0]!.time,
      trainEnd: trainCandles[trainCandles.length - 1]!.time,
      testStart: testCandles[0]!.time,
      testEnd: testCandles[testCandles.length - 1]!.time,
      trainMetrics: trainResult.metrics,
      testMetrics: testResult.metrics,
    });
  }

  const totalTestBars = windowResults.reduce((s, w) => {
    const testCandles = totalCandles.filter(c => c.time >= w.testStart && c.time <= w.testEnd);
    return s + testCandles.length;
  }, 0);

  const aggregateTestMetrics = computeMetrics(
    allTestTrades,
    allTestEquity,
    backtestConfig.initialCapital,
    totalTestBars,
  );

  // Detect overfitting: avg train Sharpe > 2x avg test Sharpe
  const avgTrainSharpe = windowResults.reduce((s, w) => s + w.trainMetrics.sharpeRatio, 0) / windowResults.length;
  const avgTestSharpe = windowResults.reduce((s, w) => s + w.testMetrics.sharpeRatio, 0) / windowResults.length;
  const overfit = avgTrainSharpe > 2 * avgTestSharpe && avgTestSharpe > 0;

  return { windows: windowResults, aggregateTestMetrics, overfit };
}

export function printWalkForwardResult(result: WalkForwardResult): void {
  console.log(`\n${'═'.repeat(60)}`);
  console.log('Walk-Forward Analysis');
  console.log(`${'═'.repeat(60)}`);

  for (let i = 0; i < result.windows.length; i++) {
    const w = result.windows[i]!;
    const trainDate = new Date(w.trainStart).toISOString().slice(0, 10);
    const testDate = new Date(w.testStart).toISOString().slice(0, 10);
    console.log(`\n── Window ${i + 1} ──`);
    console.log(`  Train: ${trainDate} → ${new Date(w.trainEnd).toISOString().slice(0, 10)}`);
    console.log(`    Return: ${w.trainMetrics.totalReturn.toFixed(2)}% | Sharpe: ${w.trainMetrics.sharpeRatio.toFixed(3)} | MaxDD: ${w.trainMetrics.maxDrawdown.toFixed(2)}%`);
    console.log(`  Test:  ${testDate} → ${new Date(w.testEnd).toISOString().slice(0, 10)}`);
    console.log(`    Return: ${w.testMetrics.totalReturn.toFixed(2)}% | Sharpe: ${w.testMetrics.sharpeRatio.toFixed(3)} | MaxDD: ${w.testMetrics.maxDrawdown.toFixed(2)}%`);
  }

  console.log(`\n── Aggregate Test Performance ──`);
  console.log(formatMetrics(result.aggregateTestMetrics));

  if (result.overfit) {
    console.log('\n⚠️  WARNING: Possible overfitting detected (train Sharpe >> test Sharpe)');
  } else {
    console.log('\n✅ No significant overfitting detected');
  }
  console.log(`${'═'.repeat(60)}\n`);
}
