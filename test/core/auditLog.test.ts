import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AuditLog } from '../../src/core/auditLog.js';
import * as fs from 'node:fs';

const TEST_DB = './test-audit.sqlite';

describe('AuditLog', () => {
  let audit: AuditLog;

  beforeEach(() => {
    try { fs.unlinkSync(TEST_DB); } catch {}
    audit = new AuditLog(TEST_DB);
  });

  afterEach(() => {
    try { fs.unlinkSync(TEST_DB); } catch {}
  });

  it('records and retrieves entries', () => {
    audit.record({
      timestamp: Date.now(),
      eventType: 'order_request',
      symbol: 'BTC-USD',
      side: 'buy',
      quantity: 0.01,
      price: 50000,
      reason: 'BUY 0.01 BTC-USD @ $50000',
      mode: 'paper',
    });
    const recent = audit.getRecent(10);
    expect(recent).toHaveLength(1);
    expect(recent[0]!.eventType).toBe('order_request');
  });

  it('is append-only (multiple entries accumulate)', () => {
    audit.logOrderRequest({ symbol: 'BTC-USD', side: 'buy', quantity: 0.01, price: 50000, mode: 'paper' });
    audit.logOrderRequest({ symbol: 'ETH-USD', side: 'buy', quantity: 0.1, price: 3000, mode: 'paper' });
    audit.logRiskBlock({ symbol: 'SOL-USD', reason: 'Max daily loss', blockedBy: 'max_daily_loss', mode: 'paper' });
    expect(audit.getCount()).toBe(3);
  });

  it('logs kill switch events', () => {
    audit.logKillSwitch(true, 'Drawdown exceeded 5%', 'live');
    audit.logKillSwitch(false, 'Manual reset by operator', 'live');
    const events = audit.getByType('kill_switch_triggered');
    expect(events).toHaveLength(1);
    expect(events[0]!.reason).toContain('Drawdown');
  });

  it('filters by event type', () => {
    audit.logOrderRequest({ symbol: 'BTC-USD', side: 'buy', quantity: 0.01, price: 50000, mode: 'paper' });
    audit.logRiskBlock({ symbol: 'BTC-USD', reason: 'test', blockedBy: 'spread', mode: 'paper' });
    const orders = audit.getByType('order_request');
    expect(orders).toHaveLength(1);
    const blocks = audit.getByType('risk_blocked');
    expect(blocks).toHaveLength(1);
  });

  it('counts by date', () => {
    const today = new Date().toISOString().slice(0, 10);
    audit.logOrderRequest({ symbol: 'BTC-USD', side: 'buy', quantity: 0.01, price: 50000, mode: 'paper' });
    audit.logOrderRequest({ symbol: 'ETH-USD', side: 'sell', quantity: 0.1, price: 3000, mode: 'paper' });
    audit.logRiskBlock({ symbol: 'SOL-USD', reason: 'test', blockedBy: 'test', mode: 'paper' });
    const counts = audit.getCountByDate(today);
    expect(counts['order_request']).toBe(2);
    expect(counts['risk_blocked']).toBe(1);
  });

  it('stores metadata as JSON', () => {
    audit.logOrderRequest({
      symbol: 'BTC-USD',
      side: 'buy',
      quantity: 0.01,
      price: 50000,
      mode: 'paper',
      metadata: { confidence: 0.8, strategy: 'advanced_composite' },
    });
    const recent = audit.getRecent(1);
    expect(recent[0]!.metadata).toBeTruthy();
    const parsed = JSON.parse(recent[0]!.metadata!);
    expect(parsed.confidence).toBe(0.8);
  });
});
