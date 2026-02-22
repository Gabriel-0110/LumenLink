import { loadConfig } from './config/load.js';
import { CoinbaseAdapter } from './exchanges/coinbase/adapter.js';
import { buildSecretsProvider } from './secrets/provider.js';

// Quote currencies used as "buying power" for each symbol format
const QUOTE_ASSETS = new Set(['USD', 'USDC', 'USDT', 'EUR', 'GBP']);

const fmt = (n: number, decimals = 4): string => n.toFixed(decimals);

const run = async (): Promise<void> => {
  const config = loadConfig();

  if (config.exchange !== 'coinbase') {
    throw new Error('Set EXCHANGE=coinbase before running coinbase:smoke');
  }

  const secrets = buildSecretsProvider(config);
  const apiKey = await secrets.getSecret(config.secrets.secretIds.coinbaseKey, 'COINBASE_API_KEY');
  const apiSecret = await secrets.getSecret(config.secrets.secretIds.coinbaseSecret, 'COINBASE_API_SECRET');
  const passphrase = await secrets.getSecret(
    config.secrets.secretIds.coinbasePassphrase,
    'COINBASE_API_PASSPHRASE'
  );

  const adapter = new CoinbaseAdapter({ apiKey, apiSecret, passphrase });

  // ── 1. Auth check ──────────────────────────────────────────────
  const balances = await adapter.getBalances();
  console.log('\n✅  Coinbase auth OK');
  console.log(`    Accounts visible: ${balances.length}`);

  // ── 2. Full balance table ──────────────────────────────────────
  const nonZero = balances.filter((b) => b.free > 0 || b.locked > 0);
  if (nonZero.length === 0) {
    console.log('\n⚠️  All account balances are zero.');
  } else {
    console.log('\n── Balances ──────────────────────────────────────────');
    for (const b of nonZero) {
      const tag = QUOTE_ASSETS.has(b.asset) ? ' ← buying power' : '';
      console.log(`    ${b.asset.padEnd(6)} free: ${fmt(b.free, 8)}  locked: ${fmt(b.locked, 8)}${tag}`);
    }
  }

  // ── 3. Buying-power check (USD/USDC) ──────────────────────────
  console.log('\n── Live Trading Readiness ────────────────────────────');
  const usd  = balances.find((b) => b.asset === 'USD')?.free  ?? 0;
  const usdc = balances.find((b) => b.asset === 'USDC')?.free ?? 0;
  const buyingPower = usd + usdc;

  if (buyingPower === 0) {
    console.log('    ❌  USD/USDC balance: $0.00');
    console.log('       You need funds to place BUY orders.');
    console.log('       → Deposit USD at https://www.coinbase.com/assets');
    console.log('       → Or convert existing crypto: Portfolio → Convert');
  } else {
    console.log(`    ✅  USD/USDC buying power: $${fmt(buyingPower, 2)}`);
  }

  // ── 4. Mode / safety settings ─────────────────────────────────
  const mode = config.mode;
  const allowLive = config.allowLiveTrading;
  const killSwitch = config.killSwitch;

  console.log(`\n── .env Settings ────────────────────────────────────`);
  console.log(`    MODE              = ${mode}`);
  console.log(`    ALLOW_LIVE_TRADING= ${allowLive}`);
  console.log(`    KILL_SWITCH       = ${killSwitch}`);

  if (mode === 'live' && allowLive && !killSwitch) {
    console.log('\n    ✅  Live trading is ENABLED');
  } else {
    console.log('\n    📋  To enable live trading, set in .env:');
    if (mode !== 'live')        console.log('        MODE=live');
    if (!allowLive)             console.log('        ALLOW_LIVE_TRADING=true');
    if (killSwitch)             console.log('        KILL_SWITCH=false');
  }

  // ── 5. Hydrated position preview ────────────────────────────────
  console.log('\n── Position Seed (what the bot will see at startup) ──');
  let anyPosition = false;
  for (const symbol of config.symbols) {
    const base = symbol.split(/[-/]/)[0];
    if (!base) continue;
    const holding = balances.find((b) => b.asset === base);
    if (!holding || holding.free <= 0) continue;
    try {
      const ticker = await adapter.getTicker(symbol);
      const valueUsd = holding.free * ticker.last;
      console.log(`    ✅  ${symbol}: holding ${holding.free} ${base} ≈ $${fmt(valueUsd, 2)}`);
      console.log(`        → bot will seed an OPEN position and can SELL immediately`);
      anyPosition = true;
    } catch {
      console.log(`    ⚠️  ${symbol}: holding found but ticker unavailable`);
    }
  }
  if (!anyPosition) {
    console.log('    (no pre-existing holdings for configured symbols)');
  }

  // ── 6. Ticker sanity check ────────────────────────────────────
  try {
    const symbol = config.symbols[0] ?? 'BTC-USD';
    const ticker = await adapter.getTicker(symbol);
    console.log(`\n── Market ────────────────────────────────────────────`);
    console.log(`    ${symbol}  last: $${fmt(ticker.last, 2)}  bid: $${fmt(ticker.bid, 2)}  ask: $${fmt(ticker.ask, 2)}`);
    console.log(`    spread: ${fmt((ticker.ask - ticker.bid) / ticker.ask * 10000, 1)} bps`);
  } catch {
    console.log('\n⚠️  Could not fetch ticker (non-critical)');
  }

  console.log('');
};

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('❌ Coinbase smoke check failed');
  console.error(message);
  process.exitCode = 1;
});
