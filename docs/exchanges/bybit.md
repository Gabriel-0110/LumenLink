# Bybit Endpoint Mapping

| Name | Method | Path | Purpose |
|---|---|---|---|
| Tickers | GET | /v5/market/tickers | Best quote |
| Kline | GET | /v5/market/kline | Candle data |
| Create Order | POST | /v5/order/create | Place order |
| Cancel Order | POST | /v5/order/cancel | Cancel order |
| Realtime Order | GET | /v5/order/realtime | Order status/open orders |
| Wallet Balance | GET | /v5/account/wallet-balance | Balances |

Implementation status: scaffold stub only in this project (`TODO`).
