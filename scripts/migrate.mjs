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

const dir = new URL('../apps/api/migrations/', import.meta.url);
const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
for (const f of files) {
  const sql = await readFile(new URL(f, dir), 'utf8');
  console.log(`▶ applying ${f}`);
  await client.query(sql);
}
await client.end();
console.log('✅ migrations complete');
