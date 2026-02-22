/**
 * Signal Queue — decouples signal generation from order execution.
 * 
 * Why this matters:
 *   - Strategy can produce signals faster than execution handles them
 *   - If execution is slow (API timeout), signals don't get lost
 *   - Clean separation: strategy loop pushes, execution loop consumes
 *   - Replay capability: can re-process signals for debugging
 * 
 * Supports two backends:
 *   - Redis (production, via REDIS_URL env)
 *   - In-memory (paper trading / development)
 */

import type { Signal, Ticker } from './types.js';

export interface QueuedSignal {
  id: string;
  symbol: string;
  signal: Signal;
  ticker: Ticker;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface SignalQueue {
  /** Push a signal onto the queue */
  push(item: QueuedSignal): Promise<void>;
  /** Pop the next signal (FIFO). Returns null if empty. */
  pop(): Promise<QueuedSignal | null>;
  /** Peek without removing */
  peek(): Promise<QueuedSignal | null>;
  /** Current queue depth */
  length(): Promise<number>;
  /** Drain all items (for shutdown) */
  drain(): Promise<QueuedSignal[]>;
}

// ── In-Memory Queue (development / paper) ───────────────────────

export class InMemorySignalQueue implements SignalQueue {
  private readonly queue: QueuedSignal[] = [];
  private readonly maxSize: number;

  constructor(maxSize = 100) {
    this.maxSize = maxSize;
  }

  async push(item: QueuedSignal): Promise<void> {
    if (this.queue.length >= this.maxSize) {
      this.queue.shift(); // drop oldest if full
    }
    this.queue.push(item);
  }

  async pop(): Promise<QueuedSignal | null> {
    return this.queue.shift() ?? null;
  }

  async peek(): Promise<QueuedSignal | null> {
    return this.queue[0] ?? null;
  }

  async length(): Promise<number> {
    return this.queue.length;
  }

  async drain(): Promise<QueuedSignal[]> {
    const items = [...this.queue];
    this.queue.length = 0;
    return items;
  }
}

// ── Redis Queue (production) ────────────────────────────────────

export class RedisSignalQueue implements SignalQueue {
  private readonly queueKey = 'lumenlink:signals';
  private client: any; // Redis client (lazy import to avoid hard dependency)

  constructor(private readonly redisUrl: string) {}

  private async getClient(): Promise<any> {
    if (this.client) return this.client;
    try {
      const { createClient } = await import('redis');
      this.client = createClient({ url: this.redisUrl });
      this.client.on('error', (err: Error) => console.error('Redis error:', err.message));
      await this.client.connect();
      return this.client;
    } catch {
      throw new Error(`Redis unavailable at ${this.redisUrl}. Use InMemorySignalQueue for development.`);
    }
  }

  async push(item: QueuedSignal): Promise<void> {
    const client = await this.getClient();
    await client.rPush(this.queueKey, JSON.stringify(item));
    // Cap queue size
    await client.lTrim(this.queueKey, -100, -1);
  }

  async pop(): Promise<QueuedSignal | null> {
    const client = await this.getClient();
    const raw = await client.lPop(this.queueKey);
    return raw ? JSON.parse(raw) : null;
  }

  async peek(): Promise<QueuedSignal | null> {
    const client = await this.getClient();
    const raw = await client.lIndex(this.queueKey, 0);
    return raw ? JSON.parse(raw) : null;
  }

  async length(): Promise<number> {
    const client = await this.getClient();
    return client.lLen(this.queueKey);
  }

  async drain(): Promise<QueuedSignal[]> {
    const client = await this.getClient();
    const items: QueuedSignal[] = [];
    let raw: string | null;
    while ((raw = await client.lPop(this.queueKey)) !== null) {
      items.push(JSON.parse(raw));
    }
    return items;
  }
}

// ── Factory ─────────────────────────────────────────────────────

export function createSignalQueue(): SignalQueue {
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    return new RedisSignalQueue(redisUrl);
  }
  return new InMemorySignalQueue();
}
