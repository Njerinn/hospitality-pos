// Patch 014: M-Pesa C2B auto-match engine.
// Deterministic 4-step cascade. Never guesses — ambiguity falls to unallocated.
// Runs inside the caller's transaction (webhook uses pool.connect()).
import type { PoolClient } from 'pg';

export type MatchReason =
  | 'bill_ref_uuid'
  | 'fixed_account_unique'
  | 'msisdn_disambiguation';

export type NoMatchReason =
  | 'no_fixed_account_configured'
  | 'no_unique_candidate'
  | 'multiple_candidates_no_msisdn';

export type MatchResult =
  | { matched: true; ticket_id: string; reason: MatchReason }
  | { matched: false; reason: NoMatchReason };

export interface MatchInput {
  tenant_id: string;
  trans_id: string;
  amount: string;
  msisdn: string;
  bill_ref: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}

export async function attemptAutoMatch(
  client: PoolClient,
  input: MatchInput,
): Promise<MatchResult> {
  // ── Step 1: BillRefNumber is a UUID → direct ticket lookup ──
  if (isUuid(input.bill_ref)) {
    const r = await client.query<{ id: string }>(
      `SELECT id FROM tickets
       WHERE id = $1 AND tenant_id = $2
         AND status IN ('open', 'sent_to_kitchen')
         AND total = $3::numeric
       LIMIT 1`,
      [input.bill_ref, input.tenant_id, input.amount],
    );
    if (r.rows.length === 1) {
      return { matched: true, ticket_id: r.rows[0].id, reason: 'bill_ref_uuid' };
    }
    // Fall through — malformed reference or amount mismatch; treat as no match
    return { matched: false, reason: 'no_unique_candidate' };
  }

  // ── Step 2: fixed account match ──
  const t = await client.query<{ mpesa_fixed_account: string | null }>(
    `SELECT mpesa_fixed_account FROM tenants WHERE id = $1`,
    [input.tenant_id],
  );
  const fixedAccount = t.rows[0]?.mpesa_fixed_account;
  if (!fixedAccount || fixedAccount.length === 0) {
    return { matched: false, reason: 'no_fixed_account_configured' };
  }
  if (input.bill_ref !== fixedAccount) {
    return { matched: false, reason: 'no_unique_candidate' };
  }

  // ── Step 3: unique open ticket by amount within 4 hours ──
  const candidates = await client.query<{ id: string }>(
    `SELECT id FROM tickets
     WHERE tenant_id = $1
       AND status IN ('open', 'sent_to_kitchen')
       AND total = $2::numeric
       AND opened_at >= NOW() - INTERVAL '4 hours'
     FOR UPDATE`,
    [input.tenant_id, input.amount],
  );

  if (candidates.rows.length === 1) {
    return { matched: true, ticket_id: candidates.rows[0].id, reason: 'fixed_account_unique' };
  }
  if (candidates.rows.length === 0) {
    return { matched: false, reason: 'no_unique_candidate' };
  }

  // ── Step 4: multiple candidates → try MSISDN disambiguation ──
  const byMsisdn = await client.query<{ id: string }>(
    `SELECT DISTINCT t.id FROM tickets t
     JOIN mpesa_transactions m ON m.ticket_id = t.id
     WHERE t.tenant_id = $1
       AND t.total = $2::numeric
       AND m.msisdn = $3
       AND m.status = 'LINKED'
       AND t.opened_at >= NOW() - INTERVAL '30 days'`,
    [input.tenant_id, input.amount, input.msisdn],
  );

  if (byMsisdn.rows.length === 1) {
    return { matched: true, ticket_id: byMsisdn.rows[0].id, reason: 'msisdn_disambiguation' };
  }
  return { matched: false, reason: 'multiple_candidates_no_msisdn' };
}
