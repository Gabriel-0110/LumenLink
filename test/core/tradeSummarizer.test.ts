import { describe, it, expect } from 'vitest';
import { summarizeTrade, formatSummary } from '../../src/core/tradeSummarizer.js';
import { makeTicker } from '../helpers.js';

describe('tradeSummarizer', () => {
  it('summarizes HOLD signal', () => {
    const result = summarizeTrade({
      symbol: 'BTC-USD',
      signal: { action: 'HOLD', confidence: 0, reason: 'No confluence' },
      riskDecision: { allowed: false, reason: 'No action signal' },
      ticker: makeTicker(),
    });
    expect(result.action).toBe('no_signal');
    expect(result.summary).toContain('No trade');
  });

  it('summarizes blocked trade', () => {
    const result = summarizeTrade({
      symbol: 'BTC-USD',
      signal: { action: 'BUY', confidence: 0.8, reason: 'Confluence 8/10' },
      riskDecision: { allowed: false, reason: 'Max daily loss reached', blockedBy: 'max_daily_loss' },
      ticker: makeTicker(),
    });
    expect(result.action).toBe('blocked');
    expect(result.summary).toContain('blocked');
    expect(result.details.some(d => d.includes('max_daily_loss'))).toBe(true);
  });

  it('summarizes executed trade', () => {
    const result = summarizeTrade({
      symbol: 'BTC-USD',
      signal: { action: 'BUY', confidence: 0.8, reason: 'Confluence 8/10' },
      riskDecision: { allowed: true, reason: 'All checks passed' },
      ticker: makeTicker({ last: 50005 }),
    });
    expect(result.action).toBe('executed');
    expect(result.summary).toContain('BUY');
    expect(result.summary).toContain('50,005');
  });

  it('includes regime context when provided', () => {
    const result = summarizeTrade({
      symbol: 'BTC-USD',
      signal: { action: 'BUY', confidence: 0.8, reason: 'test' },
      riskDecision: { allowed: true, reason: 'passed' },
      ticker: makeTicker(),
      regime: {
        regime: 'trending_up',
        confidence: 0.7,
        adx: 32,
        atrRatio: 1.2,
        bbWidth: 0.04,
        bbSqueeze: false,
        trendDirection: 1,
        details: 'Uptrend confirmed',
      },
    });
    expect(result.details.some(d => d.includes('trending_up'))).toBe(true);
  });

  it('includes anomaly warnings', () => {
    const result = summarizeTrade({
      symbol: 'BTC-USD',
      signal: { action: 'BUY', confidence: 0.8, reason: 'test' },
      riskDecision: { allowed: true, reason: 'passed' },
      ticker: makeTicker(),
      anomalies: [{
        type: 'volume_spike',
        severity: 'high',
        message: 'Volume 5x median',
        value: 5,
        threshold: 3,
        timestamp: Date.now(),
      }],
    });
    expect(result.details.some(d => d.includes('volume_spike'))).toBe(true);
  });

  it('formats summary as readable string', () => {
    const summary = summarizeTrade({
      symbol: 'BTC-USD',
      signal: { action: 'BUY', confidence: 0.8, reason: 'test' },
      riskDecision: { allowed: true, reason: 'passed' },
      ticker: makeTicker(),
    });
    const formatted = formatSummary(summary);
    expect(formatted).toContain('•');
    expect(formatted.split('\n').length).toBeGreaterThan(1);
  });
});
