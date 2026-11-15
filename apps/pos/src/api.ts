const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

type UnauthorizedHandler = () => void;
let onUnauthorized: UnauthorizedHandler | null = null;

export function setOnUnauthorized(handler: UnauthorizedHandler | null): void {
  onUnauthorized = handler;
}

let refreshPromise: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

export interface AuthClaims {
  sub: string;
  tenant_id: string;
  role: string;
}

export interface Table {
  id: string;
  name: string;
  capacity: number;
  status: string;
}

export interface Ticket {
  id: string;
  status: string;
  total: string;
  opened_at: string;
  type?: 'dine_in' | 'retail';
}

export interface TicketSummary {
  id: string;
  table_id: string | null;
  status: string;
  subtotal: string;
  vat_amount: string;
  total: string;
  opened_at: string;
  closed_at: string | null;
}

export interface TicketListItem {
  id: string;
  table_id: string | null;
  status: string;
  subtotal: string;
  vat_amount: string;
  total: string;
  opened_at: string;
}

export interface TicketItem {
  id: string;
  name: string;
  quantity: number;
  unit_price: string;
  line_total: string;
  vat_rate: string;
  sent_to_kitchen: boolean;
  course_number: number;
}

export interface KdsItem {
  id: string;
  ticket_id: string;
  name: string;
  quantity: number;
  course_number: number;
  notes: string | null;
  created_at: string;
  ticket_status: string;
  table_name: string | null;
  elapsed_seconds: number;
}

export interface Product {
  id: string;
  name: string;
  category: string | null;
  price: string;
  active: boolean;
  tax_ty_cd?: string;
}

export interface StockItem {
  id: string;
  name: string;
  unit: string;
  quantity: string;
  reorder_point: string;
  cost_per_unit: string;
  is_low: boolean;
}

export interface StockMovement {
  id: string;
  delta: string;
  reason: string;
  ref_id: string | null;
  created_at: string;
}

export interface Recipe {
  id: string;
  product_id: string;
  product_name: string;
  stock_item_id: string;
  stock_name: string;
  unit: string;
  quantity_per_product: string;
}

export interface ReportSummary {
  from: string;
  to: string;
  revenue: string;
  tickets: number;
  average_ticket: string;
  vat_collected: string;
  stock_cost: string;
  gross_profit: string;
}

export interface ReportSalesDay {
  day: string;
  revenue: string;
  tickets: number;
}

export interface ReportSalesHour {
  hour: number;
  revenue: string;
  tickets: number;
}

export interface ReportTopItem {
  name: string;
  quantity: number;
  revenue: string;
  ticket_count: number;
}

export interface ReportVat {
  from: string;
  to: string;
  net_sales: string;
  vat_collected: string;
  gross_sales: string;
  transaction_count: number;
  rate: string;
}

export interface ReportPayments {
  from: string;
  to: string;
  mpesa: { count: number; amount: string };
  other: { count: number; amount: string };
  total: { count: number; amount: string };
}

export interface ReportStockUsage {
  name: string;
  unit: string;
  total_consumed: string;
  total_cost: string;
}

export interface AddItemPayload {
  name: string;
  quantity: number;
  unit_price: number;
  vat_rate: number;
  course_number?: number;
  notes?: string;
  tax_ty_cd?: 'A' | 'B' | 'C' | 'D' | 'E';
}

async function request<T>(path: string, init?: RequestInit, retryCount = 0): Promise<T> {
  const finalInit: RequestInit = {
    credentials: 'include',
    ...init,
    headers: {
      'content-type': 'application/json',
      ...init?.headers,
    },
  };
  if (finalInit.method === 'POST' && finalInit.body === undefined) {
    finalInit.body = '{}';
  }
  const res = await fetch(`${BASE}${path}`, finalInit);
  if (!res.ok) {
    const body = await res.text();
    const isAuthPath = path.startsWith('/auth/');
    const canRetry = res.status === 401 && !isAuthPath && retryCount < 1;
    if (canRetry) {
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        return request<T>(path, init, retryCount + 1);
      }
    }
    if (res.status === 401 && path !== '/auth/login' && onUnauthorized) {
      onUnauthorized();
    }
    throw new Error(`HTTP ${res.status}: ${body}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

async function downloadBlob(path: string, init?: RequestInit, retryCount = 0): Promise<Blob> {
  const finalInit: RequestInit = {
    credentials: 'include',
    ...init,
    headers: {
      'content-type': 'application/json',
      ...init?.headers,
    },
  };
  if (finalInit.method === 'POST' && finalInit.body === undefined) {
    finalInit.body = '{}';
  }
  const res = await fetch(`${BASE}${path}`, finalInit);
  if (!res.ok) {
    if (res.status === 401 && retryCount < 1) {
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        return downloadBlob(path, init, retryCount + 1);
      }
    }
    if (res.status === 401 && onUnauthorized) {
      onUnauthorized();
    }
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body}`);
  }
  return res.blob();
}

export interface EtimsTenantConfig {
  business_structure: string | null;
  kra_pin: string | null;
  kra_pin_type: string | null;
  vat_registered: boolean;
  etims_enabled: boolean;
  etims_mode: string;
  vat_inclusive: boolean;
  paybill_number: string | null;
  mpesa_fixed_account: string | null;
}

export interface EtimsQueueCount {
  status: string;
  n: number;
}

export interface EtimsQueueRecent {
  id: string;
  ticket_id: string;
  status: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export type EtimsReceipt =
  | { status: 'not_applicable' }
  | { status: 'pending' }
  | { status: 'failed'; last_error: string | null }
  | {
      status: 'submitted';
      invc_no: number;
      rcpt_no: number;
      intrl_data: string;
      rcpt_sign: string;
      submitted_at: string;
      qr_data_url: string;
    };

export interface EtimsDevice {
  id: string;
  bhf_id: string;
  dvc_srl_no: string;
  last_handshake_at: string;
  last_notice_poll_at: string | null;
  has_cmc_key: boolean;
}

export interface MpesaRegistration {
  registered_at: string;
  response_status: number;
  response_body: unknown;
  registered_by_email: string | null;
}

export interface MpesaRegistrationStatus {
  last_registration: MpesaRegistration | null;
}

export interface UnallocatedMpesa {
  id: string;
  trans_id: string;
  amount: string;
  msisdn: string;
  bill_ref: string | null;
  trans_time: string;
  match_reason: string | null;
  suggested_tickets: Array<{
    id: string;
    table_id: string | null;
    opened_at: string;
  }>;
}

export type Outlet = 'storage' | 'kitchen' | 'bbq' | 'butchery';

export interface OutletStockItem {
  id: string;
  name: string;
  unit: string;
  outlet_qty: string;
  total_qty: string;
}

export interface OutletBreakdown {
  item: { name: string; unit: string; quantity: string };
  outlets: Array<{ outlet: string; qty: string }>;
}

export interface ButcherySale {
  id: string;
  stock_item_id: string;
  stock_name: string;
  weight_g: string;
  price_per_kg: string;
  total_amount: string;
  cost_basis: string;
  notes: string | null;
  sold_by: string | null;
  sold_by_email: string | null;
  created_at: string;
}

export interface BbqProduct {
  id: string;
  name: string;
  category: string | null;
  price: string;
  active: boolean;
  tax_ty_cd?: string;
}

export interface BbqSale {
  id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: string;
  total_amount: string;
  notes: string | null;
  recipe_deducted: boolean;
  sold_by: string | null;
  sold_by_email: string | null;
  created_at: string;
}

export const api = {
  baseUrl: BASE,
  login: (email: string, password: string) =>
    request<{ ok: true }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST' }),
  whoami: () => request<{ user: AuthClaims }>('/whoami'),
  listTables: () => request<{ tables: Table[] }>('/tables'),
  listTickets: () => request<{ tickets: TicketListItem[] }>('/tickets'),
  getKdsQueue: () => request<{ items: KdsItem[] }>('/kds/queue'),
  markItemReady: (itemId: string) =>
    request<{ ok: true; item: { id: string; ready_at: string } }>(`/kds/items/${itemId}/ready`, {
      method: 'POST',
    }),
  bumpTicket: (ticketId: string) =>
    request<{ ok: true; bumped: number }>(`/kds/tickets/${ticketId}/bump`, {
      method: 'POST',
    }),
  listProducts: () => request<{ products: Product[] }>('/inventory/products'),
  listStock: () => request<{ items: StockItem[] }>('/inventory/stock'),
  listLowStock: () => request<{ items: Array<Pick<StockItem, 'id' | 'name' | 'unit' | 'quantity' | 'reorder_point'>> }>('/inventory/stock/low'),
  restockItem: (id: string, delta: number, reason: 'restock' | 'adjustment' = 'restock') =>
    request<{ ok: true; item: { id: string; quantity: string } }>(`/inventory/stock/${id}/restock`, {
      method: 'POST',
      body: JSON.stringify({ delta, reason }),
    }),
  listMovements: (id: string) =>
    request<{ movements: StockMovement[] }>(`/inventory/stock/${id}/movements`),
  listRecipes: () => request<{ recipes: Recipe[] }>('/inventory/recipes'),

  createProduct: (body: { name: string; category?: string; price: number; tax_ty_cd?: 'A' | 'B' | 'C' | 'D' | 'E'; outlet?: 'kitchen' | 'bbq' | 'butchery' }) =>
    request<Product>('/inventory/products', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateProduct: (id: string, body: { name?: string; category?: string | null; price?: number; tax_ty_cd?: 'A' | 'B' | 'C' | 'D' | 'E' }) =>
    request<Product>(`/inventory/products/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  toggleProductActive: (id: string, active: boolean) =>
    request<{ id: string; name: string; active: boolean }>(`/inventory/products/${id}/active`, {
      method: 'PATCH',
      body: JSON.stringify({ active }),
    }),

  createStock: (body: { name: string; unit: string; quantity?: number; reorder_point?: number; cost_per_unit?: number }) =>
    request<Omit<StockItem, 'is_low'>>('/inventory/stock', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  createRecipe: (body: { product_id: string; stock_item_id: string; quantity_per_product: number }) =>
    request<{ id: string; product_id: string; stock_item_id: string; quantity_per_product: number }>(
      '/inventory/recipes',
      { method: 'POST', body: JSON.stringify(body) },
    ),

  deleteRecipe: (id: string) =>
    request<{ ok: true; deleted: string }>(`/inventory/recipes/${id}`, {
      method: 'DELETE',
    }),
  createTable: (name: string, capacity: number) =>
    request<Table>('/tables', {
      method: 'POST',
      body: JSON.stringify({ name, capacity }),
    }),
  openTicket: (table_id: string | null = null, type: 'dine_in' | 'retail' = 'dine_in') =>
    request<Ticket>('/tickets', {
      method: 'POST',
      body: JSON.stringify({ table_id, type }),
    }),
  payCash: (ticketId: string) =>
    request<{ ok: true; ticket_id: string; status: string }>(`/tickets/${ticketId}/pay-cash`, {
      method: 'POST',
    }),
  receiptPdfUrl: (ticketId: string, mode: 'original' | 'copy') =>
    `${BASE}/receipts/${ticketId}/pdf${mode === 'copy' ? '?copy=true' : ''}`,
  getTicket: (id: string) =>
    request<{ ticket: TicketSummary; items: TicketItem[] }>(`/tickets/${id}`),
  addItem: (ticketId: string, payload: AddItemPayload) =>
    request<TicketItem>(`/tickets/${ticketId}/items`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  sendToKitchen: (ticketId: string) =>
    request<{ sent: number; ticket_status: string }>(`/tickets/${ticketId}/send`, {
      method: 'POST',
    }),
  linkMpesa: (ticketId: string, transId: string) =>
    request<{ ok: true; ticket_id: string; trans_id: string; status: string }>(
      `/payments/link-mpesa/${ticketId}`,
      { method: 'POST', body: JSON.stringify({ trans_id: transId }) },
    ),
  reportSummary: (from: string, to: string) =>
    request<ReportSummary>(`/reports/summary?from=${from}&to=${to}`),
  reportSalesByDay: (from: string, to: string) =>
    request<{ from: string; to: string; days: ReportSalesDay[] }>(`/reports/sales-by-day?from=${from}&to=${to}`),
  reportSalesByHour: (from: string, to: string) =>
    request<{ from: string; to: string; hours: ReportSalesHour[] }>(`/reports/sales-by-hour?from=${from}&to=${to}`),
  reportTopItems: (from: string, to: string) =>
    request<{ from: string; to: string; items: ReportTopItem[] }>(`/reports/top-items?from=${from}&to=${to}`),
  reportVat: (from: string, to: string) =>
    request<ReportVat>(`/reports/vat?from=${from}&to=${to}`),
  reportPayments: (from: string, to: string) =>
    request<ReportPayments>(`/reports/payments?from=${from}&to=${to}`),
  reportStockUsage: (from: string, to: string) =>
    request<{ from: string; to: string; items: ReportStockUsage[] }>(`/reports/stock-usage?from=${from}&to=${to}`),
  reportPdfDownload: (from: string, to: string) =>
    downloadBlob('/reports/export/pdf', {
      method: 'POST',
      body: JSON.stringify({ from, to }),
    }),
  backupDownload: () => downloadBlob('/admin/backup'),

  // ─── eTIMS admin (patch 008D) ───
  getEtimsConfig: () => request<EtimsTenantConfig>('/etims/tenant/config'),
  updateEtimsConfig: (body: Partial<EtimsTenantConfig>) =>
    request<EtimsTenantConfig>('/etims/tenant/config', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  initEtimsDevice: (body: { bhf_id: string; dvc_srl_no: string }) =>
    request<{ ok: true; bhf_id: string; dvc_srl_no: string }>('/etims/device/init', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  getEtimsQueue: () =>
    request<{ counts: EtimsQueueCount[]; recent: EtimsQueueRecent[] }>('/etims/queue'),
  retryEtimsQueueRow: (id: string) =>
    request<{ ok: true; id: string }>(`/etims/queue/retry/${id}`, {
      method: 'POST',
    }),

  // ─── eTIMS fiscal receipt (patch 008E) ───
  getEtimsReceipt: (ticketId: string) =>
    request<EtimsReceipt>(`/receipts/${ticketId}`),

  // ─── eTIMS device status (patch 008F) ───
  getEtimsDevice: () => request<{ devices: EtimsDevice[] }>('/etims/device'),

  // ─── M-Pesa auto-match (patch 014) ───
  getMpesaRegistrationStatus: () =>
    request<MpesaRegistrationStatus>('/mpesa/registration-status'),
  registerMpesaUrls: () =>
    request<{ ok: boolean; status: number; body: unknown; registered_at: string }>(
      '/mpesa/register-urls',
      { method: 'POST', body: JSON.stringify({ confirm: true }) },
    ),
  getMpesaUnallocated: () =>
    request<{ unallocated: UnallocatedMpesa[] }>('/mpesa-ops/unallocated'),
  assignMpesaUnallocated: (id: string, ticket_id: string) =>
    request<{ ok: true; ticket_id: string; status: string }>(
      `/mpesa-ops/unallocated/${id}/assign`,
      { method: 'POST', body: JSON.stringify({ ticket_id }) },
    ),
  ignoreMpesaUnallocated: (id: string) =>
    request<{ ok: true; id: string }>(`/mpesa/unallocated/${id}/ignore`, {
      method: 'POST',
    }),

  // ─── Stock Ops (phase 015) ───
  getOutletStock: (outlet: Outlet) =>
    request<{ outlet: Outlet; items: OutletStockItem[] }>(`/stock-ops/outlet/${outlet}`),
  getStockBreakdown: (stockItemId: string) =>
    request<OutletBreakdown>(`/stock-ops/breakdown/${stockItemId}`),
  consumeStock: (body: { stock_item_id: string; quantity: number; outlet: Outlet; ref_id?: string }) =>
    request<{ ok: true; stock_item_id: string; new_total: string; consumed: number; outlet: Outlet; consumed_by: string }>(
      '/stock-ops/consume',
      { method: 'POST', body: JSON.stringify(body) },
    ),
  forwardStock: (body: { stock_item_id: string; quantity: number; from_outlet: Outlet; to_outlet: Outlet }) =>
    request<{ ok: true; stock_item_id: string; quantity: number; from_outlet: Outlet; to_outlet: Outlet; transfer_group_id: string }>(
      '/stock-ops/forward',
      { method: 'POST', body: JSON.stringify(body) },
    ),

  // ─── Butchery sales (phase 016) ───
  listButcherySales: () => request<{ sales: ButcherySale[] }>('/butchery/sales'),
  createButcherySale: (body: { stock_item_id: string; weight_g: number; price_per_kg: number; notes?: string }) =>
    request<{ ok: true; sale: { id: string; stock_item_id: string; weight_g: string; price_per_kg: string; total_amount: string; cost_basis: string; new_total_qty: string } }>(
      '/butchery/sales',
      { method: 'POST', body: JSON.stringify(body) },
    ),

  // ─── BBQ (phase 017) ───
  listBbqProducts: () => request<{ products: BbqProduct[] }>('/bbq/products'),
  listBbqSales: () => request<{ sales: BbqSale[] }>('/bbq/sales'),
  createBbqSale: (body: { product_id: string; quantity: number; notes?: string }) =>
    request<{ ok: true; sale: { id: string; product_id: string; product_name: string; quantity: number; unit_price: string; total_amount: string; recipe_deducted: boolean }; warnings?: string[] }>(
      '/bbq/sales',
      { method: 'POST', body: JSON.stringify(body) },
    ),
};
