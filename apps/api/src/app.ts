import Fastify, { FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { config } from './config.js';
import { redis } from './db/redis.js';
import { healthRoutes } from './modules/health/routes.js';
import { authRoutes } from './modules/auth/routes.js';
import { mpesaRoutes } from './modules/mpesa/routes.js';
import { mpesaWebhookRoutes } from './modules/mpesa/webhook.js';
import { tablesRoutes } from './modules/tables/routes.js';
import { ticketsRoutes } from './modules/tickets/routes.js';
import { paymentsRoutes } from './modules/payments/routes.js';
import { requireAuth } from './plugins/auth.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: config.LOG_LEVEL },
    trustProxy: true,
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
    hsts:
      config.NODE_ENV === 'production'
        ? { maxAge: 63072000, includeSubDomains: true, preload: true }
        : false,
  });

  await app.register(cors, {
    origin: config.WEB_ORIGIN,
    credentials: true,
  });

  await app.register(cookie, { secret: config.COOKIE_SECRET });

  await app.register(rateLimit, {
    global: true,
    max: 120,
    timeWindow: '1 minute',
    redis: redis ?? undefined,
    keyGenerator: (req) => req.ip,
    skipOnError: false,
  });

  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(mpesaRoutes, { prefix: '/mpesa' });
  await app.register(mpesaWebhookRoutes, { prefix: '/mpesa' });
  await app.register(tablesRoutes, { prefix: '/tables' });
  await app.register(ticketsRoutes, { prefix: '/tickets' });
  await app.register(paymentsRoutes, { prefix: '/payments' });

  app.get('/whoami', { preHandler: [requireAuth] }, async (req) => {
    return { user: (req as unknown as { auth: unknown }).auth };
  });

  return app;
}
