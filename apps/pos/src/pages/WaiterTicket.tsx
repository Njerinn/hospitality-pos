import { useEffect, useState, type FormEvent } from 'react';
import { api, type TicketSummary, type TicketItem } from '../api';

interface Props { ticketId: string; onBack: () => void; }

export function WaiterTicket({ ticketId, onBack }: Props) {
  const [ticket, setTicket] = useState<TicketSummary | null>(null);
  const [items, setItems] = useState<TicketItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [itemName, setItemName] = useState('');
  const [itemQty, setItemQty] = useState(1);
  const [itemPrice, setItemPrice] = useState('');
  const [itemVat, setItemVat] = useState(0.16);

  async function load() {
    try {
      const r = await api.getTicket(ticketId);
      setTicket(r.ticket);
      setItems(r.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => { load(); }, [ticketId]);

  async function addItem(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api.addItem(ticketId, {
        name: itemName,
        quantity: itemQty,
        unit_price: Number(itemPrice),
        vat_rate: itemVat,
      });
      setItemName(''); setItemQty(1); setItemPrice(''); setItemVat(0.16);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally { setBusy(false); }
  }

  async function sendToKitchen() {
    setBusy(true); setError(null);
    try {
      await api.sendToKitchen(ticketId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally { setBusy(false); }
  }

  if (!ticket) return <div className="loading">Loading ticket…</div>;

  const unsent = items.filter((i) => !i.sent_to_kitchen).length;
  const isClosed = ticket.status === 'paid' || ticket.status === 'voided';

  return (
    <div className="waiter-ticket">
      <div className="waiter-ticket-header">
        <button onClick={onBack}>← Tables</button>
        <span className={`badge status-${ticket.status}`}>{ticket.status}</span>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="waiter-ticket-body">
        <div className="waiter-items">
          <h3>Items</h3>
          {items.length === 0 && <p className="muted">No items yet.</p>}
          <ul className="waiter-items-list">
            {items.map((it) => (
              <li key={it.id} className={it.sent_to_kitchen ? 'sent' : ''}>
                <span className="waiter-item-qty">{it.quantity}×</span>
                <span className="waiter-item-name">{it.name}</span>
                <span className="waiter-item-price">{it.line_total}</span>
                {it.sent_to_kitchen && <span className="sent-mark">✓</span>}
              </li>
            ))}
          </ul>

          {!isClosed && (
            <form className="waiter-add-form" onSubmit={addItem}>
              <h4>Add item</h4>
              <input
                placeholder="Item name"
                value={itemName}
                onChange={(e) => setItemName(e.target.value)}
                required
              />
              <div className="waiter-add-row">
                <input
                  type="number"
                  placeholder="Qty"
                  min={1}
                  value={itemQty}
                  onChange={(e) => setItemQty(Number(e.target.value))}
                  required
                />
                <input
                  type="number"
                  step="0.01"
                  placeholder="Price"
                  min={0}
                  value={itemPrice}
                  onChange={(e) => setItemPrice(e.target.value)}
                  required
                />
                <select value={itemVat} onChange={(e) => setItemVat(Number(e.target.value))}>
                  <option value={0.16}>VAT 16%</option>
                  <option value={0}>No VAT</option>
                </select>
              </div>
              <button type="submit" disabled={busy}>+ Add</button>
            </form>
          )}
        </div>

        <div className="waiter-totals">
          <div className="waiter-total-line"><span>Subtotal</span><span>{ticket.subtotal}</span></div>
          <div className="waiter-total-line"><span>VAT</span><span>{ticket.vat_amount}</span></div>
          <div className="waiter-total-line total"><span>Total</span><span>{ticket.total}</span></div>

          {!isClosed && (
            <button
              className="waiter-send-btn"
              onClick={sendToKitchen}
              disabled={busy || unsent === 0}
            >
              Send {unsent} to Kitchen
            </button>
          )}

          {isClosed && <p className="waiter-closed-banner">{ticket.status}</p>}
          {!isClosed && <p className="waiter-hint">Payment handled by cashier</p>}
        </div>
      </div>
    </div>
  );
}
