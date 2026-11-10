const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

type UnauthorizedHandler = () => void;
let onUnauthorized: UnauthorizedHandler | null = null;

export function setOnUnauthorized(handler: UnauthorizedHandler | null): void {
  onUnauthorized = handler;
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

export interface AddItemPayload {
  name: string;
  quantity: number;
  unit_price: number;
  vat_rate: number;
  course_number?: number;
  notes?: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
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
    if (res.status === 401 && path !== '/auth/login' && onUnauthorized) {
      onUnauthorized();
    }
    throw new Error(`HTTP ${res.status}: ${body}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
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
  createTable: (name: string, capacity: number) =>
    request<Table>('/tables', {
      method: 'POST',
      body: JSON.stringify({ name, capacity }),
    }),
  openTicket: (table_id: string) =>
    request<Ticket>('/tickets', {
      method: 'POST',
      body: JSON.stringify({ table_id }),
    }),
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
};
