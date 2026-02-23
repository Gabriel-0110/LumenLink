/**
 * 1Password CLI Secrets Provider
 * 
 * Reads secrets from 1Password vault using the `op` CLI.
 * Requires: `brew install --cask 1password-cli` + authenticated session.
 * 
 * Secret references follow 1Password format:
 *   op://<vault>/<item>/<field>
 * 
 * Example .env:
 *   SECRETS_PROVIDER=1password
 *   OP_VAULT=Trading
 *   COINBASE_API_KEY=op://Trading/Coinbase/api-key
 *   COINBASE_API_SECRET=op://Trading/Coinbase/api-secret
 * 
 * Or use direct item references in the secret ID mapping.
 */

import { execSync } from 'node:child_process';
import type { SecretsProvider } from './provider.js';

interface OnePasswordConfig {
  /** 1Password vault name. Default: 'Trading' */
  vault: string;
  /** Cache secrets in memory for this many ms. Default: 300000 (5 min) */
  cacheTtlMs: number;
  /** Fallback to env vars if op CLI fails. Default: true for paper mode */
  fallbackToEnv: boolean;
}

const DEFAULT_CONFIG: OnePasswordConfig = {
  vault: 'Trading',
  cacheTtlMs: 300_000,
  fallbackToEnv: true,
};

// Maps secret IDs to 1Password item/field paths
const SECRET_TO_OP_MAP: Record<string, { item: string; field: string }> = {
  // Trading APIs
  'prod/trading/coinbase/key': { item: 'LumenLink API - Coinbase', field: 'COINBASE_API_KEY' },
  'prod/trading/coinbase/secret': { item: 'LumenLink API - Coinbase', field: 'COINBASE_API_SECRET' },
  'prod/trading/coinbase/passphrase': { item: 'LumenLink API - Coinbase', field: 'COINBASE_API_PASSPHRASE' },
  'prod/trading/binance/key': { item: 'Binance', field: 'api-key' },
  'prod/trading/binance/secret': { item: 'Binance', field: 'api-secret' },
  'prod/trading/bybit/key': { item: 'Bybit', field: 'api-key' },
  'prod/trading/bybit/secret': { item: 'Bybit', field: 'api-secret' },
  'prod/trading/gemini/key': { item: 'Gemini', field: 'api-key' },
  'prod/trading/gemini/secret': { item: 'Gemini', field: 'api-secret' },

  // Data APIs
  'prod/data/cryptopanic/key': { item: 'LumenLink API - CryptoPanic', field: 'CRYPTOPANIC_API_KEY' },
  'prod/data/coingecko/key': { item: 'LumenLink API - CoinGecko', field: 'COINGECKO_API_KEY' },
  'prod/data/coinmarketcap/key': { item: 'LumenLink API - CoinMarketCap', field: 'COINMARKETCAP_API_KEY' },
  'prod/data/twelvedata/key': { item: 'LumenLink API - TwelveData', field: 'TWELVEDATA_API_KEY' },
  'prod/data/newsapi/key': { item: 'LumenLink API - NewsAPI', field: 'NEWS_API_KEY' },
  'prod/data/lunarcrush/key': { item: 'LunarCrush', field: 'api-key' },
  'prod/data/glassnode/key': { item: 'Glassnode', field: 'api-key' },
  'prod/data/nansen/key': { item: 'Nansen', field: 'api-key' },
  'prod/data/etherscan/key': { item: 'LumenLink API - Etherscan', field: 'ETHERSCAN_API_KEY' },

  // AI
  'prod/ai/openai/key': { item: 'LumenLink API - OpenAI', field: 'OPENAI_API_KEY' },

  // Alerts
  'prod/alerts/telegram/token': { item: 'LumenLink API - Telegram', field: 'TELEGRAM_BOT_TOKEN' },
  'prod/alerts/discord/webhook': { item: 'Discord', field: 'webhook-url' },
};

const OPTIONAL_SECRETS = new Set([
  'prod/trading/coinbase/passphrase',
  'prod/trading/binance/key',
  'prod/trading/binance/secret',
  'prod/trading/bybit/key',
  'prod/trading/bybit/secret',
  'prod/trading/gemini/key',
  'prod/trading/gemini/secret',
  'prod/data/lunarcrush/key',
  'prod/data/glassnode/key',
  'prod/data/nansen/key',
  'prod/alerts/discord/webhook',
]);

export class OnePasswordProvider implements SecretsProvider {
  private readonly config: OnePasswordConfig;
  private readonly cache = new Map<string, { value: string; expiresAt: number }>();
  private readonly env: NodeJS.ProcessEnv;

  constructor(env: NodeJS.ProcessEnv, config: Partial<OnePasswordConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.env = env;
  }

  async getSecret(secretId: string, fallbackEnvName?: string): Promise<string> {
    // Check cache first
    const cached = this.cache.get(secretId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    // Check if env var contains an op:// reference
    const envVal = fallbackEnvName ? this.env[fallbackEnvName] : undefined;
    if (envVal?.startsWith('op://')) {
      return this.resolveOpReference(envVal, secretId, fallbackEnvName);
    }

    // Try 1Password via secret ID mapping
    const opMapping = SECRET_TO_OP_MAP[secretId];
    if (opMapping) {
      try {
        const ref = `op://${this.config.vault}/${opMapping.item}/${opMapping.field}`;
        const value = this.readFromOp(ref);
        this.cache.set(secretId, { value, expiresAt: Date.now() + this.config.cacheTtlMs });
        return value;
      } catch (err) {
        if (OPTIONAL_SECRETS.has(secretId)) {
          return '';
        }
        if (this.config.fallbackToEnv && envVal) {
          return envVal.trim();
        }
        throw new Error(`1Password: Failed to read ${secretId}: ${err}`);
      }
    }

    // Fall back to env var
    if (this.config.fallbackToEnv && envVal) return envVal.trim();

    throw new Error(`Secret not found: ${secretId} (no 1Password mapping or env var)`);
  }

  private async resolveOpReference(ref: string, secretId: string, fallbackEnvName?: string): Promise<string> {
    try {
      const value = this.readFromOp(ref);
      this.cache.set(secretId, { value, expiresAt: Date.now() + this.config.cacheTtlMs });
      return value;
    } catch (err) {
      if (this.config.fallbackToEnv && fallbackEnvName) {
        const plain = this.env[fallbackEnvName];
        if (plain && !plain.startsWith('op://')) return plain.trim();
      }
      throw new Error(`1Password: Failed to resolve ${ref}: ${err}`);
    }
  }

  private readFromOp(reference: string): string {
    try {
      const result = execSync(`op read "${reference}"`, {
        encoding: 'utf-8',
        timeout: 10_000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return result.trim();
    } catch (err: any) {
      const stderr = err.stderr?.toString() ?? '';
      if (stderr.includes('not signed in') || stderr.includes('session expired')) {
        throw new Error('1Password CLI not authenticated. Run: eval $(op signin)');
      }
      throw err;
    }
  }

  /** Check if 1Password CLI is available and authenticated */
  static isAvailable(): boolean {
    try {
      execSync('op whoami', { encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] });
      return true;
    } catch {
      return false;
    }
  }
}
