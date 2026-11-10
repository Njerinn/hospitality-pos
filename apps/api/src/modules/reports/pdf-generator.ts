import PDFDocument from 'pdfkit';
import type { Pool } from 'pg';

interface TicketLine {
  name: string;
  quantity: number;
  unit_price: number;
  line_total: number;
}

interface TicketBlock {
  id: string;
  openedAt: string;
  closedAt: string;
  subtotal: number;
  vat: number;
  total: number;
  transId: string | null;
  items: TicketLine[];
}

export interface ReportData {
  tenantName: string;
  from: string;
  to: string;
  summary: { revenue: number; vat: number; tickets: number; stockCost: number };
  byDay: Array<{ day: string; revenue: number; tickets: number }>;
  byHour: Array<{ hour: number; revenue: number; tickets: number }>;
  topItems: Array<{ name: string; quantity: number; revenue: number }>;
  vatSummary: { net: number; vat: number; gross: number; count: number };
  payments: { mpesaCount: number; mpesaAmount: number; otherCount: number; otherAmount: number; totalCount: number; totalAmount: number };
  stockUsage: Array<{ name: string; unit: string; consumed: number; cost: number }>;
  tickets: TicketBlock[];
}

export async function fetchReportData(
  pool: Pool,
  tenant_id: string,
  from: string,
  to: string,
): Promise<ReportData> {
  const [tenant, summary, byDay, byHour, topItems, vatSum, mpesaSum, totalSum, stockUsage, ticketList] = await Promise.all([
    pool.query<{ name: string }>('SELECT name FROM tenants WHERE id = $1', [tenant_id]),
    pool.query<{ revenue: string; vat: string; ticket_count: string }>(
      `SELECT COALESCE(SUM(total),0)::text AS revenue, COALESCE(SUM(vat_amount),0)::text AS vat, COUNT(*)::text AS ticket_count
       FROM tickets WHERE tenant_id = $1 AND status = 'paid'
         AND closed_at >= $2::date AND closed_at < ($3::date + INTERVAL '1 day')`,
      [tenant_id, from, to],
    ),
    pool.query<{ day: string; revenue: string; tickets: string }>(
      `SELECT to_char(date_trunc('day', closed_at), 'YYYY-MM-DD') AS day, COALESCE(SUM(total),0)::text AS revenue, COUNT(*)::text AS tickets
       FROM tickets WHERE tenant_id = $1 AND status = 'paid'
         AND closed_at >= $2::date AND closed_at < ($3::date + INTERVAL '1 day')
       GROUP BY 1 ORDER BY 1`,
      [tenant_id, from, to],
    ),
    pool.query<{ hour: number; revenue: string; tickets: string }>(
      `SELECT EXTRACT(HOUR FROM closed_at)::int AS hour, COALESCE(SUM(total),0)::text AS revenue, COUNT(*)::text AS tickets
       FROM tickets WHERE tenant_id = $1 AND status = 'paid'
         AND closed_at >= $2::date AND closed_at < ($3::date + INTERVAL '1 day')
       GROUP BY 1 ORDER BY 1`,
      [tenant_id, from, to],
    ),
    pool.query<{ name: string; quantity: string; revenue: string }>(
      `SELECT ti.name, SUM(ti.quantity)::text AS quantity, COALESCE(SUM(ti.line_total),0)::text AS revenue
       FROM ticket_items ti JOIN tickets t ON t.id = ti.ticket_id
       WHERE ti.tenant_id = $1 AND t.status = 'paid'
         AND t.closed_at >= $2::date AND t.closed_at < ($3::date + INTERVAL '1 day')
       GROUP BY ti.name ORDER BY COALESCE(SUM(ti.line_total),0) DESC LIMIT 20`,
      [tenant_id, from, to],
    ),
    pool.query<{ subtotal: string; vat: string; total: string; count: string }>(
      `SELECT COALESCE(SUM(subtotal),0)::text AS subtotal, COALESCE(SUM(vat_amount),0)::text AS vat,
              COALESCE(SUM(total),0)::text AS total, COUNT(*)::text AS count
       FROM tickets WHERE tenant_id = $1 AND status = 'paid'
         AND closed_at >= $2::date AND closed_at < ($3::date + INTERVAL '1 day')`,
      [tenant_id, from, to],
    ),
    pool.query<{ mpesa_count: string; mpesa_amount: string }>(
      `SELECT COUNT(*)::text AS mpesa_count, COALESCE(SUM(amount),0)::text AS mpesa_amount
       FROM mpesa_transactions WHERE tenant_id = $1 AND status = 'LINKED'
         AND created_at >= $2::date AND created_at < ($3::date + INTERVAL '1 day')`,
      [tenant_id, from, to],
    ),
    pool.query<{ count: string; amount: string }>(
      `SELECT COUNT(*)::text AS count, COALESCE(SUM(total),0)::text AS amount
       FROM tickets WHERE tenant_id = $1 AND status = 'paid'
         AND closed_at >= $2::date AND closed_at < ($3::date + INTERVAL '1 day')`,
      [tenant_id, from, to],
    ),
    pool.query<{ name: string; unit: string; total_consumed: string; total_cost: string }>(
      `SELECT s.name, s.unit, COALESCE(SUM(ABS(m.delta)),0)::text AS total_consumed,
              COALESCE(SUM(ABS(m.delta) * s.cost_per_unit),0)::text AS total_cost
       FROM stock_movements m JOIN stock_items s ON s.id = m.stock_item_id
       WHERE m.tenant_id = $1 AND m.reason = 'deduction'
         AND m.created_at >= $2::date AND m.created_at < ($3::date + INTERVAL '1 day')
       GROUP BY s.name, s.unit ORDER BY COALESCE(SUM(ABS(m.delta) * s.cost_per_unit),0) DESC`,
      [tenant_id, from, to],
    ),
    pool.query<{ id: string; opened_at: string; closed_at: string; subtotal: string; vat_amount: string; total: string; trans_id: string | null }>(
      `SELECT t.id, t.opened_at::text, t.closed_at::text, t.subtotal, t.vat_amount, t.total, m.trans_id
       FROM tickets t LEFT JOIN mpesa_transactions m ON m.ticket_id = t.id
       WHERE t.tenant_id = $1 AND t.status = 'paid'
         AND t.closed_at >= $2::date AND t.closed_at < ($3::date + INTERVAL '1 day')
       ORDER BY t.closed_at DESC LIMIT 500`,
      [tenant_id, from, to],
    ),
  ]);

  // Fetch line items for all tickets in one query
  const ticketIds = ticketList.rows.map((r) => r.id);
  const itemsByTicket: Record<string, TicketLine[]> = {};
  if (ticketIds.length > 0) {
    const itemRows = await pool.query<{
      ticket_id: string;
      name: string;
      quantity: number;
      unit_price: string;
      line_total: string;
    }>(
      `SELECT ticket_id, name, quantity, unit_price, line_total
       FROM ticket_items WHERE ticket_id = ANY($1::uuid[])
       ORDER BY ticket_id, course_number, created_at`,
      [ticketIds],
    );
    for (const it of itemRows.rows) {
      if (!itemsByTicket[it.ticket_id]) itemsByTicket[it.ticket_id] = [];
      itemsByTicket[it.ticket_id].push({
        name: it.name,
        quantity: it.quantity,
        unit_price: Number(it.unit_price),
        line_total: Number(it.line_total),
      });
    }
  }

  const s = summary.rows[0];
  const mCount = Number(mpesaSum.rows[0].mpesa_count);
  const mAmount = Number(mpesaSum.rows[0].mpesa_amount);
  const tCount = Number(totalSum.rows[0].count);
  const tAmount = Number(totalSum.rows[0].amount);

  return {
    tenantName: tenant.rows[0]?.name ?? 'Unknown',
    from,
    to,
    summary: {
      revenue: Number(s.revenue),
      vat: Number(s.vat),
      tickets: Number(s.ticket_count),
      stockCost: stockUsage.rows.reduce((sum, r) => sum + Number(r.total_cost), 0),
    },
    byDay: byDay.rows.map((r) => ({ day: r.day, revenue: Number(r.revenue), tickets: Number(r.tickets) })),
    byHour: byHour.rows.map((r) => ({ hour: r.hour, revenue: Number(r.revenue), tickets: Number(r.tickets) })),
    topItems: topItems.rows.map((r) => ({ name: r.name, quantity: Number(r.quantity), revenue: Number(r.revenue) })),
    vatSummary: {
      net: Number(vatSum.rows[0].subtotal),
      vat: Number(vatSum.rows[0].vat),
      gross: Number(vatSum.rows[0].total),
      count: Number(vatSum.rows[0].count),
    },
    payments: {
      mpesaCount: mCount,
      mpesaAmount: mAmount,
      otherCount: tCount - mCount,
      otherAmount: tAmount - mAmount,
      totalCount: tCount,
      totalAmount: tAmount,
    },
    stockUsage: stockUsage.rows.map((r) => ({
      name: r.name,
      unit: r.unit,
      consumed: Number(r.total_consumed),
      cost: Number(r.total_cost),
    })),
    tickets: ticketList.rows.map((r) => ({
      id: r.id,
      openedAt: r.opened_at,
      closedAt: r.closed_at,
      subtotal: Number(r.subtotal),
      vat: Number(r.vat_amount),
      total: Number(r.total),
      transId: r.trans_id,
      items: itemsByTicket[r.id] ?? [],
    })),
  };
}

export async function generateStatementPdf(data: ReportData): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  // ── Cover ──
  doc.fontSize(28).fillColor('#0f172a').text(data.tenantName, { align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(16).fillColor('#475569').text('Financial Statement', { align: 'center' });
  doc.moveDown(1.5);
  doc.fontSize(12).fillColor('#64748b').text(`Period:   ${data.from}   →   ${data.to}`, { align: 'center' });
  doc.text(`Generated: ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC`, { align: 'center' });
  doc.moveDown(2);

  // ── Summary ──
  doc.fontSize(18).fillColor('#0f172a').text('Summary');
  doc.moveDown(0.4);
  const avg = data.summary.tickets > 0 ? data.summary.revenue / data.summary.tickets : 0;
  const grossProfit = data.summary.revenue - data.summary.vat - data.summary.stockCost;
  const summaryLines: Array<[string, string]> = [
    ['Total Revenue', `KES ${data.summary.revenue.toFixed(2)}`],
    ['Tickets Paid', String(data.summary.tickets)],
    ['Average Ticket', `KES ${avg.toFixed(2)}`],
    ['VAT Collected', `KES ${data.summary.vat.toFixed(2)}`],
    ['Stock Cost', `KES ${data.summary.stockCost.toFixed(2)}`],
    ['Gross Profit', `KES ${grossProfit.toFixed(2)}`],
  ];
  doc.fontSize(11).fillColor('#0f172a');
  for (const [label, value] of summaryLines) {
    doc.text(`${label}: ${value}`);
  }
  doc.moveDown(1);

  // ── VAT ──
  doc.fontSize(18).fillColor('#0f172a').text('VAT Breakdown');
  doc.moveDown(0.4);
  doc.fontSize(11).fillColor('#475569');
  doc.text(`Net Sales:      KES ${data.vatSummary.net.toFixed(2)}`);
  doc.text(`VAT (16%):      KES ${data.vatSummary.vat.toFixed(2)}`);
  doc.text(`Gross Sales:    KES ${data.vatSummary.gross.toFixed(2)}`);
  doc.text(`Transactions:   ${data.vatSummary.count}`);
  doc.moveDown(1);

  // ── Payments ──
  doc.fontSize(18).fillColor('#0f172a').text('Payment Breakdown');
  doc.moveDown(0.4);
  doc.fontSize(11).fillColor('#475569');
  doc.text(`M-Pesa:   ${data.payments.mpesaCount} transactions,  KES ${data.payments.mpesaAmount.toFixed(2)}`);
  doc.text(`Other:    ${data.payments.otherCount} transactions,  KES ${data.payments.otherAmount.toFixed(2)}`);
  doc.text(`Total:    ${data.payments.totalCount} transactions,  KES ${data.payments.totalAmount.toFixed(2)}`);
  doc.moveDown(1);

  // ── Sales by Day ──
  doc.fontSize(18).fillColor('#0f172a').text('Sales by Day');
  doc.moveDown(0.4);
  if (data.byDay.length === 0) {
    doc.fontSize(11).fillColor('#64748b').text('No sales in this period.');
  } else {
    const maxRev = Math.max(...data.byDay.map((d) => d.revenue), 1);
    doc.fontSize(10).fillColor('#334155');
    for (const d of data.byDay) {
      const bar = '#'.repeat(Math.max(1, Math.round((d.revenue / maxRev) * 40)));
      doc.text(`${d.day}  ${bar}  KES ${d.revenue.toFixed(2)}`);
    }
  }
  doc.moveDown(1);

  // ── Sales by Hour ──
  doc.fontSize(18).fillColor('#0f172a').text('Sales by Hour');
  doc.moveDown(0.4);
  if (data.byHour.length === 0) {
    doc.fontSize(11).fillColor('#64748b').text('No sales in this period.');
  } else {
    const maxHour = Math.max(...data.byHour.map((d) => d.revenue), 1);
    doc.fontSize(9).fillColor('#334155');
    for (const h of data.byHour) {
      const bar = '#'.repeat(Math.max(1, Math.round((h.revenue / maxHour) * 30)));
      const label = String(h.hour).padStart(2, '0') + ':00';
      doc.text(`${label}  ${bar}  KES ${h.revenue.toFixed(2)}`);
    }
  }
  doc.moveDown(1);

  // ── Top Items ──
  if (data.topItems.length > 0) {
    doc.fontSize(18).fillColor('#0f172a').text('Top Items');
    doc.moveDown(0.4);
    doc.fontSize(10).fillColor('#334155');
    for (const it of data.topItems) {
      doc.text(`${it.name}   ${it.quantity}x   KES ${it.revenue.toFixed(2)}`);
    }
    doc.moveDown(1);
  }

  // ── Stock Usage ──
  if (data.stockUsage.length > 0) {
    doc.fontSize(18).fillColor('#0f172a').text('Stock Usage');
    doc.moveDown(0.4);
    doc.fontSize(10).fillColor('#334155');
    for (const s of data.stockUsage) {
      doc.text(`${s.name}   ${s.consumed.toFixed(2)} ${s.unit}   KES ${s.cost.toFixed(2)}`);
    }
    doc.moveDown(1);
  }

  // ── Transaction Detail (paginated, 5 per page) ──
  if (data.tickets.length > 0) {
    doc.addPage();
    doc.fontSize(18).fillColor('#0f172a').text('Transaction Detail');
    doc.moveDown(0.5);
    let count = 0;
    for (const tk of data.tickets) {
      if (count > 0 && count % 5 === 0) {
        doc.addPage();
        doc.fontSize(14).fillColor('#0f172a').text('Transaction Detail (continued)');
        doc.moveDown(0.5);
      }
      doc.fontSize(10).fillColor('#0f172a').text(`Ticket ${tk.id.slice(0, 8)}   ${tk.closedAt}`);
      doc.fontSize(9).fillColor('#475569');
      for (const it of tk.items) {
        doc.text(`   ${it.quantity}x ${it.name}  @ ${it.unit_price.toFixed(2)}  = ${it.line_total.toFixed(2)}`);
      }
      doc.text(`   Subtotal: ${tk.subtotal.toFixed(2)}   VAT: ${tk.vat.toFixed(2)}   Total: ${tk.total.toFixed(2)}`);
      if (tk.transId) doc.text(`   M-Pesa: ${tk.transId}`);
      doc.moveDown(0.4);
      count++;
    }
  }

  // ── Footer on every page ──
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.fontSize(8).fillColor('#94a3b8').text(
      `Hospitality POS  —  ${data.tenantName}  —  Page ${i + 1} of ${range.count}`,
      50,
      doc.page.height - 40,
      { align: 'center', width: doc.page.width - 100, lineBreak: false },
    );
  }

  doc.end();
  return finished;
}
