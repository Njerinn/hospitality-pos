import './env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { config } from '../src/config.js';

// Phase 019e-B: void reason + audit trail + stock restore (unsent items only).
const testDbUrl = process.env.HPP_TEST_DB_URL;
const dbSkip = testDbUrl ? false : 'HPP_TEST_DB_URL not set';

type Row = Record<string, any>;
type Db = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Row[] }>;
  end: () => Promise<void>;
};
type App = Awaited<ReturnType<typeof import('../src/app.js').buildApp>>;
type Ctx = { tenantId: string; manager: string; waiter: string; admin: string; stockItemId: string; productId: string };

async function connect(): Promise<Db> {
  const pg = (await import('pg')).default;
  const client = new pg.Client({ connectionString: testDbUrl, ssl: false });
  await client.connect();
  return client as unknown as Db;
}

function isoDay(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
}

async function mkUser(db: Db, tenantId: string, role: string): Promise<string> {
  const email = 'va-' + role + '-' + Math.random().toString(36).slice(2) + '@test.invalid';
  const r = await db.query(
    "INSERT INTO users (tenant_id, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id",
    [tenantId, email, role],
  );
  return r.rows[0].id as string;
}

async function seed(db: Db): Promise<Ctx> {
  const t = await db.query(
    "INSERT INTO tenants (name, till_number) VALUES ('Void Audit Test', 'VAT-' || floor(random()*1000000000)::text) RETURNING id",
  );
  const tenantId = t.rows[0].id as string;
  const manager = await mkUser(db, tenantId, 'manager');
  const waiter = await mkUser(db, tenantId, 'waiter');
  const admin = await mkUser(db, tenantId, 'admin');
  const s = await db.query(
    "INSERT INTO stock_items (tenant_id, name, unit, quantity, cost_per_unit) VALUES ($1, 'VA Rice', 'kg', 100, 10) RETURNING id",
    [tenantId],
  );
  const p = await db.query("INSERT INTO products (tenant_id, name, price) VALUES ($1, 'VA Dish', 100) RETURNING id", [tenantId]);
  await db.query(
    'INSERT INTO recipes (tenant_id, product_id, stock_item_id, quantity_per_product) VALUES ($1, $2, $3, 1.5)',
    [tenantId, p.rows[0].id, s.rows[0].id],
  );
  return { tenantId, manager, waiter, admin, stockItemId: s.rows[0].id as string, productId: p.rows[0].id as string };
}

async function cookieFor(role: string, tenantId: string, userId: string): Promise<string> {
  const jwt = await new SignJWT({ sub: userId, tenant_id: tenantId, role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(config.JWT_SECRET));
  return config.SESSION_COOKIE_NAME + '=' + jwt;
}

async function call(app: App, method: 'GET' | 'POST', url: string, cookie: string, payload?: unknown) {
  return app.inject({
    method,
    url,
    headers: payload === undefined ? { cookie } : { cookie, 'content-type': 'application/json' },
    payload: payload === undefined ? undefined : JSON.stringify(payload),
  });
}

async function openTicket(app: App, cookie: string): Promise<string> {
  const r = await call(app, 'POST', '/tickets', cookie, {});
  assert.equal(r.statusCode, 201, 'open ticket: ' + r.body.slice(0, 200));
  return (r.json() as { id: string }).id;
}

async function addItem(app: App, cookie: string, ticketId: string, ctx: Ctx, quantity: number): Promise<string> {
  const r = await call(app, 'POST', '/tickets/' + ticketId + '/items', cookie, {
    name: 'VA Dish',
    quantity,
    unit_price: 100,
    product_id: ctx.productId,
  });
  assert.equal(r.statusCode, 201, 'add item: ' + r.body.slice(0, 200));
  return (r.json() as { id: string }).id;
}

async function stockQty(db: Db, ctx: Ctx): Promise<number> {
  const r = await db.query('SELECT quantity FROM stock_items WHERE id = $1', [ctx.stockItemId]);
  return Number(r.rows[0].quantity);
}

async function restoreCount(db: Db, ctx: Ctx): Promise<number> {
  const r = await db.query(
    "SELECT COUNT(*)::int AS n FROM stock_movements WHERE tenant_id = $1 AND reason = 'void_restore'",
    [ctx.tenantId],
  );
  return Number(r.rows[0].n);
}

async function ticketStatus(db: Db, ticketId: string): Promise<string> {
  return (await db.query('SELECT status FROM tickets WHERE id = $1', [ticketId])).rows[0].status as string;
}

async function cleanup(db: Db, app: App | null, ctx: Ctx | null): Promise<void> {
  if (app) await app.close();
  if (ctx) await db.query('DELETE FROM tenants WHERE id = $1', [ctx.tenantId]);
  await db.end();
}

test('void: unsent items restored, sent items stay as waste, audit recorded, reports net out', { skip: dbSkip }, async () => {
  const db = await connect();
  let app: App | null = null;
  let ctx: Ctx | null = null;
  try {
    ctx = await seed(db);
    const { buildApp } = await import('../src/app.js');
    app = await buildApp();
    const mgr = await cookieFor('manager', ctx.tenantId, ctx.manager);

    const ticketId = await openTicket(app, mgr);
    const itemA = await addItem(app, mgr, ticketId, ctx, 2); // 3.0 kg deducted, stays UNSENT
    const itemB = await addItem(app, mgr, ticketId, ctx, 1); // 1.5 kg deducted, will be SENT
    assert.equal(await stockQty(db, ctx), 95.5, 'after both deductions');

    const sent = await call(app, 'POST', '/tickets/' + ticketId + '/send', mgr, { item_ids: [itemB] });
    assert.equal(sent.statusCode, 200, 'send: ' + sent.body.slice(0, 200));

    const v = await call(app, 'POST', '/tickets/' + ticketId + '/state', mgr, { to: 'voided', reason: '  Guest left before ordering  ' });
    assert.equal(v.statusCode, 200, 'void: ' + v.body.slice(0, 300));
    const vb = v.json() as { ok?: boolean; status?: string; stock_restored?: number };
    assert.equal(vb.ok, true);
    assert.equal(vb.status, 'voided');
    assert.equal(vb.stock_restored, 1, 'one stock item restored');

    assert.equal(await stockQty(db, ctx), 98.5, 'only the unsent item (3.0 kg) came back; sent item stays consumed');

    const t = (await db.query(
      'SELECT status, void_reason, voided_by, voided_at IS NOT NULL AS has_at, closed_at IS NOT NULL AS has_closed FROM tickets WHERE id = $1',
      [ticketId],
    )).rows[0];
    assert.equal(t.status, 'voided');
    assert.equal(t.void_reason, 'Guest left before ordering', 'reason stored trimmed');
    assert.equal(t.voided_by, ctx.manager, 'voider recorded');
    assert.equal(t.has_at, true);
    assert.equal(t.has_closed, true);

    const ded = (await db.query(
      "SELECT ref_id, delta FROM stock_movements WHERE tenant_id = $1 AND reason = 'deduction' ORDER BY delta",
      [ctx.tenantId],
    )).rows;
    assert.equal(ded.length, 2, 'both original deductions stay in the ledger');
    const res = (await db.query(
      "SELECT ref_id, delta, outlet FROM stock_movements WHERE tenant_id = $1 AND reason = 'void_restore'",
      [ctx.tenantId],
    )).rows;
    assert.equal(res.length, 1, 'exactly one restore movement');
    assert.equal(res[0].ref_id, itemA, 'restore is tied to the unsent item');
    assert.equal(Number(res[0].delta), 3, 'restore equals the original deduction');
    assert.equal(res[0].outlet, 'kitchen', 'same outlet as the deduction');

    const range = 'from=' + isoDay(-1) + '&to=' + isoDay(1);
    const sum = await call(app, 'GET', '/reports/summary?' + range, mgr);
    assert.equal(sum.statusCode, 200);
    assert.equal((sum.json() as { stock_cost?: string }).stock_cost, '15.00', 'cost counts only the sent (wasted) item: 1.5 kg x 10');
    const usage = await call(app, 'GET', '/reports/stock-usage?' + range, mgr);
    const rice = (usage.json() as { items: Array<{ name: string; total_consumed: string; total_cost: string }> }).items.find((i) => i.name === 'VA Rice');
    assert.ok(rice, 'rice row present');
    assert.equal(Number(rice!.total_consumed), 1.5);
    assert.equal(Number(rice!.total_cost), 15);
  } finally {
    await cleanup(db, app, ctx);
  }
});

test('void: reason is required and validated; waiters are refused first', { skip: dbSkip }, async () => {
  const db = await connect();
  let app: App | null = null;
  let ctx: Ctx | null = null;
  try {
    ctx = await seed(db);
    const { buildApp } = await import('../src/app.js');
    app = await buildApp();
    const mgr = await cookieFor('manager', ctx.tenantId, ctx.manager);
    const wtr = await cookieFor('waiter', ctx.tenantId, ctx.waiter);
    const adm = await cookieFor('admin', ctx.tenantId, ctx.admin);

    const ticketId = await openTicket(app, mgr);
    await addItem(app, mgr, ticketId, ctx, 1);
    const baseline = await stockQty(db, ctx);

    const bad: Array<[string, Record<string, unknown>, string]> = [
      ['missing', { to: 'voided' }, 'void_reason_required'],
      ['blank', { to: 'voided', reason: '   ' }, 'void_reason_required'],
      ['non-string', { to: 'voided', reason: 123 }, 'void_reason_required'],
      ['too short', { to: 'voided', reason: 'ab' }, 'void_reason_invalid'],
      ['too long', { to: 'voided', reason: 'x'.repeat(201) }, 'void_reason_invalid'],
    ];
    for (const [label, payload, code] of bad) {
      const r = await call(app, 'POST', '/tickets/' + ticketId + '/state', mgr, payload);
      assert.equal(r.statusCode, 400, label + ': ' + r.body.slice(0, 200));
      assert.equal((r.json() as { error?: string }).error, code, label + ' error code');
      assert.equal(await ticketStatus(db, ticketId), 'open', label + ': ticket untouched');
      assert.equal(await stockQty(db, ctx), baseline, label + ': stock untouched');
    }

    const w1 = await call(app, 'POST', '/tickets/' + ticketId + '/state', wtr, { to: 'voided' });
    assert.equal(w1.statusCode, 403, 'waiter without reason → role check wins: ' + w1.body.slice(0, 200));
    const w2 = await call(app, 'POST', '/tickets/' + ticketId + '/state', wtr, { to: 'voided', reason: 'Valid reason text' });
    assert.equal(w2.statusCode, 403, 'waiter with reason: ' + w2.body.slice(0, 200));
    assert.equal(await ticketStatus(db, ticketId), 'open', 'waiter attempts changed nothing');

    const t3 = await openTicket(app, mgr);
    const r3 = await call(app, 'POST', '/tickets/' + t3 + '/state', mgr, { to: 'voided', reason: 'abc' });
    assert.equal(r3.statusCode, 200, '3-char reason accepted: ' + r3.body.slice(0, 200));
    const t200 = await openTicket(app, mgr);
    const r200 = await call(app, 'POST', '/tickets/' + t200 + '/state', adm, { to: 'voided', reason: 'x'.repeat(200) });
    assert.equal(r200.statusCode, 200, '200-char reason accepted by admin: ' + r200.body.slice(0, 200));
    const len = (await db.query('SELECT char_length(void_reason) AS n, voided_by FROM tickets WHERE id = $1', [t200])).rows[0];
    assert.equal(Number(len.n), 200);
    assert.equal(len.voided_by, ctx.admin);
  } finally {
    await cleanup(db, app, ctx);
  }
});

test('void: concurrent and repeated voids restore stock exactly once', { skip: dbSkip }, async () => {
  const db = await connect();
  let app: App | null = null;
  let ctx: Ctx | null = null;
  try {
    ctx = await seed(db);
    const { buildApp } = await import('../src/app.js');
    app = await buildApp();
    const mgr = await cookieFor('manager', ctx.tenantId, ctx.manager);
    const adm = await cookieFor('admin', ctx.tenantId, ctx.admin);

    const ticketId = await openTicket(app, mgr);
    await addItem(app, mgr, ticketId, ctx, 2);
    assert.equal(await stockQty(db, ctx), 97, 'after deduction');

    const [a, b] = await Promise.all([
      call(app, 'POST', '/tickets/' + ticketId + '/state', mgr, { to: 'voided', reason: 'Double tap test A' }),
      call(app, 'POST', '/tickets/' + ticketId + '/state', adm, { to: 'voided', reason: 'Double tap test B' }),
    ]);
    const codes = [a.statusCode, b.statusCode].sort();
    assert.deepEqual(codes, [200, 409], 'exactly one wins: ' + a.body.slice(0, 120) + ' | ' + b.body.slice(0, 120));
    const loser = a.statusCode === 409 ? a : b;
    assert.equal((loser.json() as { error?: string }).error, 'invalid_transition');

    assert.equal(await stockQty(db, ctx), 100, 'restored exactly once');
    assert.equal(await restoreCount(db, ctx), 1, 'one restore movement');

    const again = await call(app, 'POST', '/tickets/' + ticketId + '/state', mgr, { to: 'voided', reason: 'Third attempt' });
    assert.equal(again.statusCode, 409, 'repeat void: ' + again.body.slice(0, 200));
    assert.equal(await stockQty(db, ctx), 100, 'still 100 after repeat');
    assert.equal(await restoreCount(db, ctx), 1, 'still one restore movement');
  } finally {
    await cleanup(db, app, ctx);
  }
});

test('void: database enforces the reason length and the new movement reason', { skip: dbSkip }, async () => {
  const db = await connect();
  let ctx: Ctx | null = null;
  try {
    ctx = await seed(db);
    const t = await db.query("INSERT INTO tickets (tenant_id, status) VALUES ($1, 'open') RETURNING id", [ctx.tenantId]);
    const id = t.rows[0].id as string;

    await assert.rejects(db.query("UPDATE tickets SET void_reason = 'ab' WHERE id = $1", [id]), (e: any) => e.code === '23514');
    await assert.rejects(db.query('UPDATE tickets SET void_reason = $2 WHERE id = $1', [id, 'x'.repeat(201)]), (e: any) => e.code === '23514');
    await db.query("UPDATE tickets SET void_reason = 'abc' WHERE id = $1", [id]);

    await db.query(
      "INSERT INTO stock_movements (tenant_id, stock_item_id, delta, reason, ref_id) VALUES ($1, $2, 1, 'void_restore', gen_random_uuid())",
      [ctx.tenantId, ctx.stockItemId],
    );
    await assert.rejects(
      db.query("INSERT INTO stock_movements (tenant_id, stock_item_id, delta, reason) VALUES ($1, $2, 1, 'bogus')", [ctx.tenantId, ctx.stockItemId]),
      (e: any) => e.code === '23514',
    );
  } finally {
    await cleanup(db, null, ctx);
  }
});
