import 'dotenv/config';
import { z } from 'zod';

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.string().default('info'),
  DATABASE_URL: z.string().url(),
  DATABASE_SSL: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  REDIS_URL: z.string().optional(),
  JWT_SECRET: z.string().min(32),
  COOKIE_SECRET: z.string().min(32),
  SESSION_COOKIE_NAME: z.string().default('pos_session'),
  WEB_ORIGIN: z.string().url(),
  MPESA_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
  MPESA_CONSUMER_KEY: z.string().min(1),
  MPESA_CONSUMER_SECRET: z.string().min(1),
  MPESA_PASSKEY: z.string().min(1),
  MPESA_TILL_NUMBER: z.string().min(1),
  MPESA_STORE_NUMBER: z.string().default('1'),
  MPESA_CONFIRMATION_URL: z.string().url(),
  MPESA_VALIDATION_URL: z.string().url(),
  SAFARICOM_ALLOWED_CIDRS: z.string().default(''),
  INTERNAL_HMAC_SECRET: z.string().min(32),
});

const parsed = Env.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}
export const config = parsed.data;
