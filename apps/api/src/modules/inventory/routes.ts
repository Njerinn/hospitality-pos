import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { requireAuth, requireTenant, type AuthClaims } from '../../plugins/auth.js';

const CreateProduct = z.object({
  name: z.string().min(1).max(120),
  category: z.string().max(50).optional(),
  price: z.coerce.number().nonnegative(),
  tax_ty_cd: z.enum(['A','B','C','D','E']).optional(),
});

const CreateStock = z.object({
  name: z.string().min(1).max(120),
  unit: z.string().min(1).max(20),
  quantity: z.coerce.number().nonnegative().default(0),
  reorder_point: z.coerce.number().nonnegative().default(0),
  cost_per_unit: z.coerce.number().nonnegative().default(0),
});

const Restock = z.object({
  delta: z.coerce.number().positive(),
  reason: z.enum(['restock', 'adjustment']).default('restock'),
});

const CreateRecipe = z.object({
  product_id: z.string().uuid(),
  stock_item_id: z.string().uuid(),
  quantity_per_product: z.coerce.number().positive(),
});

const UpdateProduct = z.object({
  name: z.string().min(1).max(120).optional(),
  category: z.string().max(50).nullable().optional(),
  price: z.coerce.number().nonnegative().optional(),
  tax_ty_cd: z.enum(['A','B','C','D','E']).optional(),
});

const ToggleActive = z.object({
  active: z.boolean(),
});

export async function inventoryRoutes(app: FastifyInstance) {
  app.get('/products', { preHandler: [requireAuth, requireTenant] }, async (req) => {
    const { tenant_id } = (req as unknown as { auth: AuthClaims }).auth;
    const { rows } = await pool.query(
      `SELECT id, name, category, price, active, tax_ty_cd FROM products
       WHERE tenant_id = $1 ORDER BY name`,
      [tenant_id],
    );
    return { products: rows };
  });

  app.post('/products', { preHandler: [requireAuth, requireTenant] }, async (req, reply) => {
    const { tenant_id } = (req as unknown as { auth: AuthClaims }).auth;
    const body = CreateProduct.parse(req.body);
    try {
      const { rows } = await pool.query(
        `INSERT INTO products (tenant_id, name, category, price, tax_ty_cd)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, name, category, price, active, tax_ty_cd`,
        [tenant_id, body.name, body.category ?? null, body.price, body.tax_ty_cd ?? 'B'],
      );
      return reply.code(201).send(rows[0]);
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        return reply.code(409).send({ error: 'product_name_exists' });
      }
      throw err;
    }
  });

  app.get('/stock', { preHandler: [requireAuth, requireTenant] }, async (req) => {
    const { tenant_id } = (req as unknown as { auth: AuthClaims }).auth;
    const { rows } = await pool.query(
      `SELECT id, name, unit, quantity, reorder_point, cost_per_unit,
              (quantity <= reorder_point) AS is_low
       FROM stock_items WHERE tenant_id = $1 ORDER BY name`,
      [tenant_id],
    );
    return { items: rows };
  });

  app.get('/stock/low', { preHandler: [requireAuth, requireTenant] }, async (req) => {
    const { tenant_id } = (req as unknown as { auth: AuthClaims }).auth;
    const { rows } = await pool.query(
      `SELECT id, name, unit, quantity, reorder_point
       FROM stock_items
       WHERE tenant_id = $1 AND quantity <= reorder_point
       ORDER BY (quantity - reorder_point) ASC`,
      [tenant_id],
    );
    return { items: rows };
  });

  app.post('/stock', { preHandler: [requireAuth, requireTenant] }, async (req, reply) => {
    const { tenant_id } = (req as unknown as { auth: AuthClaims }).auth;
    const body = CreateStock.parse(req.body);
    try {
      const { rows } = await pool.query(
        `INSERT INTO stock_items (tenant_id, name, unit, quantity, reorder_point, cost_per_unit)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, name, unit, quantity, reorder_point, cost_per_unit`,
        [tenant_id, body.name, body.unit, body.quantity, body.reorder_point, body.cost_per_unit],
      );
      return reply.code(201).send(rows[0]);
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        return reply.code(409).send({ error: 'stock_name_exists' });
      }
      throw err;
    }
  });

  app.post('/stock/:id/restock', { preHandler: [requireAuth, requireTenant] }, async (req, reply) => {
    const { tenant_id } = (req as unknown as { auth: AuthClaims }).auth;
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = Restock.parse(req.body);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const upd = await client.query<{ id: string; quantity: string }>(
        `UPDATE stock_items SET quantity = quantity + $1
         WHERE id = $2 AND tenant_id = $3
         RETURNING id, quantity`,
        [body.delta, id, tenant_id],
      );
      if (upd.rows.length === 0) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'stock_item_not_found' });
      }
      await client.query(
        `INSERT INTO stock_movements (tenant_id, stock_item_id, delta, reason)
         VALUES ($1, $2, $3, $4)`,
        [tenant_id, id, body.delta, body.reason],
      );
      await client.query('COMMIT');
      return { ok: true, item: upd.rows[0] };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  app.get('/stock/:id/movements', { preHandler: [requireAuth, requireTenant] }, async (req) => {
    const { tenant_id } = (req as unknown as { auth: AuthClaims }).auth;
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { rows } = await pool.query(
      `SELECT id, delta, reason, ref_id, created_at
       FROM stock_movements
       WHERE tenant_id = $1 AND stock_item_id = $2
       ORDER BY created_at DESC LIMIT 50`,
      [tenant_id, id],
    );
    return { movements: rows };
  });

  app.get('/recipes', { preHandler: [requireAuth, requireTenant] }, async (req) => {
    const { tenant_id } = (req as unknown as { auth: AuthClaims }).auth;
    const { rows } = await pool.query(
      `SELECT r.id, r.product_id, p.name AS product_name,
              r.stock_item_id, s.name AS stock_name, s.unit,
              r.quantity_per_product
       FROM recipes r
       JOIN products p ON p.id = r.product_id
       JOIN stock_items s ON s.id = r.stock_item_id
       WHERE r.tenant_id = $1
       ORDER BY p.name, s.name`,
      [tenant_id],
    );
    return { recipes: rows };
  });

  app.post('/recipes', { preHandler: [requireAuth, requireTenant] }, async (req, reply) => {
    const { tenant_id } = (req as unknown as { auth: AuthClaims }).auth;
    const body = CreateRecipe.parse(req.body);
    try {
      const { rows } = await pool.query(
        `INSERT INTO recipes (tenant_id, product_id, stock_item_id, quantity_per_product)
         VALUES ($1, $2, $3, $4)
         RETURNING id, product_id, stock_item_id, quantity_per_product`,
        [tenant_id, body.product_id, body.stock_item_id, body.quantity_per_product],
      );
      return reply.code(201).send(rows[0]);
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        return reply.code(409).send({ error: 'recipe_exists' });
      }
      throw err;
    }
  });

  app.patch('/products/:id', { preHandler: [requireAuth, requireTenant] }, async (req, reply) => {
    const { tenant_id } = (req as unknown as { auth: AuthClaims }).auth;
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = UpdateProduct.parse(req.body);

    const updates: string[] = [];
    const values: unknown[] = [id, tenant_id];
    if (body.name !== undefined) { updates.push('name = $' + (values.length + 1)); values.push(body.name); }
    if (body.category !== undefined) { updates.push('category = $' + (values.length + 1)); values.push(body.category); }
    if (body.price !== undefined) { updates.push('price = $' + (values.length + 1)); values.push(body.price); }

    if (updates.length === 0) {
      return reply.code(400).send({ error: 'no_fields_to_update' });
    }

    try {
      const { rows } = await pool.query(
        `UPDATE products SET ${updates.join(', ')}
         WHERE id = $1 AND tenant_id = $2
         RETURNING id, name, category, price, active`,
        values,
      );
      if (rows.length === 0) {
        return reply.code(404).send({ error: 'product_not_found' });
      }
      return rows[0];
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        return reply.code(409).send({ error: 'product_name_exists' });
      }
      throw err;
    }
  });

  app.patch('/products/:id/active', { preHandler: [requireAuth, requireTenant] }, async (req, reply) => {
    const { tenant_id } = (req as unknown as { auth: AuthClaims }).auth;
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = ToggleActive.parse(req.body);

    const { rows } = await pool.query(
      `UPDATE products SET active = $1
       WHERE id = $2 AND tenant_id = $3
       RETURNING id, name, active`,
      [body.active, id, tenant_id],
    );
    if (rows.length === 0) {
      return reply.code(404).send({ error: 'product_not_found' });
    }
    return rows[0];
  });

  app.delete('/recipes/:id', { preHandler: [requireAuth, requireTenant] }, async (req, reply) => {
    const { tenant_id } = (req as unknown as { auth: AuthClaims }).auth;
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { rowCount } = await pool.query(
      `DELETE FROM recipes WHERE id = $1 AND tenant_id = $2`,
      [id, tenant_id],
    );
    if (rowCount === 0) {
      return reply.code(404).send({ error: 'recipe_not_found' });
    }
    return { ok: true, deleted: id };
  });
}
