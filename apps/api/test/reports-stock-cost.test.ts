import './env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { config } from '../src/config.js';

// Phase 019e-A: the three stock-cost report queries must keep summing normal deductions
// exactly (regression guard for the NOT EXISTS void_restore clause added to each).
const testDbUrl = process.env.HPP_TEST_DB_URL;
const dbSkip = testDbUrl ? false : 'HPP_TEST_DB_URL not set';

type Row = Record<string, any>;
type Db = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Row[] }>;
  end: () => Promise<void>;
};
type App = Awaited<ReturnType<typeof import('../src/app.js').buildApp>>;

async function connect(): Promise<Db> {
  const pg = (await import('pg')).default;
  const client = new pg.Client({ connectionString: testDbUrl, ssl: false });
  await client.connect();
  return client as unknown as Db;
}

function isoDay(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
}

async function cookieFor(role: string, tenantId: string): Promise<string> {
  const jwt = await new SignJWT({ sub: 'test-user', tenant_id: tenantId, role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(config.JWT_SECRET));
  return config.SESSION_COOKIE_NAME + '=' + jwt;
}

async function seed(db: Db): Promise<string> {
  const t = await db.query(
    "INSERT INTO tenants (name, till_number) VALUES ('Cost Report Test', 'CRT-' || floor(random()*1000000000)::text) RETURNING id",
  );
  const tenantId = t.rows[0].id as string;
  const s = await db.query(
    "INSERT INTO stock_items (tenant_id, name, unit, quantity, cost_per_unit) VALUES ($1, 'CR Test Rice', 'kg', 100, 10) RETURNING id",
    [tenantId],
  );
  await db.query(
    "INSERT INTO stock_movements (tenant_id, stock_item_id, delta, reason, ref_id) VALUES ($1, $2, -2, 'deduction', gen_random_uuid())",
    [tenantId, s.rows[0].id],
  );
  return tenantId;
}

test('reports: summary stock_cost and stock-usage still count a normal deduction exactly', { skip: dbSkip }, async () => {
  const db = await connect();
  let app: App | null = null;
  let tenantId = '';
  try {
    tenantId = await seed(db);
    const { buildApp } = await import('../src/app.js');
    app = await buildApp();
    const cookie = await cookieFor('admin', tenantId);
    const range = 'from=' + isoDay(-1) + '&to=' + isoDay(1);

    const sum = await app.inject({ method: 'GET', url: '/reports/summary?' + range, headers: { cookie } });
    assert.equal(sum.statusCode, 200, 'summary: ' + sum.body.slice(0, 200));
    assert.equal((sum.json() as { stock_cost?: string }).stock_cost, '20.00', '2 kg × 10 = 20.00');

    const usage = await app.inject({ method: 'GET', url: '/reports/stock-usage?' + range, headers: { cookie } });
    assert.equal(usage.statusCode, 200, 'stock-usage: ' + usage.body.slice(0, 200));
    const items = (usage.json() as { items: Array<{ name: string; total_consumed: string; total_cost: string }> }).items;
    const rice = items.find((i) => i.name === 'CR Test Rice');
    assert.ok(rice, 'rice row present');
    assert.equal(Number(rice!.total_consumed), 2);
    assert.equal(Number(rice!.total_cost), 20);
  } finally {
    if (app) await app.close();
    if (tenantId) await db.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
    await db.end();
  }
});

test('reports: PDF statement export still renders with the stock-usage query', { skip: dbSkip }, async () => {
  const db = await connect();
  let app: App | null = null;
  let tenantId = '';
  try {
    tenantId = await seed(db);
    const { buildApp } = await import('../src/app.js');
    app = await buildApp();
    const cookie = await cookieFor('admin', tenantId);
    const res = await app.inject({
      method: 'POST',
      url: '/reports/export/pdf',
      headers: { cookie, 'content-type': 'application/json' },
      payload: JSON.stringify({ from: isoDay(-1), to: isoDay(1) }),
    });
    assert.equal(res.statusCode, 200, 'pdf export: ' + res.body.slice(0, 200));
    assert.match(String(res.headers['content-type']), /application\/pdf/);
    assert.equal(res.rawPayload.subarray(0, 4).toString(), '%PDF', 'body is a real PDF');
  } finally {
    if (app) await app.close();
    if (tenantId) await db.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
    await db.end();
  }
});
