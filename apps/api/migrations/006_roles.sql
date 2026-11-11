-- Patch 011: role-based access control
-- Enforces the five-role matrix via CHECK constraint.
-- Idempotent: safe to re-run.
--
-- Roles:
--   admin    — super-user, all routes
--   manager  — all routes except /admin/*
--   cashier  — tables, tickets, payments
--   waiter   — tables, tickets (no payment)
--   kitchen  — kds only

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'manager', 'cashier', 'waiter', 'kitchen'));
