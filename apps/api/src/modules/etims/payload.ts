// Patch 008B-3: KRA OSCU saveTrnsSalesOsdc payload builder.
// Pure functions — no DB, no HTTP, no routes. Called by 008C.
// VAT-exclusive math: line_total is taxable base, vat_rate applied on top.
// (D15 will change this at a higher layer if tenant uses VAT-inclusive pricing.)

export type TaxTyCd = 'A' | 'B' | 'C' | 'D' | 'E';

export const TAX_RATES: Record<TaxTyCd, number> = {
  A: 0,
  B: 16,
  C: 0,
  D: 0,
  E: 8,
};

export interface TicketForPayload {
  id: string;
  tenant_id: string;
  subtotal: string;
  vat_amount: string;
  total: string;
  closed_at: Date;
}

export interface ItemForPayload {
  name: string;
  quantity: number;
  unit_price: string;
  line_total: string;
  vat_rate: string;
  tax_ty_cd: TaxTyCd;
}

export interface TenantForPayload {
  kra_pin: string;
}

export interface UserForPayload {
  id: string;
  email: string;
}

export interface DeviceForPayload {
  sdc_id: string;
  mrc_no: string;
}

export interface BuildOptions {
  invcNo: number;
  bhfId: string;
}

export interface TaxBuckets {
  taxblAmtA: number;
  taxblAmtB: number;
  taxblAmtC: number;
  taxblAmtD: number;
  taxblAmtE: number;
  taxAmtA: number;
  taxAmtB: number;
  taxAmtC: number;
  taxAmtD: number;
  taxAmtE: number;
  totTaxblAmt: number;
  totTaxAmt: number;
  totAmt: number;
}

export function computeTaxBuckets(items: ItemForPayload[]): TaxBuckets {
  const b: TaxBuckets = {
    taxblAmtA: 0, taxblAmtB: 0, taxblAmtC: 0, taxblAmtD: 0, taxblAmtE: 0,
    taxAmtA: 0, taxAmtB: 0, taxAmtC: 0, taxAmtD: 0, taxAmtE: 0,
    totTaxblAmt: 0, totTaxAmt: 0, totAmt: 0,
  };
  for (const item of items) {
    const base = Number(item.line_total);
    const tax = Number((base * Number(item.vat_rate)).toFixed(2));
    const code = item.tax_ty_cd;
    if (code === 'A') { b.taxblAmtA += base; b.taxAmtA += tax; }
    else if (code === 'B') { b.taxblAmtB += base; b.taxAmtB += tax; }
    else if (code === 'C') { b.taxblAmtC += base; b.taxAmtC += tax; }
    else if (code === 'D') { b.taxblAmtD += base; b.taxAmtD += tax; }
    else { b.taxblAmtE += base; b.taxAmtE += tax; }
  }
  b.taxblAmtA = Number(b.taxblAmtA.toFixed(2));
  b.taxblAmtB = Number(b.taxblAmtB.toFixed(2));
  b.taxblAmtC = Number(b.taxblAmtC.toFixed(2));
  b.taxblAmtD = Number(b.taxblAmtD.toFixed(2));
  b.taxblAmtE = Number(b.taxblAmtE.toFixed(2));
  b.taxAmtA = Number(b.taxAmtA.toFixed(2));
  b.taxAmtB = Number(b.taxAmtB.toFixed(2));
  b.taxAmtC = Number(b.taxAmtC.toFixed(2));
  b.taxAmtD = Number(b.taxAmtD.toFixed(2));
  b.taxAmtE = Number(b.taxAmtE.toFixed(2));
  b.totTaxblAmt = Number((b.taxblAmtA + b.taxblAmtB + b.taxblAmtC + b.taxblAmtD + b.taxblAmtE).toFixed(2));
  b.totTaxAmt = Number((b.taxAmtA + b.taxAmtB + b.taxAmtC + b.taxAmtD + b.taxAmtE).toFixed(2));
  b.totAmt = Number((b.totTaxblAmt + b.totTaxAmt).toFixed(2));
  return b;
}

export function formatSalesDt(date: Date): string {
  const s = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
  return s.replace(/-/g, '');
}

export function formatCfmDt(date: Date): string {
  const s = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(date);
  return s.replace(/-/g, '').replace(/:/g, '').replace(' ', '');
}

export function deriveTrdInvcNo(ticketId: string): string {
  return 'TKT-' + ticketId.replace(/-/g, '').slice(0, 12).toUpperCase();
}

export interface ReceiptItem {
  itemSeq: number;
  itemCd: string;
  itemClsCd: string;
  itemTyCd: string;
  itemNm: string;
  itemStdNm: null;
  orgnNatCd: string;
  pkgUnitCd: string;
  qtyUnitCd: string;
  taxTyCd: TaxTyCd;
  btchNo: null;
  bcd: null;
  pkg: number;
  qty: number;
  prc: number;
  splyAmt: number;
  totDcAmt: number;
  taxblAmt: number;
  taxAmt: number;
  totAmt: number;
}

export interface SalesPayload extends TaxBuckets {
  tin: string;
  bhfId: string;
  invcNo: number;
  orgInvcNo: number;
  trdInvcNo: string;
  salesTyCd: string;
  rcptTyCd: string;
  pmtTyCd: string;
  salesSttsCd: string;
  cfmDt: string;
  salesDt: string;
  stockRlsDt: string;
  totItemCnt: number;
  taxRtA: number;
  taxRtB: number;
  taxRtC: number;
  taxRtD: number;
  taxRtE: number;
  prchrAcptcYn: string;
  regrId: string;
  regrNm: string;
  modrId: string;
  modrNm: string;
  receipt: {
    custTin: null;
    custMblNo: null;
    rptNo: number;
    trdeNm: string;
    adrs: string;
    topMrchntNm: string;
    topMrchntTelNo: string;
    sdcId: string;
    mrcNo: string;
    cusbhfId: string;
    invcNo: number;
    orgInvcNo: number;
    salesTyCd: string;
    rcptTyCd: string;
    pmtTyCd: string;
    salesSttsCd: string;
    cfmDt: string;
    salesDt: string;
    stockRlsDt: string;
    totItemCnt: number;
    taxRtA: number;
    taxRtB: number;
    taxRtC: number;
    taxRtD: number;
    taxRtE: number;
    prchrAcptcYn: string;
    remark: null;
    regrId: string;
    regrNm: string;
    modrId: string;
    modrNm: string;
    itemList: ReceiptItem[];
  } & TaxBuckets;
}

export function buildSalesPayload(
  ticket: TicketForPayload,
  items: ItemForPayload[],
  tenant: TenantForPayload,
  user: UserForPayload,
  device: DeviceForPayload,
  options: BuildOptions,
): SalesPayload {
  const buckets = computeTaxBuckets(items);
  const cfmDt = formatCfmDt(ticket.closed_at);
  const salesDt = formatSalesDt(ticket.closed_at);
  const trdInvcNo = deriveTrdInvcNo(ticket.id);

  const itemList: ReceiptItem[] = items.map((item, idx) => {
    const prc = Number(item.unit_price);
    const qty = item.quantity;
    const splyAmt = Number(item.line_total);
    const taxAmt = Number((splyAmt * Number(item.vat_rate)).toFixed(2));
    const totAmt = Number((splyAmt + taxAmt).toFixed(2));
    return {
      itemSeq: idx + 1,
      itemCd: 'ITEM-' + String(idx + 1).padStart(4, '0'),
      itemClsCd: '5059690900',
      itemTyCd: '1',
      itemNm: item.name.slice(0, 100),
      itemStdNm: null,
      orgnNatCd: 'KE',
      pkgUnitCd: 'NT',
      qtyUnitCd: 'U',
      taxTyCd: item.tax_ty_cd,
      btchNo: null,
      bcd: null,
      pkg: 1,
      qty,
      prc,
      splyAmt,
      totDcAmt: 0,
      taxblAmt: splyAmt,
      taxAmt,
      totAmt,
    };
  });

  const taxRates = {
    taxRtA: TAX_RATES.A,
    taxRtB: TAX_RATES.B,
    taxRtC: TAX_RATES.C,
    taxRtD: TAX_RATES.D,
    taxRtE: TAX_RATES.E,
  };

  return {
    tin: tenant.kra_pin,
    bhfId: options.bhfId,
    invcNo: options.invcNo,
    orgInvcNo: 0,
    trdInvcNo,
    salesTyCd: 'N',
    rcptTyCd: 'S',
    pmtTyCd: '01',
    salesSttsCd: '02',
    cfmDt,
    salesDt,
    stockRlsDt: cfmDt,
    totItemCnt: items.length,
    ...buckets,
    ...taxRates,
    prchrAcptcYn: 'N',
    regrId: user.id,
    regrNm: user.email,
    modrId: user.id,
    modrNm: user.email,
    receipt: {
      ...buckets,
      ...taxRates,
      custTin: null,
      custMblNo: null,
      rptNo: options.invcNo,
      trdeNm: '',
      adrs: '',
      topMrchntNm: '',
      topMrchntTelNo: '',
      sdcId: device.sdc_id,
      mrcNo: device.mrc_no,
      cusbhfId: options.bhfId,
      invcNo: options.invcNo,
      orgInvcNo: 0,
      salesTyCd: 'N',
      rcptTyCd: 'S',
      pmtTyCd: '01',
      salesSttsCd: '02',
      cfmDt,
      salesDt,
      stockRlsDt: cfmDt,
      totItemCnt: items.length,
      prchrAcptcYn: 'N',
      remark: null,
      regrId: user.id,
      regrNm: user.email,
      modrId: user.id,
      modrNm: user.email,
      itemList,
    },
  };
}
