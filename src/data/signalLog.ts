/**
 * Signal Log — persistent record of every signal evaluation.
 *
 * Records both executed and blocked signals so the dashboard can show
 * why trades happened (or didn't). Follows the TradeJournal pattern.
 */

import Database from 'better-sqlite3';

export interface SignalLogEntry {
  id?: number;
  symbol: string;
  action: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  reason: string;
  strategy: string;

  /** Final outcome: 'executed', 'risk_blocked', 'gate_blocked', 'inventory_blocked', 'cooldown', 'order_failed' */
  outcome: string;
  /** Which gate/check blocked it (if blocked) */
  blockedBy: string | null;
  /** Risk decision reason */
  riskReason: string | null;

  /** Edge analysis JSON (from gatekeeper, if available) */
  edgeDataJson: string | null;

  timestamp: number;
}

export class SignalLog {
  private readonly db: Database.Database;

  constructor(dbPath = './data/runtime.sqlite') {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS signal_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL,
        action TEXT NOT NULL,
        confidence REAL NOT NULL,
        reason TEXT NOT NULL,
        strategy TEXT NOT NULL,
        outcome TEXT NOT NULL,
        blocked_by TEXT,
        risk_reason TEXT,
        edge_data_json TEXT,
        timestamp INTEGER NOT NULL,
        date_str TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_signal_log_symbol ON signal_log(symbol);
      CREATE INDEX IF NOT EXISTS idx_signal_log_timestamp ON signal_log(timestamp);
      CREATE INDEX IF NOT EXISTS idx_signal_log_outcome ON signal_log(outcome);
      CREATE INDEX IF NOT EXISTS idx_signal_log_date ON signal_log(date_str);
    `);
  }

  private static readonly SELECT_COLS = `
    id, symbol, action, confidence, reason, strategy,
    outcome, blocked_by as blockedBy, risk_reason as riskReason,
    edge_data_json as edgeDataJson, timestamp
  `;

  record(entry: Omit<SignalLogEntry, 'id'>): void {
    this.db.prepare(`
      INSERT INTO signal_log(
        symbol, action, confidence, reason, strategy,
        outcome, blocked_by, risk_reason, edge_data_json,
        timestamp, date_str
      ) VALUES (
        @symbol, @action, @confidence, @reason, @strategy,
        @outcome, @blockedBy, @riskReason, @edgeDataJson,
        @timestamp, @dateStr
      )
    `).run({
      ...entry,
      blockedBy: entry.blockedBy ?? null,
      riskReason: entry.riskReason ?? null,
      edgeDataJson: entry.edgeDataJson ?? null,
      dateStr: new Date(entry.timestamp).toISOString().slice(0, 10),
    });
  }

  getRecent(limit = 200): SignalLogEntry[] {
    return this.db.prepare(
      `SELECT ${SignalLog.SELECT_COLS} FROM signal_log ORDER BY timestamp DESC LIMIT ?`
    ).all(limit) as SignalLogEntry[];
  }

  getBySymbol(symbol: string, limit = 100): SignalLogEntry[] {
    return this.db.prepare(
      `SELECT ${SignalLog.SELECT_COLS} FROM signal_log WHERE symbol = ? ORDER BY timestamp DESC LIMIT ?`
    ).all(symbol, limit) as SignalLogEntry[];
  }

  getByOutcome(outcome: string, limit = 100): SignalLogEntry[] {
    return this.db.prepare(
      `SELECT ${SignalLog.SELECT_COLS} FROM signal_log WHERE outcome = ? ORDER BY timestamp DESC LIMIT ?`
    ).all(outcome, limit) as SignalLogEntry[];
  }

  /** Count signals by outcome for a date */
  getCountsByDate(date: string): { outcome: string; count: number }[] {
    return this.db.prepare(
      `SELECT outcome, COUNT(*) as count FROM signal_log WHERE date_str = ? GROUP BY outcome`
    ).all(date) as { outcome: string; count: number }[];
  }
}
