import { useEffect, useState, type FormEvent } from 'react';
import { api, type OutletStockItem, type ButcherySale } from '../api';

export function Butchery() {
  const [items, setItems] = useState<OutletStockItem[]>([]);
  const [sales, setSales] = useState<ButcherySale[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [saleItemId, setSaleItemId] = useState('');
  const [saleWeight, setSaleWeight] = useState('');
  const [salePrice, setSalePrice] = useState('');
  const [saleNotes, setSaleNotes] = useState('');

  async function load() {
    try {
      const [stockRes, salesRes] = await Promise.all([
        api.getOutletStock('butchery'),
        api.listButcherySales(),
      ]);
      setItems(stockRes.items);
      setSales(salesRes.sales);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function submitSale(e: FormEvent) {
    e.preventDefault();
    if (!saleItemId) return;
    const weight = Number(saleWeight);
    const price = Number(salePrice);
    if (!Number.isFinite(weight) || weight <= 0) {
      setError('Weight must be a positive number (grams)');
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      setError('Price per kg must be zero or greater');
      return;
    }
    setBusy('sale');
    setError(null);
    try {
      await api.createButcherySale({
        stock_item_id: saleItemId,
        weight_g: weight,
        price_per_kg: price,
        notes: saleNotes || undefined,
      });
      setSaleItemId('');
      setSaleWeight('');
      setSalePrice('');
      setSaleNotes('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  function selectedItem(): OutletStockItem | undefined {
    return items.find((i) => i.id === saleItemId);
  }

  function previewTotal(): string {
    const w = Number(saleWeight);
    const p = Number(salePrice);
    if (!Number.isFinite(w) || !Number.isFinite(p) || w <= 0) return '0.00';
    return ((w / 1000) * p).toFixed(2);
  }

  const currentItem = selectedItem();

  return (
    <div className="butchery-page">
      <div className="butchery-header">
        <h2>Butchery Sales</h2>
        <button onClick={load} disabled={busy !== null}>Refresh</button>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="butchery-grid">
        <div className="butchery-panel">
          <h3>Butchery Stock</h3>
          {items.length === 0 && (
            <p className="muted">
              No stock in butchery outlet yet. Forward stock from storage on the Inventory page.
              Butchery sales require stock items with unit &quot;g&quot;.
            </p>
          )}
          {items.length > 0 && (
            <table className="butchery-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>In butchery</th>
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

          <h3 style={{ marginTop: 24 }}>Recent Sales</h3>
          {sales.length === 0 && <p className="muted">No sales recorded yet.</p>}
          {sales.length > 0 && (
            <div className="butchery-recent">
              {sales.map((s) => (
                <div key={s.id} className="butchery-recent-item">
                  <div>
                    <strong>{s.weight_g} g</strong> × {s.price_per_kg} /kg ={' '}
                    <span className="amount">KES {s.total_amount}</span>
                    {' '}— {s.stock_name}
                  </div>
                  <div className="meta">
                    {new Date(s.created_at).toLocaleString()}
                    {s.sold_by_email ? ` · ${s.sold_by_email}` : ''}
                    {s.notes ? ` · ${s.notes}` : ''}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="butchery-panel">
          <h3>Record Sale</h3>
          <form className="butchery-form" onSubmit={submitSale}>
            <select
              value={saleItemId}
              onChange={(e) => setSaleItemId(e.target.value)}
              required
            >
              <option value="">— Select stock item (g) —</option>
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
              placeholder="Weight sold (g)"
              value={saleWeight}
              onChange={(e) => setSaleWeight(e.target.value)}
              required
            />
            <input
              type="number"
              step="0.01"
              min="0"
              placeholder="Price per kg (KES)"
              value={salePrice}
              onChange={(e) => setSalePrice(e.target.value)}
              required
            />
            <textarea
              placeholder="Notes (optional)"
              value={saleNotes}
              onChange={(e) => setSaleNotes(e.target.value)}
            />
            <div className="butchery-sale-total">
              Total: KES {previewTotal()}
              {currentItem && saleWeight && salePrice && (
                <small> ({saleWeight} g × KES {salePrice}/kg)</small>
              )}
            </div>
            <button type="submit" disabled={busy === 'sale'}>
              {busy === 'sale' ? 'Recording…' : 'Record Sale'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
