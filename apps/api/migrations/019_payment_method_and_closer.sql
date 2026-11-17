-- Phase 019a: payment method + closer tracking on tickets
--
-- Enables shift/cash-drawer reconciliation (Phase 019b) by recording:
--   - what payment method closed the ticket
--   - which user performed the closure
--
-- Historical backfill (one-time, guarded):
--   Pre-019a the only dine-in closure path was /link-mpesa (M-Pesa) and
--   retail closures (BBQ/butchery) were cash-at-counter. The backfill
--   applies ONLY to rows with status='paid' AND payment_method IS NULL,
--   so it can never overwrite post-019a recorded values.
--
-- Idempotent, additive, zero data loss.

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS payment_method TEXT,
  ADD COLUMN IF NOT EXISTS closed_by UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_payment_method_check;
ALTER TABLE tickets ADD CONSTRAINT tickets_payment_method_check
  CHECK (payment_method IS NULL OR payment_method IN ('cash', 'mpesa', 'other'));

CREATE INDEX IF NOT EXISTS idx_tickets_tenant_payment_closed_at
  ON tickets(tenant_id, payment_method, closed_at DESC)
  WHERE status = 'paid';

-- Backfill historical paid tickets with best-guess method + closer.
UPDATE tickets
SET payment_method = CASE
      WHEN type = 'retail'  THEN 'cash'
      WHEN type = 'dine_in' THEN 'mpesa'
      ELSE 'other'
    END,
    closed_by = COALESCE(closed_by, created_by)
WHERE status = 'paid'
  AND payment_method IS NULL;
