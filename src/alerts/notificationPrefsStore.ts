/**
 * NotificationPrefsStore — SQLite-backed notification preferences.
 *
 * Singleton row pattern (id=1). Deep-merges with defaults on load
 * so new event types are handled gracefully across upgrades.
 */

import Database from 'better-sqlite3';
import {
  DEFAULT_PREFS,
  ALL_CHANNELS,
  type NotificationPrefs,
  type ChannelPrefs,
  type AlertChannel,
} from './types.js';

export class NotificationPrefsStore {
  private db: Database.Database;
  private cache: NotificationPrefs;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS notification_prefs (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        prefs TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    this.cache = this.load();
  }

  private load(): NotificationPrefs {
    const row = this.db.prepare('SELECT prefs FROM notification_prefs WHERE id = 1').get() as
      | { prefs: string }
      | undefined;

    if (!row) return structuredClone(DEFAULT_PREFS);

    try {
      const stored = JSON.parse(row.prefs) as Partial<NotificationPrefs>;
      return this.mergeWithDefaults(stored);
    } catch {
      return structuredClone(DEFAULT_PREFS);
    }
  }

  /** Deep-merge stored prefs with defaults so new channels/event types are covered. */
  private mergeWithDefaults(stored: Partial<NotificationPrefs>): NotificationPrefs {
    const result = structuredClone(DEFAULT_PREFS);
    if (!stored.channels) return result;

    for (const ch of ALL_CHANNELS) {
      const src = stored.channels[ch];
      if (!src) continue;
      const dst = result.channels[ch]!;
      if (typeof src.enabled === 'boolean') dst.enabled = src.enabled;
      if (src.minSeverity && ['info', 'warn', 'critical'].includes(src.minSeverity)) {
        dst.minSeverity = src.minSeverity;
      }
      if (src.overrides) {
        for (const [k, v] of Object.entries(src.overrides)) {
          if (v && ['always', 'never', 'default'].includes(v)) {
            dst.overrides[k as keyof ChannelPrefs['overrides']] = v;
          }
        }
      }
    }
    return result;
  }

  get(): NotificationPrefs {
    return this.cache;
  }

  save(prefs: NotificationPrefs): void {
    const stmt = this.db.prepare(`
      INSERT INTO notification_prefs (id, prefs, updated_at)
      VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET prefs = excluded.prefs, updated_at = excluded.updated_at
    `);
    stmt.run(JSON.stringify(prefs), Date.now());
    this.cache = prefs;
  }

  /** Patch specific channels/overrides and return the full merged result. */
  patch(partial: Partial<NotificationPrefs>): NotificationPrefs {
    const current = this.load();
    const merged = this.mergeWithDefaults({ ...current, ...this.deepMergeChannels(current, partial) });
    this.save(merged);
    return merged;
  }

  private deepMergeChannels(
    current: NotificationPrefs,
    partial: Partial<NotificationPrefs>,
  ): Partial<NotificationPrefs> {
    if (!partial.channels) return current;
    const result: NotificationPrefs = structuredClone(current);
    for (const ch of ALL_CHANNELS) {
      const src = partial.channels[ch];
      if (!src) continue;
      const dst = result.channels[ch] as ChannelPrefs;
      if (typeof src.enabled === 'boolean') dst.enabled = src.enabled;
      if (src.minSeverity) dst.minSeverity = src.minSeverity;
      if (src.overrides) {
        for (const [k, v] of Object.entries(src.overrides)) {
          if (v === 'default') {
            delete dst.overrides[k as keyof ChannelPrefs['overrides']];
          } else if (v) {
            (dst.overrides as Record<string, string>)[k] = v;
          }
        }
      }
    }
    return result;
  }

  getForChannel(channel: AlertChannel): ChannelPrefs {
    return this.cache.channels[channel];
  }
}
