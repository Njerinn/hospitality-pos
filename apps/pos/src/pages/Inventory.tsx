import { useEffect, useState, type FormEvent } from 'react';
import { api, type StockItem, type StockMovement, type Recipe, type OutletBreakdown } from '../api';

type RestockReason = 'restock' | 'adjustment';

export function Inventory() {
  const [stock, setStock] = useState<StockItem[]>([]);
  const [low, setLow] = useState<StockItem[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [selected, setSelected] = useState<StockItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [restockQty, setRestockQty] = useState('');
  const [restockReason, setRestockReason] = useState<RestockReason>('restock');

  const [newName, setNewName] = useState('');
  const [newUnit, setNewUnit] = useState('');
  const [newQty, setNewQty] = useState('');
  const [newReorder, setNewReorder] = useState('');
  const [newCost, setNewCost] = useState('');
  const [breakdown, setBreakdown] = useState<OutletBreakdown | null>(null);

  async function load() {
    try {
      const [s, l, r] = await Promise.all([
        api.listStock(),
        api.listLowStock(),
        api.listRecipes(),
      ]);
      setStock(s.items);
      setLow(l.items as StockItem[]);
      setRecipes(r.recipes);
      if (selected) {
        const refreshed = s.items.find((i) => i.id === selected.id);
        if (refreshed) setSelected(refreshed);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => { load(); }, []);

  async function selectStock(item: StockItem) {
    setSelected(item);
    setError(null);
    try {
      const [m, b] = await Promise.all([
        api.listMovements(item.id),
        api.getStockBreakdown(item.id),
      ]);
      setMovements(m.movements);
      setBreakdown(b);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function submitRestock(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    const delta = Number(restockQty);
    if (!Number.isFinite(delta) || delta <= 0) {
      setError('Restock amount must be a positive number');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.restockItem(selected.id, delta, restockReason);
      setRestockQty('');
      await load();
      await selectStock({ ...selected });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitAddStock(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body: { name: string; unit: string; quantity?: number; reorder_point?: number; cost_per_unit?: number } = {
        name: newName,
        unit: newUnit,
      };
      if (newQty) body.quantity = Number(newQty);
      if (newReorder) body.reorder_point = Number(newReorder);
      if (newCost) body.cost_per_unit = Number(newCost);
      await api.createStock(body);
      setNewName('');
      setNewUnit('');
      setNewQty('');
      setNewReorder('');
      setNewCost('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="inventory">
      <div className="inventory-header">
        <h2>Inventory</h2>
        <button onClick={load} disabled={busy}>Refresh</button>
      </div>

      {error && <div className="error">{error}</div>}

      {low.length > 0 && (
        <div className="inv-low-alert">
          <strong>⚠ Low stock</strong>
          <span>{low.length} item{low.length !== 1 ? 's' : ''} at or below reorder point</span>
        </div>
      )}

      <div className="inv-add-section">
        <h3>Add Stock Item</h3>
        <form className="inv-add-form" onSubmit={submitAddStock}>
          <input
            placeholder="Name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            required
          />
          <input
            placeholder="Unit (kg, g, L, pcs)"
            value={newUnit}
            onChange={(e) => setNewUnit(e.target.value)}
            required
          />
          <input
            type="number"
            step="0.001"
            min="0"
            placeholder="Initial qty"
            value={newQty}
            onChange={(e) => setNewQty(e.target.value)}
          />
          <input
            type="number"
            step="0.001"
            min="0"
            placeholder="Reorder point"
            value={newReorder}
            onChange={(e) => setNewReorder(e.target.value)}
          />
          <input
            type="number"
            step="0.01"
            min="0"
            placeholder="Cost/unit"
            value={newCost}
            onChange={(e) => setNewCost(e.target.value)}
          />
          <button type="submit" disabled={busy}>
            {busy ? 'Adding…' : '+ Add Stock'}
          </button>
        </form>
      </div>

      <div className="inv-grid">
        <div className="inv-panel inv-stock-panel">
          <h3>Stock</h3>
          {stock.length === 0 && <p className="muted">No stock items yet.</p>}
          {stock.length > 0 && (
            <table className="inv-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Qty</th>
                  <th>Unit</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {stock.map((it) => (
                  <tr
                    key={it.id}
                    onClick={() => selectStock(it)}
                    className={selected?.id === it.id ? 'inv-selected' : ''}
                  >
                    <td>{it.name}</td>
                    <td className={it.is_low ? 'inv-low-qty' : ''}>{it.quantity}</td>
                    <td>{it.unit}</td>
                    <td>{it.is_low && <span className="inv-badge-low">LOW</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="inv-panel inv-detail-panel">
          {!selected && (
            <p className="muted inv-empty-detail">Select a stock item to view details and restock.</p>
          )}
          {selected && (
            <>
              <h3>{selected.name}</h3>
              <div className="inv-detail-info">
                <div><span className="muted">Current:</span> <strong>{selected.quantity} {selected.unit}</strong></div>
                <div><span className="muted">Reorder at:</span> {selected.reorder_point} {selected.unit}</div>
                <div><span className="muted">Cost/unit:</span> {selected.cost_per_unit}</div>
              </div>

              {breakdown && breakdown.outlets.length > 0 && (
                <div className="inv-outlet-breakdown">
                  <h4>Stock by outlet</h4>
                  <ul className="inv-outlet-list">
                    {breakdown.outlets.map((o) => (
                      <li key={o.outlet}>
                        <span className="inv-outlet-name">{o.outlet}</span>
                        <span className="inv-outlet-qty">{o.qty} {selected.unit}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <form className="inv-restock-form" onSubmit={submitRestock}>
                <h4>Restock</h4>
                <div className="inv-restock-row">
                  <input
                    type="number"
                    step="0.001"
                    min={0.001}
                    placeholder="Amount"
                    value={restockQty}
                    onChange={(e) => setRestockQty(e.target.value)}
                    required
                  />
                  <select value={restockReason} onChange={(e) => setRestockReason(e.target.value as RestockReason)}>
                    <option value="restock">Restock</option>
                    <option value="adjustment">Adjustment</option>
                  </select>
                  <button type="submit" disabled={busy}>Add</button>
                </div>
              </form>

              <div className="inv-movements">
                <h4>Recent Movements</h4>
                {movements.length === 0 && <p className="muted">No movements yet.</p>}
                {movements.length > 0 && (
                  <ul className="inv-movements-list">
                    {movements.map((m) => (
                      <li key={m.id}>
                        <span className={Number(m.delta) >= 0 ? 'inv-delta-pos' : 'inv-delta-neg'}>
                          {Number(m.delta) >= 0 ? '+' : ''}{m.delta}
                        </span>
                        <span className="inv-movement-reason">{m.reason}</span>
                        <span className="inv-movement-date">{new Date(m.created_at).toLocaleString()}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="inv-recipes-panel">
        <h3>Recipes</h3>
        {recipes.length === 0 && <p className="muted">No recipes defined yet.</p>}
        {recipes.length > 0 && (
          <table className="inv-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Ingredient</th>
                <th>Per unit</th>
              </tr>
            </thead>
            <tbody>
              {recipes.map((r) => (
                <tr key={r.id}>
                  <td>{r.product_name}</td>
                  <td>{r.stock_name}</td>
                  <td>{r.quantity_per_product} {r.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
