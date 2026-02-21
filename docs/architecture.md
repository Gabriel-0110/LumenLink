# LumenLink Architecture

## Overview

LumenLink combines enterprise-grade TypeScript architecture with battle-tested Python API integrations to create a production-ready cryptocurrency trading bot. This document outlines the system architecture and data flow.

## High-Level Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Config        │    │   Secrets        │    │   Exchanges     │
│   Loader        │    │   Provider       │    │   (CCXT/Native) │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                       │                       │
         └─────────┬─────────────┴─────────────┬─────────┘
                   │                           │
              ┌─────────────────────────────────────────────┐
              │            Core Engine                      │
              │  ┌─────────────┐  ┌─────────────────────┐  │
              │  │ Market Data │  │    Strategy         │  │
              │  │ Service     │  │    Engine           │  │
              │  └─────────────┘  └─────────────────────┘  │
              │          │                   │             │
              │  ┌─────────────┐  ┌─────────────────────┐  │
              │  │ Risk Engine │  │   Execution         │  │
              │  │             │  │   Engine            │  │
              │  └─────────────┘  └─────────────────────┘  │
              └─────────────────────────────────────────────┘
                       │                   │
              ┌─────────────┐    ┌─────────────────────┐
              │   Alerts    │    │   Data Storage      │
              │   System    │    │   (SQLite/Memory)   │
              └─────────────┘    └─────────────────────┘
```

## Core Components

### 1. Configuration System (`src/config/`)
- **Schema Validation**: Zod-based type-safe configuration
- **Environment Loading**: Supports `.env` files and environment variables  
- **Defaults**: Sensible defaults for all settings
- **Type Safety**: Full TypeScript integration

### 2. Secrets Management (`src/secrets/`)
- **AWS Secrets Manager**: Production-grade secret storage
- **Environment Fallback**: Local development support
- **Provider Abstraction**: Pluggable secret sources
- **Secure Handling**: No secrets in logs or memory dumps

### 3. Exchange Adapters (`src/exchanges/`)

#### CCXT Adapter (`src/exchanges/ccxt/`)
- **Multi-Exchange**: Binance, Bybit, and 100+ exchanges via CCXT
- **Unified Interface**: Consistent API across all exchanges
- **Error Handling**: Robust retry and error handling
- **Rate Limiting**: Built-in rate limit management

#### Native Adapters
- **Coinbase Advanced**: Native implementation for maximum control
- **Custom Features**: Exchange-specific optimizations

### 4. Market Data Service (`src/data/`)
- **Multi-Source**: Exchange feeds, CoinGecko, CoinMarketCap
- **Storage**: SQLite for persistence, in-memory for speed
- **Caching**: Intelligent caching and refresh strategies
- **Fake Fallback**: Synthetic data for paper trading without credentials

### 5. Strategy Engine (`src/strategies/`)

#### Strategy Interface
```typescript
interface Strategy {
  readonly name: string;
  onCandle(candle: Candle, context: StrategyContext): Signal;
}
```

#### Implemented Strategies
- **RSI Mean Reversion**: Contrarian trades on oversold/overbought levels
- **EMA Crossover**: Trend-following based on moving average crosses
- **Composite**: Multi-indicator strategy with weighted signals

#### Technical Indicators
- **Library**: Uses `technicalindicators` npm package
- **Performance**: Optimized calculations with proper lookback periods
- **Extensible**: Easy to add new indicators and strategies

### 6. Risk Engine (`src/risk/`)

#### Risk Controls
- **Position Sizing**: Kelly criterion and fixed fraction methods
- **Daily Limits**: Maximum daily loss protection
- **Position Limits**: Maximum position size and count
- **Cooldown**: Time-based limits after losses

#### Market Guards
- **Spread Filtering**: Avoid wide bid-ask spreads
- **Slippage Protection**: Limit market impact
- **Volume Filtering**: Ensure adequate liquidity

### 7. Execution Engine (`src/execution/`)

#### Order Management
- **State Tracking**: Persistent order state in SQLite
- **Reconciliation**: Compare local vs exchange state
- **Client Order IDs**: Idempotent order placement
- **Error Recovery**: Handle partial fills and failures

#### Brokers
- **Paper Broker**: Realistic simulation with slippage modeling
- **Live Broker**: Real exchange execution with safety checks
- **Broker Interface**: Pluggable execution backends

### 8. Backtesting (`src/backtester/`)
- **Historical Data**: Uses exchange OHLCV data
- **Strategy Testing**: Full strategy simulation
- **Performance Metrics**: Win rate, PnL, Sharpe ratio, etc.
- **Trade Analysis**: Detailed trade-by-trade breakdown

### 9. Alerts System (`src/alerts/`)
- **Multi-Channel**: Telegram, Discord, console, logs
- **Structured Alerts**: Trade notifications, risk alerts, system status
- **Rate Limiting**: Avoid notification spam
- **Rich Formatting**: Platform-specific message formatting

## Data Flow

### 1. Initialization
```
Config Load → Secrets Resolution → Exchange Connection → Service Startup
```

### 2. Market Data Loop (30s interval)
```
Exchange API → Market Data Service → Candle Store → Strategy Context
```

### 3. Strategy Loop (60s interval)
```
Strategy Analysis → Risk Evaluation → Order Generation → Execution
```

### 4. Reconciliation Loop (Live mode only, 60s)
```
Exchange State → Local State → Discrepancy Detection → Correction
```

### 5. Order Execution Flow
```
Signal → Risk Check → Position Sizing → Order Creation → Broker → Exchange
     ↓
Order State Update → Database → Alerts → Metrics
```

## Safety Mechanisms

### 1. Multiple Safety Layers
- **Paper Mode Default**: No real money at risk
- **Kill Switch**: Emergency stop for live trading
- **Permission Gates**: Explicit opt-in for live trading
- **Risk Limits**: Multiple overlapping risk controls

### 2. Error Handling
- **Graceful Degradation**: Continue operation during non-critical failures
- **Circuit Breakers**: Stop trading on repeated failures
- **Comprehensive Logging**: Full audit trail of all operations

### 3. Operational Safety
- **Health Checks**: HTTP endpoints for monitoring
- **Graceful Shutdown**: Clean resource cleanup on exit
- **Database Transactions**: Atomic state updates

## Performance Considerations

### 1. Efficiency
- **SQLite**: Fast local database with WAL mode
- **Connection Pooling**: Reuse HTTP connections
- **Batch Operations**: Group related operations

### 2. Scalability
- **Stateless Design**: Easy horizontal scaling
- **Event-Driven**: Non-blocking I/O operations
- **Resource Management**: Proper cleanup and limits

## Security

### 1. Credential Security
- **No Hardcoded Secrets**: All secrets via configuration
- **API Key Restrictions**: Read/trade only, never withdrawal
- **AWS Integration**: Production-grade secret management

### 2. Network Security
- **TLS Everywhere**: All external communications encrypted
- **Rate Limiting**: Respect exchange limits
- **Error Sanitization**: No sensitive data in logs

## Monitoring & Observability

### 1. Logging
- **Structured Logs**: JSON format for machine parsing
- **Log Levels**: Appropriate verbosity for different environments
- **Context**: Request tracing and correlation IDs

### 2. Metrics
- **Performance**: Latency, throughput, error rates
- **Business**: Trade counts, PnL, positions
- **System**: Memory, CPU, disk usage

### 3. Health Checks
- **Liveness**: Is the service running?
- **Readiness**: Can it serve traffic?
- **Business**: Is trading functioning correctly?

## Deployment Architecture

### Production Deployment
```
Load Balancer → API Gateway → LumenLink Instances → Database
                     ↓
               Monitoring Stack
            (Logs, Metrics, Alerts)
```

### Development
- **Local**: Direct execution with `.env` configuration
- **Docker**: Containerized for consistency
- **Testing**: In-memory stores and mock exchanges