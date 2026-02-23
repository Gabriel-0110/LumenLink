import type { Logger } from '../core/logger.js';

export class Scheduler {
  private readonly timers = new Map<string, { timer: NodeJS.Timeout; task: () => Promise<void>; everyMs: number }>();

  constructor(private readonly logger: Logger) {}

  add(name: string, everyMs: number, task: () => Promise<void>): void {
    const timer = setInterval(() => {
      void task().catch((err) => {
        this.logger.error('scheduled task failed', { name, err: String(err), stack: err instanceof Error ? err.stack : undefined });
      });
    }, everyMs);
    this.timers.set(name, { timer, task, everyMs });
    this.logger.info('scheduled task registered', { name, everyMs });
  }

  reschedule(name: string, everyMs: number): boolean {
    const entry = this.timers.get(name);
    if (!entry) return false;
    clearInterval(entry.timer);
    const timer = setInterval(() => {
      void entry.task().catch((err: unknown) => {
        this.logger.error('scheduled task failed', { name, err: String(err), stack: err instanceof Error ? err.stack : undefined });
      });
    }, everyMs);
    this.timers.set(name, { timer, task: entry.task, everyMs });
    this.logger.info('scheduled task rescheduled', { name, everyMs });
    return true;
  }

  shutdown(): void {
    for (const [, entry] of this.timers) {
      clearInterval(entry.timer);
    }
    this.logger.info('scheduler shutdown complete');
  }
}
