import { buildCoinbaseHeaders } from '../src/exchanges/coinbase/auth.js';
import { createCoinbaseClient } from '../src/exchanges/coinbase/client.js';
import { coinbaseEndpoints } from '../src/exchanges/coinbase/endpoints.js';
import { getJson } from '../src/core/http.js';
import { buildSecretsProvider } from '../src/secrets/provider.js';
import { loadConfig } from '../src/config/load.js';

async function main() {
  const config = loadConfig();
  const secrets = buildSecretsProvider(config);
  const apiKey = await secrets.getSecret(config.secrets.secretIds.coinbaseKey, 'COINBASE_API_KEY');
  const apiSecret = await secrets.getSecret(config.secrets.secretIds.coinbaseSecret, 'COINBASE_API_SECRET');
  const auth = { apiKey, apiSecret };
  const orderId = '52b16e00-65f5-495c-b0a3-e21f295736c5';
  const path = coinbaseEndpoints.order(orderId);
  const headers = buildCoinbaseHeaders(auth, 'GET', path, '');
  const data = await getJson<any>(createCoinbaseClient(), path, headers);
  console.log(JSON.stringify(data, null, 2));
}

main().catch(console.error);
