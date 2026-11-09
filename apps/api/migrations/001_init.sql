-- gen_random_uuid() is in PostgreSQL core since 13; no extension required.

CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  till_number TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'cashier',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, email)
);
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);

CREATE TABLE IF NOT EXISTS mpesa_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  trans_id TEXT NOT NULL,
  trans_time TIMESTAMPTZ NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  msisdn TEXT NOT NULL,
  bill_ref TEXT,
  store_number TEXT,
  raw_payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'CONFIRMED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (trans_id)
);
CREATE INDEX IF NOT EXISTS idx_mpesa_tenant ON mpesa_transactions(tenant_id);
