import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { requireAuth, requireTenant, type AuthClaims } from '../../plugins/auth.js';

const CreateSale = z.object({
  stock_item_id: z.string().uuid(),
  weight_g: z.coerce.number().positive(),
  price_per_kg: z.coerce.number().nonnegative(),
  notes: z.string().max(500).optional(),
});

export async function butcheryRoutes(app: FastifyInstance) {
  app.get('/sales', { preHandler: [requireAuth, requireTenant] }, async (req) => {
    const { tenant_id } = (req as unknown as { auth: AuthClaims }).auth;
    const { rows } = await pool.query(
      `SELECT bs.id, bs.stock_item_id, si.name AS stock_name,
              bs.weight_g::text AS weight_g,
              bs.price_per_kg::text AS price_per_kg,
              bs.total_amount::text AS total_amount,
              bs.cost_basis::text AS cost_basis,
              bs.notes,
              bs.sold_by,
              bs.created_at,
              u.email AS sold_by_email
       FROM butchery_sales bs
       JOIN stock_items si ON si.id = bs.stock_item_id
       LEFT JOIN users u ON u.id = bs.sold_by
       WHERE bs.tenant_id = $1
       ORDER BY bs.created_at DESC
       LIMIT 100`,
      [tenant_id],
    );
    return { sales: rows };
  });

  app.post('/sales', { preHandler: [requireAuth, requireTenant] }, async (req, reply) => {
    const { tenant_id, sub: user_id } = (req as unknown as { auth: AuthClaims }).auth;
    const body = CreateSale.parse(req.body);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const si = await client.query<{
        id: string;
        unit: string;
        quantity: string;
        cost_per_unit: string;
      }>(
        `SELECT id, unit, quantity::text AS quantity, cost_per_unit::text AS cost_per_unit
         FROM stock_items WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        [body.stock_item_id, tenant_id],
      );
      if (si.rows.length === 0) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'stock_item_not_found' });
      }
      const item = si.rows[0];

      if (item.unit !== 'g') {
        await client.query('ROLLBACK');
        return reply.code(400).send({
          error: 'unit_must_be_grams',
          actual_unit: item.unit,
          hint: 'Butchery sales require stock items with unit="g". Create a gram-based stock item on the Inventory page.',
        });
      }

      const availableInButchery = await client.query<{ qty: string }>(
        `SELECT COALESCE(SUM(delta), 0)::text AS qty
         FROM stock_movements
         WHERE tenant_id = $1 AND stock_item_id = $2 AND outlet = 'butchery'`,
        [tenant_id, body.stock_item_id],
      );
      const available = Number(availableInButchery.rows[0].qty);

      if (available < body.weight_g) {
        await client.query('ROLLBACK');
        return reply.code(409).send({
          error: 'insufficient_butchery_stock',
          available,
          requested: body.weight_g,
          hint: 'Forward more stock to the butchery outlet from storage first.',
        });
      }

      const totalAmount = Number(((body.weight_g / 1000) * body.price_per_kg).toFixed(2));
      const costBasis = Number((body.weight_g * Number(item.cost_per_unit)).toFixed(2));

      const sale = await client.query<{
        id: string;
        weight_g: string;
        total_amount: string;
      }>(
        `INSERT INTO butchery_sales
           (tenant_id, stock_item_id, weight_g, price_per_kg, total_amount, cost_basis, sold_by, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, weight_g::text AS weight_g, total_amount::text AS total_amount`,
        [tenant_id, body.stock_item_id, body.weight_g, body.price_per_kg, totalAmount, costBasis, user_id, body.notes ?? null],
      );
      const saleId = sale.rows[0].id;

      const upd = await client.query<{ quantity: string }>(
        `UPDATE stock_items SET quantity = quantity - $1
         WHERE id = $2 AND tenant_id = $3
         RETURNING quantity::text AS quantity`,
        [body.weight_g, body.stock_item_id, tenant_id],
      );

      await client.query(
        `INSERT INTO stock_movements (tenant_id, stock_item_id, delta, reason, outlet, ref_id)
         VALUES ($1, $2, $3, 'consumption', 'butchery', $4)`,
        [tenant_id, body.stock_item_id, -body.weight_g, saleId],
      );

      await client.query('COMMIT');
      return reply.code(201).send({
        ok: true,
        sale: {
          id: saleId,
          stock_item_id: body.stock_item_id,
          stock_name: null,
          weight_g: sale.rows[0].weight_g,
          price_per_kg: body.price_per_kg.toFixed(2),
          total_amount: sale.rows[0].total_amount,
          cost_basis: costBasis.toFixed(2),
          new_total_qty: upd.rows[0].quantity,
        },
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });
}
