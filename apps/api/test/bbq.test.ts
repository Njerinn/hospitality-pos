import './env.js';
import test from 'node:test';
import assert from 'node:assert/strict';

test('GET /bbq/products rejects unauthenticated', async () => {
  const { buildApp } = await import('../src/app.js');
  const app = await buildApp();
  const res = await app.inject({ method: 'GET', url: '/bbq/products' });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test('GET /bbq/sales rejects unauthenticated', async () => {
  const { buildApp } = await import('../src/app.js');
  const app = await buildApp();
  const res = await app.inject({ method: 'GET', url: '/bbq/sales' });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test('POST /bbq/sales rejects malformed body', async () => {
  const { buildApp } = await import('../src/app.js');
  const app = await buildApp();
  const res = await app.inject({
    method: 'POST',
    url: '/bbq/sales',
    headers: { 'content-type': 'application/json' },
    payload: '{"product_id":"not-a-uuid"}',
  });
  assert.ok(res.statusCode === 400 || res.statusCode === 401, `got ${res.statusCode}`);
  await app.close();
});

test('bbq routes are mounted and reachable', async () => {
  const { buildApp } = await import('../src/app.js');
  const app = await buildApp();
  const res = await app.inject({ method: 'GET', url: '/bbq/products' });
  assert.ok(res.statusCode !== 404, `expected not 404, got ${res.statusCode}`);
  await app.close();
});

const __testDbUrl = process.env.HPP_TEST_DB_URL;
const __dbSkip = __testDbUrl ? false : 'HPP_TEST_DB_URL not set';

test('integration: BBQ sale creates paid retail ticket + queues eTIMS', { skip: __dbSkip }, async () => {
  const pg = (await import('pg')).default;
  const bcrypt = (await import('bcryptjs')).default;
  const { SignJWT } = await import('jose');
  const client = new pg.Client({ connectionString: __testDbUrl, ssl: false });
  await client.connect();
  let tenantId = '';
  try {
    const t = await client.query(`INSERT INTO tenants (name, till_number, etims_enabled, etims_mode, business_structure, kra_pin, kra_pin_type, vat_registered) VALUES ('BBQ Test ' || floor(random()*1e6)::text, 'BBQT-' || floor(random()*1e6)::text, TRUE, 'sandbox', 'private_company', 'P051234567X', 'non_individual', TRUE) RETURNING id`);
    tenantId = t.rows[0].id;
    const hash = await bcrypt.hash('TestBbq123!', 10);
    const u = await client.query(`INSERT INTO users (tenant_id, email, password_hash, role) VALUES ($1, 'bbqt-' || floor(random()*1e6)::text || '@t.local', $2, 'admin') RETURNING id`, [tenantId, hash]);
    const userId = u.rows[0].id;
    const p = await client.query(`INSERT INTO products (tenant_id, name, price, active, outlet, tax_ty_cd) VALUES ($1, 'NCTest ' || floor(random()*1e6)::text, 650, TRUE, 'bbq', 'B') RETURNING id`, [tenantId]);
    const productId = p.rows[0].id;

    const { buildApp } = await import('../src/app.js');
    const { config } = await import('../src/config.js');
    const app = await buildApp();
    const jwt = await new SignJWT({ sub: userId, tenant_id: tenantId, role: 'admin' })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
      .sign(new TextEncoder().encode(config.JWT_SECRET));
    const cookie = `${config.SESSION_COOKIE_NAME}=${jwt}`;

    const saleRes = await app.inject({ method: 'POST', url: '/bbq/sales', headers: { cookie, 'content-type': 'application/json' }, payload: JSON.stringify({ product_id: productId, quantity: 2 }) });
    assert.equal(saleRes.statusCode, 201, `sale failed: ${saleRes.body}`);
    const saleBody = JSON.parse(saleRes.body);
    assert.ok(saleBody.ticket_id, 'must include ticket_id');
    assert.equal(saleBody.sale.total_amount, '1300.00');

    const tix = await client.query(`SELECT type, status, subtotal::text, vat_amount::text, total::text FROM tickets WHERE id=$1 AND tenant_id=$2`, [saleBody.ticket_id, tenantId]);
    assert.equal(tix.rows[0].type, 'retail');
    assert.equal(tix.rows[0].status, 'paid');
    assert.equal(tix.rows[0].total, '1300.00');
    assert.equal(tix.rows[0].subtotal, '1120.69');
    assert.equal(tix.rows[0].vat_amount, '179.31');

    const bs = await client.query(`SELECT ticket_id FROM bbq_sales WHERE id=$1`, [saleBody.sale.id]);
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
