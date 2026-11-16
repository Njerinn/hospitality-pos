import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';
const { Client } = pg;

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL missing');
  process.exit(1);
}

const client = new Client({
  connectionString: url,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});
await client.connect();

// Phase 018e: applied-migrations ledger. Created inline so the runner does not
// depend on any migration having created it first.
await client.query(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`);

const dir = new URL('../apps/api/migrations/', import.meta.url);
const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();

const appliedRows = await client.query('SELECT name FROM schema_migrations');
const applied = new Set(appliedRows.rows.map((r) => r.name));

const tenantsExists =
  (
    await client.query(
      "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='tenants'"
    )
  ).rowCount > 0;

if (applied.size === 0 && tenantsExists) {
  // Bootstrap: existing deployment with no ledger yet. Trust that the files on
  // disk correspond to what was applied previously, seed the ledger, apply nothing.
  console.log('📘 bootstrap: existing DB detected, seeding ledger without re-applying');
  for (const f of files) {
    await client.query(
      'INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING',
      [f]
    );
    console.log(`  + ${f} (assumed applied)`);
  }
  console.log(`✅ ledger seeded with ${files.length} migrations — nothing re-applied this run`);
} else {
  let pending = 0;
  for (const f of files) {
    if (applied.has(f)) {
      console.log(`⏭️  ${f} (already applied)`);
      continue;
    }
    const sql = await readFile(new URL(f, dir), 'utf8');
    console.log(`▶ applying ${f}`);
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
    pending++;
  }
  console.log(`✅ migrations complete — ${pending} applied, ${files.length - pending} skipped`);
}

await client.end();
