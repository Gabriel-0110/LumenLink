/**
 * Prometheus-compatible metrics endpoint.
 * 
 * Exposes all counters and gauges in Prometheus text format at /metrics.
 * Compatible with Grafana + Prometheus for dashboards.
 */

import type { Metrics } from './metrics.js';

export class PrometheusMetrics implements Metrics {
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();
  private readonly histograms = new Map<string, number[]>();

  increment(name: string, value = 1): void {
    const key = this.sanitize(name);
    this.counters.set(key, (this.counters.get(key) ?? 0) + value);
  }

  gauge(name: string, value: number): void {
    const key = this.sanitize(name);
    this.gauges.set(key, value);
  }

  observe(name: string, value: number): void {
    const key = this.sanitize(name);
    const arr = this.histograms.get(key) ?? [];
    arr.push(value);
    // Keep last 1000 observations
    if (arr.length > 1000) arr.shift();
    this.histograms.set(key, arr);
  }

  /** Render all metrics in Prometheus text exposition format */
  render(): string {
    const lines: string[] = [];

    for (const [name, value] of this.counters) {
      lines.push(`# TYPE lumenlink_${name} counter`);
      lines.push(`lumenlink_${name} ${value}`);
    }

    for (const [name, value] of this.gauges) {
      lines.push(`# TYPE lumenlink_${name} gauge`);
      lines.push(`lumenlink_${name} ${value}`);
    }

    for (const [name, values] of this.histograms) {
      if (values.length === 0) continue;
      const sum = values.reduce((a, b) => a + b, 0);
      const count = values.length;
      lines.push(`# TYPE lumenlink_${name} summary`);
      lines.push(`lumenlink_${name}_sum ${sum}`);
      lines.push(`lumenlink_${name}_count ${count}`);
    }

    return lines.join('\n') + '\n';
  }

  /** Get raw snapshot (for internal use / /status endpoint) */
  snapshot(): { counters: Record<string, number>; gauges: Record<string, number> } {
    return {
      counters: Object.fromEntries(this.counters.entries()),
      gauges: Object.fromEntries(this.gauges.entries()),
    };
  }

  private sanitize(name: string): string {
    return name.replace(/[^a-zA-Z0-9_]/g, '_');
  }
}
