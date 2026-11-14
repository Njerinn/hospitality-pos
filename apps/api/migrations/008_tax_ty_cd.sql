-- Patch 008A2: Add KRA tax type code to products
-- Enables 008B-3 to build saveTrnsSalesOsdc payloads with correct taxTyCd per line.
--
-- KRA tax type codes:
--   A = Exempt
--   B = VAT 16% (standard — default for restaurants)
--   C = Zero-rated
--   D = Non-VAT (out of scope)
--   E = VAT 8% (reduced)
--
-- Idempotent, additive, zero data loss. Existing products backfilled to 'B'.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS tax_ty_cd TEXT NOT NULL DEFAULT 'B';

ALTER TABLE products DROP CONSTRAINT IF EXISTS products_tax_ty_cd_check;
ALTER TABLE products ADD CONSTRAINT products_tax_ty_cd_check
  CHECK (tax_ty_cd IN ('A', 'B', 'C', 'D', 'E'));

CREATE INDEX IF NOT EXISTS idx_products_tenant_tax
  ON products(tenant_id, tax_ty_cd);
