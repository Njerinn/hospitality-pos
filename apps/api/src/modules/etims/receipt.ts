// Patch 008E: fiscal receipt retrieval for a ticket.
// Role-gated via scope wrapper in app.ts (admin + manager + cashier).
// Generates QR as data URL server-side (qrcode) so frontend is dumb <img>.
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import QRCode from 'qrcode';
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
}
