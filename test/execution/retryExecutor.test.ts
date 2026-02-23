import { describe, it, expect } from 'vitest';
import { RetryExecutor } from '../../src/execution/retryExecutor.js';
import { createMockLogger, createMockMetrics } from '../helpers.js';

describe('RetryExecutor', () => {
  const makeExecutor = (maxAttempts = 3) =>
    new RetryExecutor(
      { maxAttempts, baseDelayMs: 10 }, // tiny delay for fast tests
      createMockLogger(),
      createMockMetrics()
    );

  it('returns result on success', async () => {
    const executor = makeExecutor();
    const result = await executor.execute(async () => 42, 'test');
    expect(result).toBe(42);
  });

  it('retries on retryable errors and succeeds', async () => {
    const executor = makeExecutor();
    let attempts = 0;
    const result = await executor.execute(async () => {
      attempts++;
      if (attempts < 3) throw new Error('timeout');
      return 'ok';
    }, 'retry-test');
    expect(result).toBe('ok');
    expect(attempts).toBe(3);
  });

  it('throws immediately on non-retryable errors', async () => {
    const executor = makeExecutor();
    let attempts = 0;
    await expect(
      executor.execute(async () => {
        attempts++;
        throw new Error('invalid API key');
      }, 'fatal-test')
    ).rejects.toThrow('invalid API key');
    expect(attempts).toBe(1);
  });

  it('exhausts maxAttempts on persistent retryable errors', async () => {
    const executor = makeExecutor(2);
    let attempts = 0;
    await expect(
      executor.execute(async () => {
        attempts++;
        throw new Error('429 rate limit');
      }, 'exhaust-test')
    ).rejects.toThrow('429 rate limit');
    expect(attempts).toBe(2);
  });

  it('retries on various retryable patterns', async () => {
    for (const msg of ['ETIMEDOUT', 'ECONNRESET', '503 Service Unavailable', 'fetch failed', 'network error']) {
      const executor = makeExecutor(2); // fresh executor per pattern to avoid circuit breaker
      let attempts = 0;
      try {
        await executor.execute(async () => {
          attempts++;
          throw new Error(msg);
        }, `pattern-${msg}`);
      } catch { /* expected */ }
      expect(attempts).toBe(2); // should have retried
    }
  });

  it('circuit breaker opens after many failures', async () => {
    // maxAttempts=2, breaker threshold = 2*3=6
    const executor = makeExecutor(2);

    // Burn through failures to open circuit breaker
    for (let i = 0; i < 4; i++) {
      try {
        await executor.execute(async () => {
          throw new Error('timeout');
        }, `burn-${i}`);
      } catch { /* expected */ }
    }

    // Circuit breaker should be open now
    await expect(
      executor.execute(async () => 'should-not-run', 'blocked')
    ).rejects.toThrow(/[Cc]ircuit breaker open/);
  });
});
