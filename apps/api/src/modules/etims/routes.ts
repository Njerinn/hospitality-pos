// Patch 008D: eTIMS admin configuration API.
// Scope-level guard: admin + manager (registered in app.ts).
// Write endpoints (POST) add a second route-level guard: admin only.
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { requireAuthAndRole, type AuthClaims } from '../../plugins/auth.js';
import { etimsConfig } from './config.js';
import { initDevice } from './client.js';
import { encryptCmcKey } from './crypto.js';

const TenantConfigBody = z.object({
  business_structure: z.enum([
    'sole_proprietor',
    'private_company',
    'public_company',
    'partnership',
    'sacco',
    'cooperative',
  ]).nullable().optional(),
  kra_pin: z.string().min(1).max(20).nullable().optional(),
  kra_pin_type: z.enum(['personal', 'non_individual']).nullable().optional(),
  vat_registered: z.boolean().optional(),
  etims_enabled: z.boolean().optional(),
  etims_mode: z.enum(['disabled', 'sandbox', 'production']).optional(),
  vat_inclusive: z.boolean().optional(),
  paybill_number: z.string().max(20).nullable().optional(),
  mpesa_fixed_account: z.string().max(30).nullable().optional(),
});

const DeviceInitBody = z.object({
  bhf_id: z.string().min(1).max(10).default('00'),
  dvc_srl_no: z.string().min(1).max(50),
});

function baseUrlForMode(mode: string): string {
  if (etimsConfig.ETIMS_MOCK_ENABLED) {
    throw new Error('device_init_refuses_mock_mode');
  }
  return mode === 'production'
    ? etimsConfig.ETIMS_PRODUCTION_BASE_URL
    : etimsConfig.ETIMS_SANDBOX_BASE_URL;
}

export async function etimsRoutes(app: FastifyInstance) {
  // ─── GET /etims/tenant/config — admin + manager ───
  app.get('/tenant/config', async (req) => {
    const { tenant_id } = (req as unknown as { auth: AuthClaims }).auth;
    const { rows } = await pool.query(
      `SELECT business_structure, kra_pin, kra_pin_type, vat_registered,
              etims_enabled, etims_mode, vat_inclusive, paybill_number, mpesa_fixed_account
       FROM tenants WHERE id = $1`,
      [tenant_id],
    );
    return rows[0] ?? null;
  });

  // ─── POST /etims/tenant/config — admin ONLY ───
  app.post(
    '/tenant/config',
    { preHandler: [requireAuthAndRole('admin')] },
    async (req, reply) => {
      const { tenant_id } = (req as unknown as { auth: AuthClaims }).auth;
      const body = TenantConfigBody.parse(req.body);

      const cols: Array<keyof typeof body> = [
        'business_structure',
        'kra_pin',
        'kra_pin_type',
        'vat_registered',
        'etims_enabled',
        'etims_mode',
        'vat_inclusive',
        'paybill_number',
        'mpesa_fixed_account',
      ];
      const updates: string[] = [];
      const values: unknown[] = [tenant_id];
      for (const col of cols) {
        if (body[col] !== undefined) {
          updates.push(`${col} = $${values.length + 1}`);
          values.push(body[col]);
        }
      }
      if (updates.length === 0) return reply.code(400).send({ error: 'no_fields' });

      try {
        const { rows } = await pool.query(
          `UPDATE tenants SET ${updates.join(', ')} WHERE id = $1
           RETURNING business_structure, kra_pin, kra_pin_type, vat_registered,
                     etims_enabled, etims_mode, vat_inclusive, paybill_number, mpesa_fixed_account`,
          values,
        );
        return rows[0] ?? null;
      } catch (err: unknown) {
        const e = err as { code?: string; message?: string };
        if (e.code === '23514') {
          return reply.code(400).send({
            error: 'constraint_violation',
            message: e.message ?? 'check constraint failed',
          });
        }
        throw err;
      }
    },
  );

  // ─── POST /etims/device/init — admin ONLY ───
  app.post(
    '/device/init',
    { preHandler: [requireAuthAndRole('admin')] },
    async (req, reply) => {
      const { tenant_id } = (req as unknown as { auth: AuthClaims }).auth;
      const body = DeviceInitBody.parse(req.body);

      const t = await pool.query<{ kra_pin: string | null; etims_mode: string }>(
        `SELECT kra_pin, etims_mode FROM tenants WHERE id = $1`,
        [tenant_id],
      );
      if (t.rows.length === 0) return reply.code(404).send({ error: 'tenant_not_found' });
      const row = t.rows[0];
      if (!row.kra_pin) return reply.code(400).send({ error: 'kra_pin_required' });
      if (row.etims_mode === 'disabled') {
        return reply.code(400).send({ error: 'etims_mode_disabled' });
      }

      const result = await initDevice({
        baseUrl: baseUrlForMode(row.etims_mode),
        tin: row.kra_pin,
        bhfId: body.bhf_id,
        dvcSrlNo: body.dvc_srl_no,
      });

      const encrypted = encryptCmcKey(result.cmcKey);

      await pool.query(
        `INSERT INTO etims_devices (tenant_id, bhf_id, dvc_srl_no, cmc_key_encrypted, last_handshake_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (tenant_id, bhf_id, dvc_srl_no)
         DO UPDATE SET cmc_key_encrypted = EXCLUDED.cmc_key_encrypted, last_handshake_at = NOW()`,
        [tenant_id, body.bhf_id, body.dvc_srl_no, encrypted],
      );

      return { ok: true, bhf_id: body.bhf_id, dvc_srl_no: body.dvc_srl_no };
    },
  );

  // ─── GET /etims/queue — admin + manager ───
  app.get('/queue', async (req) => {
    const { tenant_id } = (req as unknown as { auth: AuthClaims }).auth;
    const counts = await pool.query<{ status: string; n: number }>(
      `SELECT status, COUNT(*)::int AS n FROM etims_invoice_queue
       WHERE tenant_id = $1 GROUP BY status ORDER BY status`,
      [tenant_id],
    );
    const recent = await pool.query(
      `SELECT id, ticket_id, status, attempts, last_error, created_at, updated_at
       FROM etims_invoice_queue WHERE tenant_id = $1
       ORDER BY updated_at DESC LIMIT 50`,
      [tenant_id],
    );
    return { counts: counts.rows, recent: recent.rows };
  });

  // ─── POST /etims/queue/retry/:id — admin ONLY ───
  app.post(
    '/queue/retry/:id',
    { preHandler: [requireAuthAndRole('admin')] },
    async (req, reply) => {
      const { tenant_id } = (req as unknown as { auth: AuthClaims }).auth;
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      const { rowCount } = await pool.query(
        `UPDATE etims_invoice_queue
         SET status = 'pending', attempts = 0, last_error = NULL,
             next_retry_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2`,
        [id, tenant_id],
      );
      if (rowCount === 0) return reply.code(404).send({ error: 'queue_row_not_found' });
      return { ok: true, id };
    },
  );

  // ─── GET /etims/device — admin+manager (read-only, never returns cmcKey value) ───
  app.get('/device', async (req) => {
    const { tenant_id } = (req as unknown as { auth: AuthClaims }).auth;
    const { rows } = await pool.query<{
      id: string;
      bhf_id: string;
      dvc_srl_no: string;
      last_handshake_at: Date;
      last_notice_poll_at: Date | null;
      has_cmc_key: boolean;
    }>(
      `SELECT id, bhf_id, dvc_srl_no, last_handshake_at, last_notice_poll_at,
              (length(cmc_key_encrypted) > 0) AS has_cmc_key
       FROM etims_devices
       WHERE tenant_id = $1
       ORDER BY last_handshake_at DESC`,
      [tenant_id],
    );
    return { devices: rows };
  });
}
