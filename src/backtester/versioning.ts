/**
 * Strategy versioning — save/load/compare backtest run snapshots
 */

import { randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BacktestConfig } from './engine.js';
import type { BacktestMetrics, BacktestTrade } from './metrics.js';

export interface RunSnapshot {
  id: string;
  timestamp: number;
  gitCommit?: string;
  gitBranch?: string;
  gitDirty?: boolean;
  strategy: string;
  config: BacktestConfig;
  metrics: BacktestMetrics;
  trades: BacktestTrade[];
  equityCurve: Array<{ time: number; equity: number }>;
}

interface RunIndex {
  runs: Array<{
    id: string;
    timestamp: number;
    strategy: string;
    symbol: string;
    interval: string;
    totalReturn: number;
    sharpeRatio: number;
    maxDrawdown: number;
    totalTrades: number;
  }>;
}

const RESULTS_DIR = 'backtest-results';

function getGitInfo(): { commit?: string; branch?: string; dirty?: boolean } {
  try {
    const commit = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
    const branch = execSync('git branch --show-current', { encoding: 'utf-8' }).trim();
    const status = execSync('git status --porcelain', { encoding: 'utf-8' }).trim();
    return { commit, branch, dirty: status.length > 0 };
  } catch {
    return {};
  }
}

function ensureDir(): void {
  if (!existsSync(RESULTS_DIR)) {
    mkdirSync(RESULTS_DIR, { recursive: true });
  }
}

function loadIndex(): RunIndex {
  const indexPath = join(RESULTS_DIR, 'index.json');
  if (existsSync(indexPath)) {
    return JSON.parse(readFileSync(indexPath, 'utf-8')) as RunIndex;
  }
  return { runs: [] };
}

function saveIndex(index: RunIndex): void {
  writeFileSync(join(RESULTS_DIR, 'index.json'), JSON.stringify(index, null, 2));
}

export function saveSnapshot(
  config: BacktestConfig,
  metrics: BacktestMetrics,
  trades: BacktestTrade[],
  equityCurve: Array<{ time: number; equity: number }>,
): RunSnapshot {
  ensureDir();

  const git = getGitInfo();
  const snapshot: RunSnapshot = {
    id: randomUUID(),
    timestamp: Date.now(),
    gitCommit: git.commit,
    gitBranch: git.branch,
    gitDirty: git.dirty,
    strategy: config.strategy,
    config,
    metrics,
    trades,
    equityCurve,
  };

  // Save full snapshot
  writeFileSync(join(RESULTS_DIR, `${snapshot.id}.json`), JSON.stringify(snapshot, null, 2));

  // Update index
  const index = loadIndex();
  index.runs.push({
    id: snapshot.id,
    timestamp: snapshot.timestamp,
    strategy: config.strategy,
    symbol: config.symbol,
    interval: config.interval,
    totalReturn: metrics.totalReturn,
    sharpeRatio: metrics.sharpeRatio,
    maxDrawdown: metrics.maxDrawdown,
    totalTrades: metrics.totalTrades,
  });
  saveIndex(index);

  console.log(`📸 Snapshot saved: ${snapshot.id}`);
  return snapshot;
}

export function loadSnapshot(id: string): RunSnapshot {
  const filePath = join(RESULTS_DIR, `${id}.json`);
  if (!existsSync(filePath)) {
    throw new Error(`Snapshot not found: ${id}`);
  }
  return JSON.parse(readFileSync(filePath, 'utf-8')) as RunSnapshot;
}

export function listSnapshots(): RunIndex['runs'] {
  return loadIndex().runs;
}

export function compare(id1: string, id2: string): string {
  const s1 = loadSnapshot(id1);
  const s2 = loadSnapshot(id2);

  const m1 = s1.metrics;
  const m2 = s2.metrics;

  const diff = (label: string, v1: number, v2: number, suffix = '') => {
    const delta = v2 - v1;
    const arrow = delta > 0 ? '▲' : delta < 0 ? '▼' : '─';
    return `  ${label.padEnd(22)} ${v1.toFixed(3).padStart(10)}  →  ${v2.toFixed(3).padStart(10)}  ${arrow} ${Math.abs(delta).toFixed(3)}${suffix}`;
  };

  const lines = [
    `Comparing: ${id1.slice(0, 8)} vs ${id2.slice(0, 8)}`,
    `  Strategy:    ${s1.strategy} → ${s2.strategy}`,
    `  Symbol:      ${s1.config.symbol} → ${s2.config.symbol}`,
    '',
    diff('Total Return (%)', m1.totalReturn, m2.totalReturn),
    diff('Annualized Return (%)', m1.annualizedReturn, m2.annualizedReturn),
    diff('Sharpe Ratio', m1.sharpeRatio, m2.sharpeRatio),
    diff('Sortino Ratio', m1.sortinoRatio, m2.sortinoRatio),
    diff('Max Drawdown (%)', m1.maxDrawdown, m2.maxDrawdown),
    diff('Win Rate (%)', m1.winRate, m2.winRate),
    diff('Profit Factor', m1.profitFactor, m2.profitFactor),
    diff('Total Trades', m1.totalTrades, m2.totalTrades),
    diff('Avg R:R', m1.avgRR, m2.avgRR),
  ];

  return lines.join('\n');
}
