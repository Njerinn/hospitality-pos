// Patch 014: cashier-facing M-Pesa operations (unallocated queue management).
// Role-gated by scope wrapper in app.ts (admin + manager + cashier).
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { requireAuth, requireTenant, type AuthClaims } from '../../plugins/auth.js';
import { enqueueEtimsSubmission } from '../etims/submission.js';

const AssignBody = z.object({ ticket_id: z.string().uuid() });

interface UnallocatedRow {
  id: string;
  trans_id: string;
  amount: string;
  msisdn: string;
  bill_ref: string | null;
  trans_time: string;
  match_reason: string | null;
}

export async function mpesaOpsRoutes(app: FastifyInstance) {
  // ─── GET /mpesa-ops/unallocated — list with suggestions ───
  app.get('/unallocated', { preHandler: [requireAuth, requireTenant] }, async (req) => {
    const { tenant_id, sub: user_id } = (req as unknown as { auth: AuthClaims }).auth;
    const { rows } = await pool.query<UnallocatedRow>(
      `SELECT id, trans_id, amount::text AS amount, msisdn, bill_ref,
              trans_time::text AS trans_time, match_reason
       FROM mpesa_transactions
       WHERE tenant_id = $1 AND status = 'UNALLOCATED'
       ORDER BY trans_time DESC LIMIT 100`,
      [tenant_id],
    );

    // For each unallocated, find up to 5 open tickets matching amount within 4h
    const withSuggestions = await Promise.all(
      rows.map(async (r) => {
        const s = await pool.query<{ id: string; table_id: string | null; opened_at: Date }>(
          `SELECT id, table_id, opened_at FROM tickets
           WHERE tenant_id = $1
             AND status IN ('open', 'sent_to_kitchen')
             AND total = $2::numeric
             AND opened_at >= NOW() - INTERVAL '4 hours'
           ORDER BY opened_at ASC LIMIT 5`,
          [tenant_id, r.amount],
        );
        return { ...r, suggested_tickets: s.rows };
      }),
    );
    return { unallocated: withSuggestions };
  });

  // ─── POST /mpesa-ops/unallocated/:id/assign — manual link ───
  app.post(
    '/unallocated/:id/assign',
    { preHandler: [requireAuth, requireTenant] },
    async (req, reply) => {
      const { tenant_id, sub: user_id } = (req as unknown as { auth: AuthClaims }).auth;
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      const { ticket_id } = AssignBody.parse(req.body);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Lock the unallocated row + candidate ticket
        const m = await client.query<{ id: string; amount: string; status: string }>(
          `SELECT id, amount::text AS amount, status FROM mpesa_transactions
           WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
          [id, tenant_id],
        );
        const tx = m.rows[0];
        if (!tx) {
          await client.query('ROLLBACK');
          return reply.code(404).send({ error: 'mpesa_transaction_not_found' });
        }
        if (tx.status !== 'UNALLOCATED') {
          await client.query('ROLLBACK');
          return reply.code(409).send({ error: 'not_unallocated', status: tx.status });
        }

        const t = await client.query<{ id: string; status: string; total: string }>(
          `SELECT id, status, total FROM tickets
           WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
          [ticket_id, tenant_id],
        );
        const ticket = t.rows[0];
        if (!ticket) {
          await client.query('ROLLBACK');
          return reply.code(404).send({ error: 'ticket_not_found' });
        }
        if (ticket.status === 'paid' || ticket.status === 'voided') {
          await client.query('ROLLBACK');
          return reply.code(409).send({ error: 'ticket_closed', status: ticket.status });
        }
        if (Number(ticket.total) !== Number(tx.amount)) {
          await client.query('ROLLBACK');
          return reply.code(409).send({
            error: 'amount_mismatch',
            expected: ticket.total,
            received: tx.amount,
          });
        }

        await client.query(
          `UPDATE mpesa_transactions
           SET ticket_id = $1, status = 'LINKED', matched_at = NOW(),
               match_attempts = match_attempts + 1, match_reason = 'manual_assignment'
           WHERE id = $2`,
          [ticket_id, id],
        );
        await client.query(
          `UPDATE tickets SET status = 'paid', closed_at = NOW(),
               payment_method = 'mpesa', closed_by = $3
           WHERE id = $1 AND tenant_id = $2`,
          [ticket_id, tenant_id, user_id],
        );
        await client.query(
          `UPDATE restaurant_tables SET status = 'free'
           WHERE id = (SELECT table_id FROM tickets WHERE id = $1 AND tenant_id = $2)`,
          [ticket_id, tenant_id],
        );
        await client.query('COMMIT');

        void enqueueEtimsSubmission(app, ticket_id, tenant_id);
        return { ok: true, mpesa_transaction_id: id, ticket_id, status: 'LINKED' };
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  );
}
