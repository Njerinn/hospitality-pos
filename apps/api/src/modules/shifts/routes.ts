// Phase 019b-2: cash drawer shift management — open, close, variance approval, history.
// Role guard (scope-level, registered in app.ts): admin, manager, cashier.
// Cashier may only close their own shift; manager/admin may close any.
// Variance > tenant.variance_threshold_kes by a cashier rejects with requires_approval.
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { requireAuthAndRole, type AuthClaims } from '../../plugins/auth.js';

const OpenBody = z.object({
  opening_float: z.coerce.number().nonnegative(),
});

const CloseBody = z.object({
  counted_cash: z.coerce.number().nonnegative(),
});

const ListQuery = z.object({
  limit: z.coerce.number().int().positive().max(100).default(20),
  offset: z.coerce.number().int().nonnegative().default(0),
});

interface ShiftRow {
  id: string;
  tenant_id: string;
  opened_by: string | null;
  opened_at: Date;
  opening_float: string;
  closed_by: string | null;
  closed_at: Date | null;
  counted_cash: string | null;
  expected_cash: string | null;
  variance: string | null;
  variance_approved_by: string | null;
  variance_approved_at: Date | null;
  requires_second_approval: boolean;
  status: string;
  notes: string | null;
  created_at: Date;
}

async function getExpectedCash(
  db: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<{ total: string }> }> },
  shiftId: string,
  tenantId: string,
  openingFloat: string,
): Promise<string> {
  const r = await db.query(
    `SELECT COALESCE(SUM(total), 0)::text AS total FROM tickets
     WHERE shift_id = $1 AND tenant_id = $2 AND status = 'paid'`,
    [shiftId, tenantId],
  );
  const sum = Number(r.rows[0].total);
  return (Number(openingFloat) + sum).toFixed(2);
}

export async function shiftsRoutes(app: FastifyInstance) {
  // ─── POST /shifts/open ───
  app.post('/open', { preHandler: [requireAuthAndRole('admin', 'manager', 'cashier')] }, async (req, reply) => {
    const { tenant_id, sub: user_id } = (req as unknown as { auth: AuthClaims }).auth;
    const body = OpenBody.parse(req.body);

    const open = await pool.query<{ id: string }>(
      `SELECT id FROM shifts WHERE tenant_id = $1 AND status = 'open' LIMIT 1`,
      [tenant_id],
    );
    if (open.rows.length > 0) {
      return reply.code(409).send({ error: 'shift_already_open', shift_id: open.rows[0].id });
    }

    try {
      const { rows } = await pool.query<ShiftRow>(
        `INSERT INTO shifts (tenant_id, opened_by, opening_float, status)
         VALUES ($1, $2, $3, 'open')
         RETURNING id, tenant_id, opened_by, opened_at, opening_float, status, created_at`,
        [tenant_id, user_id, body.opening_float],
      );
      return reply.code(201).send(rows[0]);
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        return reply.code(409).send({ error: 'shift_already_open' });
      }
      throw err;
    }
  });

  // ─── POST /shifts/:id/close ───
  app.post('/:id/close', { preHandler: [requireAuthAndRole('admin', 'manager', 'cashier')] }, async (req, reply) => {
    const { tenant_id, sub: user_id, role } = (req as unknown as { auth: AuthClaims }).auth;
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = CloseBody.parse(req.body);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const shiftRes = await client.query<ShiftRow>(
        `SELECT id, opened_by, opening_float, status FROM shifts
         WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        [id, tenant_id],
      );
      if (shiftRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'shift_not_found' });
      }
      const shift = shiftRes.rows[0];
      if (shift.status !== 'open') {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'shift_not_open', status: shift.status });
      }
      if (role === 'cashier' && shift.opened_by !== user_id) {
        await client.query('ROLLBACK');
        return reply.code(403).send({ error: 'not_your_shift' });
      }

      const expected = await getExpectedCash(
        { query: (s, p) => client.query<{ total: string }>(s, p) },
        id, tenant_id, shift.opening_float,
      );
      const counted = body.counted_cash;
      const variance = Number((counted - Number(expected)).toFixed(2));

      const thresh = await client.query<{ thresh: string }>(
        `SELECT COALESCE(variance_threshold_kes, 100)::text AS thresh FROM tenants WHERE id = $1`,
        [tenant_id],
      );
      const threshold = Number(thresh.rows[0].thresh);

      if (Math.abs(variance) > threshold && role === 'cashier') {
        await client.query('ROLLBACK');
        return reply.code(400).send({
          error: 'variance_exceeds_threshold',
          variance, threshold, requires_approval: true,
        });
      }

      const needs_second_approval = Math.abs(variance) > threshold;
      const auto_approver = needs_second_approval ? null : user_id;

      const upd = await client.query<ShiftRow>(
        `UPDATE shifts SET
           status = 'closed',
           closed_by = $1::uuid,
           closed_at = NOW(),
           counted_cash = $2,
           expected_cash = $3,
           variance = $4,
           variance_approved_by = $5::uuid,
           variance_approved_at = CASE WHEN $5::uuid IS NOT NULL THEN NOW() ELSE NULL::timestamptz END,
           requires_second_approval = $8::boolean
         WHERE id = $6::uuid AND tenant_id = $7::uuid
         RETURNING id, status, closed_by, closed_at, opening_float, counted_cash,
                   expected_cash, variance, variance_approved_by, variance_approved_at,
                   requires_second_approval`,
        [user_id, counted, expected, variance, auto_approver, id, tenant_id, needs_second_approval],
      );

      await client.query('COMMIT');
      return upd.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  // ─── POST /shifts/:id/approve-variance ───
  app.post('/:id/approve-variance', { preHandler: [requireAuthAndRole('admin', 'manager')] }, async (req, reply) => {
    const { tenant_id, sub: user_id } = (req as unknown as { auth: AuthClaims }).auth;
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    const existing = await pool.query<{ closed_by: string | null; variance_approved_by: string | null }>(
      `SELECT closed_by, variance_approved_by FROM shifts
       WHERE id = $1::uuid AND tenant_id = $2::uuid`,
      [id, tenant_id],
    );
    if (existing.rows.length === 0) {
      return reply.code(404).send({ error: 'shift_not_found' });
    }
    const existingShift = existing.rows[0];
    if (existingShift.variance_approved_by !== null) {
      return reply.code(409).send({ error: 'already_approved' });
    }
    if (existingShift.closed_by === user_id) {
      return reply.code(403).send({
        error: 'cannot_self_approve',
        message: 'A second admin or manager must approve this variance',
      });
    }

    const { rows, rowCount } = await pool.query<ShiftRow>(
      `UPDATE shifts SET
         variance_approved_by = $1::uuid,
         variance_approved_at = NOW(),
         requires_second_approval = false
       WHERE id = $2::uuid AND tenant_id = $3::uuid
         AND status = 'closed'
         AND variance_approved_by IS NULL
         AND variance IS NOT NULL
       RETURNING id, variance, variance_approved_by, variance_approved_at,
                 requires_second_approval`,
      [user_id, id, tenant_id],
    );
    if (rowCount === 0) {
      return reply.code(404).send({ error: 'shift_not_eligible_for_approval' });
    }
    return rows[0];
  });

  // ─── GET /shifts/current ───
  app.get('/current', { preHandler: [requireAuthAndRole('admin', 'manager', 'cashier')] }, async (req, reply) => {
    const { tenant_id } = (req as unknown as { auth: AuthClaims }).auth;
    const { rows } = await pool.query<ShiftRow>(
      `SELECT id, tenant_id, opened_by, opened_at, opening_float, status, created_at
       FROM shifts WHERE tenant_id = $1 AND status = 'open' LIMIT 1`,
      [tenant_id],
    );
    if (rows.length === 0) {
      return reply.code(404).send({ error: 'no_open_shift' });
    }
    const expected = await getExpectedCash(
      { query: (s, p) => pool.query<{ total: string }>(s, p) },
      rows[0].id, tenant_id, rows[0].opening_float,
    );
    const ticketCount = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM tickets WHERE shift_id = $1 AND status = 'paid'`,
      [rows[0].id],
    );
    return { ...rows[0], expected_cash: expected, ticket_count: ticketCount.rows[0].n };
  });

  // ─── GET /shifts ───
  app.get('/', { preHandler: [requireAuthAndRole('admin', 'manager')] }, async (req) => {
    const { tenant_id } = (req as unknown as { auth: AuthClaims }).auth;
    const q = ListQuery.parse(req.query ?? {});
    const { rows } = await pool.query<ShiftRow>(
      `SELECT id, tenant_id, opened_by, opened_at, closed_by, closed_at,
              opening_float, counted_cash, expected_cash, variance,
              variance_approved_by, variance_approved_at, requires_second_approval, status, notes
       FROM shifts WHERE tenant_id = $1 AND status <> 'open'
       ORDER BY closed_at DESC NULLS LAST
       LIMIT $2 OFFSET $3`,
      [tenant_id, q.limit, q.offset],
    );
    return { shifts: rows, limit: q.limit, offset: q.offset };
  });

  // ─── GET /shifts/:id ───
  app.get('/:id', { preHandler: [requireAuthAndRole('admin', 'manager')] }, async (req, reply) => {
    const { tenant_id } = (req as unknown as { auth: AuthClaims }).auth;
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    const shiftRes = await pool.query<ShiftRow>(
      `SELECT id, tenant_id, opened_by, opened_at, closed_by, closed_at,
              opening_float, counted_cash, expected_cash, variance,
              variance_approved_by, variance_approved_at, requires_second_approval, status, notes
       FROM shifts WHERE id = $1 AND tenant_id = $2`,
      [id, tenant_id],
    );
    if (shiftRes.rows.length === 0) {
      return reply.code(404).send({ error: 'shift_not_found' });
    }
    const tickets = await pool.query(
      `SELECT id, status, total, payment_method, closed_at, closed_by
       FROM tickets WHERE shift_id = $1 AND tenant_id = $2
       ORDER BY closed_at NULLS LAST`,
      [id, tenant_id],
    );
    return { shift: shiftRes.rows[0], tickets: tickets.rows };
  });
}
