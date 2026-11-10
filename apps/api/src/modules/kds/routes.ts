import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { requireAuth, requireTenant, type AuthClaims } from '../../plugins/auth.js';

interface KdsItemRow {
  id: string;
  ticket_id: string;
  name: string;
  quantity: number;
  course_number: number;
  notes: string | null;
  created_at: string;
  ticket_status: string;
  table_name: string | null;
  elapsed_seconds: number;
}

export async function kdsRoutes(app: FastifyInstance) {
  // Queue: all sent-and-not-ready items for this tenant
  app.get('/queue', { preHandler: [requireAuth, requireTenant] }, async (req) => {
    const { tenant_id } = (req as unknown as { auth: AuthClaims }).auth;
    const { rows } = await pool.query<KdsItemRow>(
      `SELECT ti.id, ti.ticket_id, ti.name, ti.quantity, ti.course_number, ti.notes,
              ti.created_at::text AS created_at,
              t.status AS ticket_status,
              rt.name AS table_name,
              EXTRACT(EPOCH FROM (NOW() - ti.created_at))::int AS elapsed_seconds
       FROM ticket_items ti
       JOIN tickets t ON t.id = ti.ticket_id
       LEFT JOIN restaurant_tables rt ON rt.id = t.table_id
       WHERE ti.tenant_id = $1
         AND ti.sent_to_kitchen = TRUE
         AND ti.ready_at IS NULL
         AND t.status != 'voided'
       ORDER BY ti.created_at ASC
       LIMIT 200`,
      [tenant_id],
    );
    return { items: rows };
  });

  // Mark a single item as ready
  app.post('/items/:id/ready', { preHandler: [requireAuth, requireTenant] }, async (req, reply) => {
    const { tenant_id, sub: user_id } = (req as unknown as { auth: AuthClaims }).auth;
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { rows } = await pool.query<{ id: string; ready_at: string }>(
      `UPDATE ticket_items
       SET ready_at = NOW(), ready_by = $3
       WHERE id = $1 AND tenant_id = $2
         AND sent_to_kitchen = TRUE AND ready_at IS NULL
       RETURNING id, ready_at::text AS ready_at`,
      [id, tenant_id, user_id],
    );
    if (rows.length === 0) {
      return reply.code(404).send({ error: 'item_not_found_or_already_ready' });
    }
    return { ok: true, item: rows[0] };
  });

  // Bump all pending items on a ticket at once
  app.post('/tickets/:id/bump', { preHandler: [requireAuth, requireTenant] }, async (req, reply) => {
    const { tenant_id, sub: user_id } = (req as unknown as { auth: AuthClaims }).auth;
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    const ticket = await pool.query<{ id: string }>(
      `SELECT id FROM tickets WHERE id = $1 AND tenant_id = $2 AND status != 'voided'`,
      [id, tenant_id],
    );
    if (ticket.rows.length === 0) {
      return reply.code(404).send({ error: 'ticket_not_found' });
    }

    const { rowCount } = await pool.query(
      `UPDATE ticket_items
       SET ready_at = NOW(), ready_by = $3
       WHERE ticket_id = $1 AND tenant_id = $2
         AND sent_to_kitchen = TRUE AND ready_at IS NULL`,
      [id, tenant_id, user_id],
    );
    return { ok: true, bumped: rowCount };
  });
}
