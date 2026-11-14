import { FastifyInstance } from 'fastify';
import { pool } from '../../db/pool.js';
import { requireAuth, requireTenant, type AuthClaims } from '../../plugins/auth.js';
import { z } from 'zod';

export async function adminRoutes(app: FastifyInstance) {
  app.get('/backup', { preHandler: [requireAuth, requireTenant] }, async (req, reply) => {
    const { tenant_id } = (req as unknown as { auth: AuthClaims }).auth;

    const [tenant, users, tables, tickets, ticketItems, mpesa, products, stockItems, recipes, stockMovements] =
      await Promise.all([
        pool.query('SELECT * FROM tenants WHERE id = $1', [tenant_id]),
        pool.query('SELECT id, email, role, created_at FROM users WHERE tenant_id = $1', [tenant_id]),
        pool.query('SELECT * FROM restaurant_tables WHERE tenant_id = $1', [tenant_id]),
        pool.query('SELECT * FROM tickets WHERE tenant_id = $1 ORDER BY opened_at', [tenant_id]),
        pool.query('SELECT * FROM ticket_items WHERE tenant_id = $1 ORDER BY created_at', [tenant_id]),
        pool.query('SELECT * FROM mpesa_transactions WHERE tenant_id = $1 ORDER BY created_at', [tenant_id]),
        pool.query('SELECT * FROM products WHERE tenant_id = $1 ORDER BY name', [tenant_id]),
        pool.query('SELECT * FROM stock_items WHERE tenant_id = $1 ORDER BY name', [tenant_id]),
        pool.query('SELECT * FROM recipes WHERE tenant_id = $1', [tenant_id]),
        pool.query('SELECT * FROM stock_movements WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 10000', [tenant_id]),
      ]);

    const backup = {
      version: 1,
      generated_at: new Date().toISOString(),
      tenant_id,
      counts: {
        tenants: tenant.rowCount,
        users: users.rowCount,
        restaurant_tables: tables.rowCount,
        tickets: tickets.rowCount,
        ticket_items: ticketItems.rowCount,
        mpesa_transactions: mpesa.rowCount,
        products: products.rowCount,
        stock_items: stockItems.rowCount,
        recipes: recipes.rowCount,
        stock_movements: stockMovements.rowCount,
      },
      data: {
        tenants: tenant.rows,
        users: users.rows,
        restaurant_tables: tables.rows,
        tickets: tickets.rows,
        ticket_items: ticketItems.rows,
        mpesa_transactions: mpesa.rows,
        products: products.rows,
        stock_items: stockItems.rows,
        recipes: recipes.rows,
        stock_movements: stockMovements.rows,
      },
    };

    const filename = `backup-${tenant_id.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.json`;
    return reply
      .header('Content-Type', 'application/json')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(backup);
  });

  app.get('/tenant/config', { preHandler: [requireAuth, requireTenant] }, async (req) => {
    const { tenant_id } = (req as unknown as { auth: AuthClaims }).auth;
    const { rows } = await pool.query(
      `SELECT id, name, till_number, vat_registered, vat_inclusive,
              etims_enabled, etims_mode, business_structure,
              kra_pin, kra_pin_type, paybill_number, mpesa_fixed_account
       FROM tenants WHERE id = $1`,
      [tenant_id],
    );
    if (rows.length === 0) return { error: 'tenant_not_found' };
    return { tenant: rows[0] };
  });

  const UpdateTenantConfig = z.object({
    vat_inclusive: z.boolean().optional(),
  });

  app.patch('/tenant/config', { preHandler: [requireAuth, requireTenant] }, async (req, reply) => {
    const { tenant_id } = (req as unknown as { auth: AuthClaims }).auth;
    const body = UpdateTenantConfig.parse(req.body);
    if (body.vat_inclusive === undefined) {
      return reply.code(400).send({ error: 'no_fields_to_update' });
    }
    const { rows } = await pool.query(
      `UPDATE tenants SET vat_inclusive = $1
       WHERE id = $2
       RETURNING id, name, vat_inclusive`,
      [body.vat_inclusive, tenant_id],
    );
    if (rows.length === 0) return reply.code(404).send({ error: 'tenant_not_found' });
    return rows[0];
  });
}
