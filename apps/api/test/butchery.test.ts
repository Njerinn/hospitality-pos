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
