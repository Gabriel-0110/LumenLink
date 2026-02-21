import Database from 'better-sqlite3';
import type { Candle, Order } from '../core/types.js';
import type { CandleStore } from './candleStore.js';

export class SqliteStore implements CandleStore {
  private readonly db: Database.Database;

  constructor(dbPath = './runtime.sqlite') {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS candles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL,
        interval TEXT NOT NULL,
        time INTEGER NOT NULL,
        open REAL NOT NULL,
        high REAL NOT NULL,
        low REAL NOT NULL,
        close REAL NOT NULL,
        volume REAL NOT NULL,
        UNIQUE(symbol, interval, time)
      );

      CREATE TABLE IF NOT EXISTS orders (
        order_id TEXT PRIMARY KEY,
        client_order_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL,
        type TEXT NOT NULL,
        quantity REAL NOT NULL,
        price REAL,
        status TEXT NOT NULL,
        filled_quantity REAL NOT NULL,
        avg_fill_price REAL,
        reason TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_candles_symbol_interval_time
        ON candles(symbol, interval, time);
    `);
  }

  async saveCandles(candles: Candle[]): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO candles(symbol, interval, time, open, high, low, close, volume)
      VALUES(@symbol, @interval, @time, @open, @high, @low, @close, @volume)
      ON CONFLICT(symbol, interval, time) DO UPDATE SET
        open=excluded.open,
        high=excluded.high,
        low=excluded.low,
        close=excluded.close,
        volume=excluded.volume
    `);

    const insertMany = this.db.transaction((rows: Candle[]) => {
      for (const candle of rows) stmt.run(candle);
    });

    insertMany(candles);
  }

  async getRecentCandles(symbol: string, interval: string, limit: number): Promise<Candle[]> {
    const stmt = this.db.prepare(
      `SELECT symbol, interval, time, open, high, low, close, volume
       FROM candles
       WHERE symbol = ? AND interval = ?
       ORDER BY time DESC
       LIMIT ?`
    );
    const rows = stmt.all(symbol, interval, limit) as Candle[];
    return rows.reverse();
  }

  async saveOrder(order: Order): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO orders(
        order_id, client_order_id, symbol, side, type, quantity,
        price, status, filled_quantity, avg_fill_price, reason, created_at, updated_at
      ) VALUES(
        @orderId, @clientOrderId, @symbol, @side, @type, @quantity,
        @price, @status, @filledQuantity, @avgFillPrice, @reason, @createdAt, @updatedAt
      )
      ON CONFLICT(order_id) DO UPDATE SET
        client_order_id=excluded.client_order_id,
        symbol=excluded.symbol,
        side=excluded.side,
        type=excluded.type,
        quantity=excluded.quantity,
        price=excluded.price,
        status=excluded.status,
        filled_quantity=excluded.filled_quantity,
        avg_fill_price=excluded.avg_fill_price,
        reason=excluded.reason,
        created_at=excluded.created_at,
        updated_at=excluded.updated_at
    `);
    // better-sqlite3 requires all named parameters to exist on the object (even if null).
    // Normalize optional fields to null so the bind doesn't throw RangeError.
    stmt.run({
      ...order,
      price: order.price ?? null,
      avgFillPrice: order.avgFillPrice ?? null,
      reason: order.reason ?? null,
    });
  }

  async getOrders(): Promise<Order[]> {
    const stmt = this.db.prepare(`
      SELECT
        order_id as orderId,
        client_order_id as clientOrderId,
        symbol,
        side,
        type,
        quantity,
        price,
        status,
        filled_quantity as filledQuantity,
        avg_fill_price as avgFillPrice,
        reason,
        created_at as createdAt,
        updated_at as updatedAt
      FROM orders
      ORDER BY updated_at DESC
    `);
    return stmt.all() as Order[];
  }
}
