import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import ipaddr from 'ipaddr.js';
import { config } from '../../config.js';
import { pool } from '../../db/pool.js';
import { parseMpesaNairobiTime, toNairobiISOString } from '@hospitality-pos/shared';

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

    app.log.info(
      {
        transId: d.TransID,
        inserted: result.rowCount,
        nairobi: toNairobiISOString(new Date()),
      },
      'mpesa confirmation',
    );
    return reply.send({ ResultCode: '0', ResultDesc: 'Success' });
  });
}
