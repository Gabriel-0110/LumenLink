export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
  }
}

export class RiskBlockedError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'RISK_BLOCKED', details);
  }
}
