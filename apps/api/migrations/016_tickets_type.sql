-- Phase 018a: retail quick-sale flag on tickets
-- Enables the /sell flow (retail) to create a ticket that flows through the
-- existing eTIMS submission pipeline (which is ticket-based). Dine-in tickets
-- default to 'dine_in' — existing rows preserved with backfill.
--
-- Idempotent, additive, zero data loss.

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'dine_in';

ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_type_check;
ALTER TABLE tickets ADD CONSTRAINT tickets_type_check
  CHECK (type IN ('dine_in', 'retail'));

CREATE INDEX IF NOT EXISTS idx_tickets_tenant_type
  ON tickets(tenant_id, type, opened_at DESC);

-- Backfill any NULLs (defensive — the ADD COLUMN DEFAULT should already do this)
UPDATE tickets SET type = 'dine_in' WHERE type IS NULL;
