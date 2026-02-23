/**
 * NotificationRouter — unified alert routing hub.
 *
 * All alerts flow through this single entry point. It:
 * 1. Pushes every alert to AlertStore (fixes the empty-store bug)
 * 2. Emits on EventBus 'alerts' channel (WebSocket delivery)
 * 3. Routes to console/telegram/discord based on per-channel prefs + per-event overrides
 *
 * Implements AlertService for backwards-compatibility with TradingLoops.
 */

import type { AlertService } from './interface.js';
import type { AlertTemplate } from './alertTemplates.js';
import type { NotificationPrefsStore } from './notificationPrefsStore.js';
import type { AlertStore } from '../data/alertStore.js';
import type { EventBus } from '../../backend/src/services/eventBus.js';
import type { Logger } from '../core/logger.js';
import {
  SEVERITY_RANK,
  ALL_CHANNELS,
  type AlertChannel,
  type AlertEventType,
  type AlertSeverity,
  type RoutedAlert,
} from './types.js';

export interface ChannelServices {
  console: AlertService;
  telegram?: AlertService;
  discord?: AlertService;
}

export class NotificationRouter implements AlertService {
  constructor(
    private readonly prefs: NotificationPrefsStore,
    private readonly alertStore: AlertStore,
    private readonly eventBus: EventBus,
    private readonly services: ChannelServices,
    private readonly logger: Logger,
  ) {}

  /**
   * Route an alert through the entire notification pipeline.
   * This is the primary entry point — all alerts should use this.
   */
  async route(alert: RoutedAlert): Promise<void> {
    // 1. Always push to AlertStore (dashboard history)
    this.alertStore.push({
      level: alert.severity,
      title: alert.title,
      message: alert.message,
      source: alert.source,
      eventType: alert.eventType,
      timestamp: alert.timestamp,
    });

    // 2. Always emit on EventBus (WebSocket delivery)
    this.eventBus.emit('alerts', {
      level: alert.severity,
      title: alert.title,
      message: alert.message,
      context: alert.context,
      timestamp: alert.timestamp,
    });

    // 3. Route to each external channel based on prefs
    const deliveries: Promise<void>[] = [];

    for (const channel of ALL_CHANNELS) {
      if (channel === 'dashboard') continue; // Already handled via alertStore + eventBus
      if (!this.shouldDeliver(channel, alert.eventType, alert.severity)) continue;

      const service = this.getService(channel);
      if (!service) continue;

      deliveries.push(
        service.notify(alert.title, alert.message, {
          ...alert.context,
          severity: alert.severity,
          eventType: alert.eventType,
        }).catch(err => {
          this.logger.warn(`notification delivery failed for ${channel}`, { error: String(err) });
        }),
      );
    }

    await Promise.allSettled(deliveries);
  }

  /**
   * AlertService compatibility shim — routes as 'generic' event type with 'info' severity.
   * Used by TradingLoops and any code that still calls notify() directly.
   */
  async notify(title: string, message: string, context?: Record<string, unknown>): Promise<void> {
    await this.route({
      eventType: 'generic',
      severity: 'info',
      title,
      message,
      source: 'legacy',
      context,
      timestamp: Date.now(),
    });
  }

  /**
   * Route a pre-built alert template with a specific event type.
   * Preferred over raw notify() for typed, categorized alerts.
   */
  async routeTemplate(
    eventType: AlertEventType,
    template: AlertTemplate,
    source: string,
    context?: Record<string, unknown>,
  ): Promise<void> {
    await this.route({
      eventType,
      severity: template.severity,
      title: template.title,
      message: template.message,
      source,
      context,
      timestamp: Date.now(),
    });
  }

  /** Check if an alert should be delivered to a channel based on prefs. */
  private shouldDeliver(channel: AlertChannel, eventType: AlertEventType, severity: AlertSeverity): boolean {
    const channelPrefs = this.prefs.getForChannel(channel);
    if (!channelPrefs.enabled) return false;

    const override = channelPrefs.overrides[eventType];
    if (override === 'always') return true;
    if (override === 'never') return false;

    // Default: check severity threshold
    return SEVERITY_RANK[severity] >= SEVERITY_RANK[channelPrefs.minSeverity];
  }

  private getService(channel: AlertChannel): AlertService | undefined {
    switch (channel) {
      case 'console': return this.services.console;
      case 'telegram': return this.services.telegram;
      case 'discord': return this.services.discord;
      default: return undefined;
    }
  }
}
