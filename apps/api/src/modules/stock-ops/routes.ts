import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { pool } from '../../db/pool.js';
import { requireAuth, requireTenant, type AuthClaims } from '../../plugins/auth.js';

const OutletEnum = z.enum(['storage', 'kitchen', 'bbq', 'butchery']);

const ConsumeBody = z.object({
  stock_item_id: z.string().uuid(),
  quantity: z.coerce.number().positive(),
  outlet: OutletEnum,
  ref_id: z.string().uuid().optional(),
});

const ForwardBody = z.object({
  stock_item_id: z.string().uuid(),
  quantity: z.coerce.number().positive(),
  from_outlet: OutletEnum,
  to_outlet: OutletEnum,
});

async function getOutletQty(
  client: { query: (q: string, p: unknown[]) => Promise<{ rows: { qty: string }[] }> },
  tenant_id: string,
  stock_item_id: string,
  outlet: string,
): Promise<number> {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(delta), 0)::text AS qty
     FROM stock_movements
     WHERE tenant_id = $1 AND stock_item_id = $2
       AND (outlet = $3 OR ($3 = 'storage' AND outlet IS NULL))`,
    [tenant_id, stock_item_id, outlet],
  );
  return Number(rows[0].qty);
}

export async function stockOpsRoutes(app: FastifyInstance) {
  app.get('/outlet/:outletName', { preHandler: [requireAuth, requireTenant] }, async (req, reply) => {
    const { tenant_id } = (req as unknown as { auth: AuthClaims }).auth;
    const { outletName } = z.object({ outletName: OutletEnum }).parse(req.params);

    const { rows } = await pool.query(
      `SELECT si.id, si.name, si.unit,
              COALESCE(SUM(CASE
                WHEN sm.outlet = $2 OR ($2 = 'storage' AND sm.outlet IS NULL)
                THEN sm.delta ELSE 0 END), 0)::text AS outlet_qty,
              si.quantity::text AS total_qty
       FROM stock_items si
       LEFT JOIN stock_movements sm ON sm.stock_item_id = si.id AND sm.tenant_id = si.tenant_id
       WHERE si.tenant_id = $1
       GROUP BY si.id, si.name, si.unit, si.quantity
       HAVING COALESCE(SUM(CASE
         WHEN sm.outlet = $2 OR ($2 = 'storage' AND sm.outlet IS NULL)
         THEN sm.delta ELSE 0 END), 0) != 0
       ORDER BY si.name`,
      [tenant_id, outletName],
    );
    return { outlet: outletName, items: rows };
  });

  app.get('/breakdown/:stockItemId', { preHandler: [requireAuth, requireTenant] }, async (req, reply) => {
    const { tenant_id } = (req as unknown as { auth: AuthClaims }).auth;
    const { stockItemId } = z.object({ stockItemId: z.string().uuid() }).parse(req.params);

    const { rows: itemRows } = await pool.query<{ name: string; unit: string; quantity: string }>(
      `SELECT name, unit, quantity::text AS quantity
       FROM stock_items WHERE id = $1 AND tenant_id = $2`,
      [stockItemId, tenant_id],
    );
    if (itemRows.length === 0) {
      return reply.code(404).send({ error: 'stock_item_not_found' });
    }

    const { rows: outletRows } = await pool.query<{ outlet: string; qty: string }>(
      `SELECT COALESCE(outlet, 'storage') AS outlet, COALESCE(SUM(delta), 0)::text AS qty
       FROM stock_movements
       WHERE tenant_id = $1 AND stock_item_id = $2
       GROUP BY COALESCE(outlet, 'storage')
       ORDER BY outlet`,
      [tenant_id, stockItemId],
    );

    return { item: itemRows[0], outlets: outletRows };
  });

  app.post('/consume', { preHandler: [requireAuth, requireTenant] }, async (req, reply) => {
    const { tenant_id, sub: user_id } = (req as unknown as { auth: AuthClaims }).auth;
    const body = ConsumeBody.parse(req.body);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const available = await getOutletQty(client, tenant_id, body.stock_item_id, body.outlet);
      if (available < body.quantity) {
        await client.query('ROLLBACK');
        return reply.code(409).send({
          error: 'insufficient_outlet_stock',
          outlet: body.outlet,
          available,
          requested: body.quantity,
        });
      }

      const upd = await client.query<{ quantity: string }>(
        `UPDATE stock_items SET quantity = quantity - $1
         WHERE id = $2 AND tenant_id = $3
         RETURNING quantity::text AS quantity`,
        [body.quantity, body.stock_item_id, tenant_id],
      );
      if (upd.rows.length === 0) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'stock_item_not_found' });
      }

      await client.query(
        `INSERT INTO stock_movements (tenant_id, stock_item_id, delta, reason, outlet, ref_id)
         VALUES ($1, $2, $3, 'consumption', $4, $5)`,
        [tenant_id, body.stock_item_id, -body.quantity, body.outlet, body.ref_id ?? null],
      );

      await client.query('COMMIT');
      return {
        ok: true,
        stock_item_id: body.stock_item_id,
        new_total: upd.rows[0].quantity,
        consumed: body.quantity,
        outlet: body.outlet,
        consumed_by: user_id,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  app.post('/forward', { preHandler: [requireAuth, requireTenant] }, async (req, reply) => {
    const { tenant_id, sub: user_id } = (req as unknown as { auth: AuthClaims }).auth;
    const body = ForwardBody.parse(req.body);

    if (body.from_outlet === body.to_outlet) {
      return reply.code(400).send({ error: 'same_outlet' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const available = await getOutletQty(client, tenant_id, body.stock_item_id, body.from_outlet);
      if (available < body.quantity) {
        await client.query('ROLLBACK');
        return reply.code(409).send({
          error: 'insufficient_source_stock',
          from_outlet: body.from_outlet,
          available,
          requested: body.quantity,
        });
      }

      const transferGroupId = randomUUID();

      await client.query(
        `INSERT INTO stock_movements (tenant_id, stock_item_id, delta, reason, outlet, transfer_group_id, ref_id)
         VALUES ($1, $2, $3, 'transfer_out', $4, $5, $6),
                ($1, $2, $7, 'transfer_in',  $8, $5, $6)`,
        [tenant_id, body.stock_item_id, -body.quantity, body.from_outlet, transferGroupId, user_id, body.quantity, body.to_outlet],
      );

      await client.query('COMMIT');
      return {
        ok: true,
        stock_item_id: body.stock_item_id,
        quantity: body.quantity,
        from_outlet: body.from_outlet,
        to_outlet: body.to_outlet,
        transfer_group_id: transferGroupId,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });
}
