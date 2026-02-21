import type { z } from 'zod';
import type { configSchema } from './schema.js';

export type AppConfig = z.infer<typeof configSchema>;
