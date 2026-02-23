import { describe, it, expect } from 'vitest';
import { alertTemplates } from '../../src/alerts/alertTemplates.js';

describe('alertTemplates', () => {
  it('formats orderFilled', () => {
    const t = alertTemplates.orderFilled('BTC-USD', 'buy', 0.01, 50000, 'paper');
    expect(t.title).toContain('Order Filled');
    expect(t.message).toContain('BUY');
    expect(t.message).toContain('50,000');
    expect(t.severity).toBe('info');
  });

  it('formats killSwitchTriggered as critical', () => {
    const t = alertTemplates.killSwitchTriggered('Max drawdown exceeded');
    expect(t.title).toContain('KILL SWITCH');
    expect(t.severity).toBe('critical');
    expect(t.message).toContain('Manual reset required');
  });

  it('formats dailyLossHit as critical', () => {
    const t = alertTemplates.dailyLossHit(-175, 150);
    expect(t.severity).toBe('critical');
    expect(t.message).toContain('175.00');
  });

  it('formats dailySummary with P&L', () => {
    const t = alertTemplates.dailySummary('2026-02-21', 12, 66.7, 245.50, 35.20);
    expect(t.title).toContain('Daily Summary');
    expect(t.message).toContain('12');
    expect(t.message).toContain('+245.50');
  });

  it('formats negative P&L summary', () => {
    const t = alertTemplates.dailySummary('2026-02-21', 5, 40.0, -120.00, 180.50);
    expect(t.message).toContain('-120.00');
  });

  it('formats systemStartup', () => {
    const t = alertTemplates.systemStartup('paper', 'coinbase', 'advanced_composite', ['BTC-USD', 'ETH-USD']);
    expect(t.title).toContain('Started');
    expect(t.message).toContain('coinbase');
  });
});

