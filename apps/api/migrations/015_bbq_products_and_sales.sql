-- Phase 017: BBQ outlet products + BBQ sales
-- Adds outlet dimension to products so BBQ items are separated from kitchen menu.
-- Existing products default to 'kitchen' (backward compatible).
-- Adds bbq_sales table for sale recording; recipe deduction handled at app layer.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS outlet TEXT NOT NULL DEFAULT 'kitchen';

ALTER TABLE products DROP CONSTRAINT IF EXISTS products_outlet_check;
ALTER TABLE products ADD CONSTRAINT products_outlet_check
  CHECK (outlet IN ('kitchen', 'bbq', 'butchery'));

CREATE INDEX IF NOT EXISTS idx_products_outlet
  ON products (tenant_id, outlet) WHERE active = TRUE;

CREATE TABLE IF NOT EXISTS bbq_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity INT NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(14,2) NOT NULL CHECK (unit_price >= 0),
  total_amount NUMERIC(14,2) NOT NULL CHECK (total_amount >= 0),
  sold_by UUID REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  recipe_deducted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bbq_sales_tenant
  ON bbq_sales (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bbq_sales_product
  ON bbq_sales (product_id, created_at DESC);
