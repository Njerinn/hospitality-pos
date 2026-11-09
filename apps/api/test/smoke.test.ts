import './env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';

test('GET /health returns ok', async () => {
  const app = await buildApp();
  const res = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().status, 'ok');
  await app.close();
});

test('GET /whoami without cookie returns 401', async () => {
  const app = await buildApp();
  const res = await app.inject({ method: 'GET', url: '/whoami' });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test('POST /mpesa/validation rejects bad json with 400', async () => {
  const app = await buildApp();
  const res = await app.inject({
    method: 'POST',
    url: '/mpesa/validation',
    payload: { foo: 'bar' },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().ResultCode, 'C2B00012');
  await app.close();
});
