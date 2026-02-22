/**
 * Parameter sweep — grid search across backtest config parameters
 */

import type { BacktestConfig } from './engine.js';
import { BacktestEngine } from './engine.js';
import { formatMetrics } from './metrics.js';
import type { BacktestMetrics } from './metrics.js';

export interface ParamSweepConfig {
  symbol: string;
  interval: string;
  strategy: string;
  params: Record<string, number[]>;
  initialCapital: number;
}

export interface ParamSweepResult {
  results: Array<{
    params: Record<string, number>;
    metrics: BacktestMetrics;
  }>;
  bestBySharpe: { params: Record<string, number>; metrics: BacktestMetrics };
  bestByReturn: { params: Record<string, number>; metrics: BacktestMetrics };
  warning?: string;
}

function cartesian(params: Record<string, number[]>): Array<Record<string, number>> {
  const keys = Object.keys(params);
  if (keys.length === 0) return [{}];
  if (keys.length > 3) {
    throw new Error(`Too many sweep parameters (${keys.length}). Max 3 to avoid curse of dimensionality.`);
  }

  const combos: Array<Record<string, number>> = [];
  const recurse = (idx: number, current: Record<string, number>) => {
    if (idx === keys.length) { combos.push({ ...current }); return; }
    const key = keys[idx]!;
    for (const val of params[key]!) {
      current[key] = val;
      recurse(idx + 1, current);
    }
  };
  recurse(0, {});
  return combos;
}

export async function runParamSweep(config: ParamSweepConfig): Promise<ParamSweepResult> {
  const combos = cartesian(config.params);
  const engine = new BacktestEngine();

  console.log(`Running parameter sweep: ${combos.length} combinations`);

  const results: ParamSweepResult['results'] = [];

  for (let i = 0; i < combos.length; i++) {
    const combo = combos[i]!;
    const backtestConfig: BacktestConfig = {
      symbol: config.symbol,
      interval: config.interval,
      strategy: config.strategy,
      initialCapital: config.initialCapital,
      stopLossPct: combo['stopLossPct'] ?? 0.03,
      takeProfitPct: combo['takeProfitPct'] ?? 0.06,
      commission: combo['commission'] ?? 0.001,
      slippageBps: combo['slippageBps'] ?? 10,
    };

    try {
      const result = await engine.run(backtestConfig);
      results.push({ params: combo, metrics: result.metrics });
      process.stdout.write(`  [${i + 1}/${combos.length}] ${JSON.stringify(combo)} → Sharpe: ${result.metrics.sharpeRatio.toFixed(3)}, Return: ${result.metrics.totalReturn.toFixed(2)}%\n`);
    } catch {
      // Skip failed combos (e.g., not enough data)
    }
  }

  if (results.length === 0) {
    throw new Error('All parameter combinations failed');
  }

  const bestBySharpe = results.reduce((a, b) => a.metrics.sharpeRatio > b.metrics.sharpeRatio ? a : b);
  const bestByReturn = results.reduce((a, b) => a.metrics.totalReturn > b.metrics.totalReturn ? a : b);

  // Check if best params are at boundary values (overfitting warning)
  let warning: string | undefined;
  const keys = Object.keys(config.params);
  for (const key of keys) {
    const vals = config.params[key]!;
    const bestVal = bestBySharpe.params[key];
    if (bestVal === vals[0] || bestVal === vals[vals.length - 1]) {
      warning = 'Results may be overfit — best parameters are at boundary values. Expand search range.';
      break;
    }
  }

  return { results, bestBySharpe, bestByReturn, warning };
}

export function printParamSweepResult(result: ParamSweepResult): void {
  console.log(`\n${'═'.repeat(60)}`);
  console.log('Parameter Sweep Results');
  console.log(`${'═'.repeat(60)}`);

  console.log(`\nTotal combinations tested: ${result.results.length}`);

  console.log('\n── Best by Sharpe Ratio ──');
  console.log(`  Params: ${JSON.stringify(result.bestBySharpe.params)}`);
  console.log(formatMetrics(result.bestBySharpe.metrics));

  console.log('\n── Best by Total Return ──');
  console.log(`  Params: ${JSON.stringify(result.bestByReturn.params)}`);
  console.log(formatMetrics(result.bestByReturn.metrics));

  if (result.warning) {
    console.log(`\n⚠️  ${result.warning}`);
  }
  console.log(`${'═'.repeat(60)}\n`);
}
