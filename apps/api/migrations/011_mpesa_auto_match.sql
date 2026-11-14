-- Patch 014: M-Pesa C2B auto-match
-- Additive, idempotent, zero data migration for existing rows.
--
-- Adds to mpesa_transactions:
--   matched_at, match_attempts, match_reason
-- New table:
--   mpesa_url_registrations (audit trail for Safaricom registerurl calls)
-- New status values used (no CHECK constraint to modify):
--   'CONFIRMED' (existing), 'LINKED' (existing),
--   'UNALLOCATED' (new), 'IGNORED' (new)

ALTER TABLE mpesa_transactions
  ADD COLUMN IF NOT EXISTS matched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS match_attempts INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS match_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_mpesa_unallocated
  ON mpesa_transactions(tenant_id, status)
  WHERE status IN ('CONFIRMED', 'UNALLOCATED');

CREATE INDEX IF NOT EXISTS idx_mpesa_amount_time
  ON mpesa_transactions(tenant_id, amount, trans_time)
  WHERE status IN ('CONFIRMED', 'UNALLOCATED');

CREATE TABLE IF NOT EXISTS mpesa_url_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  response_status INT NOT NULL,
  response_body JSONB NOT NULL,
  registered_by UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_mpesa_url_regs_tenant_time
  ON mpesa_url_registrations(tenant_id, registered_at DESC);
