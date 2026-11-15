-- Phase 018c-fix: mpesa_transactions.updated_at
--
-- Code in apps/api/src/modules/mpesa/routes.ts (line 80) does:
--   UPDATE mpesa_transactions SET status = 'IGNORED', match_reason = 'admin_ignored',
--     updated_at = NOW() WHERE ...
--
-- Column was never added → this UPDATE has failed silently since Phase 014.
-- Additive, backfill-safe, idempotent.

-- 1. Add column nullable (idempotent — safe to re-run)
ALTER TABLE mpesa_transactions
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

-- 2. Backfill existing rows honestly: set updated_at = created_at so the
--    value reflects when the row was last known to have been current.
UPDATE mpesa_transactions
  SET updated_at = created_at
  WHERE updated_at IS NULL;

-- 3. Now every row has a value — lock in NOT NULL + DEFAULT for future inserts
ALTER TABLE mpesa_transactions
  ALTER COLUMN updated_at SET NOT NULL;
ALTER TABLE mpesa_transactions
  ALTER COLUMN updated_at SET DEFAULT NOW();

-- 4. Index for "recently updated" queries
CREATE INDEX IF NOT EXISTS idx_mpesa_transactions_updated_at
  ON mpesa_transactions(tenant_id, updated_at DESC);
