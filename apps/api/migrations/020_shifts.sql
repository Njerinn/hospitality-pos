-- Phase 019b: cash drawer / shift reconciliation
--
-- Design (Q1=C hybrid model):
--   - One physical drawer per tenant
--   - ONE open shift per tenant at a time (partial unique index)
--   - opened_by = cashier accountable for drawer
--   - tickets.shift_id auto-assigned via triggers when ticket becomes paid
--     and a shift is open
--   - variance = counted_cash - expected_cash
--   - variance_approved_by NULL means "pending manager approval"
--     (only when |variance| > tenant.variance_threshold_kes)
--
-- Idempotent, additive, zero data loss. No route changes required.

-- 1. Shift status enum
DO $$ BEGIN
  CREATE TYPE shift_status_enum AS ENUM ('open', 'closed', 'force_closed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. Shifts table
CREATE TABLE IF NOT EXISTS shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  opened_by UUID REFERENCES users(id) ON DELETE SET NULL,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  opening_float NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (opening_float >= 0),
  closed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  closed_at TIMESTAMPTZ,
  counted_cash NUMERIC(14,2) CHECK (counted_cash IS NULL OR counted_cash >= 0),
  expected_cash NUMERIC(14,2) CHECK (expected_cash IS NULL OR expected_cash >= 0),
  variance NUMERIC(14,2),
  variance_approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  variance_approved_at TIMESTAMPTZ,
  status shift_status_enum NOT NULL DEFAULT 'open',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT shift_closed_fields_required CHECK (
    status = 'open' OR (
      closed_at IS NOT NULL AND
      closed_by IS NOT NULL AND
      counted_cash IS NOT NULL AND
      expected_cash IS NOT NULL AND
      variance IS NOT NULL
    )
  )
);

-- 3. Only ONE open shift per tenant at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_shifts_one_open_per_tenant
  ON shifts(tenant_id)
  WHERE status = 'open';

-- 4. History query index
CREATE INDEX IF NOT EXISTS idx_shifts_tenant_closed_at
  ON shifts(tenant_id, closed_at DESC)
  WHERE status <> 'open';

-- 5. Tenants: variance approval threshold
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS variance_threshold_kes NUMERIC(10,2) NOT NULL DEFAULT 100.00;

ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_variance_threshold_check;
ALTER TABLE tenants ADD CONSTRAINT tenants_variance_threshold_check
  CHECK (variance_threshold_kes >= 0);

-- 6. Tickets: shift attribution
ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS shift_id UUID REFERENCES shifts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tickets_shift
  ON tickets(shift_id)
  WHERE shift_id IS NOT NULL;

-- 7. Trigger: assign shift_id at the moment a ticket becomes paid
--    (covers INSERT — BBQ/butchery retail; UPDATE — link-mpesa/pay-cash/webhook/ops)
CREATE OR REPLACE FUNCTION set_ticket_shift_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'paid' AND NEW.shift_id IS NULL THEN
    NEW.shift_id := (
      SELECT id FROM shifts
      WHERE tenant_id = NEW.tenant_id AND status = 'open'
      LIMIT 1
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tickets_shift_insert ON tickets;
CREATE TRIGGER trg_tickets_shift_insert
  BEFORE INSERT ON tickets
  FOR EACH ROW
  WHEN (NEW.status = 'paid')
  EXECUTE FUNCTION set_ticket_shift_id();

DROP TRIGGER IF EXISTS trg_tickets_shift_update ON tickets;
CREATE TRIGGER trg_tickets_shift_update
  BEFORE UPDATE ON tickets
  FOR EACH ROW
  WHEN (NEW.status = 'paid' AND OLD.status <> 'paid')
  EXECUTE FUNCTION set_ticket_shift_id();
