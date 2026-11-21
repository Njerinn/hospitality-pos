import './env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { recoverStaleSubmitting, enqueueMissingFiscalReceipts } from '../src/modules/etims/reconcile.js';

// Phase 019d: DB-backed tests for the eTIMS queue reconciliation.
const testDbUrl = process.env.HPP_TEST_DB_URL;
const dbSkip = testDbUrl ? false : 'HPP_TEST_DB_URL not set';

type Row = Record<string, any>;
type Db = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Row[] }>;
  end: () => Promise<void>;
};

async function connect(): Promise<Db> {
  const pg = (await import('pg')).default;
  const client = new pg.Client({ connectionString: testDbUrl, ssl: false });
  await client.connect();
  return client as unknown as Db;
}

async function mkTenant(db: Db, etimsEnabled: boolean): Promise<string> {
  const r = etimsEnabled
    ? await db.query(
        `INSERT INTO tenants (name, till_number, etims_enabled, etims_mode, business_structure, kra_pin, kra_pin_type)
         VALUES ('Reconcile Test', 'REC-' || floor(random()*1000000000)::text, TRUE, 'sandbox', 'private_company',
                 'P05' || floor(random()*100000)::text, 'non_individual')
         RETURNING id`,
      )
    : await db.query(
        `INSERT INTO tenants (name, till_number)
         VALUES ('Reconcile Test', 'REC-' || floor(random()*1000000000)::text)
         RETURNING id`,
      );
  return r.rows[0].id as string;
}

// ago values are fixed literals chosen by the tests below (never user input).
async function mkTicket(
  db: Db,
  tenantId: string,
  status: 'paid' | 'open' | 'voided',
  ago: string | null,
  withItems: boolean,
): Promise<string> {
  const closed = ago ? "NOW() - INTERVAL '" + ago + "'" : 'NULL';
  const r = await db.query(
    'INSERT INTO tickets (tenant_id, status, subtotal, vat_amount, total, closed_at) ' +
      'VALUES ($1, $2, 100, 16, 116, ' + closed + ') RETURNING id',
    [tenantId, status],
  );
  const id = r.rows[0].id as string;
  if (withItems) {
    await db.query(
      "INSERT INTO ticket_items (ticket_id, tenant_id, name, quantity, unit_price, line_total) VALUES ($1, $2, 'Test item', 1, 100, 100)",
      [id, tenantId],
    );
  }
  return id;
}

async function mkQueue(
  db: Db,
  tenantId: string,
  ticketId: string,
  status: string,
  attempts: number,
  createdAgo: string,
  updatedAgo: string,
): Promise<void> {
  await db.query(
    'INSERT INTO etims_invoice_queue (tenant_id, ticket_id, status, attempts, created_at, updated_at) ' +
      "VALUES ($1, $2, $3, $4, NOW() - INTERVAL '" + createdAgo + "', NOW() - INTERVAL '" + updatedAgo + "')",
    [tenantId, ticketId, status, attempts],
  );
}

async function queueRows(db: Db, ticketId: string): Promise<Row[]> {
  return (await db.query('SELECT status, last_error FROM etims_invoice_queue WHERE ticket_id = $1', [ticketId])).rows;
}

async function cleanup(db: Db, tenantIds: string[]): Promise<void> {
  const ids = tenantIds.filter((x) => x);
  if (ids.length > 0) await db.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [ids]);
  await db.end();
}

test('recoverStaleSubmitting: only stale submitting rows move; poison rows go permanent_fail', { skip: dbSkip }, async () => {
  const db = await connect();
  let tenantId = '';
  try {
    tenantId = await mkTenant(db, true);
    const mk = async (status: string, attempts: number, updatedAgo: string): Promise<string> => {
      const t = await mkTicket(db, tenantId, 'paid', '1 hour', true);
      await mkQueue(db, tenantId, t, status, attempts, '2 hours', updatedAgo);
      return t;
    };
    const stale = await mk('submitting', 0, '30 minutes');
    const fresh = await mk('submitting', 1, '1 minute');
    const done = await mk('success', 1, '30 minutes');
    const poison = await mk('submitting', 99, '30 minutes');
    const failed = await mk('failed', 2, '30 minutes');

    const n = await recoverStaleSubmitting();
    assert.ok(n >= 2, 'at least the two stale submitting rows recovered, got ' + n);

    const s = (await queueRows(db, stale))[0];
    assert.equal(s.status, 'failed', 'stale submitting → failed (retried by the normal path)');
    assert.equal(s.last_error, 'recovered_stale_submitting');
    assert.equal((await queueRows(db, fresh))[0].status, 'submitting', 'fresh submitting untouched');
    assert.equal((await queueRows(db, done))[0].status, 'success', 'success untouched');
    const p = (await queueRows(db, poison))[0];
    assert.equal(p.status, 'permanent_fail', 'attempt cap reached → permanent_fail');
    assert.equal(p.last_error, 'recovered_stale_submitting');
    const f = (await queueRows(db, failed))[0];
    assert.equal(f.status, 'failed', 'failed row untouched');
    assert.equal(f.last_error, null, 'failed row last_error untouched');
  } finally {
    await cleanup(db, [tenantId]);
  }
});

test('enqueueMissingFiscalReceipts: enqueues only eligible tickets, once', { skip: dbSkip }, async () => {
  const db = await connect();
  let e1 = '';
  let e2 = '';
  try {
    // Tenant 1: go-live anchor 100h ago
    e1 = await mkTenant(db, true);
    const anchor1 = await mkTicket(db, e1, 'paid', '100 hours', true);
    await mkQueue(db, e1, anchor1, 'success', 1, '100 hours', '100 hours');

    const A = await mkTicket(db, e1, 'paid', '1 hour', true);      // eligible
    const B = await mkTicket(db, e1, 'paid', '1 minute', true);    // inside grace window
    const C = await mkTicket(db, e1, 'paid', '72 hours', true);    // outside 48h lookback
    const D = await mkTicket(db, e1, 'paid', '2 hours', false);    // no items
    const E = await mkTicket(db, e1, 'paid', '2 hours', true);     // already has a fiscal response
    await db.query(
      "INSERT INTO etims_responses (tenant_id, ticket_id, invc_no, rcpt_no, intrl_data, rcpt_sign, raw_response) VALUES ($1, $2, 1, 1, 'x', 'y', '{}'::jsonb)",
      [e1, E],
    );
    const F = await mkTicket(db, e1, 'paid', '2 hours', true);     // already queued
    await mkQueue(db, e1, F, 'failed', 2, '2 hours', '2 hours');
    const G = await mkTicket(db, e1, 'open', null, true);          // not paid
    const H = await mkTicket(db, e1, 'voided', '2 hours', true);   // voided

    // Tenant 2: go-live anchor only 24h ago
    e2 = await mkTenant(db, true);
    const anchor2 = await mkTicket(db, e2, 'paid', '24 hours', true);
    await mkQueue(db, e2, anchor2, 'success', 1, '24 hours', '24 hours');
    const I = await mkTicket(db, e2, 'paid', '30 hours', true);    // before go-live anchor
    const J = await mkTicket(db, e2, 'paid', '3 hours', true);     // eligible

    await enqueueMissingFiscalReceipts();
    await enqueueMissingFiscalReceipts(); // second run must change nothing

    const count = async (t: string): Promise<number> => (await queueRows(db, t)).length;
    assert.equal(await count(A), 1, 'A enqueued exactly once');
    assert.equal((await queueRows(db, A))[0].status, 'pending');
    assert.equal(await count(B), 0, 'B inside grace window not enqueued');
    assert.equal(await count(C), 0, 'C outside lookback not enqueued');
    assert.equal(await count(D), 0, 'D without items not enqueued');
    assert.equal(await count(E), 0, 'E with fiscal response not enqueued');
    assert.equal(await count(F), 1, 'F keeps its single existing queue row');
    assert.equal((await queueRows(db, F))[0].status, 'failed', 'F existing row untouched');
    assert.equal(await count(G), 0, 'G open ticket not enqueued');
    assert.equal(await count(H), 0, 'H voided ticket not enqueued');
    assert.equal(await count(I), 0, 'I before go-live anchor not enqueued');
    assert.equal(await count(J), 1, 'J enqueued exactly once');
  } finally {
    await cleanup(db, [e1, e2]);
  }
});

test('enqueueMissingFiscalReceipts: never enqueues for eTIMS-disabled tenants or tenants without queue history', { skip: dbSkip }, async () => {
  const db = await connect();
  let dis = '';
  let noAnchor = '';
  try {
    dis = await mkTenant(db, false);
    const disAnchor = await mkTicket(db, dis, 'paid', '100 hours', true);
    await mkQueue(db, dis, disAnchor, 'success', 1, '100 hours', '100 hours');
    const disTicket = await mkTicket(db, dis, 'paid', '2 hours', true);

    noAnchor = await mkTenant(db, true);
    const naTicket = await mkTicket(db, noAnchor, 'paid', '2 hours', true);

    await enqueueMissingFiscalReceipts();

    assert.equal((await queueRows(db, disTicket)).length, 0, 'eTIMS disabled → nothing enqueued');
    assert.equal((await queueRows(db, naTicket)).length, 0, 'no queue history (no go-live anchor) → nothing enqueued');
  } finally {
    await cleanup(db, [dis, noAnchor]);
  }
});
