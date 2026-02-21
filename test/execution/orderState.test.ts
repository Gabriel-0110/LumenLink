import { describe, it, expect, beforeEach } from 'vitest';
import { OrderState } from '../../src/execution/orderState.js';
import { InMemoryStore } from '../../src/data/inMemoryStore.js';
import { makeOrder } from '../helpers.js';

describe('OrderState', () => {
  let state: OrderState;

  beforeEach(() => {
    state = new OrderState(new InMemoryStore());
  });

  it('stores and retrieves by orderId', async () => {
    const order = makeOrder({ orderId: 'abc-123' });
    await state.upsert(order);
    expect(state.getByOrderId('abc-123')).toEqual(order);
  });

  it('stores and retrieves by clientOrderId (idempotency)', async () => {
    const order = makeOrder({ orderId: 'abc-123', clientOrderId: 'client-xyz' });
    await state.upsert(order);
    expect(state.getByClientOrderId('client-xyz')).toEqual(order);
  });

  it('returns undefined for unknown order', () => {
    expect(state.getByOrderId('nonexistent')).toBeUndefined();
    expect(state.getByClientOrderId('nonexistent')).toBeUndefined();
  });

  it('upserts (updates existing order)', async () => {
    const order = makeOrder({ orderId: 'abc-123', status: 'pending' });
    await state.upsert(order);
    
    const updated = { ...order, status: 'filled' as const, filledQuantity: 0.01 };
    await state.upsert(updated);
    
    expect(state.getByOrderId('abc-123')?.status).toBe('filled');
  });

  it('tracks open orders', async () => {
    await state.upsert(makeOrder({ orderId: '1', symbol: 'BTC-USD', status: 'open' }));
    await state.upsert(makeOrder({ orderId: '2', symbol: 'BTC-USD', status: 'filled' }));
    await state.upsert(makeOrder({ orderId: '3', symbol: 'ETH-USD', status: 'pending' }));

    const allOpen = state.getOpenOrders();
    expect(allOpen).toHaveLength(2);

    const btcOpen = state.getOpenOrders('BTC-USD');
    expect(btcOpen).toHaveLength(1);
    expect(btcOpen[0]!.orderId).toBe('1');
  });

  it('returns all orders', async () => {
    await state.upsert(makeOrder({ orderId: '1' }));
    await state.upsert(makeOrder({ orderId: '2' }));
    await state.upsert(makeOrder({ orderId: '3' }));
    expect(state.getAllOrders()).toHaveLength(3);
  });
});
