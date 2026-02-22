import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TradeJournal, type JournalEntry } from '../../src/data/tradeJournal.js';
import * as fs from 'node:fs';

const TEST_DB = './data/test-journal.sqlite';

function makeEntry(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    tradeId: `trade-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    symbol: 'BTC-USD',
    side: 'buy',
    action: 'entry',
    strategy: 'advanced_composite',
    orderId: `order-${Date.now()}`,
    requestedPrice: 50000,
    filledPrice: 50005,
    slippageBps: 1.0,
    quantity: 0.01,
    notionalUsd: 500.05,
    commissionUsd: 0.50,
    confidence: 0.75,
    reason: 'Confluence score 7/10',
    riskDecision: 'allowed',
    mode: 'paper',
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('TradeJournal', () => {
  let journal: TradeJournal;

  beforeEach(() => {
    try { fs.unlinkSync(TEST_DB); } catch {}
    journal = new TradeJournal(TEST_DB);
  });

  afterEach(() => {
    try { fs.unlinkSync(TEST_DB); } catch {}
  });

  it('records and retrieves entries', () => {
    const entry = makeEntry();
    journal.record(entry);
    const recent = journal.getRecent(10);
    expect(recent).toHaveLength(1);
    expect(recent[0]!.symbol).toBe('BTC-USD');
  });

  it('groups entries by tradeId', () => {
    const tradeId = 'trade-123';
    journal.record(makeEntry({ tradeId, action: 'entry', side: 'buy' }));
    journal.record(makeEntry({
      tradeId,
      action: 'exit',
      side: 'sell',
      realizedPnlUsd: 25.50,
      realizedPnlPct: 5.1,
      holdingDurationMs: 3_600_000,
    }));

    const entries = journal.getTradeEntries(tradeId);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.action).toBe('entry');
    expect(entries[1]!.action).toBe('exit');
    expect(entries[1]!.realizedPnlUsd).toBe(25.50);
  });

  it('calculates daily summary', () => {
    const today = new Date().toISOString().slice(0, 10);
    const now = Date.now();

    // Two winning trades
    journal.record(makeEntry({ action: 'exit', realizedPnlUsd: 50, timestamp: now - 3000 }));
    journal.record(makeEntry({ action: 'exit', realizedPnlUsd: 30, timestamp: now - 2000 }));
    // One losing trade
    journal.record(makeEntry({ action: 'exit', realizedPnlUsd: -20, timestamp: now - 1000 }));

    const summary = journal.getDailySummary(today);
    expect(summary.totalTrades).toBe(3);
    expect(summary.wins).toBe(2);
    expect(summary.losses).toBe(1);
    expect(summary.winRate).toBeCloseTo(66.67, 0);
    expect(summary.netPnlUsd).toBe(60); // 50 + 30 - 20
  });

  it('returns empty summary for no-trade days', () => {
    const summary = journal.getDailySummary('2020-01-01');
    expect(summary.totalTrades).toBe(0);
    expect(summary.winRate).toBe(0);
  });

  it('tracks trade count', () => {
    journal.record(makeEntry({ action: 'entry' }));
    journal.record(makeEntry({ action: 'exit' }));
    journal.record(makeEntry({ action: 'exit' }));
    expect(journal.getTradeCount()).toBe(2); // only exits count
  });

  it('filters by date range', () => {
    const today = new Date().toISOString().slice(0, 10);
    journal.record(makeEntry({ timestamp: Date.now() }));
    const results = journal.getByDateRange(today, today);
    expect(results.length).toBeGreaterThanOrEqual(1);
  });
});
