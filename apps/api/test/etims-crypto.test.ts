import './env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptCmcKey, decryptCmcKey } from '../src/modules/etims/crypto.js';

test('crypto: roundtrip preserves plaintext', () => {
  const pt = 'MOCK-CMC-KEY-TEST-12345';
  const ct = encryptCmcKey(pt);
  assert.notEqual(ct, pt);
  assert.equal(ct.split(':').length, 3);
  assert.equal(decryptCmcKey(ct), pt);
});

test('crypto: two encryptions of same plaintext differ (random IV)', () => {
  const pt = 'same-input';
  const ct1 = encryptCmcKey(pt);
  const ct2 = encryptCmcKey(pt);
  assert.notEqual(ct1, ct2);
  assert.equal(decryptCmcKey(ct1), pt);
  assert.equal(decryptCmcKey(ct2), pt);
});

test('crypto: tampered ciphertext throws', () => {
  const ct = encryptCmcKey('tamper-test');
  const parts = ct.split(':');
  const raw = Buffer.from(parts[2], 'base64');
  raw[0] = raw[0] ^ 0xff;
  parts[2] = raw.toString('base64');
  assert.throws(() => decryptCmcKey(parts.join(':')));
});

test('crypto: malformed ciphertext throws', () => {
  assert.throws(() => decryptCmcKey('not-valid-format'));
});
