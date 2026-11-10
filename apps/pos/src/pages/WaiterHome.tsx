import { useEffect, useState } from 'react';
import { api, type Table, type TicketListItem } from '../api';

interface Props { onOpenTicket: (ticketId: string) => void; }

export function WaiterHome({ onOpenTicket }: Props) {
  const [tables, setTables] = useState<Table[]>([]);
  const [tickets, setTickets] = useState<TicketListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<number>(Date.now());

  async function load() {
    try {
      const [t, tk] = await Promise.all([api.listTables(), api.listTickets()]);
      setTables(t.tables);
      setTickets(tk.tickets);
      setLastRefresh(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, []);

  function openFor(t: Table): TicketListItem | undefined {
    return tickets.find(
      (tk) => tk.table_id === t.id && (tk.status === 'open' || tk.status === 'sent_to_kitchen'),
    );
  }

  async function tapTable(t: Table) {
    setBusy(true);
    setError(null);
    try {
      const open = openFor(t);
      if (open) {
        onOpenTicket(open.id);
      } else {
        const nt = await api.openTicket(t.id);
        onOpenTicket(nt.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="waiter-home">
      <div className="waiter-toolbar">
        <h2>Tables</h2>
        <span className="muted">auto-refresh 15s</span>
      </div>
      {error && <div className="error">{error}</div>}
      {tables.length === 0 && <p className="muted">No tables yet.</p>}
      <div className="waiter-grid">
        {tables.map((t) => {
          const open = openFor(t);
          const state = open ? 'active' : 'free';
          return (
            <button
              key={t.id}
              className={`waiter-table waiter-table-${state}`}
              onClick={() => tapTable(t)}
              disabled={busy}
            >
              <span className="waiter-table-name">{t.name}</span>
              <span className="waiter-table-info">
                {open ? `${open.status} · ${open.total}` : `cap ${t.capacity}`}
              </span>
              <span className="waiter-table-action">
                {open ? 'Add items →' : 'Open ticket →'}
              </span>
            </button>
          );
        })}
      </div>
      <p className="waiter-hint">Last refresh: {new Date(lastRefresh).toLocaleTimeString()}</p>
    </div>
  );
}
