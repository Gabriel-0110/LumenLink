import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { KillSwitch, type KillSwitchConfig } from '../../src/execution/killSwitch.js';
import { createMockLogger, createMockMetrics } from '../helpers.js';

const defaultConfig: KillSwitchConfig = {
  maxDrawdownPct: 5,
  maxConsecutiveLosses: 3,
  apiErrorThreshold: 5,
  spreadViolationsLimit: 3,
  spreadViolationsWindowMin: 10,
};

describe('KillSwitch', () => {
  let db: Database.Database;
  let ks: KillSwitch;
  let logger: ReturnType<typeof createMockLogger>;
  let metrics: ReturnType<typeof createMockMetrics>;

  beforeEach(() => {
    db = new Database(':memory:');
    logger = createMockLogger();
    metrics = createMockMetrics();
    ks = new KillSwitch(defaultConfig, logger, metrics);
    ks.init(db);
    ks.setPersistFn(() => ks.persist(db));
  });

  it('initializes table and starts untriggered', () => {
    expect(ks.isTriggered()).toBe(false);
    expect(ks.getState().consecutiveLosses).toBe(0);
  });

  it('triggers and prevents re-trigger', () => {
    ks.trigger('test reason');
    expect(ks.isTriggered()).toBe(true);
    expect(ks.getState().reason).toBe('test reason');
    expect(ks.getState().triggeredAt).toBeTypeOf('number');

    // Second trigger should be a no-op
    ks.trigger('second reason');
    expect(ks.getState().reason).toBe('test reason');
  });

  it('resets clears all state', () => {
    ks.trigger('test');
    ks.reset();
    expect(ks.isTriggered()).toBe(false);
    expect(ks.getState().reason).toBeNull();
    expect(ks.getState().triggeredAt).toBeNull();
    expect(ks.getState().consecutiveLosses).toBe(0);
    expect(ks.getState().spreadViolations).toEqual([]);
  });

  it('triggers on consecutive losses', () => {
    ks.recordTradeResult(false);
    ks.recordTradeResult(false);
    expect(ks.isTriggered()).toBe(false);
    ks.recordTradeResult(false); // 3rd loss = threshold
    expect(ks.isTriggered()).toBe(true);
    expect(ks.getState().reason).toContain('consecutive losses');
  });

  it('resets consecutive losses on profitable trade', () => {
    ks.recordTradeResult(false);
    ks.recordTradeResult(false);
    ks.recordTradeResult(true); // resets counter
    ks.recordTradeResult(false);
    ks.recordTradeResult(false);
    expect(ks.isTriggered()).toBe(false);
  });

  it('triggers on drawdown exceeding threshold', () => {
    ks.checkDrawdown(9500, 10000); // 5% drawdown = threshold
    expect(ks.isTriggered()).toBe(true);
    expect(ks.getState().reason).toContain('Drawdown');
  });

  it('does not trigger on drawdown below threshold', () => {
    ks.checkDrawdown(9600, 10000); // 4% < 5%
    expect(ks.isTriggered()).toBe(false);
  });

  it('triggers on spread violations exceeding limit', () => {
    ks.recordSpreadViolation();
    ks.recordSpreadViolation();
    expect(ks.isTriggered()).toBe(false);
    ks.recordSpreadViolation(); // 3rd = threshold
    expect(ks.isTriggered()).toBe(true);
    expect(ks.getState().reason).toContain('spread/slippage violations');
  });

  it('triggers on API errors exceeding threshold', () => {
    ks.checkApiErrors(4);
    expect(ks.isTriggered()).toBe(false);
    ks.checkApiErrors(5);
    expect(ks.isTriggered()).toBe(true);
  });

  it('persists and hydrates state across instances', () => {
    ks.recordTradeResult(false);
    ks.recordTradeResult(false);
    ks.persist(db);

    // Create a new instance and hydrate from same DB
    const ks2 = new KillSwitch(defaultConfig, logger, metrics);
    ks2.init(db);
    expect(ks2.getState().consecutiveLosses).toBe(2);
    expect(ks2.isTriggered()).toBe(false);
  });

  it('hydrates triggered state from DB', () => {
    ks.trigger('persisted reason');
    ks.persist(db);

    const ks2 = new KillSwitch(defaultConfig, logger, metrics);
    ks2.init(db);
    expect(ks2.isTriggered()).toBe(true);
    expect(ks2.getState().reason).toBe('persisted reason');
  });
});
