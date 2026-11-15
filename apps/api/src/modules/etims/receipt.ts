// Patch 008E: fiscal receipt retrieval for a ticket.
// Role-gated via scope wrapper in app.ts (admin + manager + cashier).
// Generates QR as data URL server-side (qrcode) so frontend is dumb <img>.
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import QRCode from 'qrcode';
import { renderInvoicePdf, type InvoicePdfData } from './invoice-pdf.js';
import { pool } from '../../db/pool.js';
import { type AuthClaims } from '../../plugins/auth.js';

type QueueRow = {
  status: string;
  last_error: string | null;
  invc_no: string | null;
  rcpt_no: string | null;
  intrl_data: string | null;
  rcpt_sign: string | null;
  submitted_at: Date | null;
  raw_response: unknown;
};

export type EtimsReceiptResponse =
  | { status: 'not_applicable' }
  | { status: 'pending' }
  | { status: 'failed'; last_error: string | null }
  | {
      status: 'submitted';
      invc_no: number;
      rcpt_no: number;
      intrl_data: string;
      rcpt_sign: string;
      submitted_at: string;
      qr_data_url: string;
    };

interface InvoiceRow {
  id: string;
  type: 'dine_in' | 'retail';
  opened_at: Date;
  closed_at: Date | null;
  subtotal: string;
  vat_amount: string;
  total: string;
  tenant_name: string;
  kra_pin: string | null;
  business_structure: string | null;
  vat_registered: boolean;
  vat_inclusive: boolean;
  paybill_number: string | null;
  etims_enabled: boolean;
  etims_mode: 'disabled' | 'sandbox' | 'production';
  seller_email: string | null;
  invc_no: string;
  rcpt_no: string;
  intrl_data: string;
  rcpt_sign: string;
  submitted_at: Date;
}

interface ItemRow {
  name: string;
  quantity: number;
  unit_price: string;
  line_total: string;
  tax_ty_cd: 'A' | 'B' | 'C' | 'D' | 'E';
}

async function loadInvoiceData(tenantId: string, ticketId: string): Promise<InvoicePdfData | null> {
  const r = await pool.query<InvoiceRow>(
    `SELECT t.id, t.type, t.opened_at, t.closed_at,
            t.subtotal::text AS subtotal, t.vat_amount::text AS vat_amount, t.total::text AS total,
            ten.name AS tenant_name, ten.kra_pin, ten.business_structure,
            ten.vat_registered, ten.vat_inclusive, ten.paybill_number,
            ten.etims_enabled, ten.etims_mode,
            u.email AS seller_email,
            er.invc_no::text AS invc_no, er.rcpt_no::text AS rcpt_no,
            er.intrl_data, er.rcpt_sign, er.submitted_at
     FROM tickets t
     JOIN tenants ten ON ten.id = t.tenant_id
     LEFT JOIN users u ON u.id = t.created_by
     JOIN etims_responses er ON er.ticket_id = t.id AND er.tenant_id = t.tenant_id
     WHERE t.id = $1 AND t.tenant_id = $2`,
    [ticketId, tenantId],
  );
  if (r.rows.length === 0) return null;
  const row = r.rows[0];

  const items = await pool.query<ItemRow>(
    `SELECT name, quantity, unit_price::text AS unit_price, line_total::text AS line_total, tax_ty_cd
     FROM ticket_items
     WHERE ticket_id = $1 AND tenant_id = $2
     ORDER BY course_number, created_at`,
    [ticketId, tenantId],
  );

  const qrPayload = JSON.stringify({
    invc: Number(row.invc_no),
    rcpt: Number(row.rcpt_no),
    intrl: row.intrl_data,
    sign: row.rcpt_sign,
  });
  const qrPng = await QRCode.toBuffer(qrPayload, {
    type: 'png', errorCorrectionLevel: 'M', margin: 1, width: 240,
  });

  return {
    tenant: {
      name: row.tenant_name,
      kra_pin: row.kra_pin,
      business_structure: row.business_structure,
      vat_registered: row.vat_registered,
      vat_inclusive: row.vat_inclusive,
      paybill_number: row.paybill_number,
      etims_enabled: row.etims_enabled,
      etims_mode: row.etims_mode,
    },
    ticket: {
      id: row.id,
      type: row.type,
      opened_at: row.opened_at,
      closed_at: row.closed_at,
      subtotal: Number(row.subtotal),
      vat_amount: Number(row.vat_amount),
      total: Number(row.total),
    },
    items: items.rows.map((it) => ({
      name: it.name,
      quantity: it.quantity,
      unit_price: Number(it.unit_price),
      line_total: Number(it.line_total),
      tax_ty_cd: it.tax_ty_cd,
    })),
    fiscal: {
      invc_no: Number(row.invc_no),
      rcpt_no: Number(row.rcpt_no),
      intrl_data: row.intrl_data,
      rcpt_sign: row.rcpt_sign,
      submitted_at: row.submitted_at,
    },
    qr_png: qrPng,
    seller_email: row.seller_email,
  };
}

export async function etimsReceiptRoutes(app: FastifyInstance) {
  app.get('/:ticketId', async (req): Promise<EtimsReceiptResponse> => {
    const { tenant_id } = (req as unknown as { auth: AuthClaims }).auth;
    const { ticketId } = z.object({ ticketId: z.string().uuid() }).parse(req.params);

    const q = await pool.query<QueueRow>(
      `SELECT q.status, q.last_error,
              r.invc_no, r.rcpt_no, r.intrl_data, r.rcpt_sign, r.submitted_at, r.raw_response
       FROM etims_invoice_queue q
       LEFT JOIN etims_responses r
         ON r.ticket_id = q.ticket_id AND r.tenant_id = q.tenant_id
       WHERE q.ticket_id = $1 AND q.tenant_id = $2`,
      [ticketId, tenant_id],
    );

    if (q.rows.length === 0) return { status: 'not_applicable' };
    const row = q.rows[0];

    if (row.status === 'success' && row.intrl_data && row.rcpt_sign && row.submitted_at) {
      let qrPayload = '';
      try {
        const raw = row.raw_response as { data?: { qrCodeUrl?: string } } | null;
        const url = raw?.data?.qrCodeUrl;
        if (typeof url === 'string' && url.length > 0) qrPayload = url;
      } catch { /* fall through */ }

      if (!qrPayload) {
        qrPayload = JSON.stringify({
          invc: Number(row.invc_no),
          rcpt: Number(row.rcpt_no),
          intrl: row.intrl_data,
          sign: row.rcpt_sign,
        });
      }

      const qrDataUrl = await QRCode.toDataURL(qrPayload, {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 240,
      });

      return {
        status: 'submitted',
        invc_no: Number(row.invc_no),
        rcpt_no: Number(row.rcpt_no),
        intrl_data: row.intrl_data,
        rcpt_sign: row.rcpt_sign,
        submitted_at: row.submitted_at.toISOString(),
        qr_data_url: qrDataUrl,
      };
    }

    if (row.status === 'permanent_fail') {
      return { status: 'failed', last_error: row.last_error };
    }

    return { status: 'pending' };
  });

  app.get('/:ticketId/pdf', async (req, reply) => {
    const { tenant_id } = (req as unknown as { auth: AuthClaims }).auth;
    const { ticketId } = z.object({ ticketId: z.string().uuid() }).parse(req.params);
    const q = z.object({ copy: z.enum(['true', 'false']).optional() }).parse(req.query ?? {});
    const mode: 'original' | 'copy' = q.copy === 'true' ? 'copy' : 'original';

    const data = await loadInvoiceData(tenant_id, ticketId);
    if (!data) {
      return reply.code(409).send({
        error: 'fiscal_pending',
        hint: 'Fiscal receipt has not been issued for this ticket yet.',
      });
    }

    const buffer = await renderInvoicePdf(data, mode);
    const filename = `invoice-CU-INV-${String(data.fiscal.invc_no).padStart(6, '0')}-${mode}.pdf`;

    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(buffer);
  });
}
