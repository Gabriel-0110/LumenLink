# LumenLink Architecture

## System Overview

LumenLink is a modular crypto trading bot. Every trade flows through a defined pipeline of modules, each with a single responsibility. No module is optional in production — if one is missing, the trade doesn't happen.

```
┌─────────────────────────────────────────────────────────────────────┐
│                        SCHEDULER (cron loop)                        │
│  market-data loop │ strategy loop │ reconcile loop │ sentiment loop │
└────────┬──────────┴───────┬───────┴───────┬────────┴───────┬────────┘
         │                  │               │                │
         ▼                  ▼               ▼                ▼
┌─────────────────┐ ┌──────────────┐ ┌────────────┐ ┌──────────────────┐
│  MARKET DATA    │ │ SIGNAL ENGINE│ │ RECONCILER │ │ SENTIMENT/ONCHAIN│
│  (collector)    │ │ (strategies) │ │ (sync)     │ │ (Fear&Greed,     │
│                 │ │              │ │            │ │  CryptoPanic,    │
│  Exchange OHLCV │ │  Candles +   │ │ Local vs   │ │  DeFiLlama)      │
│  → SQLite       │ │  Context →   │ │ Exchange   │ │                  │
│                 │ │  Signal      │ │ order sync │ │                  │
└────────┬────────┘ └──────┬───────┘ └────────────┘ └──────────────────┘
         │                 │
         │    ┌────────────▼────────────┐
         │    │      RISK ENGINE        │
         │    │  (hard blocker)         │
         │    │                         │
         │    │  ✓ Kill switch          │
         │    │  ✓ Daily loss limit     │
         │    │  ✓ Max positions        │
         │    │  ✓ Position size cap    │
         │    │  ✓ Cooldown timer       │
         │    │  ✓ Spread guard         │
         │    │  ✓ Slippage guard       │
         │    │  ✓ Volume guard         │
         │    └────────────┬────────────┘
         │                 │
         │                 ▼ (allowed=true)
         │    ┌────────────────────────────┐
         │    │     EXECUTION ENGINE       │
         │    │                            │
         │    │  OrderManager              │
         │    │   ├─ Idempotency check     │
         │    │   ├─ Position sizing       │
         │    │   ├─ RetryExecutor         │
         │    │   │   └─ CircuitBreaker    │
         │    │   ├─ PaperBroker (sim)     │
         │    │   └─ LiveBroker (exchange) │
         │    │                            │
         │    │  Position State Machine    │
         │    │   flat → pending → filled  │
         │    │   → managing → exited      │
         │    │                            │
         │    │  Trailing Stop Manager     │
         │    └────────────┬───────────────┘
         │                 │
         │                 ▼
         │    ┌────────────────────────────┐
         │    │     PORTFOLIO / STATE      │
         │    │                            │
         │    │  AccountSnapshot           │
         │    │   ├─ Cash balance          │
         │    │   ├─ Open positions        │
         │    │   ├─ Realized P&L          │
         │    │   ├─ Unrealized P&L        │
         │    │   └─ Stop-out history      │
         │    │                            │
         │    │  OrderState (SQLite)       │
         │    │   ├─ All orders            │
         │    │   └─ Client ID → Order map │
         │    └────────────┬───────────────┘
         │                 │
         │                 ▼
         │    ┌────────────────────────────┐
         │    │       ALERTS               │
         │    │  Console + Telegram +      │
         │    │  Discord (multiplexed)     │
         │    └────────────────────────────┘
```

---

## Trade Lifecycle (The Critical Path)

Every trade follows this exact sequence. No shortcuts.

### 1. Data Collection (`marketDataLoop`)
```
Scheduler fires every DATA_POLLING_MS (default 5s)
  → Exchange.fetchOHLCV(symbol, interval, 200 candles)
  → Store.saveCandles() (SQLite, upsert on conflict)
  → Update last candle time
```

### 2. Signal Generation (`strategyLoop`)
```
Scheduler fires every POLL_INTERVAL_MS (default 5s)
  → For each symbol:
    → Store.getRecentCandles(symbol, interval, 250)
    → Process trailing stops first (check exits before new entries)
    → If advanced_composite: fetch multi-timeframe data (1h, 4h, 1d)
    → Strategy.onCandle(latest, context) → Signal { action, confidence, reason }
    → Signal cooldown check (5 min between same signal on same pair)
```

### 3. Risk Check
```
Signal → RiskEngine.evaluate():
  1. Kill switch active? → BLOCK
  2. Live trading allowed? → BLOCK if not
  3. Selling without position? → BLOCK (phantom sell prevention)
  4. Daily loss exceeded? → BLOCK
  5. Max open positions? → BLOCK
  6. Position size exceeded? → BLOCK
  7. Cooldown after stop-out? → BLOCK
  8. Volume too low? → BLOCK
  9. Spread too wide? → BLOCK
  10. Slippage too high? → BLOCK
  → All pass → { allowed: true }
```

### 4. Position Sizing
```
Signal.confidence (0-1) × maxPositionUsd → targetUsd
  OR (with ATR):
  accountUsd × riskPercent / (ATR × multiplier / price) → positionUsd
  → quantity = positionUsd / currentPrice
```

### 5. Order Execution
```
OrderManager.submitSignal():
  → Generate clientOrderId (idempotency key)
  → Check if clientOrderId already exists (prevent duplicates)
  → If paper mode: PaperBroker.place() (simulated fill with slippage)
  → If live mode: LiveBroker.place() → Exchange API
  → OrderState.upsert() (persist to SQLite)
  → Return Order
```

### 6. Portfolio Update
```
applyOrderToSnapshot():
  → BUY: Add/update position (weighted avg entry price)
  → SELL: Calculate realized P&L, remove position if fully closed
  → If loss on close: record stop-out time for cooldown
```

### 7. Post-Trade
```
  → Register trailing stop (for buys)
  → Close trailing stop (for sells)
  → Alert.notify() → Console + Telegram + Discord
```

### 8. Reconciliation (live only, every POLL_INTERVAL_MS)
```
For each symbol:
  → Compare local open orders vs exchange open orders
  → Fetch latest state for any local orders not found on exchange
  → Update OrderState with actual fill status
```

---

## Module Inventory

| Module | Path | Status | Purpose |
|--------|------|--------|---------|
| Config | `src/config/` | ✅ | Env-based config with Zod validation |
| Logger | `src/core/logger.ts` | ✅ | JSON structured logging |
| Metrics | `src/core/metrics.ts` | ✅ | In-memory counters |
| Exchange Connector | `src/exchanges/` | ✅ | CCXT + native Coinbase adapters |
| Market Data | `src/data/marketDataService.ts` | ✅ | OHLCV polling + storage |
| Historical Data | `src/data/fetchHistory.ts` | ✅ | Backfill 6 months OHLCV |
| SQLite Store | `src/data/sqliteStore.ts` | ✅ | Candle + order persistence |
| Sentiment | `src/data/sentimentService.ts` | ✅ | Fear&Greed + CryptoPanic |
| On-Chain | `src/data/onchainService.ts` | ✅ | DeFiLlama + CoinGecko |
| Signal Engine | `src/strategies/` | ✅ | 6 strategies + MTF analyzer |
| Risk Engine | `src/risk/riskEngine.ts` | ✅ | 10-point risk check |
| Position Sizing | `src/risk/positionSizing.ts` | ✅ | Fixed % + ATR-based |
| Circuit Breaker | `src/risk/guards.ts` | ✅ | API failure tracking |
| Order Manager | `src/execution/orderManager.ts` | ✅ | Order submission + idempotency |
| Paper Broker | `src/execution/paperBroker.ts` | ✅ | Simulated fills |
| Live Broker | `src/execution/liveBroker.ts` | ✅ | Exchange order placement |
| Order State | `src/execution/orderState.ts` | ✅ | In-memory + SQLite order tracking |
| Reconciler | `src/execution/reconciler.ts` | ✅ | Local ↔ Exchange sync |
| Trailing Stops | `src/execution/trailingStop.ts` | ✅ | ATR-adaptive trailing |
| Kill Switch | `src/execution/killSwitch.ts` | 🔄 | Building (sub-agent) |
| Position FSM | `src/execution/positionStateMachine.ts` | 🔄 | Building (sub-agent) |
| Retry Executor | `src/execution/retryExecutor.ts` | 🔄 | Building (sub-agent) |
| Adv. Order Types | `src/execution/orderTypes.ts` | 🔄 | Building (sub-agent) |
| Alerts | `src/alerts/` | ✅ | Console + Telegram + Discord |
| Scheduler | `src/jobs/scheduler.ts` | ✅ | Interval-based job runner |
| Trading Loops | `src/jobs/loops.ts` | ✅ | Main trading loop orchestration |
| Secrets | `src/secrets/` | ✅ | Env + AWS Secrets Manager |
| HTTP Server | `src/index.ts` | ✅ | /health + /status endpoints |

---

## Strategies Available

| Strategy | Key | Indicators | Complexity |
|----------|-----|------------|------------|
| RSI Mean Reversion | `rsi_mean_reversion` | RSI(14) | Basic |
| EMA Crossover | `ema_crossover` | EMA(9), EMA(21) | Basic |
| Composite | `composite` | RSI + EMA agreement | Basic |
| **Advanced Composite** | `advanced_composite` | 12+ indicators, confluence scoring, VWAP, BB squeeze, volume | **Production** |
| Grid Trading | `grid_trading` | Price grid levels | Range-bound |
| Smart DCA | `smart_dca` | Sentiment-adjusted accumulation | Accumulation |

---

## Configuration Reference

All config via `.env` file. See `src/config/schema.ts` for full schema.

### Critical Settings
```env
MODE=paper                    # paper | live
EXCHANGE=coinbase             # coinbase | binance | bybit
SYMBOLS=BTC-USD,ETH-USD       # comma-separated trading pairs
INTERVAL=1h                   # candle interval
STRATEGY=advanced_composite   # strategy key

# Risk Controls
RISK_MAX_DAILY_LOSS_USD=150   # stop trading after this much loss
RISK_MAX_POSITION_USD=250     # max single position size
RISK_MAX_OPEN_POSITIONS=2     # max concurrent positions
RISK_COOLDOWN_MINUTES=15      # pause after stop-out

# Guards
GUARD_MAX_SPREAD_BPS=25       # max bid-ask spread
GUARD_MAX_SLIPPAGE_BPS=20     # max estimated slippage
GUARD_MIN_VOLUME=0            # min 24h volume

# Safety
KILL_SWITCH=true              # master kill switch
ALLOW_LIVE_TRADING=false      # must be true for real orders
```

---

## Scheduler Timing

| Loop | Default Interval | Purpose |
|------|-----------------|---------|
| market-data | 5,000ms | Fetch latest candles |
| strategy | 5,000ms | Run strategy + execute |
| reconcile | 10,000ms (live only) | Sync with exchange |
| sentiment | 900,000ms (15 min) | Fear&Greed + news |

---

## Data Flow Diagram

```
Exchange API ──→ MarketDataService ──→ SQLite (candles table)
                                            │
CryptoPanic ──→ SentimentService            │
                     │                      │
Alternative.me ─────→│                      │
                     │                      ▼
DeFiLlama ──→ OnChainService        Strategy.onCandle()
                     │                      │
                     ▼                      ▼
              RuntimeState           Signal {action, confidence}
                                            │
                                            ▼
                                     RiskEngine.evaluate()
                                            │
                                            ▼
                                     OrderManager.submitSignal()
                                            │
                                    ┌───────┴───────┐
                                    ▼               ▼
                              PaperBroker     LiveBroker
                              (simulated)     (exchange)
                                    │               │
                                    └───────┬───────┘
                                            ▼
                                     OrderState (SQLite)
                                            │
                                            ▼
                                     AccountSnapshot
                                            │
                                            ▼
                                     Alert (Telegram/Discord)
```

---

## Database Schema

### `candles` table
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | Auto-increment |
| symbol | TEXT | e.g. BTC-USD |
| interval | TEXT | e.g. 1h, 1d |
| time | INTEGER | Unix timestamp (ms) |
| open | REAL | |
| high | REAL | |
| low | REAL | |
| close | REAL | |
| volume | REAL | |
| date_str | TEXT | Human-readable datetime |
| **UNIQUE** | | (symbol, interval, time) |

### `orders` table
| Column | Type | Notes |
|--------|------|-------|
| order_id | TEXT PK | Exchange order ID |
| client_order_id | TEXT | Idempotency key |
| symbol | TEXT | |
| side | TEXT | buy / sell |
| type | TEXT | market / limit |
| quantity | REAL | |
| price | REAL | Nullable |
| status | TEXT | pending/open/filled/canceled/rejected |
| filled_quantity | REAL | |
| avg_fill_price | REAL | Nullable |
| reason | TEXT | Nullable |
| created_at | INTEGER | Unix timestamp (ms) |
| updated_at | INTEGER | Unix timestamp (ms) |

---

## What's Still Missing (Roadmap)

### Phase 1: Stabilize (Current)
- [ ] Execution engine upgrades (kill switch, retry, state machine, order types)
- [ ] Test suite (unit + integration)
- [ ] Backfill remaining historical data gaps

### Phase 2: Production Readiness
- [ ] Journal/reporting (daily P&L summaries, trade log export)
- [ ] News/calendar filter (FOMC/CPI event lockout)
- [ ] WebSocket streaming (replace polling for real-time data)
- [ ] Proper portfolio tracker (balances from exchange, not just in-memory)

### Phase 3: Alpha Generation
- [ ] TradingView webhook integration (receive alerts, decide whether to execute)
- [ ] Multi-exchange arbitrage
- [ ] On-chain whale tracking signals
- [ ] ML-enhanced signal scoring

---

## Running

```bash
# Paper trading (default)
pnpm run paper

# Backtest
pnpm run backtest

# Fetch 6 months of historical data
pnpm run fetch-history

# Custom fetch
SYMBOLS=SOL-USD,AVAX-USD TIMEFRAMES=1h,1d MONTHS=3 pnpm run fetch-history

# Type check
pnpm run typecheck

# Tests
pnpm test
```
