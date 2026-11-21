// Phase 019d: eTIMS queue reconciliation.
//  1) recoverStaleSubmitting      — rows stranded in 'submitting' (process died between claim and result)
//  2) enqueueMissingFiscalReceipts — paid tickets whose enqueue never happened
// Both are single idempotent statements, safe to run from several instances at once.
import { pool } from '../../db/pool.js';
import { etimsConfig } from './config.js';

export const STALE_SUBMITTING_MINUTES = 10;
export const MISSING_GRACE_MINUTES = 5;
export const MISSING_LOOKBACK_HOURS = 48;
export const MISSING_BATCH_LIMIT = 200;

// A row stuck in 'submitting' longer than STALE_SUBMITTING_MINUTES is handed back to the
// normal retry path. Same attempt cap as the worker's markFailed: a row that keeps killing
// the process ends as permanent_fail (visible to humans) instead of looping forever.
export async function recoverStaleSubmitting(): Promise<number> {
  const res = await pool.query(
    `UPDATE etims_invoice_queue
     SET status = CASE WHEN attempts >= $2::int THEN 'permanent_fail' ELSE 'failed' END,
         last_error = 'recovered_stale_submitting',
         next_retry_at = NOW(),
         updated_at = NOW()
     WHERE status = 'submitting'
       AND updated_at < NOW() - make_interval(mins => $1::int)`,
    [STALE_SUBMITTING_MINUTES, etimsConfig.ETIMS_RETRY_MAX_ATTEMPTS],
  );
  return res.rowCount ?? 0;
}

// Enqueue paid tickets that never got a queue row. Deliberately conservative:
//  - tenant must have eTIMS enabled
//  - ticket must have items, and neither a queue row nor a fiscal response
//  - closed at least MISSING_GRACE_MINUTES ago (the normal path gets its chance first)
//  - closed within the last MISSING_LOOKBACK_HOURS
//  - closed no earlier than the tenant's FIRST queue row (go-live anchor), so switching
//    eTIMS on never back-submits sales made before go-live. No queue history = no-op.
export async function enqueueMissingFiscalReceipts(): Promise<number> {
  const res = await pool.query(
    `INSERT INTO etims_invoice_queue (tenant_id, ticket_id, status)
     SELECT t.tenant_id, t.id, 'pending'
     FROM tickets t
     JOIN tenants tn ON tn.id = t.tenant_id
     WHERE tn.etims_enabled = TRUE
       AND t.status = 'paid'
       AND t.closed_at IS NOT NULL
       AND t.closed_at <= NOW() - make_interval(mins => $1::int)
       AND t.closed_at >= NOW() - make_interval(hours => $2::int)
       AND t.closed_at >= (
         SELECT MIN(q0.created_at) FROM etims_invoice_queue q0 WHERE q0.tenant_id = t.tenant_id
       )
       AND EXISTS (SELECT 1 FROM ticket_items i WHERE i.ticket_id = t.id)
       AND NOT EXISTS (SELECT 1 FROM etims_invoice_queue q WHERE q.ticket_id = t.id)
       AND NOT EXISTS (SELECT 1 FROM etims_responses r WHERE r.ticket_id = t.id)
     ORDER BY t.closed_at ASC
     LIMIT $3::int
     ON CONFLICT (ticket_id) DO NOTHING`,
    [MISSING_GRACE_MINUTES, MISSING_LOOKBACK_HOURS, MISSING_BATCH_LIMIT],
  );
  return res.rowCount ?? 0;
}
