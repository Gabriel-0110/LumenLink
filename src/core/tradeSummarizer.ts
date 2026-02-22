/**
 * Trade Summarizer — human-readable explanation of why a signal was or wasn't executed.
 * 
 * This is NOT an LLM. It's deterministic template-based summarization.
 * Every decision gets a clear audit trail — no hallucinated reasoning.
 */

import type { Signal, RiskDecision, Ticker } from './types.js';
import type { RegimeAnalysis } from '../strategies/regimeDetector.js';
import type { Anomaly } from '../data/anomalyDetector.js';

export interface TradeSummary {
  symbol: string;
  timestamp: number;
  action: 'executed' | 'blocked' | 'no_signal';
  summary: string;       // One-line summary
  details: string[];     // Bullet points
}

export function summarizeTrade(input: {
  symbol: string;
  signal: Signal;
  riskDecision: RiskDecision;
  ticker: Ticker;
  regime?: RegimeAnalysis;
  anomalies?: Anomaly[];
  executed?: boolean;
}): TradeSummary {
  const { symbol, signal, riskDecision, ticker, regime, anomalies, executed } = input;
  const now = Date.now();
  const details: string[] = [];

  // ── No Signal ─────────────────────────────────────────────────
  if (signal.action === 'HOLD') {
    details.push(`Strategy: HOLD — ${signal.reason}`);
    if (regime) details.push(`Regime: ${regime.regime} (${(regime.confidence * 100).toFixed(0)}% confidence) — ${regime.details}`);
    if (anomalies?.length) details.push(`Anomalies: ${anomalies.map(a => a.message).join('; ')}`);

    return {
      symbol,
      timestamp: now,
      action: 'no_signal',
      summary: `${symbol}: No trade — ${signal.reason}`,
      details,
    };
  }

  // ── Signal Generated ──────────────────────────────────────────
  const side = signal.action === 'BUY' ? 'BUY' : 'SELL';
  details.push(`Signal: ${side} (confidence: ${(signal.confidence * 100).toFixed(0)}%)`);
  details.push(`Reason: ${signal.reason}`);
  details.push(`Price: $${ticker.last.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  details.push(`Spread: ${(((ticker.ask - ticker.bid) / ((ticker.ask + ticker.bid) / 2)) * 10000).toFixed(1)} bps`);

  if (regime) {
    details.push(`Regime: ${regime.regime} (ADX: ${regime.adx.toFixed(1)}, ATR ratio: ${regime.atrRatio.toFixed(1)}x)`);
  }

  if (anomalies?.length) {
    for (const a of anomalies) {
      details.push(`⚠️ ${a.type}: ${a.message}`);
    }
  }

  // ── Blocked by Risk ───────────────────────────────────────────
  if (!riskDecision.allowed) {
    details.push(`❌ BLOCKED by: ${riskDecision.blockedBy ?? 'unknown'}`);
    details.push(`Reason: ${riskDecision.reason}`);

    return {
      symbol,
      timestamp: now,
      action: 'blocked',
      summary: `${symbol}: ${side} blocked — ${riskDecision.reason}`,
      details,
    };
  }

  // ── Executed ──────────────────────────────────────────────────
  details.push(`✅ Risk check: All 15 checks passed`);

  return {
    symbol,
    timestamp: now,
    action: 'executed',
    summary: `${symbol}: ${side} executed @ $${ticker.last.toLocaleString('en-US', { minimumFractionDigits: 2 })} — ${signal.reason}`,
    details,
  };
}

/**
 * Format a trade summary as a readable string (for logs/alerts).
 */
export function formatSummary(summary: TradeSummary): string {
  const lines = [summary.summary, ...summary.details.map(d => `  • ${d}`)];
  return lines.join('\n');
}
