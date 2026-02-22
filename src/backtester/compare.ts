#!/usr/bin/env tsx

/**
 * Compare two backtest runs
 * Usage: pnpm run backtest:compare <runId1> <runId2>
 */

import { compare, listSnapshots } from './versioning.js';

function main(): void {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error('Usage: pnpm run backtest:compare <runId1> <runId2>');
    console.error('\nAvailable runs:');
    const runs = listSnapshots();
    for (const run of runs.slice(-10)) {
      console.error(`  ${run.id.slice(0, 8)}  ${run.strategy}  ${run.symbol}  ${run.totalReturn.toFixed(2)}%`);
    }
    process.exit(1);
  }

  // Support partial IDs
  const runs = listSnapshots();
  const resolve = (partial: string): string => {
    const match = runs.find(r => r.id.startsWith(partial));
    if (!match) throw new Error(`No run found matching: ${partial}`);
    return match.id;
  };

  const id1 = resolve(args[0]!);
  const id2 = resolve(args[1]!);

  console.log(`\n${compare(id1, id2)}\n`);
}

main();
