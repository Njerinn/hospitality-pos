import { useEffect, useState } from 'react';
import { api, type Table } from '../api';

export function Tables({ onOpenTicket }: { onOpenTicket: (ticketId: string) => void }) {
  const [tables, setTables] = useState<Table[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const r = await api.listTables();
      setTables(r.tables);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => { load(); }, []);

  async function newTable() {
    const name = prompt('Table name (e.g. T-05)');
    if (!name) return;
    setBusy(true);
    try {
      await api.createTable(name, 4);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function openTicket(t: Table) {
    setBusy(true);
    setError(null);
    try {
      const ticket = await api.openTicket(t.id);
      onOpenTicket(ticket.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="tables-toolbar">
        <h2>Tables</h2>
        <button onClick={newTable} disabled={busy}>+ New table</button>
      </div>
      {error && <div className="error">{error}</div>}
      {tables.length === 0 && <p className="muted">No tables yet. Click "+ New table".</p>}
      <div className="table-grid">
        {tables.map((t) => (
          <button
            key={t.id}
            className={`table-card status-${t.status}`}
            onClick={() => openTicket(t)}
            disabled={busy}
          >
            <strong>{t.name}</strong>
            <span className="muted">cap {t.capacity}</span>
            <span className="badge">{t.status}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
