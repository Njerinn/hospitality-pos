import './env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyError, resolveBaseUrl } from '../src/modules/etims/worker.js';
import { EtimsApiError } from '../src/modules/etims/client.js';

test('classifyError: timeout is retryable', () => {
  const e = new EtimsApiError('timeout', 'timeout');
  assert.deepEqual(classifyError(e), { retryable: true, kind: 'timeout' });
});

test('classifyError: network is retryable', () => {
  const e = new EtimsApiError('net', 'network');
  assert.deepEqual(classifyError(e), { retryable: true, kind: 'network' });
});

test('classifyError: kra_reject is not retryable', () => {
  const e = new EtimsApiError('reject', 'kra_reject', '400');
  assert.deepEqual(classifyError(e), { retryable: false, kind: 'kra_reject' });
});

test('classifyError: invalid_response is not retryable', () => {
  const e = new EtimsApiError('bad', 'invalid_response');
  assert.deepEqual(classifyError(e), { retryable: false, kind: 'invalid_response' });
});

test('classifyError: unknown error is retryable', () => {
  assert.deepEqual(classifyError(new Error('boom')), { retryable: true, kind: 'unknown' });
});

test('resolveBaseUrl: override wins over everything', () => {
  const url = resolveBaseUrl('sandbox', { resolverOverride: () => 'http://override' });
  assert.equal(url, 'http://override');
});
