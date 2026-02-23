import type { Logger } from '../core/logger.js';
import type { Metrics } from '../core/metrics.js';
import type { KillSwitchState } from '../core/types.js';

export interface KillSwitchConfig {
  maxDrawdownPct: number;
  maxConsecutiveLosses: number;
  apiErrorThreshold: number;
  spreadViolationsLimit: number;
  spreadViolationsWindowMin: number;
}

/**
 * Centralized kill switch that halts all trading when triggered.
 * Persists state to SQLite and requires manual reset.
 */
export class KillSwitch {
  private state: KillSwitchState = {
    triggered: false,
    reason: null,
    triggeredAt: null,
    consecutiveLosses: 0,
    spreadViolations: [],
  };

  constructor(
    private readonly config: KillSwitchConfig,
    private readonly logger: Logger,
    private readonly metrics: Metrics
  ) {}

  /** Initialize table and hydrate state from SQLite. */
  init(db: { exec: (sql: string) => void; prepare: (sql: string) => { get: (...args: any[]) => unknown; run: (...args: any[]) => unknown } }): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS kill_switch (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        triggered INTEGER NOT NULL DEFAULT 0,
        reason TEXT,
        triggered_at INTEGER,
        consecutive_losses INTEGER NOT NULL DEFAULT 0,
        spread_violations TEXT NOT NULL DEFAULT '[]'
      )
    `);
    const row = db.prepare('SELECT * FROM kill_switch WHERE id = 1').get() as {
      triggered: number; reason: string | null; triggered_at: number | null;
      consecutive_losses: number; spread_violations: string;
    } | undefined;
    if (row) {
      this.state = {
        triggered: row.triggered === 1,
        reason: row.reason,
        triggeredAt: row.triggered_at,
        consecutiveLosses: row.consecutive_losses,
        spreadViolations: JSON.parse(row.spread_violations),
      };
    } else {
      db.prepare('INSERT INTO kill_switch (id, triggered, consecutive_losses, spread_violations) VALUES (1, 0, 0, ?)').run('[]');
    }
    if (this.state.triggered) {
      this.logger.warn('kill switch is active from previous session', { reason: this.state.reason });
    }
  }

  /** Check if the kill switch is triggered. */
  isTriggered(): boolean {
    return this.state.triggered;
  }

  /** Trigger the kill switch with a reason. */
  trigger(reason: string): void {
    if (this.state.triggered) return;
    this.state.triggered = true;
    this.state.reason = reason;
    this.state.triggeredAt = Date.now();
    this.logger.error('KILL SWITCH TRIGGERED', { reason });
    this.metrics.increment('kill_switch.triggered');
    this.emit_persist();
  }

  /** Manually reset the kill switch. */
  reset(): void {
    this.state.triggered = false;
    this.state.reason = null;
    this.state.triggeredAt = null;
    this.state.consecutiveLosses = 0;
    this.state.spreadViolations = [];
    this.logger.info('kill switch reset');
    this.metrics.increment('kill_switch.reset');
    this.emit_persist();
  }

  /** Get current state snapshot. */
  getState(): Readonly<KillSwitchState> {
    return { ...this.state };
  }

  /** Record a trade result. Triggers on consecutive losses exceeding threshold. */
  recordTradeResult(profitable: boolean): void {
    if (profitable) {
      this.state.consecutiveLosses = 0;
    } else {
      this.state.consecutiveLosses++;
      if (this.state.consecutiveLosses >= this.config.maxConsecutiveLosses) {
        this.trigger(`${this.state.consecutiveLosses} consecutive losses`);
      }
    }
    this.emit_persist();
  }

  /** Check drawdown against threshold. */
  checkDrawdown(currentEquity: number, peakEquity: number): void {
    if (peakEquity <= 0) return;
    const drawdownPct = ((peakEquity - currentEquity) / peakEquity) * 100;
    if (drawdownPct >= this.config.maxDrawdownPct) {
      this.trigger(`Drawdown ${drawdownPct.toFixed(2)}% exceeds ${this.config.maxDrawdownPct}% threshold`);
    }
  }

  /** Record a spread/slippage violation. Triggers if too many in the window. */
  recordSpreadViolation(): void {
    const now = Date.now();
    const windowMs = this.config.spreadViolationsWindowMin * 60_000;
    this.state.spreadViolations.push({ timestamp: now });
    this.state.spreadViolations = this.state.spreadViolations.filter(v => now - v.timestamp < windowMs);
    if (this.state.spreadViolations.length >= this.config.spreadViolationsLimit) {
      this.trigger(`${this.state.spreadViolations.length} spread/slippage violations in ${this.config.spreadViolationsWindowMin} minutes`);
    }
    this.emit_persist();
  }

  /** Check API error rate via circuit breaker. */
  checkApiErrors(errorCount: number): void {
    if (errorCount >= this.config.apiErrorThreshold) {
      this.trigger(`API error count ${errorCount} exceeds threshold ${this.config.apiErrorThreshold}`);
    }
  }

  // Persistence callback — set by the owner to persist state to SQLite.
  private _persistFn?: () => void;

  /** Set the persistence callback. */
  setPersistFn(fn: () => void): void {
    this._persistFn = fn;
  }

  private emit_persist(): void {
    this._persistFn?.();
  }

  /** Persist current state to SQLite. */
  persist(db: { prepare: (sql: string) => { run: (...args: any[]) => unknown } }): void {
    db.prepare(`
      UPDATE kill_switch SET triggered = ?, reason = ?, triggered_at = ?, consecutive_losses = ?, spread_violations = ? WHERE id = 1
    `).run(
      this.state.triggered ? 1 : 0,
      this.state.reason,
      this.state.triggeredAt,
      this.state.consecutiveLosses,
      JSON.stringify(this.state.spreadViolations)
    );
  }
}
