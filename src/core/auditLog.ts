/**
 * Audit Logger — immutable log of every order request, security event,
 * and configuration change.
 * 
 * This is separate from the trade journal. The audit log captures:
 * - Every order attempt (success or failure)
 * - Secret access
 * - Config changes
 * - Kill switch events
 * - Authentication failures
 * 
 * Stored in SQLite for durability. Never deleted, only appended.
 */

import Database from 'better-sqlite3';

export type AuditEventType =
  | 'order_request'
  | 'order_filled'
  | 'order_rejected'
  | 'order_canceled'
  | 'risk_blocked'
  | 'kill_switch_triggered'
  | 'kill_switch_reset'
  | 'config_change'
  | 'secret_accessed'
  | 'auth_failure'
  | 'startup'
  | 'shutdown'
  | 'circuit_breaker'
  | 'anomaly_detected';

export interface AuditEntry {
  id?: number;
  timestamp: number;
  eventType: AuditEventType;
  symbol?: string;
  side?: string;
  quantity?: number;
  price?: number;
  orderId?: string;
  reason: string;
  mode: 'paper' | 'live';
  metadata?: string;       // JSON string for extra context
}

export class AuditLog {
  private readonly db: Database.Database;

  constructor(dbPath = './runtime.sqlite') {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        symbol TEXT,
        side TEXT,
        quantity REAL,
        price REAL,
        order_id TEXT,
        reason TEXT NOT NULL,
        mode TEXT NOT NULL,
        metadata TEXT,
        date_str TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);
      CREATE INDEX IF NOT EXISTS idx_audit_event_type ON audit_log(event_type);
      CREATE INDEX IF NOT EXISTS idx_audit_date ON audit_log(date_str);
    `);
  }

  /** Append an audit entry. Immutable — never update or delete. */
  record(entry: AuditEntry): void {
    const stmt = this.db.prepare(`
      INSERT INTO audit_log(
        timestamp, event_type, symbol, side, quantity, price, order_id,
        reason, mode, metadata, date_str
      ) VALUES (
        @timestamp, @eventType, @symbol, @side, @quantity, @price, @orderId,
        @reason, @mode, @metadata, @dateStr
      )
    `);

    stmt.run({
      timestamp: entry.timestamp,
      eventType: entry.eventType,
      symbol: entry.symbol ?? null,
      side: entry.side ?? null,
      quantity: entry.quantity ?? null,
      price: entry.price ?? null,
      orderId: entry.orderId ?? null,
      reason: entry.reason,
      mode: entry.mode,
      metadata: entry.metadata ?? null,
      dateStr: new Date(entry.timestamp).toISOString().slice(0, 10),
    });
  }

  /** Convenience: log an order request */
  logOrderRequest(opts: {
    symbol: string;
    side: string;
    quantity: number;
    price: number;
    orderId?: string;
    mode: 'paper' | 'live';
    metadata?: Record<string, unknown>;
  }): void {
    this.record({
      timestamp: Date.now(),
      eventType: 'order_request',
      symbol: opts.symbol,
      side: opts.side,
      quantity: opts.quantity,
      price: opts.price,
      orderId: opts.orderId,
      reason: `${opts.side.toUpperCase()} ${opts.quantity} ${opts.symbol} @ $${opts.price}`,
      mode: opts.mode,
      metadata: opts.metadata ? JSON.stringify(opts.metadata) : undefined,
    });
  }

  /** Convenience: log a risk block */
  logRiskBlock(opts: {
    symbol: string;
    reason: string;
    blockedBy: string;
    mode: 'paper' | 'live';
  }): void {
    this.record({
      timestamp: Date.now(),
      eventType: 'risk_blocked',
      symbol: opts.symbol,
      reason: `Blocked by ${opts.blockedBy}: ${opts.reason}`,
      mode: opts.mode,
    });
  }

  /** Convenience: log kill switch event */
  logKillSwitch(triggered: boolean, reason: string, mode: 'paper' | 'live'): void {
    this.record({
      timestamp: Date.now(),
      eventType: triggered ? 'kill_switch_triggered' : 'kill_switch_reset',
      reason,
      mode,
    });
  }

  /** Get recent audit entries */
  getRecent(limit: number = 100): AuditEntry[] {
    return this.db.prepare(`
      SELECT id, timestamp, event_type as eventType, symbol, side, quantity, price,
             order_id as orderId, reason, mode, metadata, date_str as dateStr
      FROM audit_log ORDER BY timestamp DESC LIMIT ?
    `).all(limit) as AuditEntry[];
  }

  /** Get entries by type */
  getByType(eventType: AuditEventType, limit: number = 50): AuditEntry[] {
    return this.db.prepare(`
      SELECT id, timestamp, event_type as eventType, symbol, side, quantity, price,
             order_id as orderId, reason, mode, metadata
      FROM audit_log WHERE event_type = ? ORDER BY timestamp DESC LIMIT ?
    `).all(eventType, limit) as AuditEntry[];
  }

  /** Count events by type for a date */
  getCountByDate(date: string): Record<string, number> {
    const rows = this.db.prepare(`
      SELECT event_type as eventType, COUNT(*) as count
      FROM audit_log WHERE date_str = ? GROUP BY event_type
    `).all(date) as Array<{ eventType: string; count: number }>;
    return Object.fromEntries(rows.map(r => [r.eventType, r.count]));
  }

  /** Total entry count */
  getCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM audit_log').get() as { count: number };
    return row.count;
  }
}
