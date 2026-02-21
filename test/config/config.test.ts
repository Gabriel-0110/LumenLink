import { describe, expect, it } from 'vitest';
import { configSchema } from '../../src/config/schema.js';

describe('config schema', () => {
  it('defaults to paper mode', () => {
    const parsed = configSchema.parse({});
    expect(parsed.mode).toBe('paper');
    expect(parsed.exchange).toBe('coinbase');
    expect(parsed.symbols.length).toBeGreaterThan(0);
  });

  it('parses live mode and booleans', () => {
    const parsed = configSchema.parse({
      MODE: 'live',
      ALLOW_LIVE_TRADING: 'true',
      KILL_SWITCH: 'false'
    });
    expect(parsed.mode).toBe('live');
    expect(parsed.allowLiveTrading).toBe(true);
    expect(parsed.killSwitch).toBe(false);
  });
});
