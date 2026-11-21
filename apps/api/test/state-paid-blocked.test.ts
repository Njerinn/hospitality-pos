import './env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { config } from '../src/config.js';

// Phase 019c-A: /tickets/:id/state must never mark a ticket paid.
// Paid tickets come only from /pay-cash and /payments/link-mpesa, which record the
// payment method, the closer, and enqueue the eTIMS submission.
const secret = new TextEncoder().encode(process.env.JWT_SECRET!);
const COOKIE_NAME = config.SESSION_COOKIE_NAME;
const TICKET_ID = '00000000-0000-0000-0000-000000000000';

async function authHeader(role: string): Promise<{ cookie: string; 'content-type': string }> {
  const token = await new SignJWT({ sub: 'test-user', tenant_id: 'test-tenant', role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(secret);
  return { cookie: COOKIE_NAME + '=' + token, 'content-type': 'application/json' };
}

async function markPaidAs(role: string) {
  const { buildApp } = await import('../src/app.js');
  const app = await buildApp();
  try {
    return await app.inject({
      method: 'POST',
      url: '/tickets/' + TICKET_ID + '/state',
      headers: await authHeader(role),
      payload: JSON.stringify({ to: 'paid' }),
    });
  } finally {
    await app.close();
  }
}

for (const role of ['waiter', 'cashier', 'manager', 'admin']) {
  test(role + ': state→paid is rejected with 400 use_payment_endpoint (019c-A)', async () => {
    const res = await markPaidAs(role);
    assert.equal(res.statusCode, 400, role + ' state→paid → expected 400, got ' + res.statusCode + ': ' + res.body.slice(0, 200));
    const body = res.json() as { error?: string };
    assert.equal(body.error, 'use_payment_endpoint');
  });
}
