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
import { mpesaOpsRoutes } from './modules/mpesa/ops-routes.js';
import { mpesaWebhookRoutes } from './modules/mpesa/webhook.js';
import { tablesRoutes } from './modules/tables/routes.js';
import { ticketsRoutes } from './modules/tickets/routes.js';
import { paymentsRoutes } from './modules/payments/routes.js';
import { kdsRoutes } from './modules/kds/routes.js';
import { inventoryRoutes } from './modules/inventory/routes.js';
import { stockOpsRoutes } from './modules/stock-ops/routes.js';
import { butcheryRoutes } from './modules/butchery/routes.js';
import { bbqRoutes } from './modules/bbq/routes.js';
import { reportsRoutes } from './modules/reports/routes.js';
import { adminRoutes } from './modules/admin/routes.js';
import { etimsRoutes } from './modules/etims/routes.js';
import { etimsReceiptRoutes } from './modules/etims/receipt.js';
import { requireAuth, requireAuthAndRole } from './plugins/auth.js';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export async function buildApp(): Promise<FastifyInstance> {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
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

  const allowedOrigins = config.WEB_ORIGIN.split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(null, false);
    },
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

  // ───── public ─────
  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(mpesaWebhookRoutes, { prefix: '/mpesa' }); // IP-allowlist enforced in handler

  // ───── admin only ─────
  await app.register(async (s) => {
    s.addHook('preHandler', requireAuthAndRole('admin'));
    await s.register(mpesaRoutes);
  }, { prefix: '/mpesa' });

  await app.register(async (s) => {
    s.addHook('preHandler', requireAuthAndRole('admin'));
    await s.register(adminRoutes);
  }, { prefix: '/admin' });

  // ───── admin, manager, cashier, waiter ─────
  await app.register(async (s) => {
    s.addHook('preHandler', requireAuthAndRole('admin', 'manager', 'cashier', 'waiter'));
    await s.register(tablesRoutes);
  }, { prefix: '/tables' });

  await app.register(async (s) => {
    s.addHook('preHandler', requireAuthAndRole('admin', 'manager', 'cashier', 'waiter'));
    await s.register(ticketsRoutes);
  }, { prefix: '/tickets' });

  // ───── admin, manager, cashier ─────
  await app.register(async (s) => {
    s.addHook('preHandler', requireAuthAndRole('admin', 'manager', 'cashier'));
    await s.register(paymentsRoutes);
  }, { prefix: '/payments' });

  // ───── admin, manager, kitchen ─────
  await app.register(async (s) => {
    s.addHook('preHandler', requireAuthAndRole('admin', 'manager', 'kitchen'));
    await s.register(kdsRoutes);
  }, { prefix: '/kds' });

  // ───── admin, manager ─────
  await app.register(async (s) => {
    s.addHook('preHandler', requireAuthAndRole('admin', 'manager'));
    await s.register(inventoryRoutes);
  }, { prefix: '/inventory' });

  await app.register(async (s) => {
    s.addHook('preHandler', requireAuthAndRole('admin', 'manager', 'kitchen', 'butchery'));
    await s.register(stockOpsRoutes);
  }, { prefix: '/stock-ops' });

  await app.register(async (s) => {
    s.addHook('preHandler', requireAuthAndRole('admin', 'manager', 'butchery'));
    await s.register(butcheryRoutes);
  }, { prefix: '/butchery' });

  await app.register(async (s) => {
    s.addHook('preHandler', requireAuthAndRole('admin', 'manager', 'kitchen', 'cashier'));
    await s.register(bbqRoutes);
  }, { prefix: '/bbq' });

  await app.register(async (s) => {
    s.addHook('preHandler', requireAuthAndRole('admin', 'manager'));
    await s.register(reportsRoutes);
  }, { prefix: '/reports' });

  // ───── eTIMS admin (scope: admin+manager; write endpoints gated to admin inside routes) ─────
  await app.register(async (s) => {
    s.addHook('preHandler', requireAuthAndRole('admin', 'manager'));
    await s.register(etimsRoutes);
  }, { prefix: '/etims' });

  // ───── receipts (admin+manager+cashier) — fiscal receipt for paid ticket ─────
  await app.register(async (s) => {
    s.addHook('preHandler', requireAuthAndRole('admin', 'manager', 'cashier', 'waiter'));
    await s.register(etimsReceiptRoutes);
  }, { prefix: '/receipts' });

  // ───── mpesa ops (admin+manager+cashier) — unallocated payment queue ─────
  await app.register(async (s) => {
    s.addHook('preHandler', requireAuthAndRole('admin', 'manager', 'cashier'));
    await s.register(mpesaOpsRoutes);
  }, { prefix: '/mpesa-ops' });

  app.get('/whoami', { preHandler: [requireAuth] }, async (req) => {
    return { user: (req as unknown as { auth: unknown }).auth };
  });

  // SPA static file serving — after all API routes
  const posDist = join(__dirname, '..', '..', 'pos', 'dist');
  await app.register(fastifyStatic, { root: posDist, prefix: '/' });

  // SPA fallback: non-API 404s return index.html
  app.setNotFoundHandler((req, reply) => {
    const apiExact = ['/health', '/whoami'];
    const apiRoots = ['/auth', '/tables', '/tickets', '/payments', '/admin'];
    const apiWithSlash = ['/kds/', '/inventory/', '/reports/', '/etims/', '/receipts/'];

    const isApiPath =
      apiExact.includes(req.url) ||
      apiRoots.some((p) => req.url === p || req.url.startsWith(p + '/')) ||
      apiWithSlash.some((p) => req.url.startsWith(p));

    if (isApiPath) {
      return reply.code(404).send({ error: 'not_found' });
    }
    return reply.sendFile('index.html');
  });

  return app;
}
