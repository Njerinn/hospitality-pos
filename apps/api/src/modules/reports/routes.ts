import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { requireAuth, requireTenant, type AuthClaims } from '../../plugins/auth.js';
import { fetchReportData, generateStatementPdf } from './pdf-generator.js';

const DateRange = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

function parseRange(q: unknown): { from: string; to: string } {
  const { from, to } = DateRange.parse(q);
  return { from, to };
}

export async function reportsRoutes(app: FastifyInstance) {
  // Summary: total revenue, tickets, avg ticket, VAT, gross profit
  app.get('/summary', { preHandler: [requireAuth, requireTenant] }, async (req) => {
    const { tenant_id } = (req as unknown as { auth: AuthClaims }).auth;
    const { from, to } = parseRange(req.query);

    const sales = await pool.query<{
      revenue: string;
      vat: string;
      ticket_count: string;
    }>(
      `SELECT
         COALESCE(SUM(total), 0)::text AS revenue,
         COALESCE(SUM(vat_amount), 0)::text AS vat,
         COUNT(*)::text AS ticket_count
       FROM tickets
       WHERE tenant_id = $1
         AND status = 'paid'
         AND closed_at >= $2::date
         AND closed_at < ($3::date + INTERVAL '1 day')`,
      [tenant_id, from, to],
    );

    const cost = await pool.query<{ stock_cost: string }>(
      `SELECT COALESCE(SUM(ABS(m.delta) * s.cost_per_unit), 0)::text AS stock_cost
       FROM stock_movements m
       JOIN stock_items s ON s.id = m.stock_item_id
       WHERE m.tenant_id = $1
         AND m.reason = 'deduction'
         AND m.created_at >= $2::date
         AND m.created_at < ($3::date + INTERVAL '1 day')`,
      [tenant_id, from, to],
    );

    const rev = Number(sales.rows[0].revenue);
    const vat = Number(sales.rows[0].vat);
    const tickets = Number(sales.rows[0].ticket_count);
    const stockCost = Number(cost.rows[0].stock_cost);
    const avgTicket = tickets > 0 ? rev / tickets : 0;
    const grossProfit = rev - vat - stockCost;

    return {
      from,
      to,
      revenue: rev.toFixed(2),
      tickets,
      average_ticket: avgTicket.toFixed(2),
      vat_collected: vat.toFixed(2),
      stock_cost: stockCost.toFixed(2),
      gross_profit: grossProfit.toFixed(2),
    };
  });

  // Sales grouped by day
  app.get('/sales-by-day', { preHandler: [requireAuth, requireTenant] }, async (req) => {
    const { tenant_id } = (req as unknown as { auth: AuthClaims }).auth;
    const { from, to } = parseRange(req.query);
    const { rows } = await pool.query<{ day: string; revenue: string; tickets: string }>(
      `SELECT
         to_char(date_trunc('day', closed_at), 'YYYY-MM-DD') AS day,
         COALESCE(SUM(total), 0)::text AS revenue,
         COUNT(*)::text AS tickets
       FROM tickets
       WHERE tenant_id = $1
         AND status = 'paid'
         AND closed_at >= $2::date
         AND closed_at < ($3::date + INTERVAL '1 day')
       GROUP BY 1
       ORDER BY 1`,
      [tenant_id, from, to],
    );
    return { from, to, days: rows.map((r) => ({
      day: r.day, revenue: r.revenue, tickets: Number(r.tickets),
    })) };
  });

  // Sales grouped by hour of day (0-23)
  app.get('/sales-by-hour', { preHandler: [requireAuth, requireTenant] }, async (req) => {
    const { tenant_id } = (req as unknown as { auth: AuthClaims }).auth;
    const { from, to } = parseRange(req.query);
    const { rows } = await pool.query<{ hour: number; revenue: string; tickets: string }>(
      `SELECT
         EXTRACT(HOUR FROM closed_at)::int AS hour,
         COALESCE(SUM(total), 0)::text AS revenue,
         COUNT(*)::text AS tickets
       FROM tickets
       WHERE tenant_id = $1
         AND status = 'paid'
         AND closed_at >= $2::date
         AND closed_at < ($3::date + INTERVAL '1 day')
       GROUP BY 1
       ORDER BY 1`,
      [tenant_id, from, to],
    );
    return { from, to, hours: rows.map((r) => ({
      hour: r.hour, revenue: r.revenue, tickets: Number(r.tickets),
    })) };
  });

  // Top items by revenue and by quantity
  app.get('/top-items', { preHandler: [requireAuth, requireTenant] }, async (req) => {
    const { tenant_id } = (req as unknown as { auth: AuthClaims }).auth;
    const { from, to } = parseRange(req.query);
    const { rows } = await pool.query<{
      name: string;
      quantity: string;
      revenue: string;
      ticket_count: string;
    }>(
      `SELECT
         ti.name,
         SUM(ti.quantity)::text AS quantity,
         COALESCE(SUM(ti.line_total), 0)::text AS revenue,
         COUNT(DISTINCT ti.ticket_id)::text AS ticket_count
       FROM ticket_items ti
       JOIN tickets t ON t.id = ti.ticket_id
       WHERE ti.tenant_id = $1
         AND t.status = 'paid'
         AND t.closed_at >= $2::date
         AND t.closed_at < ($3::date + INTERVAL '1 day')
       GROUP BY ti.name
       ORDER BY COALESCE(SUM(ti.line_total), 0) DESC
       LIMIT 20`,
      [tenant_id, from, to],
    );
    return { from, to, items: rows.map((r) => ({
      name: r.name,
      quantity: Number(r.quantity),
      revenue: r.revenue,
      ticket_count: Number(r.ticket_count),
    })) };
  });

  // VAT summary
  app.get('/vat', { preHandler: [requireAuth, requireTenant] }, async (req) => {
    const { tenant_id } = (req as unknown as { auth: AuthClaims }).auth;
    const { from, to } = parseRange(req.query);
    const { rows } = await pool.query<{
      subtotal: string;
      vat: string;
      total: string;
      count: string;
    }>(
      `SELECT
         COALESCE(SUM(subtotal), 0)::text AS subtotal,
         COALESCE(SUM(vat_amount), 0)::text AS vat,
         COALESCE(SUM(total), 0)::text AS total,
         COUNT(*)::text AS count
       FROM tickets
       WHERE tenant_id = $1
         AND status = 'paid'
         AND closed_at >= $2::date
         AND closed_at < ($3::date + INTERVAL '1 day')`,
      [tenant_id, from, to],
    );
    const r = rows[0];
    return {
      from,
      to,
      net_sales: r.subtotal,
      vat_collected: r.vat,
      gross_sales: r.total,
      transaction_count: Number(r.count),
      rate: '16%',
    };
  });

  // Payment method breakdown (M-Pesa vs other based on mpesa_transactions linkage)
  app.get('/payments', { preHandler: [requireAuth, requireTenant] }, async (req) => {
    const { tenant_id } = (req as unknown as { auth: AuthClaims }).auth;
    const { from, to } = parseRange(req.query);

    const mpesa = await pool.query<{ count: string; amount: string }>(
      `SELECT COUNT(*)::text AS count, COALESCE(SUM(amount), 0)::text AS amount
       FROM mpesa_transactions
       WHERE tenant_id = $1
         AND status = 'LINKED'
         AND created_at >= $2::date
         AND created_at < ($3::date + INTERVAL '1 day')`,
      [tenant_id, from, to],
    );
    const total = await pool.query<{ count: string; amount: string }>(
      `SELECT COUNT(*)::text AS count, COALESCE(SUM(total), 0)::text AS amount
       FROM tickets
       WHERE tenant_id = $1
         AND status = 'paid'
         AND closed_at >= $2::date
         AND closed_at < ($3::date + INTERVAL '1 day')`,
      [tenant_id, from, to],
    );

    const mpesaAmount = Number(mpesa.rows[0].amount);
    const mpesaCount = Number(mpesa.rows[0].count);
    const totalAmount = Number(total.rows[0].amount);
    const totalCount = Number(total.rows[0].count);
    const otherAmount = totalAmount - mpesaAmount;
    const otherCount = totalCount - mpesaCount;

    return {
      from,
      to,
      mpesa: { count: mpesaCount, amount: mpesaAmount.toFixed(2) },
      other: { count: otherCount, amount: otherAmount.toFixed(2) },
      total: { count: totalCount, amount: totalAmount.toFixed(2) },
    };
  });

  // Stock usage by item (cost of goods consumed in period)
  app.get('/stock-usage', { preHandler: [requireAuth, requireTenant] }, async (req) => {
    const { tenant_id } = (req as unknown as { auth: AuthClaims }).auth;
    const { from, to } = parseRange(req.query);
    const { rows } = await pool.query<{
      name: string;
      unit: string;
      total_consumed: string;
      total_cost: string;
    }>(
      `SELECT
         s.name,
         s.unit,
         COALESCE(SUM(ABS(m.delta)), 0)::text AS total_consumed,
         COALESCE(SUM(ABS(m.delta) * s.cost_per_unit), 0)::text AS total_cost
       FROM stock_movements m
       JOIN stock_items s ON s.id = m.stock_item_id
       WHERE m.tenant_id = $1
         AND m.reason = 'deduction'
         AND m.created_at >= $2::date
         AND m.created_at < ($3::date + INTERVAL '1 day')
       GROUP BY s.name, s.unit
       ORDER BY COALESCE(SUM(ABS(m.delta) * s.cost_per_unit), 0) DESC
       LIMIT 20`,
      [tenant_id, from, to],
    );
    return { from, to, items: rows.map((r) => ({
      name: r.name,
      unit: r.unit,
      total_consumed: r.total_consumed,
      total_cost: r.total_cost,
    })) };
  });

  // PDF export
  app.post('/export/pdf', { preHandler: [requireAuth, requireTenant] }, async (req, reply) => {
    const { tenant_id } = (req as unknown as { auth: AuthClaims }).auth;
    const body = DateRange.parse(req.body);
    const data = await fetchReportData(pool, tenant_id, body.from, body.to);
    const buffer = await generateStatementPdf(data);
    const filename = `statement-${body.from}-to-${body.to}.pdf`;
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(buffer);
  });
}
