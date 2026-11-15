import { useEffect, useState, type FormEvent } from 'react';
import { api, type OutletStockItem } from '../api';

export function Kitchen() {
  const [items, setItems] = useState<OutletStockItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [consumeItemId, setConsumeItemId] = useState('');
  const [consumeQty, setConsumeQty] = useState('');

  const [forwardItemId, setForwardItemId] = useState('');
  const [forwardQty, setForwardQty] = useState('');

  async function load() {
    try {
      const r = await api.getOutletStock('kitchen');
      setItems(r.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function submitConsume(e: FormEvent) {
    e.preventDefault();
    if (!consumeItemId) return;
    const qty = Number(consumeQty);
    if (!Number.isFinite(qty) || qty <= 0) {
      setError('Quantity must be a positive number');
      return;
    }
    setBusy('consume');
    setError(null);
    try {
      await api.consumeStock({
        stock_item_id: consumeItemId,
        quantity: qty,
        outlet: 'kitchen',
      });
      setConsumeQty('');
      setConsumeItemId('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function submitForward(e: FormEvent) {
    e.preventDefault();
    if (!forwardItemId) return;
    const qty = Number(forwardQty);
    if (!Number.isFinite(qty) || qty <= 0) {
      setError('Quantity must be a positive number');
      return;
    }
    setBusy('forward');
    setError(null);
    try {
      await api.forwardStock({
        stock_item_id: forwardItemId,
        quantity: qty,
        from_outlet: 'kitchen',
        to_outlet: 'bbq',
      });
      setForwardQty('');
      setForwardItemId('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  function availableQty(id: string): string {
    const it = items.find((i) => i.id === id);
    return it ? it.outlet_qty : '0';
  }

  return (
    <div className="kitchen-page">
      <div className="kitchen-header">
        <h2>Kitchen Operations</h2>
        <button onClick={load} disabled={busy !== null}>Refresh</button>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="kitchen-grid">
        <div className="kitchen-panel kitchen-stock-panel">
          <h3>Kitchen Stock</h3>
          {items.length === 0 && (
            <p className="muted">
              No stock in kitchen yet. Forward from storage on the Inventory page.
            </p>
          )}
          {items.length > 0 && (
            <table className="kitchen-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Qty in kitchen</th>
                  <th>Unit</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id}>
                    <td>{it.name}</td>
                    <td>{it.outlet_qty}</td>
                    <td>{it.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="kitchen-panel kitchen-forms-panel">
          <h3>Record Usage</h3>
          <form className="kitchen-form" onSubmit={submitConsume}>
            <select
              value={consumeItemId}
              onChange={(e) => setConsumeItemId(e.target.value)}
              required
            >
              <option value="">— Select item —</option>
              {items.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.name} ({it.outlet_qty} {it.unit})
                </option>
              ))}
            </select>
            <input
              type="number"
              step="0.001"
              min="0.001"
              placeholder="Quantity used"
              value={consumeQty}
              onChange={(e) => setConsumeQty(e.target.value)}
              required
            />
            {consumeItemId && (
              <span className="muted kitchen-available">
                Available: {availableQty(consumeItemId)}
              </span>
            )}
            <button type="submit" disabled={busy === 'consume'}>
              {busy === 'consume' ? 'Recording…' : 'Record Usage'}
            </button>
          </form>

          <h3>Forward to BBQ</h3>
          <form className="kitchen-form" onSubmit={submitForward}>
            <select
              value={forwardItemId}
              onChange={(e) => setForwardItemId(e.target.value)}
              required
            >
              <option value="">— Select item —</option>
              {items.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.name} ({it.outlet_qty} {it.unit})
                </option>
              ))}
            </select>
            <input
              type="number"
              step="0.001"
              min="0.001"
              placeholder="Quantity to forward"
              value={forwardQty}
              onChange={(e) => setForwardQty(e.target.value)}
              required
            />
            {forwardItemId && (
              <span className="muted kitchen-available">
                Available: {availableQty(forwardItemId)}
              </span>
            )}
            <button type="submit" disabled={busy === 'forward'}>
              {busy === 'forward' ? 'Forwarding…' : 'Forward to BBQ'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
