import './env.js';
import test from 'node:test';
import assert from 'node:assert/strict';

const testDbUrl = process.env.HPP_TEST_DB_URL;
const dbSkip = testDbUrl ? false : 'HPP_TEST_DB_URL not set';

test('GET /receipts/:ticketId/pdf rejects unauthenticated', async () => {
  const { buildApp } = await import('../src/app.js');
  const app = await buildApp();
  const res = await app.inject({
    method: 'GET',
    url: '/receipts/00000000-0000-0000-0000-000000000000/pdf',
  });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test('GET /receipts/:ticketId/pdf rejects invalid uuid', async () => {
  const { buildApp } = await import('../src/app.js');
  const app = await buildApp();
  const res = await app.inject({
    method: 'GET',
    url: '/receipts/not-a-uuid/pdf',
  });
  assert.ok(res.statusCode === 400 || res.statusCode === 401, `got ${res.statusCode}`);
  await app.close();
});

test('pdf endpoint reachable (not 404)', async () => {
  const { buildApp } = await import('../src/app.js');
  const app = await buildApp();
  const res = await app.inject({
    method: 'GET',
    url: '/receipts/00000000-0000-0000-0000-000000000000/pdf',
  });
  assert.notEqual(res.statusCode, 404);
  await app.close();
});

test('integration: original + copy PDF generation', { skip: dbSkip }, async () => {
  const pg = (await import('pg')).default;
  const bcrypt = (await import('bcryptjs')).default;
  const { SignJWT } = await import('jose');

  const client = new pg.Client({ connectionString: testDbUrl, ssl: false });
  await client.connect();

  let tenantId = '';
  let userId = '';
  let ticketId = '';
  let cookie = '';

  try {
    // ── Fixture: tenant ──
    const t = await client.query(
      `INSERT INTO tenants (name, till_number, kra_pin, business_structure, kra_pin_type, vat_registered, etims_enabled, etims_mode)
       VALUES ('Test Hotel PDF', 'TEST-' || floor(random()*100000)::text, 'P051234567X', 'private_company', 'non_individual', TRUE, TRUE, 'sandbox')
       RETURNING id`,
    );
    tenantId = t.rows[0].id;

    // ── Fixture: user ──
    const hash = await bcrypt.hash('TestPdf123!', 10);
    const u = await client.query(
      `INSERT INTO users (tenant_id, email, password_hash, role)
       VALUES ($1, 'pdf-tester-' || floor(random()*1000000)::text || '@test.local', $2, 'admin')
       RETURNING id, email`,
      [tenantId, hash],
    );
    userId = u.rows[0].id;

    // ── Fixture: ticket ──
    const ticket = await client.query(
      `INSERT INTO tickets (tenant_id, type, status, subtotal, vat_amount, total, closed_at)
       VALUES ($1, 'dine_in', 'paid', 1460.00, 233.60, 1693.60, NOW())
       RETURNING id`,
      [tenantId],
    );
    ticketId = ticket.rows[0].id;

    // ── Fixture: items ──
    await client.query(
      `INSERT INTO ticket_items (ticket_id, tenant_id, name, quantity, unit_price, line_total, vat_rate, tax_ty_cd, sent_to_kitchen, course_number)
       VALUES
         ($1, $2, 'Nyama Choma', 2, 650.00, 1300.00, 0.16, 'B', TRUE, 1),
         ($1, $2, 'Ugali', 2, 80.00, 160.00, 0.16, 'B', TRUE, 1)`,
      [ticketId, tenantId],
    );

    // ── Fixture: eTIMS queue + response (simulated submitted) ──
    await client.query(
      `INSERT INTO etims_invoice_queue (tenant_id, ticket_id, status)
       VALUES ($1, $2, 'success')`,
      [tenantId, ticketId],
    );
    await client.query(
      `INSERT INTO etims_responses (tenant_id, ticket_id, invc_no, rcpt_no, intrl_data, rcpt_sign, raw_response)
       VALUES ($1, $2, 42, 42, 'INTERNAL-TEST-DATA', 'TEST-SIGNATURE-HASH-FOR-PDF-VERIFY', '{"data":{"qrCodeUrl":"https://example.test/qr"}}'::jsonb)`,
      [tenantId, ticketId],
    );

    // ── Login → cookie ──
    const { buildApp } = await import('../src/app.js');
    const { config } = await import('../src/config.js');
    const app = await buildApp();

    const jwt = await new SignJWT({ sub: userId, tenant_id: tenantId, role: 'admin' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(config.JWT_SECRET));

    cookie = `${config.SESSION_COOKIE_NAME}=${jwt}`;

    // ── Request original ──
    const orig = await app.inject({
      method: 'GET',
      url: `/receipts/${ticketId}/pdf`,
      headers: { cookie },
    });
    assert.equal(orig.statusCode, 200, `original status: ${orig.statusCode}, body: ${orig.body.slice(0, 200)}`);
    assert.match(orig.headers['content-type'] as string, /application\/pdf/);
    assert.match(orig.headers['content-disposition'] as string, /invoice-CU-INV-000042-original\.pdf/);
    assert.equal(orig.rawPayload.slice(0, 5).toString(), '%PDF-', 'original must start with PDF magic');

    // ── Request copy ──
    const copy = await app.inject({
      method: 'GET',
      url: `/receipts/${ticketId}/pdf?copy=true`,
      headers: { cookie },
    });
    assert.equal(copy.statusCode, 200, `copy status: ${copy.statusCode}`);
    assert.match(copy.headers['content-disposition'] as string, /invoice-CU-INV-000042-copy\.pdf/);
    assert.equal(copy.rawPayload.slice(0, 5).toString(), '%PDF-', 'copy must start with PDF magic');

    // Both PDFs > 2000 bytes (a valid invoice has header, items, QR)
    assert.ok(orig.rawPayload.length > 2000, `original size ${orig.rawPayload.length}`);
    assert.ok(copy.rawPayload.length > 2000, `copy size ${copy.rawPayload.length}`);

    // ── Request for nonexistent ticket → 409 fiscal_pending ──
    const pending = await app.inject({
      method: 'GET',
      url: `/receipts/00000000-0000-0000-0000-000000000001/pdf`,
      headers: { cookie },
    });
    assert.equal(pending.statusCode, 409);
    assert.equal(JSON.parse(pending.body).error, 'fiscal_pending');

    await app.close();
  } finally {
    // ── Cleanup ──
    if (tenantId) await client.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
    await client.end();
  }
});
