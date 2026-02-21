import { EventEmitter } from 'node:events';
import type { Logger } from '../core/logger.js';
import type { PositionState, Side } from '../core/types.js';
import type { CandleStore } from '../data/candleStore.js';

export interface ManagedPosition {
  id: string;
  symbol: string;
  side: Side;
  entryPrice: number;
  quantity: number;
  state: PositionState;
  stopLoss?: number;
  takeProfit?: number;
  createdAt: number;
  updatedAt: number;
}

type TransitionEvent = 'pending_entry' | 'filled' | 'managing' | 'pending_exit' | 'exited' | 'flat';

const VALID_TRANSITIONS: Record<PositionState, PositionState[]> = {
  flat: ['pending_entry'],
  pending_entry: ['filled', 'flat'],
  filled: ['managing', 'pending_exit', 'exited'],
  managing: ['pending_exit', 'exited'],
  pending_exit: ['exited', 'managing'],
  exited: ['flat'],
};

/**
 * Tracks position lifecycle through discrete states with SQLite persistence.
 * Emits events on state transitions.
 */
export class PositionStateMachine extends EventEmitter {
  private readonly positions = new Map<string, ManagedPosition>();

  constructor(
    private readonly store: CandleStore,
    private readonly logger: Logger
  ) {
    super();
  }

  /** Initialize positions table and hydrate from SQLite. */
  async init(db: { exec: (sql: string) => void; prepare: (sql: string) => { all: (...args: unknown[]) => unknown[]; run: (...args: unknown[]) => void } }): Promise<void> {
    db.exec(`
      CREATE TABLE IF NOT EXISTS positions (
        id TEXT PRIMARY KEY,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL,
        entry_price REAL NOT NULL,
        quantity REAL NOT NULL,
        state TEXT NOT NULL,
        stop_loss REAL,
        take_profit REAL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    const rows = db.prepare('SELECT * FROM positions WHERE state != ?').all('exited') as Array<{
      id: string; symbol: string; side: Side; entry_price: number; quantity: number;
      state: PositionState; stop_loss: number | null; take_profit: number | null;
      created_at: number; updated_at: number;
    }>;
    for (const r of rows) {
      this.positions.set(r.id, {
        id: r.id, symbol: r.symbol, side: r.side, entryPrice: r.entry_price,
        quantity: r.quantity, state: r.state, stopLoss: r.stop_loss ?? undefined,
        takeProfit: r.take_profit ?? undefined, createdAt: r.created_at, updatedAt: r.updated_at,
      });
    }
    this.logger.info('position state machine hydrated', { count: this.positions.size });
  }

  /** Create a new position in flat state. */
  create(params: { id: string; symbol: string; side: Side; quantity: number; stopLoss?: number; takeProfit?: number }): ManagedPosition {
    const now = Date.now();
    const pos: ManagedPosition = {
      id: params.id, symbol: params.symbol, side: params.side,
      entryPrice: 0, quantity: params.quantity, state: 'flat',
      stopLoss: params.stopLoss, takeProfit: params.takeProfit,
      createdAt: now, updatedAt: now,
    };
    this.positions.set(pos.id, pos);
    return pos;
  }

  /** Transition a position to a new state. */
  transition(id: string, to: PositionState, update?: Partial<Pick<ManagedPosition, 'entryPrice' | 'quantity' | 'stopLoss' | 'takeProfit'>>): ManagedPosition {
    const pos = this.positions.get(id);
    if (!pos) throw new Error(`Position ${id} not found`);
    if (!VALID_TRANSITIONS[pos.state].includes(to)) {
      throw new Error(`Invalid transition ${pos.state} → ${to} for position ${id}`);
    }
    const from = pos.state;
    pos.state = to;
    pos.updatedAt = Date.now();
    if (update) Object.assign(pos, update);
    this.logger.info('position transition', { id, from, to, symbol: pos.symbol });
    this.emit('transition', { position: pos, from, to });
    return pos;
  }

  /** Persist a position to SQLite. */
  async persist(id: string, db: { prepare: (sql: string) => { run: (...args: unknown[]) => void } }): Promise<void> {
    const pos = this.positions.get(id);
    if (!pos) return;
    db.prepare(`
      INSERT OR REPLACE INTO positions (id, symbol, side, entry_price, quantity, state, stop_loss, take_profit, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(pos.id, pos.symbol, pos.side, pos.entryPrice, pos.quantity, pos.state,
      pos.stopLoss ?? null, pos.takeProfit ?? null, pos.createdAt, pos.updatedAt);
  }

  get(id: string): ManagedPosition | undefined {
    return this.positions.get(id);
  }

  getBySymbol(symbol: string): ManagedPosition | undefined {
    for (const p of this.positions.values()) {
      if (p.symbol === symbol && p.state !== 'exited' && p.state !== 'flat') return p;
    }
    return undefined;
  }

  getAllActive(): ManagedPosition[] {
    return Array.from(this.positions.values()).filter(p => p.state !== 'exited' && p.state !== 'flat');
  }
}
