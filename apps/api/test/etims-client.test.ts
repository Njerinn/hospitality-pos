import './env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { startMockEtimsServer } from '../src/modules/etims/mock-server.js';
import {
  initDevice,
  submitSale,
  EtimsApiError,
} from '../src/modules/etims/client.js';

const TIN = 'P051234567A';
const BHF = '00';
const DVC = 'TEST-CLIENT';

test('client: initDevice returns cmcKey', async () => {
  const mock = await startMockEtimsServer();
  try {
    const result = await initDevice({
      baseUrl: mock.url,
      tin: TIN,
      bhfId: BHF,
      dvcSrlNo: DVC,
    });
    assert.ok(typeof result.cmcKey === 'string' && result.cmcKey.length > 0);
    assert.ok(result.cmcKey.startsWith('MOCK-CMC-'));
  } finally {
    await mock.close();
  }
});

test('client: submitSale returns fiscal fields', async () => {
  const mock = await startMockEtimsServer();
  try {
    const init = await initDevice({
      baseUrl: mock.url,
      tin: TIN,
      bhfId: BHF,
      dvcSrlNo: DVC,
    });
    const result = await submitSale({
      baseUrl: mock.url,
      tin: TIN,
      bhfId: BHF,
      cmcKey: init.cmcKey,
      payload: { invcNo: 1, totAmt: 1160 },
    });
    assert.ok(typeof result.curRcptNo === 'number');
    assert.ok(typeof result.totRcptNo === 'number');
    assert.ok(result.intrlData.startsWith('MOCK-INTRL-'));
    assert.ok(result.rcptSign.startsWith('MOCK-SIGN-'));
  } finally {
    await mock.close();
  }
});

test('client: retries on 5xx and succeeds', async () => {
  const mock = await startMockEtimsServer();
  try {
    await fetch(`${mock.url}/__debug/set-fail-save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ count: 1 }),
    });
    const init = await initDevice({
      baseUrl: mock.url,
      tin: TIN,
      bhfId: BHF,
      dvcSrlNo: DVC,
    });
    const result = await submitSale({
      baseUrl: mock.url,
      tin: TIN,
      bhfId: BHF,
      cmcKey: init.cmcKey,
      payload: { invcNo: 1, totAmt: 1160 },
    });
    assert.ok(
      result.intrlData.startsWith('MOCK-INTRL-'),
      'first call was 503, retry should succeed',
    );
  } finally {
    await mock.close();
  }
});

test('client: throws EtimsApiError with kind=timeout after retries', async () => {
  const mock = await startMockEtimsServer();
  try {
    await fetch(`${mock.url}/__debug/set-sleep-save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ms: 500 }),
    });
    const init = await initDevice({
      baseUrl: mock.url,
      tin: TIN,
      bhfId: BHF,
      dvcSrlNo: DVC,
    });
    let caught: unknown = null;
    try {
      await submitSale({
        baseUrl: mock.url,
        tin: TIN,
        bhfId: BHF,
        cmcKey: init.cmcKey,
        payload: { invcNo: 1, totAmt: 1160 },
      });
    } catch (e) {
      caught = e;
    }
    assert.ok(
      caught instanceof EtimsApiError,
      `expected EtimsApiError, got ${typeof caught}`,
    );
    assert.equal((caught as EtimsApiError).kind, 'timeout');
  } finally {
    await mock.close();
  }
});
