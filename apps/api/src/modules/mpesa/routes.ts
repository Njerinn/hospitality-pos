import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireTenant, requireAuthAndRole, type AuthClaims } from '../../plugins/auth.js';
import { pool } from '../../db/pool.js';
import { registerC2BUrls, simulateC2B } from './client.js';

const SimulateBody = z.object({
  msisdn: z.string().min(9),
  amount: z.coerce.number().positive(),
  billRef: z.string().min(1),
});

const RegisterBody = z.object({
  confirm: z.literal(true),
});

export async function mpesaRoutes(app: FastifyInstance) {
  // ─── Existing: register URLs (no audit) ───
  app.post(
    '/c2b/register-urls',
    { preHandler: [requireAuth, requireTenant] },
    async () => registerC2BUrls(),
  );

  // ─── Existing: simulate C2B (sandbox only) ───
  app.post(
    '/c2b/simulate',
    { preHandler: [requireAuth, requireTenant] },
    async (req) => simulateC2B(SimulateBody.parse(req.body)),
  );

  // ─── NEW: register URLs with confirmation + audit ───
  app.post('/register-urls', async (req, reply) => {
    const { tenant_id, sub: user_id } = (req as unknown as { auth: AuthClaims }).auth;
    RegisterBody.parse(req.body);
    const result = await registerC2BUrls();
    await pool.query(
      `INSERT INTO mpesa_url_registrations
         (tenant_id, response_status, response_body, registered_by)
       VALUES ($1, $2, $3, $4)`,
      [tenant_id, result.status, result.body, user_id],
    );
    return {
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      body: result.body,
      registered_at: new Date().toISOString(),
    };
  });

  // ─── NEW: registration status ───
  app.get('/registration-status', async (req) => {
    const { tenant_id } = (req as unknown as { auth: AuthClaims }).auth;
    const { rows } = await pool.query<{
      registered_at: Date;
      response_status: number;
      response_body: unknown;
      registered_by_email: string | null;
    }>(
      `SELECT r.registered_at, r.response_status, r.response_body, u.email AS registered_by_email
       FROM mpesa_url_registrations r
       LEFT JOIN users u ON u.id = r.registered_by
       WHERE r.tenant_id = $1
       ORDER BY r.registered_at DESC
       LIMIT 1`,
      [tenant_id],
    );
    return { last_registration: rows[0] ?? null };
  });

  // ─── NEW: ignore an unallocated payment (admin only) ───
  app.post(
    '/unallocated/:id/ignore',
    { preHandler: [requireAuthAndRole('admin')] },
    async (req, reply) => {
      const { tenant_id } = (req as unknown as { auth: AuthClaims }).auth;
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      const { rowCount } = await pool.query(
        `UPDATE mpesa_transactions
         SET status = 'IGNORED', match_reason = 'admin_ignored', updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2 AND status = 'UNALLOCATED'`,
        [id, tenant_id],
      );
      if (rowCount === 0) return reply.code(404).send({ error: 'not_found_or_not_unallocated' });
      return { ok: true, id };
    },
  );
}
