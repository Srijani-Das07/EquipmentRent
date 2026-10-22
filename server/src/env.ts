import 'dotenv/config';
import path from 'node:path';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  CLIENT_ORIGIN: z.string().url().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  POLICY_CONFIG_PATH: z.string().default('./config/equipment_policy_config.json'),
  POLICY_CONFIG_VERSIONS_DIR: z.string().default('./config/versions'),
  POLICY_CONFIG_POLL_MS: z.coerce.number().int().min(100).max(4000).default(2000), // P4: < 5s
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
  console.error(`Invalid environment configuration:\n${lines.join('\n')}`);
  process.exit(1);
}

const raw = parsed.data;

if (raw.NODE_ENV === 'production' && raw.JWT_SECRET.startsWith('change-me')) {
  console.error('Refusing to start in production with the example JWT_SECRET.');
  process.exit(1);
}

export const env = {
  ...raw,
  isProd: raw.NODE_ENV === 'production',
  isTest: raw.NODE_ENV === 'test',
  policyConfigPath: path.resolve(raw.POLICY_CONFIG_PATH),
  policyVersionsDir: path.resolve(raw.POLICY_CONFIG_VERSIONS_DIR),
};

export type Env = typeof env;
