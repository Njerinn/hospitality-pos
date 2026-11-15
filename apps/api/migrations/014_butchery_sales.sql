-- Phase 016: butchery sales
-- Records meat sold by weight (grams), deducts butchery-outlet stock, creates
-- a stock_movement with reason='consumption' outlet='butchery' for audit.
--
-- Design: price_per_kg entered per-sale (market prices vary daily).
-- Butchery stock items must have unit='g'; other units rejected at app layer.

CREATE TABLE IF NOT EXISTS butchery_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  stock_item_id UUID NOT NULL REFERENCES stock_items(id) ON DELETE RESTRICT,
  weight_g NUMERIC(14,3) NOT NULL CHECK (weight_g > 0),
  price_per_kg NUMERIC(14,2) NOT NULL CHECK (price_per_kg >= 0),
  total_amount NUMERIC(14,2) NOT NULL CHECK (total_amount >= 0),
  cost_basis NUMERIC(14,2) NOT NULL DEFAULT 0,
  sold_by UUID REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_butchery_sales_tenant
  ON butchery_sales(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_butchery_sales_stock
  ON butchery_sales(stock_item_id, created_at DESC);
