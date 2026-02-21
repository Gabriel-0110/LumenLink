# Key Inventory

Never store raw keys in this file. Only metadata and storage locations.

| Key Name | Purpose | Required Scopes | Secret Location (AWS SM SecretId) | Owner | Created | Rotation (Days) | Last Rotated | Next Rotation |
|---|---|---|---|---|---|---:|---|---|
| coinbase_api_key | Coinbase auth key | trade, view (no withdraw) | prod/trading/coinbase/key | trading-team | YYYY-MM-DD | 90 | YYYY-MM-DD | YYYY-MM-DD |
| coinbase_api_secret | Coinbase auth secret | trade, view (no withdraw) | prod/trading/coinbase/secret | trading-team | YYYY-MM-DD | 90 | YYYY-MM-DD | YYYY-MM-DD |
| coinbase_api_passphrase | Coinbase passphrase | trade, view (no withdraw) | prod/trading/coinbase/passphrase | trading-team | YYYY-MM-DD | 90 | YYYY-MM-DD | YYYY-MM-DD |
| telegram_bot_token | Telegram alerts | bot send message only | prod/alerts/telegram/token | platform | YYYY-MM-DD | 180 | YYYY-MM-DD | YYYY-MM-DD |
| discord_webhook_url | Discord alerts | webhook post only | prod/alerts/discord/webhook | platform | YYYY-MM-DD | 180 | YYYY-MM-DD | YYYY-MM-DD |

## Notes

- Withdrawal permission is prohibited for trading keys.
- Keep this inventory updated on every rotation.
