// Patch 008C: fire-and-forget eTIMS queue insertion on payment success.
// Never throws, never blocks the caller. If the INSERT fails, only a warning
// is logged — the payment close has already committed.
import type { FastifyInstance } from 'fastify';
import { pool } from '../../db/pool.js';

type QueryResult = { rows: unknown[]; rowCount: number | null };
type Queryable = {
  query: (sql: string, params?: unknown[]) => Promise<QueryResult>;
};

export async function enqueueEtimsSubmission(
  app: FastifyInstance,
  ticketId: string,
  tenantId: string,
  opts: { db?: Queryable } = {},
): Promise<void> {
  const db = opts.db ?? pool;
  try {
    // Skip silently if the tenant has not enabled eTIMS.
    const tenant = (await db.query(
      `SELECT etims_enabled FROM tenants WHERE id = $1`,
      [tenantId],
    )) as { rows: Array<{ etims_enabled: boolean }> };
    if (!tenant.rows[0]?.etims_enabled) return;

    await db.query(
      `INSERT INTO etims_invoice_queue (tenant_id, ticket_id, status)
       VALUES ($1, $2, 'pending')
       ON CONFLICT (ticket_id) DO NOTHING`,
      [tenantId, ticketId],
    );
  } catch (err) {
    app.log.warn({ err, ticketId, tenantId }, 'etims enqueue failed');
  }
}
