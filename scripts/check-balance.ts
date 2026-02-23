#!/usr/bin/env tsx
import { loadConfig } from '../src/config/load.js';
import { CoinbaseAdapter } from '../src/exchanges/coinbase/adapter.js';
import { buildSecretsProvider } from '../src/secrets/provider.js';

async function main() {
  const config = loadConfig();
  const secrets = buildSecretsProvider(config);
  const apiKey = await secrets.getSecret(config.secrets.secretIds.coinbaseKey, 'COINBASE_API_KEY');
  const apiSecret = await secrets.getSecret(config.secrets.secretIds.coinbaseSecret, 'COINBASE_API_SECRET');
  const passphrase = await secrets.getSecret(config.secrets.secretIds.coinbasePassphrase, 'COINBASE_API_PASSPHRASE');
  const adapter = new CoinbaseAdapter({ apiKey, apiSecret, passphrase });
  
  const balances = await adapter.getBalances();
  const btc = balances.find(b => b.asset === 'BTC');
  const usd = balances.find(b => b.asset === 'USD');
  const ticker = await adapter.getTicker('BTC-USD');
  
  console.log(`BTC: ${btc?.free ?? 0} (≈ $${((btc?.free ?? 0) * ticker.last).toFixed(2)})`);
  console.log(`USD: $${(usd?.free ?? 0).toFixed(2)}`);
  console.log(`BTC Price: $${ticker.last.toFixed(2)}`);
  console.log(`Total: $${(((btc?.free ?? 0) * ticker.last) + (usd?.free ?? 0)).toFixed(2)}`);

  // Check recent orders
  const openOrders = await adapter.listOpenOrders('BTC-USD');
  console.log(`\nOpen orders: ${openOrders.length}`);
  openOrders.forEach(o => console.log(` ${o.side} ${o.quantity} @ ${o.price ?? 'market'} [${o.status}]`));
}

main().catch(console.error);
