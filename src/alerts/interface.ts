export interface AlertService {
  notify(title: string, message: string, context?: Record<string, unknown>): Promise<void>;
}
