import './env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { config } from '../src/config.js';

// Phase 019c-B: voiding a ticket is a supervisory action — admin/manager only.
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

async function voidAs(role: string) {
  const { buildApp } = await import('../src/app.js');
  const app = await buildApp();
  try {
    return await app.inject({
      method: 'POST',
      url: '/tickets/' + TICKET_ID + '/state',
      headers: await authHeader(role),
      payload: JSON.stringify({ to: 'voided' }),
    });
  } finally {
    await app.close();
  }
}

for (const role of ['waiter', 'cashier']) {
  test(role + ': 403 when voiding a ticket (019c-B)', async () => {
    const res = await voidAs(role);
    assert.equal(res.statusCode, 403, role + ' void → expected 403, got ' + res.statusCode + ': ' + res.body.slice(0, 200));
    const body = res.json() as { error?: string; required_roles?: unknown; actual_role?: string };
    assert.equal(body.error, 'forbidden');
    assert.deepEqual(body.required_roles, ['admin', 'manager']);
    assert.equal(body.actual_role, role);
  });
}

for (const role of ['admin', 'manager']) {
  test(role + ': void is not blocked by the role check (019c-B)', async () => {
    const res = await voidAs(role);
    assert.notEqual(res.statusCode, 403, role + ' void → must not be 403, got: ' + res.body.slice(0, 200));
  });
}
