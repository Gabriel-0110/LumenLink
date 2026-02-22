# LumenLink Trading Bot — Session Summary

**Date:** February 22, 2026  
**Author:** Automated session recap

---

## What Is LumenLink?

LumenLink is an automated cryptocurrency trading bot built in TypeScript. It connects to Coinbase, analyzes BTC-USD price action using 15+ technical indicators, and executes buy/sell orders based on a regime-aware strategy. It runs locally on a Mac, polls every 30 seconds, and operates 24/7.

---

## What Happened This Session

### 1. Strategy Overhaul (10 Improvements)

The bot's trading strategy was significantly upgraded:

- **ATR-based position sizing** — uses market volatility to size trades instead of fixed amounts
- **Multi-timeframe analysis** — checks 4h and 1d trends to avoid trading against the bigger picture
- **Regime detection** — classifies the market as trending, ranging, breakout, or high-volatility and adapts behavior
- **Regime-aware composite strategy** — routes signals through different indicator configurations depending on the detected regime
- **Convex confidence scaling** — low-confidence signals get disproportionately less capital (power of 1.5)
- **Fear & Greed sentiment** — incorporates market sentiment as a modifier
- **MACD EMA fix** — corrected from SMA to proper EMA calculation
- **Anomaly detector wiring** — blocks trading during data anomalies
- **Short support in backtester** — backtester now supports short positions
- **All 169 tests passing** after changes

### 2. Dashboard Built

A rich web dashboard was built at `/ui` with:
- Price sparkline, equity curve, 7-day P&L bars
- Win/loss donut chart, Fear & Greed gauge
- Open positions table, recent trades table
- Auto-refreshes every 15 seconds
- Dark theme with Chart.js graphics

### 3. Debugging Multiple Blockers

The bot was producing only HOLD signals and failing on order execution. Several cascading issues were found and fixed:

| Issue | Root Cause | Fix |
|-------|-----------|-----|
| Always HOLD | Risk limits too tight ($250 max vs $1,050 position) | Raised to $3,000 |
| Still HOLD | Regime thresholds calibrated for 1h, bot uses 5m | Recalibrated all thresholds for 5m |
| Still HOLD | Score thresholds too high (3.5/1.5/2.0) | Lowered to 2.0/0.8/1.2 |
| `INVALID_SIZE_PRECISION` | Order qty had 15+ decimal places | Floored to 8 decimals |
| `INSUFFICIENT_FUND` on SELL | Bot tried to sell more BTC than held | Fixed to sell actual position quantity |
| `INSUFFICIENT_FUND` on BUY | $0 cash | Added cash-capping so any deposit works |
| Unhandled errors crashing loop | Exchange rejections not caught | Added try/catch with clean logging |

### 4. Paper Trading Instance

A second instance runs in paper (simulated) mode for comparison:
- Same strategy, same settings
- Separate database for trade history
- Shares candle data with the live bot
- Starts with $10,000 simulated cash
- Runs on port 8081

### 5. Partial Position Sizing (Latest Fix)

The bot was going "all-in / all-out" — spending 100% of cash on BUY, selling 100% of BTC on SELL. This meant it could only act in one direction at a time.

**Fix:** Added `RISK_DEPLOY_PERCENT=50` — each trade now uses only 50% of available capital/position. The bot always keeps reserves so it can act on both BUY and SELL signals at any time.

---

## Current Situation (as of 5:30 AM UTC, Feb 22)

### Account

| Metric | Value |
|--------|-------|
| **Cash (USD)** | $1,035.88 |
| **BTC held** | 0 (none) |
| **Total equity** | $1,035.88 |
| **Live trades executed** | 0 |
| **BTC price** | ~$67,800 |

### How the BTC became cash

The bot did **not** sell the BTC. No live orders were ever successfully executed by the bot (all attempts failed with `INSUFFICIENT_FUND`). The BTC → USD conversion happened outside the bot, likely through Coinbase directly (manual sell, auto-conversion, or another mechanism on the account).

### Bot Status

| Instance | Port | Status | Cash |
|----------|------|--------|------|
| **Live** | 8080 | Running, healthy | $1,035.88 (real) |
| **Paper** | 8081 | Running, healthy | $10,000 (simulated) |

### Current Market Signal

The strategy is outputting **SELL** signals (confidence 0.95, score -6.0) because the market is heavily bearish:
- Bearish EMA stack, below EMA200
- MACD bearish, ADX 29 (strong downtrend)
- MFI oversold (19), CCI oversold (-102)
- Below VWAP, OBV confirms downtrend

These SELL signals are **correctly blocked** — there's no BTC to sell. The bot is waiting for the market to flip bullish and generate a BUY signal.

### What Happens Next

1. Market continues dropping → bot holds cash (correct behavior, preserving capital)
2. Market bounces, indicators turn bullish → bot fires a **BUY** signal
3. BUY executes → spends 50% of cash (~$515) to buy BTC, keeps ~$520 in reserve
4. If BTC rises → bot can SELL 50% of the position for profit, keep the rest
5. If BTC dips more → bot can BUY again with remaining cash (dollar-cost averaging effect)

The cycle repeats: buy partial → hold → sell partial → hold → buy partial...

---

## Configuration

| Setting | Value | Meaning |
|---------|-------|---------|
| Strategy | `regime_aware` | Adapts to market regime (trending/ranging/breakout) |
| Interval | 5 minutes | Analyzes 5-minute candles |
| Poll interval | 30 seconds | Checks for new data every 30s |
| Deploy percent | 50% | Uses half of available capital per trade |
| Max daily loss | $80 | Stops trading if daily losses exceed $80 |
| Max position | $3,000 | Maximum single position size |
| Cooldown | 2 minutes | Minimum time between trades |
| Exchange | Coinbase | BTC-USD pair |

---

## Dashboards

- **Live:** http://localhost:8080/ui
- **Paper:** http://localhost:8081/ui
- **Live API:** http://localhost:8080/api/data
- **Paper API:** http://localhost:8081/api/data

---

## Key Files Modified

| File | What Changed |
|------|-------------|
| `src/strategies/regimeAwareComposite.ts` | New strategy — routes by market regime |
| `src/strategies/regimeDetector.ts` | Thresholds recalibrated for 5m interval |
| `src/strategies/advancedComposite.ts` | Configurable thresholds, MACD EMA fix, sentiment |
| `src/execution/orderManager.ts` | SELL uses position qty, BUY capped to cash, deploy % |
| `src/jobs/loops.ts` | Error handling, position passing, balance debug logging |
| `src/risk/riskEngine.ts` | ATR sizing, anomaly blocking |
| `src/risk/positionSizing.ts` | Convex scaling (confidence^1.5) |
| `src/config/schema.ts` | `regime_aware` strategy, `RISK_DEPLOY_PERCENT` |
| `src/index.ts` | Dashboard UI, API endpoint, paper mode DB separation |
| `.env` | Tuned risk limits, 5m interval, deploy percent |
| `.env.paper` | Paper trading config (port 8081, simulated mode) |
