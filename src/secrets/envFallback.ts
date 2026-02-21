import type { SecretsProvider } from './provider.js';

const fallbackMap: Record<string, string> = {
  'prod/trading/coinbase/key': 'COINBASE_API_KEY',
  'prod/trading/coinbase/secret': 'COINBASE_API_SECRET',
  'prod/trading/coinbase/passphrase': 'COINBASE_API_PASSPHRASE',
  'prod/alerts/telegram/token': 'TELEGRAM_BOT_TOKEN',
  'prod/alerts/discord/webhook': 'DISCORD_WEBHOOK_URL'
};

export class EnvFallbackSecretsProvider implements SecretsProvider {
  constructor(private readonly env: NodeJS.ProcessEnv) {}

  async getSecret(secretId: string, fallbackEnvName?: string): Promise<string> {
    const envKey = fallbackEnvName ?? fallbackMap[secretId];
    const value = envKey ? this.env[envKey] : undefined;
    if (!value) {
      throw new Error(`Missing secret in env fallback for ${secretId}`);
    }
    return value;
  }
}
