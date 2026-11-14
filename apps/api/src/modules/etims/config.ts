// Patch 008B: eTIMS configuration — scoped to the etims module.
// Additive, does NOT touch apps/api/src/config.ts.
// All fields have safe defaults — no env var is required for boot.
import { z } from 'zod';

const EtimsEnv = z.object({
  ETIMS_MOCK_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  ETIMS_SANDBOX_BASE_URL: z
    .string()
    .url()
    .default('https://etims-api-sbx.kra.go.ke/etims-api'),
  ETIMS_PRODUCTION_BASE_URL: z
    .string()
    .url()
    .default('https://etims-api.kra.go.ke/etims-api'),
  ETIMS_DEVICE_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  ETIMS_RETRY_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  ETIMS_RETRY_BACKOFF_MS: z.coerce.number().int().positive().default(2000),
});

const parsed = EtimsEnv.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid ETIMS environment:', parsed.error.flatten().fieldErrors);
  throw new Error('invalid_etims_environment');
}

export const etimsConfig = parsed.data;
export type EtimsConfig = typeof etimsConfig;
