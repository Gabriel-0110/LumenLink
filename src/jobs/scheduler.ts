import type { Logger } from '../core/logger.js';

export class Scheduler {
  private readonly timers: NodeJS.Timeout[] = [];

  constructor(private readonly logger: Logger) {}

  add(name: string, everyMs: number, task: () => Promise<void>): void {
    const timer = setInterval(() => {
      void task().catch((err) => {
        this.logger.error('scheduled task failed', { name, err: String(err), stack: err instanceof Error ? err.stack : undefined });
      });
    }, everyMs);
    this.timers.push(timer);
    this.logger.info('scheduled task registered', { name, everyMs });
  }

  shutdown(): void {
    for (const timer of this.timers) {
      clearInterval(timer);
    }
    this.logger.info('scheduler shutdown complete');
  }
}
