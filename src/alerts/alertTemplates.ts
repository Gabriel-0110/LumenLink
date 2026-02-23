/**
 * Alert Templates — pre-formatted alerts for critical trading events.
 * 
 * Each template handles formatting, severity level, and context.
 * Used by the alert multiplexer to send consistent notifications.
 */

import type { AlertSeverity } from './types.js';

export interface AlertTemplate {
  title: string;
  message: string;
  severity: AlertSeverity;
}

const SEVERITY_EMOJI: Record<AlertSeverity, string> = {
  info: 'ℹ️',
  warn: '⚠️',
  critical: '🚨',
};

// ── Template Factories ──────────────────────────────────────────────

export const alertTemplates = {
  orderFilled(symbol: string, side: string, qty: number, price: number, mode: string): AlertTemplate {
    return {
      title: `${SEVERITY_EMOJI.info} Order Filled`,
      message: `${side.toUpperCase()} ${qty} ${symbol} @ $${price.toLocaleString('en-US', { minimumFractionDigits: 2 })} [${mode}]`,
      severity: 'info',
    };
  },

  orderRejected(symbol: string, reason: string, blockedBy: string): AlertTemplate {
    return {
      title: `${SEVERITY_EMOJI.warn} Order Rejected`,
      message: `${symbol}: ${reason}\nBlocked by: ${blockedBy}`,
      severity: 'warn',
    };
  },

  killSwitchTriggered(reason: string): AlertTemplate {
    return {
      title: `${SEVERITY_EMOJI.critical} KILL SWITCH ACTIVATED`,
      message: `All trading halted.\nReason: ${reason}\n\nManual reset required.`,
      severity: 'critical',
    };
  },

  dailyLossHit(lossUsd: number, limitUsd: number): AlertTemplate {
    return {
      title: `${SEVERITY_EMOJI.critical} Daily Loss Limit Hit`,
      message: `Loss: $${Math.abs(lossUsd).toFixed(2)} / $${limitUsd.toFixed(2)} limit\nTrading paused until tomorrow.`,
      severity: 'critical',
    };
  },

  circuitBreakerOpen(failures: number): AlertTemplate {
    return {
      title: `${SEVERITY_EMOJI.critical} Circuit Breaker Tripped`,
      message: `${failures} consecutive API failures.\nTrading halted until circuit resets.`,
      severity: 'critical',
    };
  },

  volatilityHalt(symbol: string, atr: number, threshold: number): AlertTemplate {
    return {
      title: `${SEVERITY_EMOJI.warn} Volatility Circuit Breaker`,
      message: `${symbol}: ATR spike detected (${atr.toFixed(2)}x median, threshold: ${threshold}x)\nTrading paused.`,
      severity: 'warn',
    };
  },

  eventLockout(eventName: string, minutesAway: number): AlertTemplate {
    return {
      title: `${SEVERITY_EMOJI.warn} Event Lockout Active`,
      message: `${eventName} in ${minutesAway} min.\nTrading paused until lockout window ends.`,
      severity: 'warn',
    };
  },

  trailingStopTriggered(symbol: string, entryPrice: number, exitPrice: number, pnlPct: number): AlertTemplate {
    const emoji = pnlPct >= 0 ? '🟢' : '🔴';
    return {
      title: `${emoji} Trailing Stop Triggered`,
      message: `${symbol}: Entry $${entryPrice.toFixed(2)} → Exit $${exitPrice.toFixed(2)} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%)`,
      severity: 'info',
    };
  },

  cooldownActive(symbol: string, minutesRemaining: number): AlertTemplate {
    return {
      title: `${SEVERITY_EMOJI.info} Cooldown Active`,
      message: `${symbol}: ${minutesRemaining.toFixed(0)} min remaining after stop-out.`,
      severity: 'info',
    };
  },

  dailySummary(date: string, trades: number, winRate: number, netPnl: number, drawdown: number): AlertTemplate {
    const pnlEmoji = netPnl >= 0 ? '🟢' : '🔴';
    return {
      title: `📊 Daily Summary — ${date}`,
      message: [
        `Trades: ${trades}`,
        `Win Rate: ${winRate.toFixed(1)}%`,
        `${pnlEmoji} Net P&L: $${netPnl >= 0 ? '+' : ''}${netPnl.toFixed(2)}`,
        `Max Drawdown: $${drawdown.toFixed(2)}`,
      ].join('\n'),
      severity: 'info',
    };
  },

  sentimentAlert(fearGreedIndex: number, label: string): AlertTemplate {
    const emoji = fearGreedIndex <= 25 ? '😱' : fearGreedIndex >= 75 ? '🤑' : '😐';
    return {
      title: `${emoji} Sentiment: ${label}`,
      message: `Fear & Greed Index: ${fearGreedIndex}/100\n${fearGreedIndex <= 25 ? 'Extreme fear — potential buy zone' : fearGreedIndex >= 75 ? 'Extreme greed — caution advised' : 'Neutral sentiment'}`,
      severity: fearGreedIndex <= 20 || fearGreedIndex >= 80 ? 'warn' : 'info',
    };
  },

  systemStartup(mode: string, exchange: string, strategy: string, symbols: string[]): AlertTemplate {
    return {
      title: `🚀 LumenLink Started`,
      message: `Mode: ${mode}\nExchange: ${exchange}\nStrategy: ${strategy}\nPairs: ${symbols.join(', ')}`,
      severity: 'info',
    };
  },

  systemShutdown(reason: string): AlertTemplate {
    return {
      title: `🛑 LumenLink Stopped`,
      message: `Reason: ${reason}`,
      severity: 'warn',
    };
  },
};
