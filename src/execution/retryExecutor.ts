import type { Logger } from '../core/logger.js';
import type { Metrics } from '../core/metrics.js';
import { CircuitBreaker } from '../risk/guards.js';

/** Error classification for retry decisions. */
function isRetryable(error: unknown): boolean {
  const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  const retryablePatterns = ['timeout', 'etimedout', 'econnreset', 'econnrefused', 'rate limit', '429', '503', '502', 'network', 'fetch failed'];
  return retryablePatterns.some(p => msg.includes(p));
}

export interface RetryExecutorConfig {
  maxAttempts: number;
  baseDelayMs: number;
}

/**
 * Wraps async operations with exponential backoff retry and circuit breaker integration.
 * Preserves idempotency by reusing the same request on each attempt.
 */
export class RetryExecutor {
  private readonly circuitBreaker: CircuitBreaker;

  constructor(
    private readonly config: RetryExecutorConfig,
    private readonly logger: Logger,
    private readonly metrics: Metrics,
    circuitBreaker?: CircuitBreaker
  ) {
    this.circuitBreaker = circuitBreaker ?? new CircuitBreaker(config.maxAttempts * 3, 5 * 60 * 1000);
  }

  /** Execute an async function with retry logic. */
  async execute<T>(fn: () => Promise<T>, label: string): Promise<T> {
    if (this.circuitBreaker.isOpen()) {
      this.metrics.increment('retry.circuit_breaker_open');
      throw new Error(`Circuit breaker open, refusing ${label}`);
    }

    let lastError: unknown;
    for (let attempt = 1; attempt <= this.config.maxAttempts; attempt++) {
      try {
        const result = await fn();
        this.circuitBreaker.recordSuccess();
        return result;
      } catch (error) {
        lastError = error;
        const retriable = isRetryable(error);
        this.logger.warn('retry attempt failed', {
          label, attempt, maxAttempts: this.config.maxAttempts,
          retriable, error: error instanceof Error ? error.message : String(error),
        });
        this.metrics.increment('retry.attempt');

        if (!retriable) {
          this.circuitBreaker.recordFailure();
          this.metrics.increment('retry.fatal_error');
          throw error;
        }

        this.circuitBreaker.recordFailure();
        if (attempt < this.config.maxAttempts) {
          const delay = this.config.baseDelayMs * Math.pow(2, attempt - 1);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    this.metrics.increment('retry.exhausted');
    throw lastError;
  }

  /** Get the underlying circuit breaker state. */
  getCircuitBreakerState() {
    return this.circuitBreaker.getState();
  }
}
