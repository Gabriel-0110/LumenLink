import type { AppConfig } from '../config/types.js';
import { AwsSecretsManagerProvider } from './awsSecretsManager.js';
import { EnvFallbackSecretsProvider } from './envFallback.js';
import { OnePasswordProvider } from './onePasswordProvider.js';

export interface SecretsProvider {
  getSecret(secretId: string, fallbackEnvName?: string): Promise<string>;
}

export const buildSecretsProvider = (config: AppConfig): SecretsProvider => {
  // Priority: 1Password > AWS Secrets Manager > Env fallback
  const secretsProviderType = process.env.SECRETS_PROVIDER?.toLowerCase();

  if (secretsProviderType === '1password' || secretsProviderType === 'op') {
    const vault = process.env.OP_VAULT ?? 'Trading';
    return new OnePasswordProvider(process.env, {
      vault,
      fallbackToEnv: config.mode === 'paper', // only fallback in paper mode
    });
  }

  if (config.secrets.useAwsSecretsManager) {
    return new AwsSecretsManagerProvider(config.secrets.awsRegion, process.env);
  }

  return new EnvFallbackSecretsProvider(process.env);
};
