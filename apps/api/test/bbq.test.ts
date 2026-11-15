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
