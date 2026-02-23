/**
 * Alert Store — in-memory ring buffer for persistent alert history.
 *
 * Keeps the last N alerts in memory for the dashboard to query.
 * Alerts are also emitted via EventBus for real-time WebSocket delivery.
 */

export type AlertLevel = 'critical' | 'warn' | 'info';

export interface AlertEntry {
  id: number;
  level: AlertLevel;
  title: string;
  message: string;
  source: string;
  timestamp: number;
}

export class AlertStore {
  private readonly buffer: AlertEntry[] = [];
  private readonly maxSize: number;
  private nextId = 1;

  constructor(maxSize = 500) {
    this.maxSize = maxSize;
  }

  push(alert: Omit<AlertEntry, 'id'>): AlertEntry {
    const entry: AlertEntry = { ...alert, id: this.nextId++ };
    this.buffer.push(entry);
    if (this.buffer.length > this.maxSize) {
      this.buffer.shift();
    }
    return entry;
  }

  getRecent(limit = 100): AlertEntry[] {
    const start = Math.max(0, this.buffer.length - limit);
    return this.buffer.slice(start).reverse();
  }

  getByLevel(level: AlertLevel, limit = 100): AlertEntry[] {
    const filtered = this.buffer.filter(a => a.level === level);
    const start = Math.max(0, filtered.length - limit);
    return filtered.slice(start).reverse();
  }

  getSince(timestamp: number, limit = 200): AlertEntry[] {
    return this.buffer
      .filter(a => a.timestamp >= timestamp)
      .slice(-limit)
      .reverse();
  }

  get size(): number {
    return this.buffer.length;
  }

  clear(): void {
    this.buffer.length = 0;
  }
}
