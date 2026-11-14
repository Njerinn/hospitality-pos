// Patch 008C: background submission worker for the eTIMS invoice queue.
// Polls for pending/failed rows, builds payload, submits to KRA OSCU,
// persists fiscal response. Poll interval + mock base URL injectable for tests.
// Never crashes the process — every tick is try/catch-wrapped by the loop.
import type { FastifyInstance } from 'fastify';
import { pool } from '../../db/pool.js';
import { etimsConfig } from './config.js';
import { submitSale, EtimsApiError } from './client.js';
import { decryptCmcKey } from './crypto.js';
import {
  buildSalesPayload,
  type ItemForPayload,
  type TicketForPayload,
  type UserForPayload,
} from './payload.js';

export interface WorkerOptions {
  pollIntervalMs?: number;
  mockBaseUrl?: string;
  resolverOverride?: (tenantMode: string) => string;
}

export interface ClassifiedError {
  retryable: boolean;
  kind: string;
}

export function classifyError(err: unknown): ClassifiedError {
  if (err instanceof EtimsApiError) {
    const retryable =
      err.kind === 'timeout' || err.kind === 'network' || err.kind === 'http';
    return { retryable, kind: err.kind };
  }
  return { retryable: true, kind: 'unknown' };
}

export function resolveBaseUrl(tenantMode: string, opts: WorkerOptions): string {
  if (opts.resolverOverride) return opts.resolverOverride(tenantMode);
  if (etimsConfig.ETIMS_MOCK_ENABLED) {
    if (!opts.mockBaseUrl) {
      throw new Error('ETIMS_MOCK_ENABLED=true but mockBaseUrl not provided to worker');
    }
    return opts.mockBaseUrl;
  }
  return tenantMode === 'production'
    ? etimsConfig.ETIMS_PRODUCTION_BASE_URL
    : etimsConfig.ETIMS_SANDBOX_BASE_URL;
}

interface QueueRow {
  id: string;
  tenant_id: string;
  ticket_id: string;
  attempts: number;
}

interface DeviceRow {
  bhf_id: string;
  dvc_srl_no: string;
  cmc_key_encrypted: string;
}

interface TenantRow {
  kra_pin: string | null;
  vat_inclusive: boolean;
  etims_mode: string;
}

type TicketRow = TicketForPayload & { created_by: string | null };

export function startEtimsWorker(
  app: FastifyInstance,
  opts: WorkerOptions = {},
): { stop: () => Promise<void> } {
  if (etimsConfig.ETIMS_MOCK_ENABLED && !opts.mockBaseUrl && process.env.NODE_ENV === 'production') {
    app.log.error('ETIMS_MOCK_ENABLED=true in production but no mockBaseUrl — refusing to start worker');
    return { stop: async () => {} };
  }

  const pollIntervalMs = opts.pollIntervalMs ?? 5000;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function loop(): Promise<void> {
    if (stopped) return;
    try {
      await processOne(app, opts);
    } catch (err) {
      app.log.error({ err }, 'etims worker tick failed');
    }
    if (!stopped) timer = setTimeout(loop, pollIntervalMs);
  }

  timer = setTimeout(loop, pollIntervalMs);
  app.log.info({ pollIntervalMs, mockEnabled: etimsConfig.ETIMS_MOCK_ENABLED }, 'etims worker started');

  return {
    stop: async () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      app.log.info({}, 'etims worker stopped');
    },
  };
}

async function processOne(app: FastifyInstance, opts: WorkerOptions): Promise<void> {
  const lockClient = await pool.connect();
  let row: QueueRow | null = null;
  try {
    await lockClient.query('BEGIN');
    const q = await lockClient.query<QueueRow>(
      `SELECT id, tenant_id, ticket_id, attempts
       FROM etims_invoice_queue
       WHERE status = 'pending'
          OR (status = 'failed' AND next_retry_at <= NOW())
       ORDER BY created_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
    );
    if (q.rows.length === 0) {
      await lockClient.query('COMMIT');
      return;
    }
    row = q.rows[0];
    await lockClient.query(
      `UPDATE etims_invoice_queue
       SET status = 'submitting', attempts = attempts + 1, updated_at = NOW()
       WHERE id = $1`,
      [row.id],
    );
    await lockClient.query('COMMIT');
  } catch (err) {
    await lockClient.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    lockClient.release();
  }

  if (row) await submitQueueRow(app, opts, row);
}

async function submitQueueRow(
  app: FastifyInstance,
  opts: WorkerOptions,
  row: QueueRow,
): Promise<void> {
  const ticketRes = await pool.query<TicketRow>(
    `SELECT id, tenant_id, subtotal, vat_amount, total, closed_at, created_by
     FROM tickets WHERE id = $1 AND tenant_id = $2`,
    [row.ticket_id, row.tenant_id],
  );
  if (ticketRes.rows.length === 0) return markFailed(row.id, 'ticket_not_found', false);
  const ticket = ticketRes.rows[0];
  if (ticket.closed_at === null) return markFailed(row.id, 'ticket_not_closed', false);

  const itemsRes = await pool.query<ItemForPayload>(
    `SELECT name, quantity, unit_price, line_total, vat_rate, tax_ty_cd
     FROM ticket_items WHERE ticket_id = $1 AND tenant_id = $2 ORDER BY created_at`,
    [row.ticket_id, row.tenant_id],
  );
  const items = itemsRes.rows;
  if (items.length === 0) return markFailed(row.id, 'ticket_has_no_items', false);

  const tenantRes = await pool.query<TenantRow>(
    `SELECT kra_pin, vat_inclusive, etims_mode FROM tenants WHERE id = $1`,
    [row.tenant_id],
  );
  if (tenantRes.rows.length === 0) return markFailed(row.id, 'tenant_not_found', false);
  const tenant = tenantRes.rows[0];
  if (!tenant.kra_pin) return markFailed(row.id, 'tenant_no_kra_pin', false);

  const deviceRes = await pool.query<DeviceRow>(
    `SELECT bhf_id, dvc_srl_no, cmc_key_encrypted
     FROM etims_devices WHERE tenant_id = $1 ORDER BY last_handshake_at DESC LIMIT 1`,
    [row.tenant_id],
  );
  if (deviceRes.rows.length === 0) return markFailed(row.id, 'no_etims_device', false);
  const device = deviceRes.rows[0];

  const userRes = ticket.created_by
    ? await pool.query<{ id: string; email: string }>(
        `SELECT id, email FROM users WHERE id = $1`,
        [ticket.created_by],
      )
    : { rows: [] as Array<{ id: string; email: string }> };
  const user: UserForPayload = userRes.rows[0] ?? { id: 'system', email: 'system@pos.local' };

  let invcNo: number;
  const invcLock = await pool.connect();
  try {
    await invcLock.query('BEGIN');
    await invcLock.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `etims_invc:${row.tenant_id}`,
    ]);
    const maxRes = await invcLock.query<{ max: string }>(
      `SELECT COALESCE(MAX(invc_no), 0)::text AS max
       FROM etims_responses WHERE tenant_id = $1`,
      [row.tenant_id],
    );
    invcNo = Number(maxRes.rows[0].max) + 1;
    await invcLock.query('COMMIT');
  } catch (err) {
    await invcLock.query('ROLLBACK').catch(() => {});
    return markFailed(row.id, `invc_lock_failed:${(err as Error).message}`, true);
  } finally {
    invcLock.release();
  }

  let payload;
  try {
    payload = buildSalesPayload(
      ticket,
      items,
      { kra_pin: tenant.kra_pin, vat_inclusive: tenant.vat_inclusive },
      user,
      { sdc_id: device.dvc_srl_no, mrc_no: 'MRC-001' },
      { invcNo, bhfId: device.bhf_id },
    );
  } catch (err) {
    return markFailed(row.id, `payload_failed:${(err as Error).message}`, false);
  }

  try {
    const result = await submitSale({
      baseUrl: resolveBaseUrl(tenant.etims_mode, opts),
      tin: tenant.kra_pin,
      bhfId: device.bhf_id,
      cmcKey: decryptCmcKey(device.cmc_key_encrypted),
      payload: payload as unknown as Record<string, unknown>,
    });

    const respClient = await pool.connect();
    try {
      await respClient.query('BEGIN');
      await respClient.query(
        `INSERT INTO etims_responses
           (tenant_id, ticket_id, invc_no, rcpt_no, intrl_data, rcpt_sign, raw_response)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (ticket_id) DO NOTHING`,
        [
          row.tenant_id,
          row.ticket_id,
          invcNo,
          result.totRcptNo,
          result.intrlData,
          result.rcptSign,
          result.raw,
        ],
      );
      await respClient.query(
        `UPDATE etims_invoice_queue
         SET status = 'success', last_error = NULL, updated_at = NOW()
         WHERE id = $1`,
        [row.id],
      );
      await respClient.query('COMMIT');
    } catch (err) {
      await respClient.query('ROLLBACK').catch(() => {});
      return markFailed(row.id, `response_persist_failed:${(err as Error).message}`, true);
    } finally {
      respClient.release();
    }

    app.log.info({ ticketId: row.ticket_id, invcNo, rcptNo: result.totRcptNo }, 'etims invoice submitted');
  } catch (err) {
    const { retryable, kind } = classifyError(err);
    const msg = err instanceof Error ? err.message : String(err);
    await markFailed(row.id, `${kind}:${msg}`, retryable);
    app.log.warn({ err, ticketId: row.ticket_id, kind, retryable }, 'etims submit failed');
  }
}

async function markFailed(queueId: string, errorMsg: string, retryable: boolean): Promise<void> {
  if (!retryable) {
    await pool.query(
      `UPDATE etims_invoice_queue
       SET status = 'permanent_fail', last_error = $1, updated_at = NOW()
       WHERE id = $2`,
      [errorMsg, queueId],
    );
    return;
  }
  await pool.query(
    `UPDATE etims_invoice_queue
     SET status = CASE WHEN attempts >= $1 THEN 'permanent_fail' ELSE 'failed' END,
         last_error = $2,
         next_retry_at = NOW() + make_interval(secs => ($3::float / 1000.0) * POWER(2, LEAST(attempts, 10))),
         updated_at = NOW()
     WHERE id = $4`,
    [etimsConfig.ETIMS_RETRY_MAX_ATTEMPTS, errorMsg, etimsConfig.ETIMS_RETRY_BACKOFF_MS, queueId],
  );
}
