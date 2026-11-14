import './env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeTaxBuckets,
  buildSalesPayload,
  deriveTrdInvcNo,
  formatSalesDt,
  formatCfmDt,
  type ItemForPayload,
  type TicketForPayload,
  type TenantForPayload,
  type UserForPayload,
  type DeviceForPayload,
} from '../src/modules/etims/payload.js';

const item = (overrides: Partial<ItemForPayload> = {}): ItemForPayload => ({
  name: 'Nyama Choma',
  quantity: 2,
  unit_price: '450.00',
  line_total: '900.00',
  vat_rate: '0.1600',
  tax_ty_cd: 'B',
  ...overrides,
});

test('computeTaxBuckets: mixed B + A items, totals reconcile exactly', () => {
  const items: ItemForPayload[] = [
    item({ line_total: '500.00', tax_ty_cd: 'B', vat_rate: '0.16' }),
    item({ line_total: '500.00', tax_ty_cd: 'B', vat_rate: '0.16' }),
    item({ line_total: '100.00', tax_ty_cd: 'A', vat_rate: '0' }),
  ];
  const b = computeTaxBuckets(items);
  assert.equal(b.taxblAmtB, 1000);
  assert.equal(b.taxAmtB, 160);
  assert.equal(b.taxblAmtA, 100);
  assert.equal(b.taxAmtA, 0);
  assert.equal(b.totTaxblAmt, 1100);
  assert.equal(b.totTaxAmt, 160);
  assert.equal(b.totAmt, 1260);
});

test('computeTaxBuckets: empty items → all zero', () => {
  const b = computeTaxBuckets([]);
  assert.equal(b.totTaxblAmt, 0);
  assert.equal(b.totTaxAmt, 0);
  assert.equal(b.totAmt, 0);
  assert.equal(b.taxblAmtA + b.taxblAmtB + b.taxblAmtC + b.taxblAmtD + b.taxblAmtE, 0);
});

test('formatSalesDt / formatCfmDt: Nairobi local conversion', () => {
  // UTC 12:34:56 → Nairobi 15:34:56 (same day)
  const d = new Date('2026-11-14T12:34:56Z');
  assert.equal(formatSalesDt(d), '20261114');
  assert.equal(formatCfmDt(d), '20261114153456');
});

test('deriveTrdInvcNo: deterministic, TKT- prefix, uppercase, no hyphens', () => {
  const out = deriveTrdInvcNo('7b27a25a-1514-4b81-8c58-ee91d157ad2a');
  assert.ok(out.startsWith('TKT-'));
  assert.equal(out, out.toUpperCase());
  assert.ok(!out.slice(4).includes('-'));
  assert.equal(out, 'TKT-7B27A25A1514');
});

test('buildSalesPayload: single B item end-to-end', () => {
  const ticket: TicketForPayload = {
    id: '7b27a25a-1514-4b81-8c58-ee91d157ad2a',
    tenant_id: '2f6dd163-51f5-461c-a340-23d7a5b226df',
    subtotal: '900.00',
    vat_amount: '144.00',
    total: '1044.00',
    closed_at: new Date('2026-11-14T12:34:56Z'),
  };
  const items: ItemForPayload[] = [item()];
  const tenant: TenantForPayload = { kra_pin: 'P051234567A' };
  const user: UserForPayload = { id: 'user-1', email: 'admin@demo.local' };
  const device: DeviceForPayload = { sdc_id: 'SDC-001', mrc_no: 'MRC-001' };

  const p = buildSalesPayload(ticket, items, tenant, user, device, {
    invcNo: 1,
    bhfId: '00',
  });

  // Header
  assert.equal(p.tin, 'P051234567A');
  assert.equal(p.bhfId, '00');
  assert.equal(p.invcNo, 1);
  assert.equal(p.trdInvcNo, 'TKT-7B27A25A1514');
  assert.equal(p.salesTyCd, 'N');
  assert.equal(p.rcptTyCd, 'S');
  assert.equal(p.totItemCnt, 1);

  // Buckets
  assert.equal(p.taxblAmtB, 900);
  assert.equal(p.taxAmtB, 144);
  assert.equal(p.totTaxblAmt, 900);
  assert.equal(p.totTaxAmt, 144);
  assert.equal(p.totAmt, 1044);

  // Receipt mirror
  assert.equal(p.receipt.itemList.length, 1);
  const r = p.receipt.itemList[0];
  assert.equal(r.itemNm, 'Nyama Choma');
  assert.equal(r.taxTyCd, 'B');
  assert.equal(r.qty, 2);
  assert.equal(r.prc, 450);
  assert.equal(r.splyAmt, 900);
  assert.equal(r.taxAmt, 144);
  assert.equal(r.totAmt, 1044);

  // Timestamps
  assert.equal(p.cfmDt, '20261114153456');
  assert.equal(p.salesDt, '20261114');
});
