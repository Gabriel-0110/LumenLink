import { describe, it, expect, beforeEach } from 'vitest';
import { InMemorySignalQueue, type QueuedSignal } from '../../src/core/signalQueue.js';
import { makeTicker } from '../helpers.js';

function makeQueuedSignal(overrides: Partial<QueuedSignal> = {}): QueuedSignal {
  return {
    id: `sig-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    symbol: 'BTC-USD',
    signal: { action: 'BUY', confidence: 0.8, reason: 'test' },
    ticker: makeTicker(),
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('InMemorySignalQueue', () => {
  let queue: InMemorySignalQueue;

  beforeEach(() => {
    queue = new InMemorySignalQueue();
  });

  it('push and pop (FIFO)', async () => {
    await queue.push(makeQueuedSignal({ id: 'first' }));
    await queue.push(makeQueuedSignal({ id: 'second' }));
    const item = await queue.pop();
    expect(item!.id).toBe('first');
  });

  it('pop returns null when empty', async () => {
    expect(await queue.pop()).toBeNull();
  });

  it('peek without removing', async () => {
    await queue.push(makeQueuedSignal({ id: 'peek-me' }));
    const peeked = await queue.peek();
    expect(peeked!.id).toBe('peek-me');
    expect(await queue.length()).toBe(1); // still there
  });

  it('tracks length', async () => {
    expect(await queue.length()).toBe(0);
    await queue.push(makeQueuedSignal());
    await queue.push(makeQueuedSignal());
    expect(await queue.length()).toBe(2);
    await queue.pop();
    expect(await queue.length()).toBe(1);
  });

  it('drain returns all and empties queue', async () => {
    await queue.push(makeQueuedSignal());
    await queue.push(makeQueuedSignal());
    await queue.push(makeQueuedSignal());
    const items = await queue.drain();
    expect(items).toHaveLength(3);
    expect(await queue.length()).toBe(0);
  });

  it('drops oldest when at max size', async () => {
    const small = new InMemorySignalQueue(3);
    await small.push(makeQueuedSignal({ id: 'a' }));
    await small.push(makeQueuedSignal({ id: 'b' }));
    await small.push(makeQueuedSignal({ id: 'c' }));
    await small.push(makeQueuedSignal({ id: 'd' })); // should drop 'a'
    expect(await small.length()).toBe(3);
    const first = await small.pop();
    expect(first!.id).toBe('b'); // 'a' was dropped
  });
});
