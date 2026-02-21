import { describe, it, expect, beforeEach } from 'vitest';
import { EventLockout } from '../../src/risk/eventLockout.js';

describe('EventLockout', () => {
  let lockout: EventLockout;

  beforeEach(() => {
    lockout = new EventLockout({
      defaultLockoutBeforeMs: 30 * 60_000,  // 30 min
      defaultLockoutAfterMs: 60 * 60_000,   // 60 min
      lockoutImpactLevels: ['high'],
      enabled: true,
    });
  });

  it('does not block when no events registered', () => {
    const result = lockout.check(Date.now());
    expect(result.blocked).toBe(false);
  });

  it('blocks 30 min before a high-impact event', () => {
    const eventTime = Date.now() + 20 * 60_000; // 20 min from now
    lockout.addEvents([{ name: 'FOMC', time: eventTime, category: 'macro', impact: 'high' }]);
    const result = lockout.check(Date.now());
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain('FOMC');
    expect(result.reason).toContain('before');
  });

  it('blocks 60 min after a high-impact event', () => {
    const eventTime = Date.now() - 30 * 60_000; // 30 min ago
    lockout.addEvents([{ name: 'CPI', time: eventTime, category: 'macro', impact: 'high' }]);
    const result = lockout.check(Date.now());
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain('CPI');
    expect(result.reason).toContain('after');
  });

  it('does not block for medium-impact when only high is configured', () => {
    const eventTime = Date.now() + 10 * 60_000;
    lockout.addEvents([{ name: 'PPI', time: eventTime, category: 'macro', impact: 'medium' }]);
    const result = lockout.check(Date.now());
    expect(result.blocked).toBe(false);
  });

  it('does not block when event is far away', () => {
    const eventTime = Date.now() + 5 * 3_600_000; // 5 hours from now
    lockout.addEvents([{ name: 'NFP', time: eventTime, category: 'macro', impact: 'high' }]);
    const result = lockout.check(Date.now());
    expect(result.blocked).toBe(false);
  });

  it('does not block when disabled', () => {
    lockout = new EventLockout({ enabled: false });
    const eventTime = Date.now() + 10 * 60_000;
    lockout.addEvents([{ name: 'FOMC', time: eventTime, category: 'macro', impact: 'high' }]);
    const result = lockout.check(Date.now());
    expect(result.blocked).toBe(false);
  });

  it('returns upcoming events', () => {
    const now = Date.now();
    lockout.addEvents([
      { name: 'CPI', time: now + 2 * 3_600_000, category: 'macro', impact: 'high' },
      { name: 'NFP', time: now + 48 * 3_600_000, category: 'macro', impact: 'high' },
    ]);
    const upcoming = lockout.getUpcoming(24, now);
    expect(upcoming).toHaveLength(1);
    expect(upcoming[0]!.name).toBe('CPI');
  });

  it('prunes old events', () => {
    const now = Date.now();
    lockout.addEvents([
      { name: 'Old Event', time: now - 24 * 3_600_000, category: 'macro', impact: 'high' },
      { name: 'Future Event', time: now + 24 * 3_600_000, category: 'macro', impact: 'high' },
    ]);
    lockout.pruneOldEvents(now);
    expect(lockout.getAllEvents()).toHaveLength(1);
    expect(lockout.getAllEvents()[0]!.name).toBe('Future Event');
  });

  it('supports custom lockout windows per event', () => {
    const eventTime = Date.now() + 50 * 60_000; // 50 min from now
    lockout.addEvents([{
      name: 'FOMC',
      time: eventTime,
      category: 'macro',
      impact: 'high',
      lockoutBeforeMs: 60 * 60_000, // 60 min lockout before
    }]);
    const result = lockout.check(Date.now());
    expect(result.blocked).toBe(true); // within 60 min custom window
  });
});
