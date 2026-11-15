-- Phase 015: outlet-aware inventory
-- Adds outlet attribution to stock movements so kitchen, BBQ, butchery, and
-- storage are visible separately. Stock quantity remains the grand total.
-- Forwarding between outlets creates a paired movement (out + in) that nets
-- to zero on the total.

ALTER TABLE stock_movements
  ADD COLUMN IF NOT EXISTS outlet TEXT;
ALTER TABLE stock_movements
  ADD COLUMN IF NOT EXISTS transfer_group_id UUID;

ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_outlet_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_outlet_check
  CHECK (outlet IS NULL OR outlet IN ('storage', 'kitchen', 'bbq', 'butchery'));

CREATE INDEX IF NOT EXISTS idx_stock_movements_outlet
  ON stock_movements (tenant_id, outlet, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_transfer
  ON stock_movements (transfer_group_id)
  WHERE transfer_group_id IS NOT NULL;

-- Add 'butchery' role to the users CHECK constraint
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'manager', 'cashier', 'waiter', 'kitchen', 'butchery'));
