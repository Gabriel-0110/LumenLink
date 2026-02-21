type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const levelWeight: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

export class JsonLogger implements Logger {
  constructor(private readonly minLevel: LogLevel = 'info') {}

  private write(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (levelWeight[level] < levelWeight[this.minLevel]) return;
    const entry = {
      ts: new Date().toISOString(),
      level,
      message,
      ...context
    };
    // Avoid passing secrets into logs from higher-level callers.
    process.stdout.write(`${JSON.stringify(entry)}\n`);
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.write('debug', message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.write('info', message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.write('warn', message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.write('error', message, context);
  }
}
