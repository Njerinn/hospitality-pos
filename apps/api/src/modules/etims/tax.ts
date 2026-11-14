// Patch 008A2b-2: pure tax-code resolution helper.
// Source of truth precedence: product.tax_ty_cd > body.tax_ty_cd > 'B' (VAT 16% default).
// Never called with side effects — pure function, easily testable.

export type TaxTyCd = 'A' | 'B' | 'C' | 'D' | 'E';
export const TAX_TY_CD_VALUES: readonly TaxTyCd[] = ['A', 'B', 'C', 'D', 'E'];

export function resolveTaxTyCd(
  bodyTax: TaxTyCd | undefined,
  productTax: TaxTyCd | null | undefined,
): TaxTyCd {
  if (productTax) return productTax;
  if (bodyTax) return bodyTax;
  return 'B';
}
