import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireTenant } from '../../plugins/auth.js';
import { registerC2BUrls, simulateC2B } from './client.js';

const SimulateBody = z.object({
  msisdn: z.string().min(9),
  amount: z.coerce.number().positive(),
  billRef: z.string().min(1),
});

export async function mpesaRoutes(app: FastifyInstance) {
  app.post(
    '/c2b/register-urls',
    { preHandler: [requireAuth, requireTenant] },
    async () => registerC2BUrls(),
  );

  app.post(
    '/c2b/simulate',
    { preHandler: [requireAuth, requireTenant] },
    async (req) => simulateC2B(SimulateBody.parse(req.body)),
  );
}
