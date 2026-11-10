import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { requireAuth, requireTenant, type AuthClaims } from '../../plugins/auth.js';

const CreateBody = z.object({
  name: z.string().min(1).max(50),
  capacity: z.coerce.number().int().positive().max(50).default(4),
});

export async function tablesRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: [requireAuth, requireTenant] }, async (req) => {
    const { tenant_id } = (req as unknown as { auth: AuthClaims }).auth;
    const { rows } = await pool.query(
      `SELECT id, name, capacity, status
       FROM restaurant_tables
       WHERE tenant_id = $1
       ORDER BY name`,
      [tenant_id],
    );
    return { tables: rows };
  });

  app.post('/', { preHandler: [requireAuth, requireTenant] }, async (req, reply) => {
    const { tenant_id } = (req as unknown as { auth: AuthClaims }).auth;
    const body = CreateBody.parse(req.body);
    try {
      const { rows } = await pool.query(
        `INSERT INTO restaurant_tables (tenant_id, name, capacity)
         VALUES ($1, $2, $3)
         RETURNING id, name, capacity, status`,
        [tenant_id, body.name, body.capacity],
      );
      return reply.code(201).send(rows[0]);
    } catch (err: unknown) {
      if ((err as { code?: string }).code === '23505') {
        return reply.code(409).send({ error: 'table_name_exists' });
      }
      throw err;
    }
  });
}
