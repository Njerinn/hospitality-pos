import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { requireAuth, requireTenant, type AuthClaims } from '../../plugins/auth.js';

const LinkBody = z.object({
  trans_id: z.string().min(1).max(30),
});

export async function paymentsRoutes(app: FastifyInstance) {
  app.post('/link-mpesa/:ticketId', { preHandler: [requireAuth, requireTenant] }, async (req, reply) => {
    const { tenant_id } = (req as unknown as { auth: AuthClaims }).auth;
    const { ticketId } = z.object({ ticketId: z.string().uuid() }).parse(req.params);
    const { trans_id } = LinkBody.parse(req.body);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const t = await client.query<{ id: string; status: string; total: string }>(
        `SELECT id, status, total FROM tickets
         WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        [ticketId, tenant_id],
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

      const m = await client.query<{ id: string; amount: string; ticket_id: string | null }>(
        `SELECT id, amount, ticket_id FROM mpesa_transactions
         WHERE trans_id = $1 AND tenant_id = $2`,
        [trans_id, tenant_id],
      );
      const tx = m.rows[0];
      if (!tx) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'mpesa_transaction_not_found' });
      }
      if (tx.ticket_id && tx.ticket_id !== ticketId) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'transaction_already_linked', to: tx.ticket_id });
      }
      if (Number(tx.amount) !== Number(ticket.total)) {
        await client.query('ROLLBACK');
        return reply.code(409).send({
          error: 'amount_mismatch',
          expected: ticket.total,
          received: tx.amount,
        });
      }

      await client.query(
        `UPDATE mpesa_transactions SET ticket_id = $1, status = 'LINKED'
         WHERE id = $2`,
        [ticketId, tx.id],
      );
      await client.query(
        `UPDATE tickets SET status = 'paid', closed_at = NOW()
         WHERE id = $1 AND tenant_id = $2`,
        [ticketId, tenant_id],
      );
      await client.query(
        `UPDATE restaurant_tables SET status = 'free'
         WHERE id = (SELECT table_id FROM tickets WHERE id = $1 AND tenant_id = $2)`,
        [ticketId, tenant_id],
      );

      await client.query('COMMIT');
      return { ok: true, ticket_id: ticketId, trans_id, status: 'paid' };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });
}
