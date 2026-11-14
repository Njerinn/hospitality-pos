import './env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { enqueueEtimsSubmission } from '../src/modules/etims/submission.js';

function mockApp() {
  const warns: unknown[][] = [];
  const app = { log: { warn: (...a: unknown[]) => warns.push(a) } } as unknown as FastifyInstance;
  return { app, warns };
}

test('enqueueEtimsSubmission: inserts row when tenant has etims_enabled', async () => {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  const db = {
    query: async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      if (sql.includes('SELECT etims_enabled')) return { rows: [{ etims_enabled: true }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
  };
  const { app, warns } = mockApp();
  await enqueueEtimsSubmission(app, 'tkt-1', 'tenant-1', { db });
  assert.equal(calls.length, 2);
  assert.ok(calls[0].sql.includes('SELECT etims_enabled'));
  assert.ok(calls[1].sql.includes('INSERT INTO etims_invoice_queue'));
  assert.deepEqual(calls[1].params, ['tenant-1', 'tkt-1']);
  assert.equal(warns.length, 0);
});

test('enqueueEtimsSubmission: no-op when etims_enabled false', async () => {
  const calls: Array<{ sql: string }> = [];
  const db = {
    query: async (sql: string) => {
      calls.push({ sql });
      return { rows: [{ etims_enabled: false }], rowCount: 1 };
    },
  };
  const { app } = mockApp();
  await enqueueEtimsSubmission(app, 'tkt-2', 'tenant-2', { db });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].sql.includes('SELECT etims_enabled'));
});

test('enqueueEtimsSubmission: swallows generic error (does not throw)', async () => {
  const db = {
    query: async () => { throw new Error('connection lost'); },
  };
  const { app, warns } = mockApp();
  await enqueueEtimsSubmission(app, 'tkt-3', 'tenant-3', { db });
  assert.equal(warns.length, 1);
});

test('enqueueEtimsSubmission: swallows unique-constraint conflict', async () => {
  let callCount = 0;
  const db = {
    query: async () => {
      callCount++;
      if (callCount === 1) return { rows: [{ etims_enabled: true }], rowCount: 1 };
      throw Object.assign(new Error('duplicate key'), { code: '23505' });
    },
  };
  const { app, warns } = mockApp();
  await enqueueEtimsSubmission(app, 'tkt-4', 'tenant-4', { db });
  assert.equal(warns.length, 1);
});
