-- Patch 008A2c: VAT-inclusive pricing flag on tenants
-- Enables per-tenant VAT-inclusive price display (D15 = C)
-- Idempotent, additive, zero data loss. Existing tenants default to FALSE (VAT-exclusive — current behavior).

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS vat_inclusive BOOLEAN NOT NULL DEFAULT FALSE;
