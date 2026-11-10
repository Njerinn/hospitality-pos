import { useEffect, useState } from 'react';
import { api, type KdsItem } from '../api';

interface TicketGroup {
  ticket_id: string;
  table_name: string | null;
  ticket_status: string;
  items: KdsItem[];
  oldest_seconds: number;
}

export function KDS() {
  const [items, setItems] = useState<KdsItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<number>(Date.now());

  async function load() {
    try {
      const r = await api.getKdsQueue();
      setItems(r.items);
      setLastRefresh(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, []);

  function groupByTicket(list: KdsItem[]): TicketGroup[] {
    const map = new Map<string, TicketGroup>();
    for (const it of list) {
      const g = map.get(it.ticket_id);
      if (g) {
        g.items.push(it);
        if (it.elapsed_seconds > g.oldest_seconds) g.oldest_seconds = it.elapsed_seconds;
      } else {
        map.set(it.ticket_id, {
          ticket_id: it.ticket_id,
          table_name: it.table_name,
          ticket_status: it.ticket_status,
          items: [it],
          oldest_seconds: it.elapsed_seconds,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.oldest_seconds - a.oldest_seconds);
  }

  function formatElapsed(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    if (m < 5) return `${m}m ${s}s`;
    return `${m}m+`;
  }

  function alertClass(seconds: number): string {
    if (seconds >= 300) return 'kds-critical';
    if (seconds >= 180) return 'kds-warn';
    return 'kds-ok';
  }

  async function onMarkReady(itemId: string) {
    setBusy(itemId);
    setError(null);
    try {
      await api.markItemReady(itemId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function onBumpTicket(ticketId: string) {
    setBusy(ticketId);
    setError(null);
    try {
      await api.bumpTicket(ticketId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const groups = groupByTicket(items);
  const totalItems = items.length;

  if (items.length === 0) {
    return (
      <div className="kds">
        <div className="kds-header">
          <h1>Kitchen Display</h1>
          <span className="kds-refresh">auto-refresh 10s · {new Date(lastRefresh).toLocaleTimeString()}</span>
        </div>
        <div className="kds-empty">
          <p className="kds-empty-title">No pending items.</p>
          <p className="kds-empty-sub">All caught up ✓</p>
        </div>
      </div>
    );
  }

  return (
    <div className="kds">
      <div className="kds-header">
        <h1>Kitchen Display</h1>
        <div className="kds-header-right">
          <span className="kds-count">{totalItems} item{totalItems !== 1 ? 's' : ''} pending</span>
          <span className="kds-refresh">{new Date(lastRefresh).toLocaleTimeString()}</span>
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="kds-grid">
        {groups.map((g) => (
          <div key={g.ticket_id} className={`kds-ticket ${alertClass(g.oldest_seconds)}`}>
            <div className="kds-ticket-header">
              <div className="kds-ticket-meta">
                <strong className="kds-table">{g.table_name ?? 'Takeaway'}</strong>
                <span className="kds-status">{g.ticket_status.replace('_', ' ')}</span>
              </div>
              <span className={`kds-elapsed ${alertClass(g.oldest_seconds)}`}>
                {formatElapsed(g.oldest_seconds)}
              </span>
            </div>

            <ul className="kds-items">
              {g.items.map((it) => (
                <li key={it.id}>
                  <span className="kds-qty">{it.quantity}×</span>
                  <span className="kds-name">{it.name}</span>
                  <span className="kds-course">C{it.course_number}</span>
                  <button
                    className="kds-ready-btn"
                    onClick={() => onMarkReady(it.id)}
                    disabled={busy === it.id}
                  >
                    {busy === it.id ? '…' : 'Ready'}
                  </button>
                </li>
              ))}
            </ul>

            <button
              className="kds-bump-btn"
              onClick={() => onBumpTicket(g.ticket_id)}
              disabled={busy === g.ticket_id}
            >
              Bump All ({g.items.length})
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
