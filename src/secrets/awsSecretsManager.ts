import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import type { SecretsProvider } from './provider.js';

export class AwsSecretsManagerProvider implements SecretsProvider {
  private readonly client: SecretsManagerClient;

  constructor(region: string, private readonly env: NodeJS.ProcessEnv) {
    this.client = new SecretsManagerClient({ region });
    this.env = env;
  }

  async getSecret(secretId: string, fallbackEnvName?: string): Promise<string> {
    try {
      const response = await this.client.send(new GetSecretValueCommand({ SecretId: secretId }));
      const secretString = response.SecretString;
      if (!secretString) {
        throw new Error(`Secret ${secretId} is empty`);
      }

      try {
        const parsed = JSON.parse(secretString) as { value?: string };
        if (typeof parsed.value === 'string' && parsed.value.length > 0) {
          return parsed.value;
        }
      } catch {
        // Raw string is supported.
      }

      return secretString;
    } catch (err) {
      if (fallbackEnvName && this.env[fallbackEnvName]) {
        return this.env[fallbackEnvName] as string;
      }
      throw err;
    }
  }
}
