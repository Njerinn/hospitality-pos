import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { resolveTaxTyCd, type TaxTyCd } from '../etims/tax.js';
import { requireAuth, requireTenant, type AuthClaims } from '../../plugins/auth.js';

const OpenBody = z.object({
  table_id: z.string().uuid().nullable().optional(),
  notes: z.string().max(500).optional(),
});

const AddItemBody = z.object({
  name: z.string().min(1).max(120),
  quantity: z.coerce.number().int().positive().max(100).default(1),
  unit_price: z.coerce.number().nonnegative(),
  vat_rate: z.coerce.number().min(0).max(1).default(0.16),
  course_number: z.coerce.number().int().positive().max(10).default(1),
  notes: z.string().max(500).optional(),
  product_id: z.string().uuid().optional(),
  tax_ty_cd: z.enum(['A','B','C','D','E']).optional(),
});

const SendBody = z.object({
  item_ids: z.array(z.string().uuid()).min(1).optional(),
});

const StateTransition = z.object({
  to: z.enum(['paid', 'voided']),
});

async function loadTicketOrFail(tenant_id: string, id: string) {
  const { rows } = await pool.query(
    `SELECT id, tenant_id, table_id, status, subtotal, vat_amount, total,
            notes, created_by, opened_at, closed_at
     FROM tickets WHERE id = $1 AND tenant_id = $2`,
    [id, tenant_id],
  );
  if (rows.length === 0) return null;
  return rows[0];
}

export async function ticketsRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: [requireAuth, requireTenant] }, async (req) => {
    const { tenant_id } = (req as unknown as { auth: AuthClaims }).auth;
    const { rows } = await pool.query(
      `SELECT id, table_id, status, subtotal, vat_amount, total, opened_at
       FROM tickets WHERE tenant_id = $1 ORDER BY opened_at DESC LIMIT 100`,
      [tenant_id],
    );
    return { tickets: rows };
  });

  app.get('/:id', { preHandler: [requireAuth, requireTenant] }, async (req, reply) => {
    const { tenant_id } = (req as unknown as { auth: AuthClaims }).auth;
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const ticket = await loadTicketOrFail(tenant_id, id);
    if (!ticket) return reply.code(404).send({ error: 'not_found' });
    const items = await pool.query(
      `SELECT id, name, quantity, unit_price, line_total, vat_rate,
              sent_to_kitchen, course_number, notes
       FROM ticket_items WHERE ticket_id = $1 AND tenant_id = $2
       ORDER BY course_number, created_at`,
      [id, tenant_id],
    );
    return { ticket, items: items.rows };
  });

  app.post('/', { preHandler: [requireAuth, requireTenant] }, async (req, reply) => {
    const { tenant_id, sub: user_id } = (req as unknown as { auth: AuthClaims }).auth;
    const body = OpenBody.parse(req.body ?? {});
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO tickets (tenant_id, table_id, notes, created_by)
         VALUES ($1, $2, $3, $4)
         RETURNING id, status, total, opened_at`,
        [tenant_id, body.table_id ?? null, body.notes ?? null, user_id],
      );
      if (body.table_id) {
        await client.query(
          `UPDATE restaurant_tables SET status = 'occupied'
           WHERE id = $1 AND tenant_id = $2 AND status = 'free'`,
          [body.table_id, tenant_id],
        );
      }
      await client.query('COMMIT');
      return reply.code(201).send(rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  app.post('/:id/items', { preHandler: [requireAuth, requireTenant] }, async (req, reply) => {
    const { tenant_id } = (req as unknown as { auth: AuthClaims }).auth;
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = AddItemBody.parse(req.body);
    const ticket = await loadTicketOrFail(tenant_id, id);
    if (!ticket) return reply.code(404).send({ error: 'not_found' });
    if (ticket.status !== 'open' && ticket.status !== 'sent_to_kitchen') {
      return reply.code(409).send({ error: 'ticket_not_open' });
    }
    const line_total = Number((body.quantity * body.unit_price).toFixed(2));
    const vat = Number((line_total * body.vat_rate).toFixed(2));
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      let productTaxCd: TaxTyCd | null = null;
      if (body.product_id) {
        const prodRes = await client.query<{ tax_ty_cd: TaxTyCd }>(
          `SELECT tax_ty_cd FROM products WHERE id = $1 AND tenant_id = $2`,
          [body.product_id, tenant_id],
        );
        if (prodRes.rows.length > 0) productTaxCd = prodRes.rows[0].tax_ty_cd;
      }
      const resolvedTaxTyCd = resolveTaxTyCd(body.tax_ty_cd, productTaxCd);

      const { rows } = await client.query(
        `INSERT INTO ticket_items
           (ticket_id, tenant_id, product_id, name, quantity, unit_price, line_total, vat_rate, course_number, notes, tax_ty_cd)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id, name, quantity, unit_price, line_total, vat_rate, sent_to_kitchen, course_number, tax_ty_cd`,
        [id, tenant_id, body.product_id ?? null, body.name, body.quantity, body.unit_price, line_total, body.vat_rate, body.course_number, body.notes ?? null, resolvedTaxTyCd],
      );

      // Deduct stock per recipe if product_id provided (never blocks the sale)
      if (body.product_id) {
        const recipeRes = await client.query<{ stock_item_id: string; quantity_per_product: string }>(
          `SELECT stock_item_id, quantity_per_product FROM recipes
           WHERE tenant_id = $1 AND product_id = $2`,
          [tenant_id, body.product_id],
        );
        const newItemId = (rows[0] as { id: string }).id;
        for (const r of recipeRes.rows) {
          const delta = Number((-1 * Number(r.quantity_per_product) * body.quantity).toFixed(3));
          await client.query(
            `UPDATE stock_items SET quantity = quantity + $1
             WHERE id = $2 AND tenant_id = $3`,
            [delta, r.stock_item_id, tenant_id],
          );
          await client.query(
            `INSERT INTO stock_movements (tenant_id, stock_item_id, delta, reason, ref_id)
             VALUES ($1, $2, $3, 'deduction', $4)`,
            [tenant_id, r.stock_item_id, delta, newItemId],
          );
        }
      }
      await client.query(
        `UPDATE tickets
         SET subtotal = subtotal + $1,
             vat_amount = vat_amount + $2,
             total = total + $1 + $2
         WHERE id = $3 AND tenant_id = $4`,
        [line_total, vat, id, tenant_id],
      );
      await client.query('COMMIT');
      return reply.code(201).send(rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  app.post('/:id/send', { preHandler: [requireAuth, requireTenant] }, async (req, reply) => {
    const { tenant_id } = (req as unknown as { auth: AuthClaims }).auth;
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = SendBody.parse(req.body ?? {});
    const ticket = await loadTicketOrFail(tenant_id, id);
    if (!ticket) return reply.code(404).send({ error: 'not_found' });
    if (ticket.status === 'paid' || ticket.status === 'voided') {
      return reply.code(409).send({ error: 'ticket_closed' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const whereClause = body.item_ids ? `AND id = ANY($3::uuid[])` : ``;
      const params: unknown[] = body.item_ids
        ? [id, tenant_id, body.item_ids]
        : [id, tenant_id];
      const { rowCount } = await client.query(
        `UPDATE ticket_items
         SET sent_to_kitchen = TRUE
         WHERE ticket_id = $1 AND tenant_id = $2 AND sent_to_kitchen = FALSE ${whereClause}`,
        params,
      );
      await client.query(
        `UPDATE tickets SET status = 'sent_to_kitchen'
         WHERE id = $1 AND tenant_id = $2 AND status = 'open'`,
        [id, tenant_id],
      );
      await client.query('COMMIT');
      return { sent: rowCount, ticket_status: 'sent_to_kitchen' };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  app.post('/:id/state', { preHandler: [requireAuth, requireTenant] }, async (req, reply) => {
    const { tenant_id } = (req as unknown as { auth: AuthClaims }).auth;
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = StateTransition.parse(req.body);
    const ticket = await loadTicketOrFail(tenant_id, id);
    if (!ticket) return reply.code(404).send({ error: 'not_found' });

    const allowed: Record<string, string[]> = {
      paid: ['open', 'sent_to_kitchen'],
      voided: ['open', 'sent_to_kitchen'],
    };
    if (!allowed[body.to]?.includes(ticket.status)) {
      return reply.code(409).send({ error: 'invalid_transition', from: ticket.status, to: body.to });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE tickets SET status = $1, closed_at = NOW()
         WHERE id = $2 AND tenant_id = $3`,
        [body.to, id, tenant_id],
      );
      if (ticket.table_id) {
        await client.query(
          `UPDATE restaurant_tables SET status = 'free'
           WHERE id = $1 AND tenant_id = $2`,
          [ticket.table_id, tenant_id],
        );
      }
      await client.query('COMMIT');
      return { ok: true, status: body.to };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });
}
