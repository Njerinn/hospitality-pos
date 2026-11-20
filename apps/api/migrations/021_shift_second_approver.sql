-- Phase 019b-C: segregation of duties for cash drawer variance.
-- Closes the gap where admin/manager could self-approve any variance, including
-- large shortfalls. New rule: variance above tenant threshold requires approval
-- from a DIFFERENT admin/manager. Single-admin shops must create a second admin.
--
-- Idempotent, additive, zero data loss.

ALTER TABLE shifts
  ADD COLUMN IF NOT EXISTS requires_second_approval BOOLEAN NOT NULL DEFAULT false;

-- Backfill: any already-closed shift with NO approver AND non-zero variance is
-- pending approval by definition. Historical rows that were auto-approved by the
-- old (buggy) code path retain their approval — we do not rewrite history.
UPDATE shifts
  SET requires_second_approval = TRUE
  WHERE status = 'closed'
    AND variance_approved_by IS NULL
    AND variance IS NOT NULL
    AND variance <> 0;

CREATE INDEX IF NOT EXISTS idx_shifts_needs_approval
  ON shifts (tenant_id, closed_at DESC)
  WHERE requires_second_approval = true;
