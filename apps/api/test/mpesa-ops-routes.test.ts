import './env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { config } from '../src/config.js';

const secret = new TextEncoder().encode(process.env.JWT_SECRET!);
const COOKIE_NAME = config.SESSION_COOKIE_NAME;

async function authHeader(role: string): Promise<{ cookie: string }> {
  const token = await new SignJWT({ sub: 'test-user', tenant_id: 'test-tenant', role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(secret);
  return { cookie: `${COOKIE_NAME}=${token}` };
}

test('/mpesa-ops/unallocated: unauth → 401', async () => {
  const { buildApp } = await import('../src/app.js');
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: '/mpesa-ops/unallocated' });
    assert.equal(res.statusCode, 401);
  } finally {
    await app.close();
  }
});

test('/mpesa-ops/unallocated: waiter → 403 (not in admin/manager/cashier)', async () => {
  const { buildApp } = await import('../src/app.js');
  const app = await buildApp();
  try {
    const headers = await authHeader('waiter');
    const res = await app.inject({ method: 'GET', url: '/mpesa-ops/unallocated', headers });
    assert.equal(res.statusCode, 403);
  } finally {
    await app.close();
  }
});

test('/mpesa-ops/unallocated: kitchen → 403 (not in admin/manager/cashier)', async () => {
  const { buildApp } = await import('../src/app.js');
  const app = await buildApp();
  try {
    const headers = await authHeader('kitchen');
    const res = await app.inject({ method: 'GET', url: '/mpesa-ops/unallocated', headers });
    assert.equal(res.statusCode, 403);
  } finally {
    await app.close();
  }
});
