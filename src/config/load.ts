import dotenv from 'dotenv';
import { configSchema } from './schema.js';
import type { AppConfig } from './types.js';

dotenv.config({ path: process.env.DOTENV_CONFIG_PATH || '.env' });

export const loadConfig = (): AppConfig => {
  const parsed = configSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Config validation failed: ${details}`);
  }
  return parsed.data;
};
