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

async function assertAllForbidden(
  role: string,
  cases: Array<['GET' | 'POST', string]>,
): Promise<void> {
  const { buildApp } = await import('../src/app.js');
  const app = await buildApp();
  const headers = await authHeader(role);
  try {
    for (const [method, url] of cases) {
      const res = await app.inject({ method, url, headers });
      assert.equal(
        res.statusCode,
        403,
        `${role} ${method} ${url} → expected 403, got ${res.statusCode}: ${res.body.slice(0, 200)}`,
      );
      const body = res.json() as { error?: string; required_roles?: unknown };
      assert.equal(body.error, 'forbidden', `${role} ${method} ${url}: body.error`);
      assert.ok(
        Array.isArray(body.required_roles),
        `${role} ${method} ${url}: required_roles must be array`,
      );
    }
  } finally {
    await app.close();
  }
}

async function assertNotForbidden(
  role: string,
  cases: Array<['GET' | 'POST', string, string | undefined]>,
): Promise<void> {
  const { buildApp } = await import('../src/app.js');
  const app = await buildApp();
  const headers = { ...(await authHeader(role)), 'content-type': 'application/json' };
  try {
    for (const [method, url, payload] of cases) {
      const res = await app.inject({ method, url, headers, payload });
      assert.notEqual(
        res.statusCode,
        403,
        `${role} ${method} ${url} → expected NOT 403, got 403: ${res.body.slice(0, 200)}`,
      );
    }
  } finally {
    await app.close();
  }
}

test('waiter: 403 on payments, reports, inventory, admin, kds', async () => {
  await assertAllForbidden('waiter', [
    ['POST', '/payments/link-mpesa/00000000-0000-0000-0000-000000000000'],
    ['GET', '/reports/summary?from=2026-01-01&to=2026-01-31'],
    ['GET', '/inventory/products'],
    ['GET', '/admin/backup'],
    ['POST', '/kds/items/00000000-0000-0000-0000-000000000000/ready'],
  ]);
});

test('cashier: 403 on reports, inventory, admin, kds', async () => {
  await assertAllForbidden('cashier', [
    ['GET', '/reports/summary?from=2026-01-01&to=2026-01-31'],
    ['GET', '/inventory/products'],
    ['GET', '/admin/backup'],
    ['POST', '/kds/items/00000000-0000-0000-0000-000000000000/ready'],
  ]);
});

test('kitchen: 403 on reports, inventory, admin, tickets, tables', async () => {
  await assertAllForbidden('kitchen', [
    ['GET', '/reports/summary?from=2026-01-01&to=2026-01-31'],
    ['GET', '/inventory/products'],
    ['GET', '/admin/backup'],
    ['GET', '/tickets/00000000-0000-0000-0000-000000000000'],
    ['GET', '/tables'],
  ]);
});

test('manager: 403 on admin/backup, allowed elsewhere (fails at handler not guard)', async () => {
  const { buildApp } = await import('../src/app.js');
  const app = await buildApp();
  const headers = { ...(await authHeader('manager')), 'content-type': 'application/json' };
  try {
    const blocked = await app.inject({ method: 'GET', url: '/admin/backup', headers });
    assert.equal(blocked.statusCode, 403, 'manager /admin/backup → 403');
    assert.equal((blocked.json() as { error: string }).error, 'forbidden');

    const allowed: Array<['GET' | 'POST', string, string | undefined]> = [
      ['POST', '/kds/items/not-a-uuid/ready', undefined],
      ['GET', '/tickets/not-a-uuid', undefined],
      ['POST', '/payments/link-mpesa/not-a-uuid', '{"trans_id":"x"}'],
      ['GET', '/reports/summary?from=x&to=y', undefined],
    ];
    for (const [method, url, payload] of allowed) {
      const res = await app.inject({ method, url, headers, payload });
      assert.notEqual(
        res.statusCode,
        403,
        `manager ${method} ${url} → expected not 403, got 403: ${res.body.slice(0, 200)}`,
      );
    }
  } finally {
    await app.close();
  }
});

test('admin: not forbidden on all guarded routes', async () => {
  await assertNotForbidden('admin', [
    ['POST', '/kds/items/not-a-uuid/ready', undefined],
    ['GET', '/tickets/not-a-uuid', undefined],
    ['POST', '/payments/link-mpesa/not-a-uuid', '{"trans_id":"x"}'],
    ['GET', '/reports/summary?from=x&to=y', undefined],
  ]);
});

test('no cookie: 401 not 403 on guarded route (guard returns 401 first)', async () => {
  const { buildApp } = await import('../src/app.js');
  const app = await buildApp();
  try {
    const res = await app.inject({
      method: 'GET',
      url: '/reports/summary?from=2026-01-01&to=2026-01-31',
    });
    assert.equal(res.statusCode, 401, 'no cookie → 401 (guard fires before role check)');
    assert.equal((res.json() as { error: string }).error, 'unauthenticated');
  } finally {
    await app.close();
  }
});
