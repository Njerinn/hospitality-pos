-- Phase 015: allow outlet-aware reason values in stock_movements
-- Safe whether or not a prior CHECK exists (DO block guards both paths).
DO $$
DECLARE
  existing_def TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO existing_def
  FROM pg_constraint WHERE conname = 'stock_movements_reason_check';

  IF existing_def IS NOT NULL AND existing_def NOT LIKE '%transfer_out%' THEN
    ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_reason_check;
    ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_reason_check
      CHECK (reason IN ('restock', 'adjustment', 'deduction', 'consumption', 'transfer_out', 'transfer_in'));
  END IF;
END $$;
