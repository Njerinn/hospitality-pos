import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { requireAuth, requireTenant, type AuthClaims } from '../../plugins/auth.js';

const CreateSale = z.object({
  product_id: z.string().uuid(),
  quantity: z.coerce.number().int().positive(),
  notes: z.string().max(500).optional(),
});

interface RecipeRow {
  stock_item_id: string;
  quantity_per_product: string;
  stock_name: string;
  unit: string;
}

export async function bbqRoutes(app: FastifyInstance) {
  app.get('/products', { preHandler: [requireAuth, requireTenant] }, async (req) => {
    const { tenant_id } = (req as unknown as { auth: AuthClaims }).auth;
    const { rows } = await pool.query(
      `SELECT id, name, category, price::text AS price, active, tax_ty_cd
       FROM products
       WHERE tenant_id = $1 AND outlet = 'bbq' AND active = TRUE
       ORDER BY name`,
      [tenant_id],
    );
    return { products: rows };
  });

  app.get('/sales', { preHandler: [requireAuth, requireTenant] }, async (req) => {
    const { tenant_id } = (req as unknown as { auth: AuthClaims }).auth;
    const { rows } = await pool.query(
      `SELECT bs.id, bs.product_id, p.name AS product_name,
              bs.quantity,
              bs.unit_price::text AS unit_price,
              bs.total_amount::text AS total_amount,
              bs.notes,
              bs.recipe_deducted,
              bs.sold_by,
              bs.created_at,
              u.email AS sold_by_email
       FROM bbq_sales bs
       JOIN products p ON p.id = bs.product_id
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

      const prod = await client.query<{
        id: string;
        name: string;
        price: string;
        outlet: string;
        active: boolean;
      }>(
        `SELECT id, name, price::text AS price, outlet, active
         FROM products WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        [body.product_id, tenant_id],
      );
      if (prod.rows.length === 0) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'product_not_found' });
      }
      const product = prod.rows[0];

      if (product.outlet !== 'bbq') {
        await client.query('ROLLBACK');
        return reply.code(400).send({
          error: 'product_not_bbq_outlet',
          actual_outlet: product.outlet,
          hint: 'Set product outlet to "bbq" on the Menu page first.',
        });
      }
      if (!product.active) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'product_inactive' });
      }

      const unitPrice = Number(product.price);
      const totalAmount = Number((unitPrice * body.quantity).toFixed(2));

      const sale = await client.query<{ id: string; total_amount: string }>(
        `INSERT INTO bbq_sales
           (tenant_id, product_id, quantity, unit_price, total_amount, sold_by, notes, recipe_deducted)
         VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE)
         RETURNING id, total_amount::text AS total_amount`,
        [tenant_id, body.product_id, body.quantity, unitPrice, totalAmount, user_id, body.notes ?? null],
      );
      const saleId = sale.rows[0].id;

      const recipes = await client.query<RecipeRow>(
        `SELECT r.stock_item_id, r.quantity_per_product::text AS quantity_per_product,
                s.name AS stock_name, s.unit
         FROM recipes r
         JOIN stock_items s ON s.id = r.stock_item_id
         WHERE r.product_id = $1 AND r.tenant_id = $2`,
        [body.product_id, tenant_id],
      );
      const recipeCount = recipes.rows.length;

      const warnings: string[] = [];

      for (const rec of recipes.rows) {
        const needed = Number(rec.quantity_per_product) * body.quantity;

        const availRes = await client.query<{ qty: string }>(
          `SELECT COALESCE(SUM(delta), 0)::text AS qty
           FROM stock_movements
           WHERE tenant_id = $1 AND stock_item_id = $2 AND outlet = 'bbq'`,
          [tenant_id, rec.stock_item_id],
        );
        const available = Number(availRes.rows[0].qty);

        if (available < needed) {
          await client.query('ROLLBACK');
          return reply.code(409).send({
            error: 'insufficient_bbq_ingredient',
            stock_item_id: rec.stock_item_id,
            stock_name: rec.stock_name,
            unit: rec.unit,
            available,
            needed,
          });
        }

        await client.query(
          `UPDATE stock_items SET quantity = quantity - $1
           WHERE id = $2 AND tenant_id = $3`,
          [needed, rec.stock_item_id, tenant_id],
        );
        await client.query(
          `INSERT INTO stock_movements (tenant_id, stock_item_id, delta, reason, outlet, ref_id)
           VALUES ($1, $2, $3, 'consumption', 'bbq', $4)`,
          [tenant_id, rec.stock_item_id, -needed, saleId],
        );
      }

      if (recipeCount === 0) {
        warnings.push('no_recipe_configured');
      } else {
        await client.query(
          `UPDATE bbq_sales SET recipe_deducted = TRUE WHERE id = $1`,
          [saleId],
        );
      }

      await client.query('COMMIT');
      return reply.code(201).send({
        ok: true,
        sale: {
          id: saleId,
          product_id: body.product_id,
          product_name: product.name,
          quantity: body.quantity,
          unit_price: unitPrice.toFixed(2),
          total_amount: sale.rows[0].total_amount,
          recipe_deducted: recipeCount > 0,
        },
        warnings: warnings.length > 0 ? warnings : undefined,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });
}
