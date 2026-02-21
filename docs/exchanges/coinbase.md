# Coinbase Advanced Trade Endpoint Mapping

| Name | Method | Path | Purpose |
|---|---|---|---|
| Get Product | GET | /api/v3/brokerage/products/{product_id} | Ticker-like product data |
| Get Product Candles | GET | /api/v3/brokerage/products/{product_id}/candles | Historical candles |
| Create Order | POST | /api/v3/brokerage/orders | Submit order |
| Cancel Orders | POST | /api/v3/brokerage/orders/batch_cancel | Cancel orders |
| Get Order | GET | /api/v3/brokerage/orders/historical/{order_id} | Order detail |
| List Orders | GET | /api/v3/brokerage/orders/historical/batch | Open/historical orders |
| List Accounts | GET | /api/v3/brokerage/accounts | Balances |

Notes:
- Exact auth header format can vary by account/app type.
- `src/exchanges/coinbase/auth.ts` centralizes signing/header logic.
