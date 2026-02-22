/**
 * Trade Journal — persistent record of every trade with full context.
 * 
 * Every entry/exit gets logged with: price, fees, slippage, reason,
 * strategy, confidence, risk decision, P&L, and timestamps.
 * 
 * This is the source of truth for performance analysis.
 */

import Database from 'better-sqlite3';

export interface JournalEntry {
  id?: number;
  tradeId: string;           // groups entry + exit
  symbol: string;
  side: 'buy' | 'sell';
  action: 'entry' | 'exit';
  strategy: string;
  
  // Execution
  orderId: string;
  requestedPrice: number;    // price at signal time
  filledPrice: number;       // actual fill price
  slippageBps: number;       // (filled - requested) / requested * 10000
  quantity: number;
  notionalUsd: number;       // quantity * filledPrice
  commissionUsd: number;     // exchange fee
  
  // Context
  confidence: number;        // strategy confidence (0-1)
  reason: string;            // strategy reason
  riskDecision: string;      // 'allowed' or block reason
  
  // P&L (populated on exit)
  realizedPnlUsd?: number;
  realizedPnlPct?: number;
  holdingDurationMs?: number;
  
  // Metadata
  mode: 'paper' | 'live';
  timestamp: number;
}

export interface DailySummary {
  date: string;              // YYYY-MM-DD
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  grossProfitUsd: number;
  grossLossUsd: number;
  netPnlUsd: number;
  totalCommissionUsd: number;
  totalSlippageBps: number;  // average
  bestTradeUsd: number;
  worstTradeUsd: number;
  maxDrawdownUsd: number;
}

export class TradeJournal {
  private readonly db: Database.Database;

  constructor(dbPath = './data/runtime.sqlite') {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS trade_journal (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trade_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL,
        action TEXT NOT NULL,
        strategy TEXT NOT NULL,
        order_id TEXT NOT NULL,
        requested_price REAL NOT NULL,
        filled_price REAL NOT NULL,
        slippage_bps REAL NOT NULL,
        quantity REAL NOT NULL,
        notional_usd REAL NOT NULL,
        commission_usd REAL NOT NULL,
        confidence REAL NOT NULL,
        reason TEXT NOT NULL,
        risk_decision TEXT NOT NULL,
        realized_pnl_usd REAL,
        realized_pnl_pct REAL,
        holding_duration_ms INTEGER,
        mode TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        date_str TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_journal_trade_id ON trade_journal(trade_id);
      CREATE INDEX IF NOT EXISTS idx_journal_symbol ON trade_journal(symbol);
      CREATE INDEX IF NOT EXISTS idx_journal_date ON trade_journal(date_str);
      CREATE INDEX IF NOT EXISTS idx_journal_timestamp ON trade_journal(timestamp);
    `);
  }

  /** Record an entry or exit */
  record(entry: JournalEntry): void {
    const stmt = this.db.prepare(`
      INSERT INTO trade_journal(
        trade_id, symbol, side, action, strategy, order_id,
        requested_price, filled_price, slippage_bps, quantity, notional_usd, commission_usd,
        confidence, reason, risk_decision,
        realized_pnl_usd, realized_pnl_pct, holding_duration_ms,
        mode, timestamp, date_str
      ) VALUES (
        @tradeId, @symbol, @side, @action, @strategy, @orderId,
        @requestedPrice, @filledPrice, @slippageBps, @quantity, @notionalUsd, @commissionUsd,
        @confidence, @reason, @riskDecision,
        @realizedPnlUsd, @realizedPnlPct, @holdingDurationMs,
        @mode, @timestamp, @dateStr
      )
    `);

    stmt.run({
      ...entry,
      realizedPnlUsd: entry.realizedPnlUsd ?? null,
      realizedPnlPct: entry.realizedPnlPct ?? null,
      holdingDurationMs: entry.holdingDurationMs ?? null,
      dateStr: new Date(entry.timestamp).toISOString().slice(0, 10),
    });
  }

  private static readonly SELECT_COLS = `
    id, trade_id as tradeId, symbol, side, action, strategy,
    order_id as orderId, requested_price as requestedPrice,
    filled_price as filledPrice, slippage_bps as slippageBps,
    quantity, notional_usd as notionalUsd, commission_usd as commissionUsd,
    confidence, reason, risk_decision as riskDecision,
    realized_pnl_usd as realizedPnlUsd, realized_pnl_pct as realizedPnlPct,
    holding_duration_ms as holdingDurationMs,
    mode, timestamp, date_str as dateStr
  `;

  /** Get all entries for a trade */
  getTradeEntries(tradeId: string): JournalEntry[] {
    return this.db.prepare(
      `SELECT ${TradeJournal.SELECT_COLS} FROM trade_journal WHERE trade_id = ? ORDER BY timestamp`
    ).all(tradeId) as JournalEntry[];
  }

  /** Get recent trades */
  getRecent(limit: number = 50): JournalEntry[] {
    return this.db.prepare(
      `SELECT ${TradeJournal.SELECT_COLS} FROM trade_journal ORDER BY timestamp DESC LIMIT ?`
    ).all(limit) as JournalEntry[];
  }

  /** Get trades for a date range */
  getByDateRange(startDate: string, endDate: string): JournalEntry[] {
    return this.db.prepare(
      `SELECT ${TradeJournal.SELECT_COLS} FROM trade_journal WHERE date_str >= ? AND date_str <= ? ORDER BY timestamp`
    ).all(startDate, endDate) as JournalEntry[];
  }

  /** Calculate daily summary */
  getDailySummary(date: string): DailySummary {
    const exits = this.db.prepare(
      `SELECT ${TradeJournal.SELECT_COLS} FROM trade_journal WHERE date_str = ? AND action = 'exit' ORDER BY timestamp`
    ).all(date) as JournalEntry[];

    const allEntries = this.db.prepare(
      `SELECT ${TradeJournal.SELECT_COLS} FROM trade_journal WHERE date_str = ? ORDER BY timestamp`
    ).all(date) as JournalEntry[];

    const wins = exits.filter(e => (e.realizedPnlUsd ?? 0) > 0);
    const losses = exits.filter(e => (e.realizedPnlUsd ?? 0) <= 0);
    const grossProfit = wins.reduce((s, e) => s + (e.realizedPnlUsd ?? 0), 0);
    const grossLoss = Math.abs(losses.reduce((s, e) => s + (e.realizedPnlUsd ?? 0), 0));
    const totalCommission = allEntries.reduce((s, e) => s + (e.commissionUsd ?? 0), 0);
    const avgSlippage = allEntries.length > 0
      ? allEntries.reduce((s, e) => s + Math.abs(e.slippageBps ?? 0), 0) / allEntries.length
      : 0;

    // Max drawdown within the day
    let peak = 0;
    let maxDD = 0;
    let cumPnl = 0;
    for (const exit of exits) {
      cumPnl += exit.realizedPnlUsd ?? 0;
      if (cumPnl > peak) peak = cumPnl;
      const dd = peak - cumPnl;
      if (dd > maxDD) maxDD = dd;
    }

    return {
      date,
      totalTrades: exits.length,
      wins: wins.length,
      losses: losses.length,
      winRate: exits.length > 0 ? (wins.length / exits.length) * 100 : 0,
      grossProfitUsd: grossProfit,
      grossLossUsd: grossLoss,
      netPnlUsd: grossProfit - grossLoss,
      totalCommissionUsd: totalCommission,
      totalSlippageBps: avgSlippage,
      bestTradeUsd: exits.length > 0 ? Math.max(...exits.map(e => e.realizedPnlUsd ?? 0)) : 0,
      worstTradeUsd: exits.length > 0 ? Math.min(...exits.map(e => e.realizedPnlUsd ?? 0)) : 0,
      maxDrawdownUsd: maxDD,
    };
  }

  /** Get summary for the last N days */
  getMultiDaySummary(days: number = 7): DailySummary[] {
    const summaries: DailySummary[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(Date.now() - i * 86_400_000);
      const dateStr = d.toISOString().slice(0, 10);
      const summary = this.getDailySummary(dateStr);
      if (summary.totalTrades > 0) summaries.push(summary);
    }
    return summaries;
  }

  /** Total trade count */
  getTradeCount(): number {
    const row = this.db.prepare("SELECT COUNT(*) as count FROM trade_journal WHERE action = 'exit'").get() as { count: number };
    return row.count;
  }
}
