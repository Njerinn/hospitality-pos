import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import ipaddr from 'ipaddr.js';
import { config } from '../../config.js';
import { pool } from '../../db/pool.js';
import { parseMpesaNairobiTime, toNairobiISOString } from '@hospitality-pos/shared';
import { attemptAutoMatch } from './matching.js';
import { enqueueEtimsSubmission } from '../etims/submission.js';

const allowedCidrs = config.SAFARICOM_ALLOWED_CIDRS.split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function ipAllowed(ip: string): boolean {
  if (allowedCidrs.length === 0) return true;
  let addr: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    addr = ipaddr.process(ip);
  } catch {
    return false;
  }
  return allowedCidrs.some((cidr) => {
    try {
      return addr.match(ipaddr.parseCIDR(cidr));
    } catch {
      return false;
    }
  });
}

const CallbackBody = z
  .object({
    TransactionType: z.string(),
    TransID: z.string(),
    TransTime: z.string(),
    TransAmount: z.coerce.number(),
    BusinessShortCode: z.coerce.string(),
    BillRefNumber: z.string().optional().default(''),
    MSISDN: z.coerce.string(),
    StoreNumber: z.string().optional().default(''),
  })
  .passthrough();

export async function mpesaWebhookRoutes(app: FastifyInstance) {
  app.post('/validation', async (req, reply) => {
    if (!ipAllowed(req.ip)) {
      return reply.code(403).send({ ResultCode: 'C2B00009', ResultDesc: 'IP not allowed' });
    }
    const parsed = CallbackBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ ResultCode: 'C2B00012', ResultDesc: 'Invalid payload' });
    }
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM tenants WHERE till_number = $1 LIMIT 1`,
      [parsed.data.BusinessShortCode],
    );
    if (rows.length === 0) {
      return reply.send({ ResultCode: 'C2B00012', ResultDesc: 'Unknown shortcode' });
    }
    return reply.send({ ResultCode: '0', ResultDesc: 'Accepted' });
  });

  app.post('/confirmation', async (req, reply) => {
    if (!ipAllowed(req.ip)) {
      return reply.code(403).send({ ResultCode: 'C2B00009', ResultDesc: 'IP not allowed' });
    }
    const parsed = CallbackBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ ResultCode: 'C2B00012', ResultDesc: 'Invalid payload' });
    }
    const d = parsed.data;
    const { rows: tenantRows } = await pool.query<{ id: string }>(
      `SELECT id FROM tenants WHERE till_number = $1 LIMIT 1`,
      [d.BusinessShortCode],
    );
    if (tenantRows.length === 0) {
      return reply.send({ ResultCode: '0', ResultDesc: 'Ignored (unknown shortcode)' });
    }
    const tenantId = tenantRows[0].id;

    const result = await pool.query(
      `INSERT INTO mpesa_transactions
         (tenant_id, trans_id, trans_time, amount, msisdn, bill_ref, store_number, raw_payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (trans_id) DO NOTHING`,
      [
        tenantId,
        d.TransID,
        parseMpesaNairobiTime(d.TransTime),
        d.TransAmount,
        d.MSISDN,
        d.BillRefNumber,
        d.StoreNumber,
        d,
      ],
    );

    let matchInfo: { status: string; reason: string | null; ticket_id: string | null } = {
      status: 'CONFIRMED',
      reason: null,
      ticket_id: null,
    };

    if (result.rowCount && result.rowCount > 0) {
      // ── Patch 014: attempt auto-match inside a fresh transaction ──
      const mc = await pool.connect();
      try {
        await mc.query('BEGIN');
        const tx = await mc.query<{ id: string; amount: string }>(
          `SELECT id, amount::text AS amount FROM mpesa_transactions
           WHERE trans_id = $1 AND tenant_id = $2 FOR UPDATE`,
          [d.TransID, tenantId],
        );
        const row = tx.rows[0];
        const match = await attemptAutoMatch(mc, {
          tenant_id: tenantId,
          trans_id: d.TransID,
          amount: row.amount,
          msisdn: d.MSISDN,
          bill_ref: d.BillRefNumber,
        });

        if (match.matched) {
          await mc.query(
            `UPDATE tickets SET status = 'paid', closed_at = NOW()
             WHERE id = $1 AND tenant_id = $2`,
            [match.ticket_id, tenantId],
          );
          await mc.query(
            `UPDATE mpesa_transactions
             SET ticket_id = $1, status = 'LINKED', matched_at = NOW(),
                 match_attempts = 1, match_reason = $2
             WHERE id = $3`,
            [match.ticket_id, match.reason, row.id],
          );
          await mc.query(
            `UPDATE restaurant_tables SET status = 'free'
             WHERE id = (SELECT table_id FROM tickets WHERE id = $1 AND tenant_id = $2)`,
            [match.ticket_id, tenantId],
          );
          await mc.query('COMMIT');
          matchInfo = { status: 'LINKED', reason: match.reason, ticket_id: match.ticket_id };
          void enqueueEtimsSubmission(app, match.ticket_id, tenantId);
        } else {
          await mc.query(
            `UPDATE mpesa_transactions
             SET status = 'UNALLOCATED', match_attempts = 1, match_reason = $1
             WHERE id = $2`,
            [match.reason, row.id],
          );
          await mc.query('COMMIT');
          matchInfo = { status: 'UNALLOCATED', reason: match.reason, ticket_id: null };
        }
      } catch (err) {
        await mc.query('ROLLBACK').catch(() => {});
        app.log.error({ err, transId: d.TransID }, 'auto-match threw — marking UNALLOCATED');
        // Fallback: mark UNALLOCATED in a fresh connection — the payment must never be lost
        try {
          await pool.query(
            `UPDATE mpesa_transactions
             SET status = 'UNALLOCATED', match_attempts = 1, match_reason = 'match_error'
             WHERE trans_id = $1 AND tenant_id = $2 AND status = 'CONFIRMED'`,
            [d.TransID, tenantId],
          );
        } catch (fallbackErr) {
          app.log.error({ fallbackErr, transId: d.TransID }, 'unallocated fallback also failed');
        }
        matchInfo = { status: 'UNALLOCATED', reason: 'match_error', ticket_id: null };
      } finally {
        mc.release();
      }
    }

    app.log.info(
      {
        transId: d.TransID,
        inserted: result.rowCount,
        status: matchInfo.status,
        reason: matchInfo.reason,
        ticketId: matchInfo.ticket_id,
        nairobi: toNairobiISOString(new Date()),
      },
      'mpesa confirmation',
    );
    return reply.send({ ResultCode: '0', ResultDesc: 'Success' });
  });
}
