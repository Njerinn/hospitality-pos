const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000';

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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    ...init,
    headers: {
      'content-type': 'application/json',
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text();
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
};
