-- Patch 008A: Multi-tenant eTIMS configuration + M-Pesa PayBill support
-- Additive, idempotent, zero data loss.
--
-- Adds to `tenants`:
--   business_structure, kra_pin, kra_pin_type, vat_registered,
--   etims_enabled, etims_mode, paybill_number, mpesa_fixed_account
--
-- New tables:
--   etims_devices, etims_invoice_queue, etims_responses, etims_code_lists

-- 1. Business structure ENUM
DO $$ BEGIN
  CREATE TYPE business_structure_enum AS ENUM (
    'sole_proprietor',
    'private_company',
    'public_company',
    'partnership',
    'sacco',
    'cooperative'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. PIN type ENUM
DO $$ BEGIN
  CREATE TYPE kra_pin_type_enum AS ENUM ('personal', 'non_individual');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 3. eTIMS mode ENUM
DO $$ BEGIN
  CREATE TYPE etims_mode_enum AS ENUM ('disabled', 'sandbox', 'production');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 4. Add columns to tenants (all idempotent)
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS business_structure business_structure_enum,
  ADD COLUMN IF NOT EXISTS kra_pin TEXT,
  ADD COLUMN IF NOT EXISTS kra_pin_type kra_pin_type_enum,
  ADD COLUMN IF NOT EXISTS vat_registered BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS etims_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS etims_mode etims_mode_enum NOT NULL DEFAULT 'disabled',
  ADD COLUMN IF NOT EXISTS paybill_number TEXT,
  ADD COLUMN IF NOT EXISTS mpesa_fixed_account TEXT;

-- 5. PIN type must match business structure (when both are set)
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_pin_type_matches_structure;
ALTER TABLE tenants ADD CONSTRAINT tenants_pin_type_matches_structure
  CHECK (
    kra_pin_type IS NULL
    OR (
      business_structure IS NOT NULL
      AND (
        (business_structure = 'sole_proprietor' AND kra_pin_type = 'personal')
        OR (business_structure <> 'sole_proprietor' AND kra_pin_type = 'non_individual')
      )
    )
  );

-- 6. eTIMS cannot be enabled without declared structure + PIN
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_etims_requires_config;
ALTER TABLE tenants ADD CONSTRAINT tenants_etims_requires_config
  CHECK (
    etims_enabled = FALSE
    OR (business_structure IS NOT NULL AND kra_pin IS NOT NULL AND kra_pin_type IS NOT NULL)
  );

-- 7. eTIMS mode cannot advance past 'disabled' without declared structure
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_etims_mode_requires_structure;
ALTER TABLE tenants ADD CONSTRAINT tenants_etims_mode_requires_structure
  CHECK (etims_mode = 'disabled' OR business_structure IS NOT NULL);

-- 8. eTIMS device handshake state (per branch)
CREATE TABLE IF NOT EXISTS etims_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  bhf_id TEXT NOT NULL,
  dvc_srl_no TEXT NOT NULL,
  cmc_key_encrypted TEXT NOT NULL,
  last_handshake_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_notice_poll_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, bhf_id, dvc_srl_no)
);
CREATE INDEX IF NOT EXISTS idx_etims_devices_tenant ON etims_devices(tenant_id);

-- 9. Async submission queue (one entry per paid ticket)
CREATE TABLE IF NOT EXISTS etims_invoice_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','submitting','success','failed','permanent_fail')),
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  next_retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ticket_id)
);
CREATE INDEX IF NOT EXISTS idx_etims_queue_status_retry
  ON etims_invoice_queue(status, next_retry_at)
  WHERE status IN ('pending', 'failed');
CREATE INDEX IF NOT EXISTS idx_etims_queue_tenant ON etims_invoice_queue(tenant_id);

-- 10. Fiscal response per successful ticket
CREATE TABLE IF NOT EXISTS etims_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  invc_no BIGINT NOT NULL,
  rcpt_no BIGINT NOT NULL,
  intrl_data TEXT NOT NULL,
  rcpt_sign TEXT NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw_response JSONB NOT NULL,
  UNIQUE (ticket_id)
);
CREATE INDEX IF NOT EXISTS idx_etims_responses_tenant ON etims_responses(tenant_id);
CREATE INDEX IF NOT EXISTS idx_etims_responses_invc
  ON etims_responses(tenant_id, invc_no);

-- 11. Cached KRA code lists
CREATE TABLE IF NOT EXISTS etims_code_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code_type TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  extra JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, code_type, code)
);
CREATE INDEX IF NOT EXISTS idx_etims_code_lists_tenant_type
  ON etims_code_lists(tenant_id, code_type);
