import type { AppConfig } from '../config/types.js';
import { AwsSecretsManagerProvider } from './awsSecretsManager.js';
import { EnvFallbackSecretsProvider } from './envFallback.js';

export interface SecretsProvider {
  getSecret(secretId: string, fallbackEnvName?: string): Promise<string>;
}

export const buildSecretsProvider = (config: AppConfig): SecretsProvider => {
  if (config.secrets.useAwsSecretsManager) {
    return new AwsSecretsManagerProvider(config.secrets.awsRegion, process.env);
  }
  return new EnvFallbackSecretsProvider(process.env);
};
