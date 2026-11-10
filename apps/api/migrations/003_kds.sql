-- Patch 006: KDS (Kitchen Display Screen)
-- Adds ready_at / ready_by to ticket_items so kitchen can "bump" items.

ALTER TABLE ticket_items
  ADD COLUMN IF NOT EXISTS ready_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ready_by UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_items_pending_kitchen
  ON ticket_items(tenant_id, created_at)
  WHERE sent_to_kitchen = TRUE AND ready_at IS NULL;
