import type { SecretsProvider } from './provider.js';

const fallbackMap: Record<string, string> = {
  // Trading APIs
  'prod/trading/coinbase/key': 'COINBASE_API_KEY',
  'prod/trading/coinbase/secret': 'COINBASE_API_SECRET',
  'prod/trading/coinbase/passphrase': 'COINBASE_API_PASSPHRASE',
  'prod/trading/binance/key': 'BINANCE_API_KEY',
  'prod/trading/binance/secret': 'BINANCE_API_SECRET',
  
  // Data APIs
  'prod/data/cryptopanic/key': 'CRYPTOPANIC_API_KEY',
  'prod/data/coingecko/key': 'COINGECKO_API_KEY',
  'prod/data/coinmarketcap/key': 'COINMARKETCAP_API_KEY',
  'prod/data/twelvedata/key': 'TWELVEDATA_API_KEY',
  'prod/data/newsapi/key': 'NEWS_API_KEY',
  'prod/data/lunarcrush/key': 'LUNARCRUSH_API_KEY',
  'prod/data/glassnode/key': 'GLASSNODE_API_KEY',
  'prod/data/nansen/key': 'NANSEN_API_KEY',
  'prod/data/etherscan/key': 'ETHERSCAN_API_KEY',
  
  // AI APIs
  'prod/ai/openai/key': 'OPENAI_API_KEY',
  
  // Alert APIs
  'prod/alerts/telegram/token': 'TELEGRAM_BOT_TOKEN',
  'prod/alerts/discord/webhook': 'DISCORD_WEBHOOK_URL'
};

// Optional API keys that shouldn't fail in paper mode
const optionalSecrets = new Set([
  'prod/data/lunarcrush/key',
  'prod/data/glassnode/key', 
  'prod/data/nansen/key',
  'prod/data/coingecko/key',
  'prod/data/coinmarketcap/key',
  'prod/data/twelvedata/key',
  'prod/data/newsapi/key',
  'prod/ai/openai/key',
  'prod/data/etherscan/key',
  'prod/trading/coinbase/passphrase', // Optional in paper mode
  'prod/trading/binance/key',         // Optional if not using Binance
  'prod/trading/binance/secret'       // Optional if not using Binance
]);

export class EnvFallbackSecretsProvider implements SecretsProvider {
  constructor(private readonly env: NodeJS.ProcessEnv) {}

  async getSecret(secretId: string, fallbackEnvName?: string): Promise<string> {
    const envKey = fallbackEnvName ?? fallbackMap[secretId];
    const value = envKey ? this.env[envKey] : undefined;
    
    // Return empty string for optional secrets if missing (instead of throwing)
    if (!value) {
      if (optionalSecrets.has(secretId)) {
        return '';
      }
      throw new Error(`Missing secret in env fallback for ${secretId} (env var: ${envKey})`);
    }
    
    return value.trim();
  }
}
