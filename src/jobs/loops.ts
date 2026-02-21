import type { AppConfig } from '../config/types.js';
import type { AccountSnapshot } from '../core/types.js';
import type { Logger } from '../core/logger.js';
import type { AlertService } from '../alerts/interface.js';
import { MarketDataService } from '../data/marketDataService.js';
import { OrderManager } from '../execution/orderManager.js';
import { Reconciler } from '../execution/reconciler.js';
import { RiskEngine } from '../risk/riskEngine.js';
import type { Strategy } from '../strategies/interface.js';
import type { CandleStore } from '../data/candleStore.js';

export interface RuntimeState {
  lastCandleTime?: number;
  dailyPnlEstimate: number;
  openPositions: number;
}

export const createDefaultSnapshot = (): AccountSnapshot => ({
  cashUsd: 10000,
  realizedPnlUsd: 0,
  unrealizedPnlUsd: 0,
  openPositions: [],
  lastStopOutAtBySymbol: {}
});

export class TradingLoops {
  private snapshot: AccountSnapshot = createDefaultSnapshot();
  private readonly runtime: RuntimeState = {
    dailyPnlEstimate: 0,
    openPositions: 0
  };

  constructor(
    private readonly config: AppConfig,
    private readonly marketData: MarketDataService,
    private readonly store: CandleStore,
    private readonly strategy: Strategy,
    private readonly riskEngine: RiskEngine,
    private readonly orderManager: OrderManager,
    private readonly reconciler: Reconciler,
    private readonly alert: AlertService,
    private readonly logger: Logger
  ) {}

  getStatus(): RuntimeState {
    this.runtime.openPositions = this.snapshot.openPositions.length;
    this.runtime.dailyPnlEstimate = this.snapshot.realizedPnlUsd + this.snapshot.unrealizedPnlUsd;
    this.runtime.lastCandleTime = this.marketData.getLastCandleTime();
    return this.runtime;
  }

  async marketDataLoop(): Promise<void> {
    await this.marketData.poll(this.config.symbols, this.config.interval, 200, this.config.data.fakeFallback);
  }

  async strategyLoop(): Promise<void> {
    for (const symbol of this.config.symbols) {
      const candles = await this.store.getRecentCandles(symbol, this.config.interval, 250);
      const latest = candles[candles.length - 1];
      if (!latest) continue;

      const signal = this.strategy.onCandle(latest, { candles, symbol });
      const ticker = await this.marketData.getTickerOrSynthetic(symbol);
      const decision = this.riskEngine.evaluate({
        signal,
        symbol,
        snapshot: this.snapshot,
        ticker,
        nowMs: Date.now()
      });

      if (!decision.allowed) {
        this.logger.info('risk blocked signal', {
          symbol,
          action: signal.action,
          reason: decision.reason,
          blockedBy: decision.blockedBy
        });
        continue;
      }

      const order = await this.orderManager.submitSignal({ symbol, signal, ticker });
      if (order) {
        this.applyOrderToSnapshot(order.symbol, order.side, order.filledQuantity, order.avgFillPrice ?? ticker.last);
        await this.alert.notify('Order submitted', `${symbol} ${signal.action} (${signal.reason})`, {
          orderId: order.orderId,
          clientOrderId: order.clientOrderId,
          mode: this.config.mode
        });
      }
    }
  }

  async reconciliationLoop(): Promise<void> {
    if (this.config.mode !== 'live') return;
    await this.reconciler.run(this.config.symbols);
  }

  private applyOrderToSnapshot(
    symbol: string,
    side: 'buy' | 'sell',
    quantity: number,
    fillPrice: number
  ): void {
    const positions = this.snapshot.openPositions;
    const existing = positions.find((p) => p.symbol === symbol);

    if (side === 'buy') {
      if (!existing) {
        positions.push({
          symbol,
          quantity,
          avgEntryPrice: fillPrice,
          marketPrice: fillPrice
        });
        return;
      }
      const totalQty = existing.quantity + quantity;
      const weightedEntry = (existing.avgEntryPrice * existing.quantity + fillPrice * quantity) / totalQty;
      existing.quantity = totalQty;
      existing.avgEntryPrice = weightedEntry;
      existing.marketPrice = fillPrice;
      return;
    }

    if (!existing) return;
    const closeQty = Math.min(existing.quantity, quantity);
    const realized = (fillPrice - existing.avgEntryPrice) * closeQty;
    this.snapshot.realizedPnlUsd += realized;
    existing.quantity -= closeQty;
    existing.marketPrice = fillPrice;
    if (existing.quantity <= 1e-12) {
      this.snapshot.openPositions = positions.filter((p) => p.symbol !== symbol);
      if (realized < 0) {
        this.snapshot.lastStopOutAtBySymbol[symbol] = Date.now();
      }
    }
  }
}
