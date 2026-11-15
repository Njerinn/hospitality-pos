import { useEffect, useState, type FormEvent } from 'react';
import { api, type BbqProduct, type BbqSale } from '../api';

export function Bbq() {
  const [products, setProducts] = useState<BbqProduct[]>([]);
  const [sales, setSales] = useState<BbqSale[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [saleProductId, setSaleProductId] = useState('');
  const [saleQty, setSaleQty] = useState('1');
  const [saleNotes, setSaleNotes] = useState('');

  async function load() {
    try {
      const [p, s] = await Promise.all([
        api.listBbqProducts(),
        api.listBbqSales(),
      ]);
      setProducts(p.products);
      setSales(s.sales);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function submitSale(e: FormEvent) {
    e.preventDefault();
    if (!saleProductId) return;
    const qty = Number(saleQty);
    if (!Number.isInteger(qty) || qty <= 0) {
      setError('Quantity must be a positive integer');
      return;
    }
    setBusy('sale');
    setError(null);
    try {
      await api.createBbqSale({
        product_id: saleProductId,
        quantity: qty,
        notes: saleNotes || undefined,
      });
      setSaleProductId('');
      setSaleQty('1');
      setSaleNotes('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  function selectedProduct(): BbqProduct | undefined {
    return products.find((p) => p.id === saleProductId);
  }

  function previewTotal(): string {
    const p = selectedProduct();
    const q = Number(saleQty);
    if (!p || !Number.isFinite(q) || q <= 0) return '0.00';
    return (Number(p.price) * q).toFixed(2);
  }

  const current = selectedProduct();

  return (
    <div className="bbq-page">
      <div className="bbq-header">
        <h2>BBQ — Choma</h2>
        <button onClick={load} disabled={busy !== null}>Refresh</button>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="bbq-grid">
        <div className="bbq-panel">
          <h3>BBQ Menu</h3>
          {products.length === 0 && (
            <p className="muted">
              No BBQ products yet. Add products with outlet set to &quot;BBQ&quot; on the Menu page.
            </p>
          )}
          {products.length > 0 && (
            <div className="bbq-product-grid">
              {products.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`bbq-product-card${saleProductId === p.id ? ' selected' : ''}`}
                  onClick={() => setSaleProductId(p.id)}
                >
                  <span className="bbq-product-name">{p.name}</span>
                  {p.category && <span className="bbq-product-category">{p.category}</span>}
                  <span className="bbq-product-price">KES {p.price}</span>
                </button>
              ))}
            </div>
          )}

          <h3 style={{ marginTop: 24 }}>Recent Sales</h3>
          {sales.length === 0 && <p className="muted">No sales recorded yet.</p>}
          {sales.length > 0 && (
            <div className="bbq-recent">
              {sales.map((s) => (
                <div key={s.id} className="bbq-recent-item">
                  <div>
                    <strong>{s.quantity}× {s.product_name}</strong>
                    {' '}= <span className="amount">KES {s.total_amount}</span>
                    {s.recipe_deducted
                      ? <span className="muted"> · recipe applied</span>
                      : <span className="muted"> · no recipe</span>}
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

        <div className="bbq-panel">
          <h3>Record Sale</h3>
          <form className="bbq-form" onSubmit={submitSale}>
            {current && (
              <div className="muted">
                Selected: {current.name} @ KES {current.price}
              </div>
            )}
            <input
              type="number"
              step="1"
              min="1"
              placeholder="Quantity"
              value={saleQty}
              onChange={(e) => setSaleQty(e.target.value)}
              required
            />
            <textarea
              placeholder="Notes (optional)"
              value={saleNotes}
              onChange={(e) => setSaleNotes(e.target.value)}
            />
            <div className="bbq-total">
              Total: KES {previewTotal()}
              {current && saleQty && (
                <small> ({saleQty} × KES {current.price})</small>
              )}
            </div>
            <button type="submit" disabled={busy === 'sale' || !saleProductId}>
              {busy === 'sale' ? 'Recording…' : 'Record Sale'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
