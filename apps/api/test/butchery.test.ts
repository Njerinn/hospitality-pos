import './env.js';
import test from 'node:test';
import assert from 'node:assert/strict';

test('POST /butchery/sales rejects unauthenticated', async () => {
  const { buildApp } = await import('../src/app.js');
  const app = await buildApp();
  const res = await app.inject({
    method: 'POST',
    url: '/butchery/sales',
    headers: { 'content-type': 'application/json' },
    payload: '{"stock_item_id":"00000000-0000-0000-0000-000000000000","weight_g":100,"price_per_kg":650}',
  });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test('GET /butchery/sales rejects unauthenticated', async () => {
  const { buildApp } = await import('../src/app.js');
  const app = await buildApp();
  const res = await app.inject({ method: 'GET', url: '/butchery/sales' });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test('POST /butchery/sales rejects malformed body', async () => {
  const { buildApp } = await import('../src/app.js');
  const app = await buildApp();
  const res = await app.inject({
    method: 'POST',
    url: '/butchery/sales',
    headers: { 'content-type': 'application/json' },
    payload: '{"stock_item_id":"not-a-uuid"}',
  });
  assert.ok(res.statusCode === 400 || res.statusCode === 401, `got ${res.statusCode}`);
  await app.close();
});

test('butchery routes are registered and reachable', async () => {
  const { buildApp } = await import('../src/app.js');
  const app = await buildApp();
  const res = await app.inject({ method: 'GET', url: '/butchery/sales' });
  assert.ok(res.statusCode !== 404, `expected not 404, got ${res.statusCode}`);
  await app.close();
});

const __testDbUrl = process.env.HPP_TEST_DB_URL;
const __dbSkip = __testDbUrl ? false : 'HPP_TEST_DB_URL not set';

test('integration: butchery sale creates paid retail ticket + queues eTIMS', { skip: __dbSkip }, async () => {
  const pg = (await import('pg')).default;
  const bcrypt = (await import('bcryptjs')).default;
  const { SignJWT } = await import('jose');
  const client = new pg.Client({ connectionString: __testDbUrl, ssl: false });
  await client.connect();
  let tenantId = '';
  try {
    const t = await client.query(`INSERT INTO tenants (name, till_number, etims_enabled, etims_mode, business_structure, kra_pin, kra_pin_type, vat_registered) VALUES ('Butch Test ' || floor(random()*1e6)::text, 'BT-' || floor(random()*1e6)::text, TRUE, 'sandbox', 'private_company', 'P051234567X', 'non_individual', TRUE) RETURNING id`);
    tenantId = t.rows[0].id;
    const hash = await bcrypt.hash('TestButch123!', 10);
    const u = await client.query(`INSERT INTO users (tenant_id, email, password_hash, role) VALUES ($1, 'bt-' || floor(random()*1e6)::text || '@t.local', $2, 'admin') RETURNING id`, [tenantId, hash]);
    const userId = u.rows[0].id;
    const si = await client.query(`INSERT INTO stock_items (tenant_id, name, unit, quantity, cost_per_unit) VALUES ($1, 'Beef ' || floor(random()*1e6)::text, 'g', 5000, 0.8) RETURNING id`, [tenantId]);
    const stockItemId = si.rows[0].id;
    await client.query(`INSERT INTO stock_movements (tenant_id, stock_item_id, delta, reason, outlet) VALUES ($1, $2, 5000, 'restock', 'butchery')`, [tenantId, stockItemId]);

    const { buildApp } = await import('../src/app.js');
    const { config } = await import('../src/config.js');
    const app = await buildApp();
    const jwt = await new SignJWT({ sub: userId, tenant_id: tenantId, role: 'admin' })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
      .sign(new TextEncoder().encode(config.JWT_SECRET));
    const cookie = `${config.SESSION_COOKIE_NAME}=${jwt}`;

    const saleRes = await app.inject({ method: 'POST', url: '/butchery/sales', headers: { cookie, 'content-type': 'application/json' }, payload: JSON.stringify({ stock_item_id: stockItemId, weight_g: 500, price_per_kg: 650 }) });
    assert.equal(saleRes.statusCode, 201, `sale failed: ${saleRes.body}`);
    const saleBody = JSON.parse(saleRes.body);
    assert.ok(saleBody.ticket_id, 'must include ticket_id');
    assert.equal(saleBody.sale.total_amount, '325.00');

    const tix = await client.query(`SELECT type, status, subtotal::text, vat_amount::text, total::text FROM tickets WHERE id=$1 AND tenant_id=$2`, [saleBody.ticket_id, tenantId]);
    assert.equal(tix.rows[0].type, 'retail');
    assert.equal(tix.rows[0].status, 'paid');
    assert.equal(tix.rows[0].total, '325.00');
    assert.equal(tix.rows[0].subtotal, '325.00');
    assert.equal(tix.rows[0].vat_amount, '0.00');

    const bs = await client.query(`SELECT ticket_id FROM butchery_sales WHERE id=$1`, [saleBody.sale.id]);
    assert.equal(bs.rows[0].ticket_id, saleBody.ticket_id);

    const q = await client.query(`SELECT status FROM etims_invoice_queue WHERE ticket_id=$1`, [saleBody.ticket_id]);
    assert.equal(q.rows.length, 1);
    assert.equal(q.rows[0].status, 'pending');

    const r = await app.inject({ method: 'GET', url: `/receipts/${saleBody.ticket_id}`, headers: { cookie } });
    assert.equal(r.statusCode, 200);
    assert.equal(JSON.parse(r.body).status, 'pending');
    await app.close();
  } finally {
    if (tenantId) await client.query('DELETE FROM tenants WHERE id=$1', [tenantId]);
    await client.end();
  }
});
