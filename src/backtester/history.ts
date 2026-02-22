#!/usr/bin/env tsx

/**
 * List all backtest run snapshots
 * Usage: pnpm run backtest:history
 */

import { listSnapshots } from './versioning.js';

function main(): void {
  const runs = listSnapshots();

  if (runs.length === 0) {
    console.log('No backtest runs found.');
    return;
  }

  console.log(`\n${'═'.repeat(100)}`);
  console.log('Backtest History');
  console.log(`${'═'.repeat(100)}`);
  console.log(
    'ID'.padEnd(10) +
    'Date'.padEnd(22) +
    'Strategy'.padEnd(22) +
    'Symbol'.padEnd(10) +
    'Return'.padStart(10) +
    'Sharpe'.padStart(10) +
    'MaxDD'.padStart(10) +
    'Trades'.padStart(8)
  );
  console.log('─'.repeat(100));

  for (const run of runs) {
    const date = new Date(run.timestamp).toISOString().slice(0, 19).replace('T', ' ');
    console.log(
      run.id.slice(0, 8).padEnd(10) +
      date.padEnd(22) +
      run.strategy.padEnd(22) +
      run.symbol.padEnd(10) +
      `${run.totalReturn.toFixed(2)}%`.padStart(10) +
      run.sharpeRatio.toFixed(3).padStart(10) +
      `${run.maxDrawdown.toFixed(2)}%`.padStart(10) +
      String(run.totalTrades).padStart(8)
    );
  }
  console.log(`${'═'.repeat(100)}\n`);
}

main();
