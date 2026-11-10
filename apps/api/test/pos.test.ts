import './env.js';
import test from 'node:test';
import assert from 'node:assert/strict';

test('POS routes are mounted and require auth', async () => {
  const { buildApp } = await import('../src/app.js');
  const app = await buildApp();

  const cases: Array<[string, string]> = [
    ['GET', '/tables'],
    ['GET', '/tickets'],
    ['GET', '/tickets/00000000-0000-0000-0000-000000000000'],
  ];

  for (const [method, url] of cases) {
    const res = await app.inject({ method: method as 'GET', url });
    assert.equal(res.statusCode, 401, `${method} ${url} must be 401 without auth`);
  }

  await app.close();
});

test('POST /tickets rejects malformed JSON with 400', async () => {
  const { buildApp } = await import('../src/app.js');
  const app = await buildApp();
  const res = await app.inject({
    method: 'POST',
    url: '/tickets',
    headers: { 'content-type': 'application/json' },
    payload: '{"nope":',
  });
  assert.equal(res.statusCode, 400);
  await app.close();
});

test('POST /tables rejects bad body with 400 or requires auth', async () => {
  const { buildApp } = await import('../src/app.js');
  const app = await buildApp();
  const res = await app.inject({
    method: 'POST',
    url: '/tables',
    headers: { 'content-type': 'application/json' },
    payload: '{"name": 123}',
  });
  assert.ok(res.statusCode === 400 || res.statusCode === 401);
  await app.close();
});
