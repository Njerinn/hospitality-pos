-- Patch 008A2b: add tax_ty_cd to ticket_items
-- Enables 008B-3 payload builder to emit correct taxTyCd per line.
-- product_id already exists (verified by discovery); included as idempotent safety for fresh installs.
--
-- Idempotent, additive, zero data loss. Existing items backfill to 'B'.

ALTER TABLE ticket_items
  ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES products(id) ON DELETE SET NULL;

ALTER TABLE ticket_items
  ADD COLUMN IF NOT EXISTS tax_ty_cd TEXT NOT NULL DEFAULT 'B';

ALTER TABLE ticket_items DROP CONSTRAINT IF EXISTS ticket_items_tax_ty_cd_check;
ALTER TABLE ticket_items ADD CONSTRAINT ticket_items_tax_ty_cd_check
  CHECK (tax_ty_cd IN ('A', 'B', 'C', 'D', 'E'));

CREATE INDEX IF NOT EXISTS idx_items_tenant_tax
  ON ticket_items(tenant_id, tax_ty_cd);
