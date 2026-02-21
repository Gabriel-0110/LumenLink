# Binance Spot Endpoint Mapping

| Name | Method | Path | Purpose |
|---|---|---|---|
| Symbol Price Ticker | GET | /api/v3/ticker/bookTicker | Best bid/ask |
| Klines | GET | /api/v3/klines | Candle data |
| New Order | POST | /api/v3/order | Place order |
| Cancel Order | DELETE | /api/v3/order | Cancel order |
| Query Order | GET | /api/v3/order | Order status |
| Open Orders | GET | /api/v3/openOrders | Open orders |
| Account | GET | /api/v3/account | Balances |

Implementation status: scaffold stub only in this project (`TODO`).
