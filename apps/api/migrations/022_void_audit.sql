-- Phase 019e-B: void audit trail + stock-restore movement reason.
--
-- tickets: who voided, when, and why. Legacy voided rows: the void time equals closed_at;
-- the reason and the voider were never recorded, so they stay NULL (never invented).
--
-- stock_movements: allow reason 'void_restore' (a positive movement that reverses the
-- deduction of an UNSENT item when its ticket is voided). The cost reports skip a deduction
-- that has a matching void_restore (phase 019e-A). Items already sent to the kitchen are
-- NOT restored: that stock was consumed (waste).
--
-- Idempotent, additive, zero data loss.

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS void_reason TEXT,
  ADD COLUMN IF NOT EXISTS voided_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;

ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_void_reason_len;
ALTER TABLE tickets ADD CONSTRAINT tickets_void_reason_len
  CHECK (void_reason IS NULL OR char_length(void_reason) BETWEEN 3 AND 200);

UPDATE tickets
SET voided_at = closed_at
WHERE status = 'voided' AND voided_at IS NULL AND closed_at IS NOT NULL;

DO $$
DECLARE
  existing_def TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO existing_def
  FROM pg_constraint WHERE conname = 'stock_movements_reason_check';

  IF existing_def IS NOT NULL AND existing_def NOT LIKE '%void_restore%' THEN
    ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_reason_check;
    ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_reason_check
      CHECK (reason IN ('restock', 'adjustment', 'deduction', 'consumption', 'transfer_out', 'transfer_in', 'void_restore'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_movements_ref
  ON stock_movements (ref_id) WHERE ref_id IS NOT NULL;
