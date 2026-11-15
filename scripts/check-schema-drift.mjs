// Schema-drift check: verify every column referenced by code INSERT/UPDATE
// statements exists in the schema after all migrations are applied.
//
// Catches the exact bug class that broke Phase 018b: code writing
// tickets.type but no migration ever created it in production/staging.
//
// Usage (CI or local):
//   DATABASE_URL=postgres://pos:pos@127.0.0.1:5432/pos node scripts/check-schema-drift.mjs
//
// Exit 0 = no drift. Exit 1 = drift detected (details on stderr).

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
const { Client } = pg;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL missing');
  process.exit(1);
}

const client = new Client({
  connectionString: DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});
await client.connect();

// ─── 1. Build schema map from information_schema ───
const { rows } = await client.query(`
  SELECT table_name, column_name
  FROM information_schema.columns
  WHERE table_schema = 'public'
  ORDER BY table_name, ordinal_position
`);
const schema = new Map();
for (const r of rows) {
  if (!schema.has(r.table_name)) schema.set(r.table_name, new Set());
  schema.get(r.table_name).add(r.column_name);
}
await client.end();

// ─── 2. Walk source tree ───
async function walk(dir, acc = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (['node_modules', 'dist', '.git', 'coverage'].includes(e.name)) continue;
      await walk(p, acc);
    } else if (/\.(ts|mjs|js)$/.test(e.name)) {
      acc.push(p);
    }
  }
  return acc;
}

const files = [
  ...(await walk('apps/api/src')),
  ...(await walk('scripts')),
];

// ─── 3. Extract INSERT INTO <table> (<cols>) ───
function extractInserts(src) {
  const out = [];
  const re = /INSERT\s+INTO\s+([a-z_][a-z0-9_]*)\s*\(([\s\S]*?)\)\s*VALUES/gi;
  let m;
  while ((m = re.exec(src)) !== null) {
    const table = m[1].toLowerCase();
    const colsRaw = m[2];
    if (/SELECT/i.test(colsRaw)) continue;
    const cols = colsRaw
      .split(',')
      .map((c) => c.trim().replace(/^["`]|["`]$/g, ''))
      .filter((c) => /^[a-z_][a-z0-9_]*$/i.test(c));
    if (cols.length > 0) out.push({ table, cols });
  }
  return out;
}

// ─── 4. Extract UPDATE <table> SET <col> = ... ───
function extractUpdates(src) {
  const out = [];
  const re = /UPDATE\s+([a-z_][a-z0-9_]*)\s+SET\s+([\s\S]*?)(?:\bWHERE\b|\bRETURNING\b|$)/gi;
  let m;
  while ((m = re.exec(src)) !== null) {
    const table = m[1].toLowerCase();
    const setClause = m[2];
    const cols = [];
    for (const piece of setClause.split(',')) {
      const eq = piece.indexOf('=');
      if (eq === -1) continue;
      const lhs = piece.slice(0, eq).trim().replace(/^["`]|["`]$/g, '');
      if (/^[a-z_][a-z0-9_]*$/i.test(lhs)) cols.push(lhs);
    }
    if (cols.length > 0) out.push({ table, cols });
  }
  return out;
}

// ─── 5. Validate ───
const errors = [];
let checkedInserts = 0;
let checkedUpdates = 0;

for (const file of files) {
  const src = await readFile(file, 'utf8');

  for (const { table, cols } of extractInserts(src)) {
    checkedInserts++;
    if (!schema.has(table)) {
      errors.push(`${file}: INSERT INTO ${table} — table does not exist in schema`);
      continue;
    }
    const tableCols = schema.get(table);
    for (const c of cols) {
      if (!tableCols.has(c)) {
        errors.push(`${file}: INSERT INTO ${table} references missing column "${c}"`);
      }
    }
  }

  for (const { table, cols } of extractUpdates(src)) {
    checkedUpdates++;
    if (!schema.has(table)) {
      errors.push(`${file}: UPDATE ${table} — table does not exist in schema`);
      continue;
    }
    const tableCols = schema.get(table);
    for (const c of cols) {
      if (!tableCols.has(c)) {
        errors.push(`${file}: UPDATE ${table} references missing column "${c}"`);
      }
    }
  }
}

// ─── 6. Report ───
console.log(`Scanned ${files.length} files.`);
console.log(`Schema contains ${schema.size} tables.`);
console.log(`Checked ${checkedInserts} INSERT statements, ${checkedUpdates} UPDATE statements.`);

if (errors.length > 0) {
  console.error('');
  console.error(`❌ SCHEMA DRIFT DETECTED — ${errors.length} issue(s):`);
  for (const e of errors) console.error(`  • ${e}`);
  console.error('');
  console.error('Fix: add the missing column to a migration, apply to all environments, re-run this check.');
  process.exit(1);
}

console.log('✅ No schema drift detected.');
