import type { AlertService } from './interface.js';

export class ConsoleAlertService implements AlertService {
  async notify(title: string, message: string, context?: Record<string, unknown>): Promise<void> {
    process.stdout.write(
      `${JSON.stringify({ ts: new Date().toISOString(), alert: title, message, ...context })}\n`
    );
  }
}
