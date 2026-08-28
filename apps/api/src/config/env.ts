import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ path: resolve(import.meta.dirname, '../../../../.env') });

const developmentEncryptionKey =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  DATABASE_URL: z
    .string()
    .url()
    .default('postgresql://knowledgehub:knowledgehub_dev_password@localhost:5433/knowledgehub'),
  JWT_SECRET: z
    .string()
    .min(32)
    .default('knowledgehub-development-secret-change-me'),
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),
  DATA_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/)
    .default(developmentEncryptionKey),
  FASTGPT_API_BASE_URL: z.string().url().default('https://api.fastgpt.in/api/v1'),
  FASTGPT_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(30_000),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  throw new Error(`Invalid environment variables: ${z.prettifyError(parsed.error)}`);
}

if (
  parsed.data.NODE_ENV === 'production' &&
  parsed.data.DATA_ENCRYPTION_KEY === developmentEncryptionKey
) {
  throw new Error('DATA_ENCRYPTION_KEY must be replaced in production');
}

export const env = parsed.data;
