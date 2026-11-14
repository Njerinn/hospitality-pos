import './env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';
import { attemptAutoMatch, isUuid } from '../src/modules/mpesa/matching.js';

function makeMockClient(
  handlers: Array<{ match: string; rows: unknown[] }>,
): PoolClient {
  return {
    query: async (sql: string) => {
      for (const h of handlers) {
        if (sql.includes(h.match)) return { rows: h.rows };
      }
      return { rows: [] };
    },
  } as unknown as PoolClient;
}

test('isUuid: valid v4 UUID → true', () => {
  assert.equal(isUuid('12345678-1234-1234-1234-123456789abc'), true);
});

test('isUuid: non-UUID string → false', () => {
  assert.equal(isUuid('HOTEL01'), false);
  assert.equal(isUuid('not-a-uuid'), false);
  assert.equal(isUuid(''), false);
});

test('attemptAutoMatch: BillRefNumber = ticket UUID + match → reason bill_ref_uuid', async () => {
  const client = makeMockClient([
    { match: 'SELECT id FROM tickets', rows: [{ id: 'ticket-uuid-1' }] },
  ]);
  const r = await attemptAutoMatch(client, {
    tenant_id: 'tenant-1',
    trans_id: 'TX-UUID',
    amount: '1160.00',
    msisdn: '254700000000',
    bill_ref: '12345678-1234-1234-1234-123456789abc',
  });
  assert.equal(r.matched, true);
  if (r.matched) assert.equal(r.reason, 'bill_ref_uuid');
  if (r.matched) assert.equal(r.ticket_id, 'ticket-uuid-1');
});

test('attemptAutoMatch: fixed account + 1 candidate → reason fixed_account_unique', async () => {
  const client = makeMockClient([
    { match: 'SELECT mpesa_fixed_account', rows: [{ mpesa_fixed_account: 'HOTEL01' }] },
    { match: 'SELECT id FROM tickets', rows: [{ id: 'ticket-uuid-2' }] },
  ]);
  const r = await attemptAutoMatch(client, {
    tenant_id: 'tenant-1',
    trans_id: 'TX-FIXED',
    amount: '500.00',
    msisdn: '254700000000',
    bill_ref: 'HOTEL01',
  });
  assert.equal(r.matched, true);
  if (r.matched) assert.equal(r.reason, 'fixed_account_unique');
});

test('attemptAutoMatch: fixed account + 0 candidates → reason no_unique_candidate', async () => {
  const client = makeMockClient([
    { match: 'SELECT mpesa_fixed_account', rows: [{ mpesa_fixed_account: 'HOTEL01' }] },
  ]);
  const r = await attemptAutoMatch(client, {
    tenant_id: 'tenant-1',
    trans_id: 'TX-NOCAND',
    amount: '500.00',
    msisdn: '254700000000',
    bill_ref: 'HOTEL01',
  });
  assert.equal(r.matched, false);
  if (!r.matched) assert.equal(r.reason, 'no_unique_candidate');
});

test('attemptAutoMatch: no fixed account configured → reason no_fixed_account_configured', async () => {
  const client = makeMockClient([
    { match: 'SELECT mpesa_fixed_account', rows: [{ mpesa_fixed_account: null }] },
  ]);
  const r = await attemptAutoMatch(client, {
    tenant_id: 'tenant-1',
    trans_id: 'TX-NOFIXED',
    amount: '500.00',
    msisdn: '254700000000',
    bill_ref: 'SOMETHING',
  });
  assert.equal(r.matched, false);
  if (!r.matched) assert.equal(r.reason, 'no_fixed_account_configured');
});
