# LumenLink Trading Bot 🤖⚡

**Production-ready cryptocurrency trading bot with TypeScript architecture and comprehensive API integrations.**

LumenLink merges enterprise-grade TypeScript architecture with battle-tested Python API integrations, supporting paper trading, live execution, backtesting, and comprehensive risk controls.

## ✨ Key Features

- **🔒 Safety First**: Paper trading by default, kill switches, and comprehensive risk controls
- **📊 Multi-Exchange**: Binance, Coinbase Advanced, Bybit support via CCXT
- **🧠 Strategy Engine**: RSI Mean Reversion, EMA Crossover, and custom composite strategies  
- **📈 Backtesting**: Historical strategy validation with detailed performance metrics
- **🛡️ Risk Management**: Position sizing, stop-loss, take-profit, daily loss limits
- **📱 Alerts**: Telegram, Discord, and console notifications
- **🔧 Observability**: Structured logging, metrics, health endpoints
- **☁️ Production Ready**: Docker, AWS Secrets Manager, TypeScript + Zod validation

## 🚀 Quick Start

### 1. Install Dependencies
```bash
pnpm install
```

### 2. Configuration
```bash
cp .env.example .env
# Edit .env with your API keys and settings
```

### 3. Paper Trading (Safe Mode)
```bash
pnpm run paper
```

### 4. Run Backtest
```bash
pnpm run backtest
```

### 5. Check Status
- Health: `GET http://localhost:8080/health`
- Status: `GET http://localhost:8080/status`

## 🛡️ Safety & Risk Controls

- **Default Paper Mode**: No real money at risk
- **Kill Switch**: `KILL_SWITCH=true` blocks all live orders  
- **Position Limits**: Max position size and open positions
- **Daily Loss Limits**: Automatic shutdown on losses
- **Spread/Slippage Guards**: Market quality filters
- **API Key Scopes**: Use read/trade only - never enable withdrawals

## 📊 Supported Exchanges

| Exchange | Status | Pairs | Notes |
|----------|--------|--------|--------|
| **Binance** | ✅ Full | BTC/USDT, ETH/USDT, etc. | Primary, most liquidity |
| **Coinbase** | ✅ Full | BTC-USD, ETH-USD, etc. | US regulated |
| **Bybit** | ✅ Full | BTCUSDT, ETHUSDT, etc. | Global derivatives |

## 🧠 Trading Strategies

### RSI Mean Reversion (Default)
- **Buy**: RSI < 30 (oversold)
- **Sell**: RSI > 70 (overbought)  
- **Confidence**: Scales with RSI distance from thresholds

### EMA Crossover  
- **Buy**: Fast EMA crosses above Slow EMA (Golden Cross)
- **Sell**: Fast EMA crosses below Slow EMA (Death Cross)
- **Periods**: 9 (fast) / 21 (slow) by default

### Composite Strategy
- Combines multiple indicators for higher confidence signals
- Weight-based signal aggregation

## 🔧 Configuration

Key environment variables:

```bash
# Core Settings
MODE=paper                    # paper | live
EXCHANGE=binance             # binance | coinbase | bybit  
STRATEGY=rsi_mean_reversion  # Strategy to use
SYMBOLS=BTC/USDT,ETH/USDT   # Trading pairs

# Risk Limits
RISK_MAX_DAILY_LOSS_USD=150   # Stop trading if daily loss exceeds
RISK_MAX_POSITION_USD=250     # Max per position
RISK_MAX_OPEN_POSITIONS=3     # Max concurrent positions

# API Keys (see .env.example for full list)
BINANCE_API_KEY=your_key_here
BINANCE_API_SECRET=your_secret_here
TELEGRAM_BOT_TOKEN=your_bot_token
```

## 📈 Backtesting

Test strategies against historical data:

```bash
# Run backtest with current config
pnpm run backtest

# Example output:
============================================================
Backtest Results: BTC/USDT
Strategy: RSI Mean Reversion  
============================================================
Total trades:     23
Win rate:         65.2%
Avg PnL:          1.84%
Total PnL:        42.32%
Best trade:       8.91%
Worst trade:      -2.87%
Avg bars held:    4.2
```

## 🚦 Going Live Checklist

**⚠️ NEVER skip these steps:**

1. **Test in Paper Mode**: Run for days/weeks first
2. **Validate Backtests**: Ensure positive historical performance  
3. **Set Conservative Limits**: Start with small position sizes
4. **API Key Permissions**: Trade only, never withdrawals
5. **Enable Kill Switch**: `KILL_SWITCH=false` only when ready
6. **Monitor Closely**: Watch first live trades carefully

```bash
# Live mode requires both flags
MODE=live
ALLOW_LIVE_TRADING=true
KILL_SWITCH=false  # Only set false when ready!
```

## 📱 Notifications

### Telegram Setup
1. Create bot: Message [@BotFather](https://t.me/botfather)
2. Get chat ID: Message [@userinfobot](https://t.me/userinfobot) 
3. Add to `.env`:
```bash
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
```

### Discord Setup
1. Create webhook in Discord server settings
2. Add to `.env`:
```bash
DISCORD_WEBHOOK_URL=your_webhook_url
```

## 🏗️ Project Structure

```
src/
├── alerts/          # Telegram, Discord, console notifications
├── backtester/      # Historical strategy testing
├── config/          # Zod-validated configuration system
├── core/           # Types, logging, HTTP, validation
├── data/           # Market data service, SQLite/memory stores
├── exchanges/      # Exchange adapters (CCXT, Coinbase native)
├── execution/      # Order management, paper/live brokers
├── risk/           # Risk engine, position sizing, guards
├── secrets/        # AWS Secrets Manager + env fallback
├── strategies/     # Trading strategy implementations
└── jobs/           # Scheduler and trading loops

tests/              # Comprehensive test suite
docs/              # Architecture and operational guides
```

## 🔐 API Key Management

See `API_KEYS_CHECKLIST.md` for comprehensive API setup guide.

### Coinbase (safest mode)

- Use **Coinbase CDP JWT** credentials only (no legacy HMAC flow).
- Store credentials in **1Password** and run with `SECRETS_PROVIDER=op` (or `1password`).
- `COINBASE_API_KEY` must be `organizations/{org_id}/apiKeys/{key_id}`.
- `COINBASE_API_SECRET` must be a PEM private key (`BEGIN PRIVATE KEY` or `BEGIN EC PRIVATE KEY`).
- In live mode, if auth fails at startup, LumenLink runs in degraded mode and blocks live trading.

**Exchange Keys (Required):**
- Binance API (read + trade only)
- Telegram Bot Token (notifications)

**Optional Data APIs:**
- CoinGecko, CoinMarketCap (market data)
- OpenAI (sentiment analysis)
- NewsAPI (news sentiment)

## 🚀 Deployment

### Docker
```bash
docker build -t lumen-link .
docker run -p 8080:8080 --env-file .env lumen-link
```

### AWS Secrets Manager
Store sensitive credentials in AWS Secrets Manager:
```bash
USE_AWS_SECRETS_MANAGER=true
SECRET_ID_BINANCE_KEY=prod/trading/binance/key
```

## 🧪 Development

```bash
# Development mode  
pnpm run dev

# Type checking
pnpm run typecheck

# Linting
pnpm run lint

# Tests
pnpm run test

# Build for production
pnpm run build
```

## 📊 Monitoring & Operations

- **Health Check**: `GET /health` - Service status
- **Trading Status**: `GET /status` - Positions, PnL, last signals
- **Logs**: Structured JSON logging to stdout/files
- **Metrics**: In-memory metrics collection

## ⚠️ Risk Disclaimer

**Cryptocurrency trading involves substantial risk of loss. This software is provided for educational purposes. The authors are not responsible for any financial losses. Always:**

- Start with paper trading
- Never risk more than you can afford to lose  
- Test thoroughly before going live
- Monitor positions closely
- Use proper risk management

## 📝 License

MIT License - See LICENSE file for details.

---

**Made with ⚡ by combining TypeScript architecture excellence with Python's battle-tested API integrations.**