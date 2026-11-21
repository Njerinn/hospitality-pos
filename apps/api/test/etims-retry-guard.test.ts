import './env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { config } from '../src/config.js';

// Phase 019d-B: POST /etims/queue/retry/:id only re-queues failed/permanent_fail rows,
// never a ticket that already has a fiscal response, never another tenant's row, admin only.
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

async function mkTenant(db: Db): Promise<string> {
  const r = await db.query(
    "INSERT INTO tenants (name, till_number) VALUES ('Retry Guard Test', 'RTG-' || floor(random()*1000000000)::text) RETURNING id",
  );
  return r.rows[0].id as string;
}

async function mkQueued(
  db: Db,
  tenantId: string,
  status: string,
  attempts: number,
  lastError: string | null,
): Promise<{ ticketId: string; queueId: string }> {
  const t = await db.query(
    "INSERT INTO tickets (tenant_id, status, subtotal, vat_amount, total, closed_at) VALUES ($1, 'paid', 100, 16, 116, NOW() - INTERVAL '1 hour') RETURNING id",
    [tenantId],
  );
  const ticketId = t.rows[0].id as string;
  const q = await db.query(
    'INSERT INTO etims_invoice_queue (tenant_id, ticket_id, status, attempts, last_error) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [tenantId, ticketId, status, attempts, lastError],
  );
  return { ticketId, queueId: q.rows[0].id as string };
}

async function addResponse(db: Db, tenantId: string, ticketId: string): Promise<void> {
  await db.query(
    "INSERT INTO etims_responses (tenant_id, ticket_id, invc_no, rcpt_no, intrl_data, rcpt_sign, raw_response) VALUES ($1, $2, 1, 1, 'x', 'y', '{}'::jsonb)",
    [tenantId, ticketId],
  );
}

async function queueRow(db: Db, queueId: string): Promise<Row> {
  return (await db.query('SELECT status, attempts, last_error FROM etims_invoice_queue WHERE id = $1', [queueId])).rows[0];
}

async function cookieFor(role: string, tenantId: string): Promise<string> {
  const jwt = await new SignJWT({ sub: 'test-user', tenant_id: tenantId, role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(config.JWT_SECRET));
  return config.SESSION_COOKIE_NAME + '=' + jwt;
}

async function retry(app: App, cookie: string, queueId: string) {
  return app.inject({ method: 'POST', url: '/etims/queue/retry/' + queueId, headers: { cookie } });
}

async function cleanup(db: Db, app: App | null, tenantIds: string[]): Promise<void> {
  if (app) await app.close();
  const ids = tenantIds.filter((x) => x);
  if (ids.length > 0) await db.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [ids]);
  await db.end();
}

test('retry: failed/permanent_fail re-queued; other states 409; unknown or other-tenant 404', { skip: dbSkip }, async () => {
  const db = await connect();
  let app: App | null = null;
  let t1 = '';
  let t2 = '';
  try {
    t1 = await mkTenant(db);
    t2 = await mkTenant(db);
    const pf = await mkQueued(db, t1, 'permanent_fail', 5, 'no_etims_device');
    const fl = await mkQueued(db, t1, 'failed', 2, 'timeout:x');
    const su = await mkQueued(db, t1, 'success', 1, null);
    const sb = await mkQueued(db, t1, 'submitting', 1, null);
    const pe = await mkQueued(db, t1, 'pending', 0, null);
    const other = await mkQueued(db, t2, 'permanent_fail', 5, 'x');

    const { buildApp } = await import('../src/app.js');
    app = await buildApp();
    const cookie = await cookieFor('admin', t1);

    const r1 = await retry(app, cookie, pf.queueId);
    assert.equal(r1.statusCode, 200, 'permanent_fail retried: ' + r1.body.slice(0, 200));
    const pfRow = await queueRow(db, pf.queueId);
    assert.equal(pfRow.status, 'pending');
    assert.equal(pfRow.attempts, 0);
    assert.equal(pfRow.last_error, null);

    const r2 = await retry(app, cookie, fl.queueId);
    assert.equal(r2.statusCode, 200, 'failed retried: ' + r2.body.slice(0, 200));
    assert.equal((await queueRow(db, fl.queueId)).status, 'pending');

    for (const [label, row, status, attempts] of [
      ['success', su, 'success', 1],
      ['submitting', sb, 'submitting', 1],
      ['pending', pe, 'pending', 0],
    ] as const) {
      const r = await retry(app, cookie, row.queueId);
      assert.equal(r.statusCode, 409, label + ' must be rejected: ' + r.body.slice(0, 200));
      const body = r.json() as { error?: string; status?: string };
      assert.equal(body.error, 'not_retryable', label + ' error code');
      assert.equal(body.status, status, label + ' reported status');
      const after = await queueRow(db, row.queueId);
      assert.equal(after.status, status, label + ' row unchanged');
      assert.equal(after.attempts, attempts, label + ' attempts unchanged');
    }

    const rOther = await retry(app, cookie, other.queueId);
    assert.equal(rOther.statusCode, 404, "another tenant's row: " + rOther.body.slice(0, 200));
    assert.equal((rOther.json() as { error?: string }).error, 'queue_row_not_found');
    assert.equal((await queueRow(db, other.queueId)).status, 'permanent_fail', "other tenant's row unchanged");

    const rUnknown = await retry(app, cookie, '00000000-0000-4000-8000-000000000009');
    assert.equal(rUnknown.statusCode, 404);
  } finally {
    await cleanup(db, app, [t1, t2]);
  }
});

test('retry: a ticket that already has a fiscal response is never re-queued', { skip: dbSkip }, async () => {
  const db = await connect();
  let app: App | null = null;
  let t1 = '';
  try {
    t1 = await mkTenant(db);
    const pfFis = await mkQueued(db, t1, 'permanent_fail', 5, 'response_persist_failed:x');
    await addResponse(db, t1, pfFis.ticketId);
    const suFis = await mkQueued(db, t1, 'success', 1, null);
    await addResponse(db, t1, suFis.ticketId);

    const { buildApp } = await import('../src/app.js');
    app = await buildApp();
    const cookie = await cookieFor('admin', t1);

    for (const [label, row, status] of [
      ['permanent_fail+response', pfFis, 'permanent_fail'],
      ['success+response', suFis, 'success'],
    ] as const) {
      const r = await retry(app, cookie, row.queueId);
      assert.equal(r.statusCode, 409, label + ': ' + r.body.slice(0, 200));
      assert.equal((r.json() as { error?: string }).error, 'already_fiscalised', label + ' error code');
      assert.equal((await queueRow(db, row.queueId)).status, status, label + ' row unchanged');
    }
  } finally {
    await cleanup(db, app, [t1]);
  }
});

test('retry: manager, cashier and waiter are forbidden and nothing changes', { skip: dbSkip }, async () => {
  const db = await connect();
  let app: App | null = null;
  let t1 = '';
  try {
    t1 = await mkTenant(db);
    const pf = await mkQueued(db, t1, 'permanent_fail', 5, 'no_etims_device');

    const { buildApp } = await import('../src/app.js');
    app = await buildApp();

    for (const role of ['manager', 'cashier', 'waiter']) {
      const r = await retry(app, await cookieFor(role, t1), pf.queueId);
      assert.equal(r.statusCode, 403, role + ' retry → expected 403, got ' + r.statusCode + ': ' + r.body.slice(0, 200));
      assert.equal((r.json() as { error?: string }).error, 'forbidden', role + ' error code');
      assert.equal((await queueRow(db, pf.queueId)).status, 'permanent_fail', role + ' left the row unchanged');
    }
  } finally {
    await cleanup(db, app, [t1]);
  }
});
