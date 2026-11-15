import './env.js';
import test from 'node:test';
import assert from 'node:assert/strict';

const testDbUrl = process.env.HPP_TEST_DB_URL;
const dbSkip = testDbUrl ? false : 'HPP_TEST_DB_URL not set';

test('POST /tickets accepts type=retail + POST /:id/pay-cash fires eTIMS queue', { skip: dbSkip }, async () => {
  const pg = (await import('pg')).default;
  const { SignJWT } = await import('jose');
  const client = new pg.Client({ connectionString: testDbUrl, ssl: false });
  await client.connect();

  let tenantId = '';
  let ticketId = '';
  let app: Awaited<ReturnType<typeof import('../src/app.js').buildApp>> | null = null;

  try {
    // Tenant with eTIMS enabled so enqueueEtimsSubmission actually fires
    const t = await client.query(
      `INSERT INTO tenants (name, till_number, etims_enabled, etims_mode, business_structure, kra_pin, kra_pin_type)
       VALUES ('Sell Flow Test', 'SELL-' || floor(random()*1000000)::text, TRUE, 'sandbox', 'private_company', 'P05' || floor(random()*100000)::text, 'non_individual')
       RETURNING id`,
    );
    tenantId = t.rows[0].id;

    // Real user so created_by FK is satisfied
    const userRes = await client.query(
      `INSERT INTO users (tenant_id, email, password_hash, role)
       VALUES ($1, 'sell-flow-' || floor(random()*1000000)::text || '@test.local', 'test-hash-placeholder', 'cashier')
       RETURNING id`,
      [tenantId],
    );
    const realUserId = userRes.rows[0].id;

    const { buildApp } = await import('../src/app.js');
    const { config } = await import('../src/config.js');
    app = await buildApp();

    const jwt = await new SignJWT({ sub: realUserId, tenant_id: tenantId, role: 'cashier' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(config.JWT_SECRET));
    const cookie = `${config.SESSION_COOKIE_NAME}=${jwt}`;

    const createRes = await app.inject({
      method: 'POST',
      url: '/tickets',
      headers: { cookie, 'content-type': 'application/json' },
      payload: JSON.stringify({ type: 'retail', notes: 'sell-flow-test' }),
    });
    assert.equal(createRes.statusCode, 201, `create: ${createRes.statusCode} ${createRes.body.slice(0, 200)}`);
    ticketId = JSON.parse(createRes.body).id;
    assert.ok(ticketId, 'ticket id returned');
    assert.equal(JSON.parse(createRes.body).type, 'retail', 'type is retail in response');

    const dbTicket = await client.query('SELECT type, status FROM tickets WHERE id = $1', [ticketId]);
    assert.equal(dbTicket.rows[0].type, 'retail');
    assert.equal(dbTicket.rows[0].status, 'open');

    const itemRes = await app.inject({
      method: 'POST',
      url: `/tickets/${ticketId}/items`,
      headers: { cookie, 'content-type': 'application/json' },
      payload: JSON.stringify({ name: 'Test Product', quantity: 1, unit_price: 100, vat_rate: 0.16 }),
    });
    assert.equal(itemRes.statusCode, 201, `item: ${itemRes.statusCode} ${itemRes.body.slice(0, 200)}`);

    const payRes = await app.inject({
      method: 'POST',
      url: `/tickets/${ticketId}/pay-cash`,
      headers: { cookie },
    });
    assert.equal(payRes.statusCode, 200, `pay: ${payRes.statusCode} ${payRes.body.slice(0, 200)}`);
    const payBody = JSON.parse(payRes.body);
    assert.equal(payBody.ok, true);
    assert.equal(payBody.status, 'paid');

    const paidTicket = await client.query('SELECT status, closed_at FROM tickets WHERE id = $1', [ticketId]);
    assert.equal(paidTicket.rows[0].status, 'paid');
    assert.ok(paidTicket.rows[0].closed_at, 'closed_at set');

    const queue = await client.query('SELECT status FROM etims_invoice_queue WHERE ticket_id = $1', [ticketId]);
    assert.equal(queue.rows.length, 1, 'eTIMS queue row exists');
    assert.equal(queue.rows[0].status, 'pending');

    const dupPay = await app.inject({
      method: 'POST',
      url: `/tickets/${ticketId}/pay-cash`,
      headers: { cookie },
    });
    assert.equal(dupPay.statusCode, 409, 'second pay-cash rejected as closed');

    const queue2 = await client.query('SELECT COUNT(*)::int AS n FROM etims_invoice_queue WHERE ticket_id = $1', [ticketId]);
    assert.equal(queue2.rows[0].n, 1, 'no duplicate queue row');
  } finally {
    if (app) await app.close();
    if (tenantId) await client.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
    await client.end();
  }
});

test('POST /tickets without type defaults to dine_in', { skip: dbSkip }, async () => {
  const pg = (await import('pg')).default;
  const { SignJWT } = await import('jose');
  const client = new pg.Client({ connectionString: testDbUrl, ssl: false });
  await client.connect();

  let tenantId = '';
  let app: Awaited<ReturnType<typeof import('../src/app.js').buildApp>> | null = null;

  try {
    const t = await client.query(
      `INSERT INTO tenants (name, till_number)
       VALUES ('Default Type Test', 'DEF-' || floor(random()*1000000)::text)
       RETURNING id`,
    );
    tenantId = t.rows[0].id;

    const userRes = await client.query(
      `INSERT INTO users (tenant_id, email, password_hash, role)
       VALUES ($1, 'def-' || floor(random()*1000000)::text || '@test.local', 'test-hash-placeholder', 'cashier')
       RETURNING id`,
      [tenantId],
    );
    const realUserId = userRes.rows[0].id;

    const { buildApp } = await import('../src/app.js');
    const { config } = await import('../src/config.js');
    app = await buildApp();
    const jwt = await new SignJWT({ sub: realUserId, tenant_id: tenantId, role: 'cashier' })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
      .sign(new TextEncoder().encode(config.JWT_SECRET));
    const cookie = `${config.SESSION_COOKIE_NAME}=${jwt}`;

    const res = await app.inject({
      method: 'POST',
      url: '/tickets',
      headers: { cookie, 'content-type': 'application/json' },
      payload: JSON.stringify({ notes: 'no type' }),
    });
    assert.equal(res.statusCode, 201, `create: ${res.statusCode} ${res.body.slice(0, 200)}`);
    assert.equal(JSON.parse(res.body).type, 'dine_in');

    const tid = JSON.parse(res.body).id;
    const dbRow = await client.query('SELECT type FROM tickets WHERE id = $1', [tid]);
    assert.equal(dbRow.rows[0].type, 'dine_in');
  } finally {
    if (app) await app.close();
    if (tenantId) await client.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
    await client.end();
  }
});
