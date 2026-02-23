import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { PositionStateMachine } from '../../src/execution/positionStateMachine.js';
import { InMemoryStore } from '../../src/data/inMemoryStore.js';
import { createMockLogger } from '../helpers.js';

describe('PositionStateMachine', () => {
  let psm: PositionStateMachine;
  let db: Database.Database;

  beforeEach(async () => {
    db = new Database(':memory:');
    psm = new PositionStateMachine(new InMemoryStore(), createMockLogger());
    await psm.init(db);
  });

  it('creates a position in flat state', () => {
    const pos = psm.create({ id: 'p1', symbol: 'BTC-USD', side: 'buy', quantity: 0.01 });
    expect(pos.state).toBe('flat');
    expect(pos.symbol).toBe('BTC-USD');
    expect(pos.quantity).toBe(0.01);
  });

  it('transitions through valid lifecycle', () => {
    psm.create({ id: 'p1', symbol: 'BTC-USD', side: 'buy', quantity: 0.01 });

    psm.transition('p1', 'pending_entry');
    expect(psm.get('p1')!.state).toBe('pending_entry');

    psm.transition('p1', 'filled', { entryPrice: 50000, quantity: 0.01 });
    expect(psm.get('p1')!.state).toBe('filled');
    expect(psm.get('p1')!.entryPrice).toBe(50000);

    psm.transition('p1', 'managing');
    expect(psm.get('p1')!.state).toBe('managing');

    psm.transition('p1', 'pending_exit');
    expect(psm.get('p1')!.state).toBe('pending_exit');

    psm.transition('p1', 'exited');
    expect(psm.get('p1')!.state).toBe('exited');
  });

  it('throws on invalid transitions', () => {
    psm.create({ id: 'p1', symbol: 'BTC-USD', side: 'buy', quantity: 0.01 });

    // flat -> managing is invalid
    expect(() => psm.transition('p1', 'managing')).toThrow(/Invalid transition/);

    // flat -> exited is invalid
    expect(() => psm.transition('p1', 'exited')).toThrow(/Invalid transition/);
  });

  it('throws for non-existent position', () => {
    expect(() => psm.transition('doesnt-exist', 'filled')).toThrow(/not found/);
  });

  it('getBySymbol finds active positions', () => {
    psm.create({ id: 'p1', symbol: 'BTC-USD', side: 'buy', quantity: 0.01 });
    // flat state = not active for getBySymbol
    expect(psm.getBySymbol('BTC-USD')).toBeUndefined();

    psm.transition('p1', 'pending_entry');
    expect(psm.getBySymbol('BTC-USD')).toBeDefined();
    expect(psm.getBySymbol('BTC-USD')!.id).toBe('p1');
  });

  it('getAllActive filters correctly', () => {
    psm.create({ id: 'p1', symbol: 'BTC-USD', side: 'buy', quantity: 0.01 });
    psm.create({ id: 'p2', symbol: 'ETH-USD', side: 'buy', quantity: 1 });

    expect(psm.getAllActive()).toHaveLength(0); // both flat

    psm.transition('p1', 'pending_entry');
    expect(psm.getAllActive()).toHaveLength(1);

    psm.transition('p2', 'pending_entry');
    expect(psm.getAllActive()).toHaveLength(2);
  });

  it('persists and hydrates positions', async () => {
    psm.create({ id: 'p1', symbol: 'BTC-USD', side: 'buy', quantity: 0.01 });
    psm.transition('p1', 'pending_entry');
    psm.transition('p1', 'filled', { entryPrice: 50000 });
    await psm.persist('p1', db as any);

    // New instance hydrates from same DB
    const psm2 = new PositionStateMachine(new InMemoryStore(), createMockLogger());
    await psm2.init(db);
    const pos = psm2.get('p1');
    expect(pos).toBeDefined();
    expect(pos!.state).toBe('filled');
    expect(pos!.entryPrice).toBe(50000);
  });

  it('does not hydrate exited positions', async () => {
    psm.create({ id: 'p1', symbol: 'BTC-USD', side: 'buy', quantity: 0.01 });
    psm.transition('p1', 'pending_entry');
    psm.transition('p1', 'filled', { entryPrice: 50000 });
    psm.transition('p1', 'managing');
    psm.transition('p1', 'pending_exit');
    psm.transition('p1', 'exited');
    await psm.persist('p1', db as any);

    const psm2 = new PositionStateMachine(new InMemoryStore(), createMockLogger());
    await psm2.init(db);
    expect(psm2.getAllActive()).toHaveLength(0);
  });

  it('updates stopLoss and takeProfit on transition', () => {
    psm.create({ id: 'p1', symbol: 'BTC-USD', side: 'buy', quantity: 0.01, stopLoss: 49000, takeProfit: 55000 });
    psm.transition('p1', 'pending_entry');
    psm.transition('p1', 'filled', { entryPrice: 50000 });
    psm.transition('p1', 'managing', { stopLoss: 49500 });
    expect(psm.get('p1')!.stopLoss).toBe(49500);
    expect(psm.get('p1')!.takeProfit).toBe(55000); // unchanged
  });
});
