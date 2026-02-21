# API Keys Checklist 🔑

Use this file to track which API keys you've collected.
Add each key to `.env` as you go. Keys marked 🟢 require no signup.

---

## 🟢 No Signup Needed

- [X] **Alternative.me Fear & Greed Index** — no key required | signed as lumenlinkbot@gmail.com
  - Docs: https://alternative.me/crypto/fear-and-greed-index/
- [X] **Binance WebSocket** — uses your existing Binance API key | not available in NY
- [X] **Binance Futures API** — uses your existing Binance API key | not available in NY
- [X] **FRED (Federal Reserve)** — basic endpoints are public | Signup not available
  - Docs: https://fred.stlouisfed.org/docs/api/fred/

---

## 🔑 Free — Signup Required

- [X] **CoinGecko**
  - Signup: https://www.coingecko.com/en/api
  - Plan: Free (Demo API)
  - `.env` key: `COINGECKO_API_KEY`

- [X] **CoinMarketCap**
  - Signup: https://coinmarketcap.com/api/
  - Plan: Basic (free)
  - `.env` key: `COINMARKETCAP_API_KEY`

- [X] **TwelveData**
  - Signup: https://twelvedata.com/pricing
  - Plan: Free tier (800 requests/day)
  - `.env` key: `TWELVEDATA_API_KEY`

- [X] **CryptoPanic**
  - Signup: https://cryptopanic.com/developers/api/
  - Plan: Free
  - `.env` key: `CRYPTOPANIC_API_KEY`

- [X] **Whale Alert**
  - Signup: https://whale-alert.io/
  - Plan: Free tier
  - `.env` key: `WHALE_ALERT_API_KEY`
  - Free tier does not provide API Key

- [X] **NewsAPI**
  - Signup: https://newsapi.org/register
  - Plan: Free (developer tier)
  - `.env` key: `NEWS_API_KEY`

- [X] **Coinglass**
  - Signup: https://www.coinglass.com/
  - Plan: Free tier
  - `.env` key: `COINGLASS_API_KEY`
  - No Free tier available

- [X] **OpenAI**
  - Signup: https://platform.openai.com/signup
  - Plan: Pay-as-you-go (very cheap for sentiment scoring)
  - `.env` key: `OPENAI_API_KEY`

- [X] **Etherscan**
  - Signup: https://etherscan.io/register
  - Plan: Free
  - `.env` key: `ETHERSCAN_API_KEY`

- [X] **BscScan**
  - Signup: https://bscscan.com/register
  - Plan: Free
  - `.env` key: `BSCSCAN_API_KEY`
  - Same as Etherscan with 'chainid=56'

---

## 💳 Paid — Add Later (when bot is live & profitable)

- [ ] **LunarCrush** — social media sentiment per coin
  - https://lunarcrush.com/developers/api/authentication
  - `.env` key: `LUNARCRUSH_API_KEY`

- [ ] **Glassnode** — on-chain metrics, whale accumulation
  - https://studio.glassnode.com/settings/api
  - `.env` key: `GLASSNODE_API_KEY`

- [ ] **Nansen** — smart money wallet tracking
  - https://www.nansen.ai/
  - `.env` key: `NANSEN_API_KEY`

---

## ✅ Progress Tracker

| API | Key Obtained | Added to .env | Tested |
|-----|:---:|:---:|:---:|
| Binance | ☐ | ☐ | ☐ |
| CoinGecko | ☐ | ☐ | ☐ |
| CoinMarketCap | ☐ | ☐ | ☐ |
| TwelveData | ☐ | ☐ | ☐ |
| CryptoPanic | ☐ | ☐ | ☐ |
| Whale Alert | ☐ | ☐ | ☐ |
| NewsAPI | ☐ | ☐ | ☐ |
| Coinglass | ☐ | ☐ | ☐ |
| OpenAI | ☐ | ☐ | ☐ |
| Etherscan | ☐ | ☐ | ☐ |
| BscScan | ☐ | ☐ | ☐ |
| Fear & Greed | ✅ | N/A | ☐ |

---

> ⚠️ Never share your API keys with anyone. Never commit `.env` to git.
> The `.env` file is already in `.gitignore` for your protection.