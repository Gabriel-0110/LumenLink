import * as crypto from 'node:crypto';
import type { AppConfig } from '../config/types.js';
import type { Logger } from '../core/logger.js';
import type { Metrics } from '../core/metrics.js';
import type { Order, Position, RiskDecision, Signal, Ticker } from '../core/types.js';
import { computePositionUsd } from '../risk/positionSizing.js';
import type { KillSwitch } from './killSwitch.js';
import { LiveBroker } from './liveBroker.js';
import { OrderState } from './orderState.js';
import type { AdvancedOrderRequest } from './orderTypes.js';
import { toBasicOrderRequest } from './orderTypes.js';
import { PaperBroker } from './paperBroker.js';
import type { PositionStateMachine } from './positionStateMachine.js';
import type { RetryExecutor } from './retryExecutor.js';
import { TrailingStopManager, type TrailingStopConfig } from './trailingStops.js';

export class OrderManager {
  private readonly trailingStops = new TrailingStopManager();

  constructor(
    private readonly config: AppConfig,
    private readonly orderState: OrderState,
    private readonly paperBroker: PaperBroker,
    private readonly liveBroker: LiveBroker,
    private readonly logger: Logger,
    private readonly metrics: Metrics,
    private readonly killSwitch?: KillSwitch,
    private readonly retryExecutor?: RetryExecutor,
    private readonly positionSM?: PositionStateMachine
  ) {}

  createClientOrderId(symbol: string, side: 'buy' | 'sell'): string {
    return `${symbol}-${side}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  }

  /**
   * Submit a signal as an order. Checks kill switch, uses retry executor,
   * and updates position state machine on fills.
   */
  async submitSignal(input: {
    symbol: string;
    signal: Signal;
    ticker: Ticker;
    idempotencyKey?: string;
    /** Pass the RiskDecision to use ATR-computed position sizing when available. */
    riskDecision?: RiskDecision;
    /** Current open position for this symbol (used to size SELL orders correctly). */
    currentPosition?: Position;
    /** Available cash (USD) — used to cap BUY orders so they never exceed balance. */
    availableCashUsd?: number;
  }): Promise<Order | undefined> {
    const { symbol, signal, ticker, riskDecision, currentPosition, availableCashUsd } = input;
    if (signal.action === 'HOLD') return undefined;

    // Check kill switch
    if (this.killSwitch?.isTriggered()) {
      this.logger.warn('order blocked by kill switch', { symbol });
      this.metrics.increment('orders.kill_switch_blocked');
      return undefined;
    }

    const side: 'buy' | 'sell' = signal.action === 'BUY' ? 'buy' : 'sell';
    const clientOrderId = input.idempotencyKey ?? this.createClientOrderId(symbol, side);

    const existing = this.orderState.getByClientOrderId(clientOrderId);
    if (existing) {
      this.logger.info('idempotent order request matched existing order', {
        clientOrderId,
        orderId: existing.orderId
      });
      this.metrics.increment('orders.idempotent_hit');
      return existing;
    }

    let quantity: number;

    if (side === 'sell' && currentPosition && currentPosition.quantity > 0) {
      // SELL: sell a fraction of the position (deployPercent) so we keep some BTC
      const deployPct = this.config.risk.deployPercent ?? 0.5;
      const sellQty = currentPosition.quantity * deployPct;
      quantity = Math.floor(sellQty * 1e8) / 1e8;
      this.logger.info('SELL order sized to position fraction', {
        symbol,
        positionQty: currentPosition.quantity,
        deployPercent: (deployPct * 100).toFixed(0) + '%',
        orderQty: quantity,
      });
    } else {
      // BUY: use ATR-computed size from RiskDecision, or convex confidence scaling
      let targetUsd = riskDecision?.positionSizeUsd ?? computePositionUsd(signal.confidence, this.config.risk.maxPositionUsd);

      // Cap to deployable fraction of available cash so we always keep reserves
      if (availableCashUsd !== undefined && availableCashUsd >= 0) {
        const deployPct = this.config.risk.deployPercent ?? 0.5;
        // Reserve 0.5% for exchange fees, then apply deploy fraction
        const usable = availableCashUsd * 0.995 * deployPct;
        if (usable < 1) {
          this.logger.warn('BUY skipped — available cash below $1', {
            symbol, availableCashUsd: availableCashUsd.toFixed(2),
          });
          return undefined;
        }
        if (targetUsd > usable) {
          this.logger.info('BUY size capped to available cash', {
            symbol,
            originalUsd: targetUsd.toFixed(2),
            cappedUsd: usable.toFixed(2),
          });
          targetUsd = usable;
        }
      }

      // Floor to 8 decimal places — Coinbase BTC-USD base_increment = 0.00000001
      const rawQty = Math.max(0.000001, targetUsd / Math.max(ticker.last, 1));
      quantity = Math.floor(rawQty * 1e8) / 1e8;
    }

    const orderReq: AdvancedOrderRequest = {
      symbol,
      side,
      type: 'market',
      quantity,
      clientOrderId
    };

    return this.placeOrder(orderReq, ticker);
  }

  /**
   * Place an advanced order request (market, limit, stop, stop_limit).
   * Uses retry executor if available, updates position state machine on fills.
   */
  async placeOrder(req: AdvancedOrderRequest, ticker: Ticker): Promise<Order> {
    if (this.killSwitch?.isTriggered()) {
      throw new Error('Kill switch is active — all trading halted');
    }

    // Update position SM to pending_entry if applicable
    if (this.positionSM && req.side === 'buy') {
      const existingPos = this.positionSM.getBySymbol(req.symbol);
      if (!existingPos) {
        const pos = this.positionSM.create({
          id: req.clientOrderId,
          symbol: req.symbol,
          side: req.side,
          quantity: req.quantity,
        });
        this.positionSM.transition(pos.id, 'pending_entry');
      }
    }

    const placeFn = async () => {
      const basicReq = toBasicOrderRequest(req);
      if (this.config.mode === 'paper') {
        return this.paperBroker.place(basicReq, ticker, this.config.guards.maxSlippageBps);
      }
      return this.liveBroker.place(basicReq);
    };

    const order = this.retryExecutor
      ? await this.retryExecutor.execute(placeFn, `order:${req.clientOrderId}`)
      : await placeFn();

    await this.orderState.upsert(order);
    this.metrics.increment('orders.submitted');

    // Update position SM on fill
    if (this.positionSM && order.status === 'filled') {
      const pos = this.positionSM.get(req.clientOrderId) ?? this.positionSM.getBySymbol(req.symbol);
      if (pos && (pos.state === 'pending_entry')) {
        this.positionSM.transition(pos.id, 'filled', {
          entryPrice: order.avgFillPrice ?? 0,
          quantity: order.filledQuantity,
        });
      }
    }

    return order;
  }

  /** Cancel all open orders. Used by kill switch activation. */
  async cancelAllOrders(): Promise<void> {
    const openOrders = this.orderState.getOpenOrders();
    this.logger.info('canceling all open orders', { count: openOrders.length });
    for (const order of openOrders) {
      try {
        if (this.config.mode === 'live') {
          await this.liveBroker.cancel(order.orderId);
        }
        const canceled: Order = { ...order, status: 'canceled', updatedAt: Date.now() };
        await this.orderState.upsert(canceled);
      } catch (error) {
        this.logger.error('failed to cancel order', {
          orderId: order.orderId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    this.metrics.increment('orders.cancel_all', openOrders.length);
  }

  // Trailing Stop Management
  addTrailingStop(position: Position, config: TrailingStopConfig, currentPrice: number): void {
    const stop = this.trailingStops.addTrailingStop(position, config, currentPrice);
    this.logger.info('trailing stop added', {
      symbol: config.symbol,
      initialStopPrice: stop.currentStopPrice,
      trailPercent: config.trailPercent
    });
    this.metrics.increment('trailing_stops.added');
  }

  async processTrailingStops(ticker: Ticker): Promise<Order[]> {
    const triggeredSymbols = this.trailingStops.updateTrailingStops(ticker);
    const orders: Order[] = [];

    for (const symbol of triggeredSymbols) {
      const stop = this.trailingStops.getTrailingStop(symbol);
      if (!stop) continue;

      const side: 'buy' | 'sell' = stop.side === 'buy' ? 'sell' : 'buy';
      const clientOrderId = this.createClientOrderId(symbol, side);
      const quantity = 0.001;

      const orderReq = {
        symbol,
        side,
        type: 'market' as const,
        quantity,
        clientOrderId
      };

      try {
        const order = this.config.mode === 'paper'
          ? await this.paperBroker.place(orderReq, ticker, this.config.guards.maxSlippageBps)
          : await this.liveBroker.place(orderReq);

        await this.orderState.upsert(order);
        orders.push(order);

        this.logger.info('trailing stop triggered', {
          symbol,
          stopPrice: stop.currentStopPrice,
          currentPrice: ticker.last,
          orderId: order.orderId
        });

        this.metrics.increment('trailing_stops.triggered');
        this.trailingStops.removeTrailingStop(symbol);
      } catch (error) {
        this.logger.error('failed to execute trailing stop order', {
          symbol,
          error: error instanceof Error ? error.message : String(error)
        });
        this.metrics.increment('trailing_stops.failed');
      }
    }

    return orders;
  }

  removeTrailingStop(symbol: string): boolean {
    const removed = this.trailingStops.removeTrailingStop(symbol);
    if (removed) {
      this.logger.info('trailing stop removed', { symbol });
      this.metrics.increment('trailing_stops.removed');
    }
    return removed;
  }

  getTrailingStops() {
    return this.trailingStops.getAllTrailingStops();
  }
}
