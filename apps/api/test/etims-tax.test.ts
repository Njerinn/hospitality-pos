import './env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTaxTyCd, TAX_TY_CD_VALUES } from '../src/modules/etims/tax.js';

test('resolveTaxTyCd: product wins when both provided', () => {
  assert.equal(resolveTaxTyCd('A', 'E'), 'E');
});

test('resolveTaxTyCd: body used when no product code', () => {
  assert.equal(resolveTaxTyCd('C', null), 'C');
});

test('resolveTaxTyCd: default B when both absent', () => {
  assert.equal(resolveTaxTyCd(undefined, null), 'B');
});

test('TAX_TY_CD_VALUES contains exactly A/B/C/D/E', () => {
  assert.deepEqual([...TAX_TY_CD_VALUES].sort(), ['A', 'B', 'C', 'D', 'E']);
});

test('resolveTaxTyCd: product always wins across all 25 body×product combos', () => {
  const codes: Array<'A' | 'B' | 'C' | 'D' | 'E'> = ['A', 'B', 'C', 'D', 'E'];
  for (const body of codes) {
    for (const product of codes) {
      assert.equal(
        resolveTaxTyCd(body, product),
        product,
        `product '${product}' should win over body '${body}'`,
      );
    }
  }
});

test('resolveTaxTyCd: null/undefined product falls back to body', () => {
  assert.equal(resolveTaxTyCd('E', null), 'E');
  assert.equal(resolveTaxTyCd('A', undefined), 'A');
  assert.equal(resolveTaxTyCd('C', null), 'C');
  assert.equal(resolveTaxTyCd('D', undefined), 'D');
});
