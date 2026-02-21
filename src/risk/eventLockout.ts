/**
 * News/Event lockout — prevents trading around high-impact macro events.
 * 
 * Events like FOMC, CPI, NFP, and major token unlocks cause unpredictable
 * volatility. This module blocks trading within a configurable window
 * around known events.
 * 
 * Supports:
 * - Static event calendar (manually maintained)
 * - Configurable lockout window (before + after event)
 * - Event categories (macro, crypto, earnings)
 */

export type EventCategory = 'macro' | 'crypto' | 'earnings';
export type EventImpact = 'high' | 'medium' | 'low';

export interface ScheduledEvent {
  name: string;
  time: number;              // Unix timestamp (ms)
  category: EventCategory;
  impact: EventImpact;
  lockoutBeforeMs: number;   // How long before event to stop trading
  lockoutAfterMs: number;    // How long after event to resume
}

export interface EventLockoutConfig {
  /** Default lockout before event (ms). Default: 30 min */
  defaultLockoutBeforeMs: number;
  /** Default lockout after event (ms). Default: 60 min */
  defaultLockoutAfterMs: number;
  /** Only lock out for these impact levels. Default: ['high'] */
  lockoutImpactLevels: EventImpact[];
  /** Enable/disable lockout. Default: true */
  enabled: boolean;
}

const DEFAULT_CONFIG: EventLockoutConfig = {
  defaultLockoutBeforeMs: 30 * 60_000,   // 30 min before
  defaultLockoutAfterMs: 60 * 60_000,    // 60 min after
  lockoutImpactLevels: ['high'],
  enabled: true,
};

export class EventLockout {
  private readonly config: EventLockoutConfig;
  private events: ScheduledEvent[] = [];

  constructor(config: Partial<EventLockoutConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Add events to the calendar */
  addEvents(events: Array<Omit<ScheduledEvent, 'lockoutBeforeMs' | 'lockoutAfterMs'> & { lockoutBeforeMs?: number; lockoutAfterMs?: number }>): void {
    for (const e of events) {
      this.events.push({
        ...e,
        lockoutBeforeMs: e.lockoutBeforeMs ?? this.config.defaultLockoutBeforeMs,
        lockoutAfterMs: e.lockoutAfterMs ?? this.config.defaultLockoutAfterMs,
      });
    }
    // Sort by time ascending
    this.events.sort((a, b) => a.time - b.time);
  }

  /** Clear past events (housekeeping) */
  pruneOldEvents(nowMs: number = Date.now()): void {
    this.events = this.events.filter(e => e.time + e.lockoutAfterMs > nowMs);
  }

  /**
   * Check if trading is locked out right now.
   * Returns the blocking event if in lockout window.
   */
  check(nowMs: number = Date.now()): { blocked: boolean; reason: string; event?: ScheduledEvent } {
    if (!this.config.enabled) {
      return { blocked: false, reason: 'Event lockout disabled' };
    }

    for (const event of this.events) {
      if (!this.config.lockoutImpactLevels.includes(event.impact)) continue;

      const lockoutStart = event.time - event.lockoutBeforeMs;
      const lockoutEnd = event.time + event.lockoutAfterMs;

      if (nowMs >= lockoutStart && nowMs <= lockoutEnd) {
        const isBeforeEvent = nowMs < event.time;
        const minutesAway = Math.abs(event.time - nowMs) / 60_000;
        const timing = isBeforeEvent
          ? `${minutesAway.toFixed(0)} min before`
          : `${minutesAway.toFixed(0)} min after`;

        return {
          blocked: true,
          reason: `Event lockout: ${event.name} (${timing}) [${event.impact} impact]`,
          event,
        };
      }
    }

    return { blocked: false, reason: 'No active event lockout' };
  }

  /** Get upcoming events within the next N hours */
  getUpcoming(hoursAhead: number = 24, nowMs: number = Date.now()): ScheduledEvent[] {
    const cutoff = nowMs + hoursAhead * 3_600_000;
    return this.events.filter(e => e.time >= nowMs && e.time <= cutoff);
  }

  /** Get all registered events */
  getAllEvents(): ScheduledEvent[] {
    return [...this.events];
  }
}

/**
 * Common macro events — use as a starting template.
 * Times should be updated each month with actual schedule.
 */
export function createCommonMacroEvents(year: number, month: number): Array<Omit<ScheduledEvent, 'lockoutBeforeMs' | 'lockoutAfterMs'>> {
  // These are placeholders — actual dates change monthly.
  // In production, fetch from an economic calendar API.
  return [
    { name: 'FOMC Rate Decision', time: 0, category: 'macro', impact: 'high' },
    { name: 'CPI Release', time: 0, category: 'macro', impact: 'high' },
    { name: 'NFP (Non-Farm Payrolls)', time: 0, category: 'macro', impact: 'high' },
    { name: 'PPI Release', time: 0, category: 'macro', impact: 'medium' },
    { name: 'Retail Sales', time: 0, category: 'macro', impact: 'medium' },
    { name: 'GDP Release', time: 0, category: 'macro', impact: 'high' },
    { name: 'PCE Price Index', time: 0, category: 'macro', impact: 'high' },
    { name: 'Unemployment Claims', time: 0, category: 'macro', impact: 'low' },
  ];
}
