import type { AppConfig } from '../config/types.js';
import type { AccountSnapshot, Candle, Position } from '../core/types.js';
import type { Logger } from '../core/logger.js';
import type { ExchangeAdapter } from '../exchanges/adapter.js';
import type { AlertService } from '../alerts/interface.js';
import { MarketDataService } from '../data/marketDataService.js';
import { OrderManager } from '../execution/orderManager.js';
import { Reconciler } from '../execution/reconciler.js';
import { RiskEngine } from '../risk/riskEngine.js';
import type { Strategy } from '../strategies/interface.js';
import type { CandleStore } from '../data/candleStore.js';
import type { SentimentService, SentimentData } from '../data/sentimentService.js';
import type { OnChainService, MarketOverview } from '../data/onchainService.js';
import { TrailingStopManager } from '../execution/trailingStop.js';
import { MultiTimeframeAnalyzer } from '../strategies/multiTimeframe.js';
import { ATR } from 'technicalindicators';

export interface RuntimeState {
  lastCandleTime?: number;
  dailyPnlEstimate: number;
  openPositions: number;
  sentiment?: SentimentData;
  marketOverview?: MarketOverview;
  lastSentimentUpdate?: number;
  trailingStops?: {
    active: number;
    activated: number;
    total: number;
  };
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

  // Bug 4: Duplicate signal cooldown
  private readonly lastSignalTime = new Map<string, { action: string; timestamp: number }>();
  private static readonly SIGNAL_COOLDOWN_MS = 300_000; // 5 minutes

  private latestSentiment?: SentimentData;
  private latestMarketOverview?: MarketOverview;
  
  // Trailing stops and multi-timeframe analysis
  private readonly trailingStopManager: TrailingStopManager;
  private readonly multiTimeframeAnalyzer: MultiTimeframeAnalyzer;

  constructor(
    private readonly config: AppConfig,
    private readonly marketData: MarketDataService,
    private readonly store: CandleStore,
    private readonly strategy: Strategy,
    private readonly riskEngine: RiskEngine,
    private readonly orderManager: OrderManager,
    private readonly reconciler: Reconciler,
    private readonly alert: AlertService,
    private readonly logger: Logger,
    private readonly sentimentService?: SentimentService,
    private readonly onChainService?: OnChainService
  ) {
    // Initialize trailing stop manager with config
    this.trailingStopManager = new TrailingStopManager({
      activationProfitPercent: 1.5,  // Activate after 1.5% profit
      trailPercent: 2.5,             // Trail 2.5% below highest price
      atrMultiplier: 2.0             // Alternative: trail by ATR * 2.0
    });
    
    // Initialize multi-timeframe analyzer
    this.multiTimeframeAnalyzer = new MultiTimeframeAnalyzer();
  }

  /**
   * Seed the in-memory snapshot with real balances fetched from the exchange.
   * Called once at startup so the bot knows about any pre-existing holdings
   * (e.g. you already hold BTC before the first run) and can issue SELL signals
   * without being blocked by phantom-sell protection.
   */
  async hydrateFromExchange(exchange: ExchangeAdapter): Promise<void> {
    try {
      const balances = await exchange.getBalances();

      // Seed cash from USD / USDC balance
      const usd  = balances.find((b) => b.asset === 'USD')?.free  ?? 0;
      const usdc = balances.find((b) => b.asset === 'USDC')?.free ?? 0;
      this.snapshot.cashUsd = usd + usdc;

      // Seed open positions for each configured symbol that has a non-zero holding
      const positions: Position[] = [];
      for (const symbol of this.config.symbols) {
        // Parse base asset: 'BTC-USD' → 'BTC', 'BTC/USDT' → 'BTC'
        const base = symbol.split(/[-\/]/)[0];
        if (!base) continue;

        const holding = balances.find((b) => b.asset === base);
        if (!holding || holding.free <= 0) continue;

        try {
          const ticker = await exchange.getTicker(symbol);
          positions.push({
            symbol,
            quantity: holding.free,
            avgEntryPrice: ticker.last, // best estimate; actual entry price unknown
            marketPrice: ticker.last,
          });
          this.logger.info('seeded existing position from exchange balance', {
            symbol,
            quantity: holding.free,
            marketPrice: ticker.last,
            valueUsd: (holding.free * ticker.last).toFixed(2),
          });
        } catch (err) {
          this.logger.warn('could not fetch ticker for held asset — skipping position seed', {
            symbol, base, err: String(err),
          });
        }
      }

      this.snapshot.openPositions = positions;

      const totalUsd = positions.reduce((s, p) => s + p.quantity * p.marketPrice, 0);
      this.logger.info('snapshot hydrated from exchange', {
        cashUsd: this.snapshot.cashUsd,
        positionsSeeded: positions.length,
        totalHoldingValueUsd: totalUsd.toFixed(2),
      });
    } catch (err) {
      this.logger.warn('failed to hydrate snapshot from exchange — using empty defaults', {
        err: String(err),
      });
    }
  }

  getStatus(): RuntimeState {
    this.runtime.openPositions = this.snapshot.openPositions.length;
    this.runtime.dailyPnlEstimate = this.snapshot.realizedPnlUsd + this.snapshot.unrealizedPnlUsd;
    this.runtime.lastCandleTime = this.marketData.getLastCandleTime();
    this.runtime.sentiment = this.latestSentiment;
    this.runtime.marketOverview = this.latestMarketOverview;
    this.runtime.lastSentimentUpdate = this.latestSentiment?.timestamp;
    
    // Add trailing stop information
    const allTrailingStops = this.trailingStopManager.getPositions();
    this.runtime.trailingStops = {
      active: allTrailingStops.filter(ts => ts.activated).length,
      activated: allTrailingStops.filter(ts => ts.activated).length,
      total: allTrailingStops.length
    };
    
    return this.runtime;
  }

  /** Returns all data needed by the rich web dashboard. */
  async getRichStatus(journal?: { getMultiDaySummary(days: number): unknown[]; getDailySummary(date: string): unknown; getRecent(limit: number): unknown[]; getTradeCount(): number }) {
    const base = this.getStatus();
    const totalEquityUsd = this.snapshot.cashUsd +
      this.snapshot.openPositions.reduce((s, p) => s + p.quantity * p.marketPrice, 0);

    const positions = this.snapshot.openPositions.map(p => ({
      symbol: p.symbol,
      quantity: p.quantity,
      avgEntryPrice: p.avgEntryPrice,
      marketPrice: p.marketPrice,
      valueUsd: p.quantity * p.marketPrice,
      unrealizedPnlUsd: (p.marketPrice - p.avgEntryPrice) * p.quantity,
      unrealizedPnlPct: p.avgEntryPrice > 0
        ? ((p.marketPrice - p.avgEntryPrice) / p.avgEntryPrice) * 100
        : 0,
    }));

    // Collect sparkline prices from all configured symbols (last 72 candles)
    const sparklines: Record<string, Array<{ time: number; close: number; high: number; low: number; volume: number }>> = {};
    for (const symbol of this.config.symbols) {
      try {
        const candles = await this.store.getRecentCandles(symbol, this.config.interval, 72);
        sparklines[symbol] = candles.map(c => ({
          time: c.time,
          close: c.close,
          high: c.high,
          low: c.low,
          volume: c.volume,
        }));
      } catch { /* best-effort */ }
    }

    const today = new Date().toISOString().slice(0, 10);
    const todaySummary = journal?.getDailySummary(today) ?? null;
    const weekly = journal?.getMultiDaySummary(14) ?? [];
    const recentTrades = journal?.getRecent(50) ?? [];
    const totalTrades = journal?.getTradeCount() ?? 0;

    // Compute cumulative P&L from weekly data (for equity chart label)
    let cumulativePnl = 0;
    const equityCurve = (weekly as Array<{ date: string; netPnlUsd: number }>)
      .slice()
      .reverse()
      .map(d => { cumulativePnl += d.netPnlUsd; return { date: d.date, cumPnl: cumulativePnl }; });

    return {
      uptime: this.runtime.dailyPnlEstimate, // overwritten below by caller
      mode: this.config.mode,
      exchange: this.config.exchange,
      strategy: this.config.strategy,
      interval: this.config.interval,
      symbols: this.config.symbols,
      killSwitch: this.config.killSwitch,
      cash: this.snapshot.cashUsd,
      totalEquityUsd,
      unrealizedPnlUsd: this.snapshot.unrealizedPnlUsd,
      realizedPnlUsd: this.snapshot.realizedPnlUsd,
      positions,
      lastCandleTime: base.lastCandleTime ?? null,
      sentiment: base.sentiment ?? null,
      marketOverview: base.marketOverview ?? null,
      trailingStops: base.trailingStops ?? null,
      risk: {
        maxDailyLossUsd: this.config.risk.maxDailyLossUsd,
        maxPositionUsd: this.config.risk.maxPositionUsd,
        maxOpenPositions: this.config.risk.maxOpenPositions,
        cooldownMinutes: this.config.risk.cooldownMinutes,
        dailyPnlEstimate: this.snapshot.realizedPnlUsd + this.snapshot.unrealizedPnlUsd,
      },
      today: todaySummary,
      weekly,
      equityCurve,
      recentTrades,
      allTime: { totalTrades },
      sparklines,
    };
  }

  /**
   * Display human-readable paper trading dashboard
   */
  async displayPaperTradingDashboard(): Promise<void> {
    if (this.config.mode !== 'paper') return;

    const now = new Date();
    const timeStr = now.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit', 
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short'
    });

    const totalPnL = this.snapshot.realizedPnlUsd + this.snapshot.unrealizedPnlUsd;
    const fearGreedText = this.latestSentiment 
      ? `${this.latestSentiment.fearGreedIndex} (${this.latestSentiment.fearGreedLabel})`
      : 'N/A';

    console.log('\n' + '═'.repeat(60));
    console.log(`${' '.repeat(12)}LumenLink Paper Trading Dashboard`);
    console.log(`${' '.repeat(18)}${timeStr}`);
    console.log('═'.repeat(60));
    console.log(`  Cash:        $${this.snapshot.cashUsd.toFixed(2)}`);
    console.log(`  Positions:   ${this.snapshot.openPositions.length}`);
    console.log(`  Unrealized:  $${this.snapshot.unrealizedPnlUsd.toFixed(2)}`);
    console.log(`  Realized:    $${this.snapshot.realizedPnlUsd.toFixed(2)}`);
    console.log(`  Total P&L:   $${totalPnL.toFixed(2)}`);
    console.log('─'.repeat(60));

    // Show market prices and last signals for each symbol
    const marketInfo: Array<{symbol: string; price: number; signal?: string; confidence?: number}> = [];
    for (const symbol of this.config.symbols) {
      try {
        const ticker = await this.marketData.getTickerOrSynthetic(symbol);
        const candles = await this.store.getRecentCandles(symbol, this.config.interval, 250);
        const latest = candles[candles.length - 1];
        
        let signalInfo = 'N/A';
        if (latest) {
          const signal = this.strategy.onCandle(latest, { candles, symbol });
          signalInfo = signal.confidence > 0 
            ? `${signal.action} (${signal.confidence.toFixed(2)})` 
            : signal.action;
        }
        
        marketInfo.push({
          symbol,
          price: ticker.last,
          signal: signalInfo
        });
      } catch (error) {
        marketInfo.push({
          symbol,
          price: 0,
          signal: 'ERROR'
        });
      }
    }

    // Display market data
    for (const info of marketInfo) {
      const priceStr = info.price > 0 ? `$${info.price.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}` : 'N/A';
      console.log(`  ${info.symbol}: ${priceStr} | Signal: ${info.signal}`);
    }
    
    console.log('─'.repeat(60));

    // Show positions if any exist
    if (this.snapshot.openPositions.length > 0) {
      console.log('  Open Positions:');
      for (const pos of this.snapshot.openPositions) {
        const unrealized = (pos.marketPrice - pos.avgEntryPrice) * pos.quantity;
        const unrealizedPct = ((pos.marketPrice - pos.avgEntryPrice) / pos.avgEntryPrice) * 100;
        console.log(`    ${pos.symbol}: ${pos.quantity.toFixed(6)} @ $${pos.avgEntryPrice.toFixed(2)}`);
        console.log(`      Current: $${pos.marketPrice.toFixed(2)} | P&L: $${unrealized.toFixed(2)} (${unrealizedPct.toFixed(2)}%)`);
      }
      console.log('─'.repeat(60));
    }

    console.log(`  Fear & Greed: ${fearGreedText}`);
    if (this.runtime.trailingStops) {
      console.log(`  Trailing Stops: ${this.runtime.trailingStops.active} active`);
    }
    console.log('═'.repeat(60));
    console.log(); // Extra newline for spacing
  }

  async marketDataLoop(): Promise<void> {
    await this.marketData.poll(this.config.symbols, this.config.interval, 200, this.config.data.fakeFallback);
  }

  async strategyLoop(): Promise<void> {
    // Display dashboard at the start of each strategy cycle
    await this.displayPaperTradingDashboard();

    for (const symbol of this.config.symbols) {
      const candles = await this.store.getRecentCandles(symbol, this.config.interval, 250);
      const latest = candles[candles.length - 1];
      if (!latest) continue;

      const ticker = await this.marketData.getTickerOrSynthetic(symbol);
      
      // --- Process trailing stops first ---
      await this.processTrailingStops(symbol, ticker.last, candles);
      
      // --- Fetch multi-timeframe data for strategies that support it ---
      let mtfResult;
      if (this.strategy.name === 'advanced_composite' || this.strategy.name === 'regime_aware') {
        mtfResult = await this.fetchMultiTimeframeAnalysis(symbol);
      }

      const signal = this.strategy.onCandle(latest, { candles, symbol, mtfResult });

      // Always log what the strategy decided (visible in logs for easy diagnosis)
      this.logger.info('strategy signal', { symbol, action: signal.action, confidence: signal.confidence?.toFixed(2), reason: signal.reason });

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
          signalReason: signal.reason,
          blockReason: decision.reason,
          blockedBy: decision.blockedBy
        });
        continue;
      }

      // Bug 4: Duplicate signal cooldown
      const cooldownKey = `${symbol}:${signal.action}`;
      const lastExec = this.lastSignalTime.get(cooldownKey);
      if (lastExec && Date.now() - lastExec.timestamp < TradingLoops.SIGNAL_COOLDOWN_MS) {
        this.logger.info('Signal cooldown active', {
          symbol,
          action: signal.action,
          lastExecMs: Date.now() - lastExec.timestamp
        });
        continue;
      }

      const order = await this.orderManager.submitSignal({ symbol, signal, ticker });
      if (order) {
        this.lastSignalTime.set(cooldownKey, { action: signal.action, timestamp: Date.now() });
        this.applyOrderToSnapshot(order.symbol, order.side, order.filledQuantity, order.avgFillPrice ?? ticker.last);
        
        // Handle trailing stops for new positions
        if (order.side === 'buy') {
          this.trailingStopManager.openPosition(symbol, order.avgFillPrice ?? ticker.last);
          this.logger.info('trailing stop registered', {
            symbol,
            entryPrice: order.avgFillPrice ?? ticker.last,
            orderId: order.orderId
          });
        } else if (order.side === 'sell') {
          this.trailingStopManager.closePosition(symbol);
          this.logger.info('trailing stop closed', { symbol, orderId: order.orderId });
        }
        
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

  async sentimentLoop(): Promise<void> {
    if (!this.sentimentService || !this.onChainService) {
      this.logger.debug('sentiment services not configured, skipping sentiment loop');
      return;
    }

    try {
      const [sentiment, onChainSummary] = await Promise.allSettled([
        this.sentimentService.getSentiment(),
        this.onChainService.getOnChainSummary()
      ]);

      let sentimentChanged = false;

      // Process sentiment data
      if (sentiment.status === 'fulfilled') {
        const previousFearGreed = this.latestSentiment?.fearGreedIndex;
        this.latestSentiment = sentiment.value;

        // Log significant changes in fear & greed index
        if (previousFearGreed !== undefined) {
          const change = Math.abs(sentiment.value.fearGreedIndex - previousFearGreed);
          if (change >= 10) { // Significant change threshold
            sentimentChanged = true;
            this.logger.info('significant sentiment change detected', {
              previousFearGreed,
              currentFearGreed: sentiment.value.fearGreedIndex,
              currentLabel: sentiment.value.fearGreedLabel,
              change,
              newsScore: sentiment.value.newsScore
            });
          }
        } else {
          // First time logging sentiment
          this.logger.info('sentiment data initialized', {
            fearGreedIndex: sentiment.value.fearGreedIndex,
            fearGreedLabel: sentiment.value.fearGreedLabel,
            newsScore: sentiment.value.newsScore,
            socialSentiment: sentiment.value.socialSentiment
          });
        }
      } else {
        this.logger.warn('failed to fetch sentiment data', { error: sentiment.reason });
      }

      // Process on-chain data
      if (onChainSummary.status === 'fulfilled') {
        const previousBtcDominance = this.latestMarketOverview?.btcDominance;
        this.latestMarketOverview = onChainSummary.value.overview;

        // Log significant BTC dominance changes
        if (previousBtcDominance !== undefined) {
          const dominanceChange = Math.abs(onChainSummary.value.overview.btcDominance - previousBtcDominance);
          if (dominanceChange >= 2) { // 2% dominance change threshold
            this.logger.info('significant btc dominance change detected', {
              previousDominance: previousBtcDominance,
              currentDominance: onChainSummary.value.overview.btcDominance,
              change: dominanceChange,
              totalMarketCap: onChainSummary.value.overview.totalMarketCap,
              trending: onChainSummary.value.trending.slice(0, 5)
            });
          }
        }
      } else {
        this.logger.warn('failed to fetch on-chain data', { error: onChainSummary.reason });
      }

      // Send alert for significant sentiment changes
      if (sentimentChanged && this.latestSentiment) {
        const isExtreme = this.latestSentiment.fearGreedIndex <= 25 || this.latestSentiment.fearGreedIndex >= 75;
        if (isExtreme) {
          await this.alert.notify(
            'Market Sentiment Alert',
            `Fear & Greed Index: ${this.latestSentiment.fearGreedIndex} (${this.latestSentiment.fearGreedLabel})${
              this.latestSentiment.newsScore !== undefined 
                ? ` | News Sentiment: ${(this.latestSentiment.newsScore > 0 ? '+' : '')}${(this.latestSentiment.newsScore * 100).toFixed(1)}%`
                : ''
            }`,
            {
              fearGreedIndex: this.latestSentiment.fearGreedIndex,
              fearGreedLabel: this.latestSentiment.fearGreedLabel,
              newsScore: this.latestSentiment.newsScore,
              btcDominance: this.latestMarketOverview?.btcDominance
            }
          );
        }
      }

    } catch (error) {
      this.logger.error('sentiment loop error', { error: String(error) });
    }
  }

  private async processTrailingStops(symbol: string, currentPrice: number, candles: Candle[]): Promise<void> {
    if (!this.trailingStopManager.hasPosition(symbol)) {
      return;
    }

    // Calculate ATR for more adaptive trailing
    let atr: number | undefined;
    try {
      const highs = candles.slice(-50).map(c => c.high);
      const lows = candles.slice(-50).map(c => c.low);
      const closes = candles.slice(-50).map(c => c.close);
      
      if (highs.length >= 14) {
        const atrValues = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });
        atr = atrValues[atrValues.length - 1];
      }
    } catch (error) {
      this.logger.warn('ATR calculation failed for trailing stop', { symbol, error: String(error) });
    }

    const result = this.trailingStopManager.update(symbol, currentPrice, atr);
    
    if (result.shouldExit) {
      // Generate a SELL signal for the trailing stop
      const ticker = await this.marketData.getTickerOrSynthetic(symbol);
      const trailingStopSignal = {
        action: 'SELL' as const,
        confidence: 0.9, // High confidence for trailing stop
        reason: result.reason
      };

      this.logger.info('trailing stop triggered', { symbol, ...result });

      // Submit the trailing stop order
      const decision = this.riskEngine.evaluate({
        signal: trailingStopSignal,
        symbol,
        snapshot: this.snapshot,
        ticker,
        nowMs: Date.now()
      });

      if (decision.allowed) {
        const order = await this.orderManager.submitSignal({ symbol, signal: trailingStopSignal, ticker });
        if (order) {
          this.applyOrderToSnapshot(order.symbol, order.side, order.filledQuantity, order.avgFillPrice ?? ticker.last);
          this.trailingStopManager.closePosition(symbol);
          
          await this.alert.notify('Trailing Stop Triggered', result.reason, {
            orderId: order.orderId,
            symbol,
            mode: this.config.mode
          });
        }
      } else {
        this.logger.warn('trailing stop blocked by risk engine', { symbol, reason: decision.reason });
      }
    }
  }

  private async fetchMultiTimeframeAnalysis(symbol: string): Promise<any> {
    try {
      // Fetch candles for different timeframes
      const timeframeCandles = new Map<string, Candle[]>();
      
      // Only fetch MTF data for advanced composite strategy to avoid unnecessary API calls
      const timeframes = ['1h', '4h', '1d'];
      
      for (const timeframe of timeframes) {
        try {
          const candles = await this.store.getRecentCandles(symbol, timeframe, 250);
          if (candles.length >= 200) {
            timeframeCandles.set(timeframe, candles);
          }
        } catch (error) {
          this.logger.warn(`failed to fetch ${timeframe} candles for MTF analysis`, { symbol, error: String(error) });
        }
      }

      if (timeframeCandles.size === 0) {
        this.logger.warn('no timeframe data available for MTF analysis', { symbol });
        return undefined;
      }

      return this.multiTimeframeAnalyzer.analyze(timeframeCandles);
    } catch (error) {
      this.logger.error('MTF analysis failed', { symbol, error: String(error) });
      return undefined;
    }
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
