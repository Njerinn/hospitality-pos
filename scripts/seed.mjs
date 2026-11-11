import bcrypt from 'bcryptjs';
import pg from 'pg';
const { Client } = pg;

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL missing');
  process.exit(1);
}

const email = process.env.SEED_EMAIL || 'admin@demo.local';
const password = process.env.SEED_PASSWORD || 'ChangeMe123!';
const till = process.env.SEED_TILL || '600000';

const client = new Client({
  connectionString: url,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});
await client.connect();

const hash = await bcrypt.hash(password, 10);
const tenantRes = await client.query(
  `INSERT INTO tenants (name, till_number) VALUES ($1, $2)
   ON CONFLICT (till_number) DO UPDATE SET name = EXCLUDED.name
   RETURNING id`,
  ['Demo Hotel', till],
);
const tenantId = tenantRes.rows[0].id;

await client.query(
  `INSERT INTO users (tenant_id, email, password_hash, role) VALUES ($1, $2, $3, 'admin')
   ON CONFLICT (tenant_id, email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
  [tenantId, email, hash],
);

// ───── patch 011: role users (idempotent) ─────
const roleUsers = [
  { email: 'manager@demo.local', role: 'manager' },
  { email: 'cashier@demo.local', role: 'cashier' },
  { email: 'waiter@demo.local', role: 'waiter' },
  { email: 'kitchen@demo.local', role: 'kitchen' },
];
for (const u of roleUsers) {
  await client.query(
    `INSERT INTO users (tenant_id, email, password_hash, role) VALUES ($1, $2, $3, $4)
     ON CONFLICT (tenant_id, email) DO UPDATE SET role = EXCLUDED.role`,
    [tenantId, u.email, hash, u.role],
  );
}

console.log(`✅ seeded tenant=${tenantId} user=${email}`);
console.log(`✅ seeded role users: ${roleUsers.map((u) => u.email + ' (' + u.role + ')').join(', ')}`);
await client.end();
