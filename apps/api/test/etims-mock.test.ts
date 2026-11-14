import './env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { startMockEtimsServer } from '../src/modules/etims/mock-server.js';

test('mock OSCU: init handshake returns valid cmcKey', async () => {
  const mock = await startMockEtimsServer();
  try {
    const res = await fetch(`${mock.url}/selectInitOsdcInfo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tin: 'P051234567A', bhfId: '00', dvcSrlNo: 'TEST-001' }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      resultCd: string;
      resultMsg: string;
      data?: { cmcKey?: string };
    };
    assert.equal(
      body.resultCd,
      '000',
      `expected resultCd 000, got ${body.resultCd}: ${body.resultMsg}`,
    );
    assert.ok(
      typeof body.data?.cmcKey === 'string' && body.data.cmcKey.length > 0,
      'cmcKey missing or empty',
    );
  } finally {
    await mock.close();
  }
});

test('mock OSCU: save sale returns rcptSign + intrlData', async () => {
  const mock = await startMockEtimsServer();
  try {
    const init = await fetch(`${mock.url}/selectInitOsdcInfo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tin: 'P051234567A', bhfId: '00', dvcSrlNo: 'TEST-002' }),
    });
    const initBody = (await init.json()) as { data: { cmcKey: string } };
    const cmcKey = initBody.data.cmcKey;
    assert.ok(cmcKey.length > 0);

    const res = await fetch(`${mock.url}/saveTrnsSalesOsdc`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        tin: 'P051234567A',
        bhfId: '00',
        cmcKey,
      },
      body: JSON.stringify({ invcNo: 1, totAmt: 1160 }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      resultCd: string;
      resultMsg: string;
      data?: { rcptSign?: string; intrlData?: string; curRcptNo?: number };
    };
    assert.equal(
      body.resultCd,
      '000',
      `expected 000, got ${body.resultCd}: ${body.resultMsg}`,
    );
    assert.ok(
      typeof body.data?.rcptSign === 'string' && body.data.rcptSign.startsWith('MOCK-SIGN-'),
      `rcptSign wrong: ${body.data?.rcptSign}`,
    );
    assert.ok(
      typeof body.data?.intrlData === 'string' &&
        body.data.intrlData.startsWith('MOCK-INTRL-'),
      `intrlData wrong: ${body.data?.intrlData}`,
    );
    assert.ok(
      typeof body.data?.curRcptNo === 'number' && body.data.rcptNo !== 0,
      `curRcptNo wrong: ${body.data?.curRcptNo}`,
    );
  } finally {
    await mock.close();
  }
});
