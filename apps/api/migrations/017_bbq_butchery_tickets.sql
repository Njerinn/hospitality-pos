-- Phase 018b: link BBQ + butchery sales to retail tickets so they flow through eTIMS
ALTER TABLE bbq_sales ADD COLUMN IF NOT EXISTS ticket_id UUID REFERENCES tickets(id) ON DELETE SET NULL;
ALTER TABLE butchery_sales ADD COLUMN IF NOT EXISTS ticket_id UUID REFERENCES tickets(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_bbq_sales_ticket ON bbq_sales(ticket_id) WHERE ticket_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_butchery_sales_ticket ON butchery_sales(ticket_id) WHERE ticket_id IS NOT NULL;
