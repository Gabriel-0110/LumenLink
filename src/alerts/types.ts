/**
 * Unified alert types — single source of truth for the notification system.
 *
 * Covers severity levels, event types, channel routing, and preferences.
 */

export type AlertSeverity = 'info' | 'warn' | 'critical';
export const SEVERITY_RANK: Record<AlertSeverity, number> = { info: 0, warn: 1, critical: 2 };

export type AlertEventType =
  | 'orderFilled' | 'orderRejected'
  | 'killSwitchTriggered' | 'killSwitchReset'
  | 'dailyLossHit' | 'circuitBreakerOpen' | 'volatilityHalt'
  | 'eventLockout' | 'trailingStopTriggered' | 'cooldownActive'
  | 'dailySummary' | 'sentimentAlert'
  | 'systemStartup' | 'systemShutdown'
  | 'strategySwitched' | 'sessionPaused' | 'sessionResumed'
  | 'generic';

export type AlertChannel = 'console' | 'telegram' | 'discord' | 'dashboard';
export type EventTypeOverride = 'always' | 'never' | 'default';

export interface RoutedAlert {
  eventType: AlertEventType;
  severity: AlertSeverity;
  title: string;
  message: string;
  source: string;
  context?: Record<string, unknown>;
  timestamp: number;
}

export interface ChannelPrefs {
  enabled: boolean;
  minSeverity: AlertSeverity;
  overrides: Partial<Record<AlertEventType, EventTypeOverride>>;
}

export interface NotificationPrefs {
  channels: Record<AlertChannel, ChannelPrefs>;
}

export const DEFAULT_PREFS: NotificationPrefs = {
  channels: {
    console: { enabled: true, minSeverity: 'info', overrides: {} },
    telegram: { enabled: false, minSeverity: 'warn', overrides: {} },
    discord: { enabled: false, minSeverity: 'warn', overrides: {} },
    dashboard: { enabled: true, minSeverity: 'info', overrides: {} },
  },
};

export const ALL_EVENT_TYPES: AlertEventType[] = [
  'orderFilled', 'orderRejected',
  'killSwitchTriggered', 'killSwitchReset',
  'dailyLossHit', 'circuitBreakerOpen', 'volatilityHalt',
  'eventLockout', 'trailingStopTriggered', 'cooldownActive',
  'dailySummary', 'sentimentAlert',
  'systemStartup', 'systemShutdown',
  'strategySwitched', 'sessionPaused', 'sessionResumed',
  'generic',
];

export const ALL_CHANNELS: AlertChannel[] = ['console', 'telegram', 'discord', 'dashboard'];
