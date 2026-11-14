import { useEffect, useState, type FormEvent } from 'react';
import { api, type Product, type StockItem, type Recipe } from '../api';

export function Menu() {
  const [products, setProducts] = useState<Product[]>([]);
  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [newProdName, setNewProdName] = useState('');
  const [newProdCategory, setNewProdCategory] = useState('');
  const [newProdPrice, setNewProdPrice] = useState('');
  const [newProdTaxTyCd, setNewProdTaxTyCd] = useState<'A' | 'B' | 'C' | 'D' | 'E'>('B');

  const [newStockName, setNewStockName] = useState('');
  const [newStockUnit, setNewStockUnit] = useState('');
  const [newStockQty, setNewStockQty] = useState('');
  const [newStockReorder, setNewStockReorder] = useState('');
  const [newStockCost, setNewStockCost] = useState('');

  const [newRecipeProductId, setNewRecipeProductId] = useState('');
  const [newRecipeStockId, setNewRecipeStockId] = useState('');
  const [newRecipeQty, setNewRecipeQty] = useState('');

  async function loadAll() {
    try {
      const [p, s, r] = await Promise.all([
        api.listProducts(),
        api.listStock(),
        api.listRecipes(),
      ]);
      setProducts(p.products);
      setStockItems(s.items);
      setRecipes(r.recipes);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function addProduct(e: FormEvent) {
    e.preventDefault();
    setBusy('add-product');
    setError(null);
    try {
      await api.createProduct({
        name: newProdName,
        category: newProdCategory || undefined,
        price: Number(newProdPrice),
        tax_ty_cd: newProdTaxTyCd,
      });
      setNewProdName('');
      setNewProdCategory('');
      setNewProdPrice('');
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function toggleActive(p: Product) {
    setBusy('toggle-' + p.id);
    setError(null);
    try {
      await api.toggleProductActive(p.id, !p.active);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function editProductPrice(p: Product) {
    const input = window.prompt(`New price for "${p.name}":`, p.price);
    if (input === null) return;
    const num = Number(input);
    if (Number.isNaN(num) || num < 0) {
      setError('Invalid price');
      return;
    }
    setBusy('edit-' + p.id);
    setError(null);
    try {
      await api.updateProduct(p.id, { price: num });
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function addStock(e: FormEvent) {
    e.preventDefault();
    setBusy('add-stock');
    setError(null);
    try {
      await api.createStock({
        name: newStockName,
        unit: newStockUnit,
        quantity: newStockQty ? Number(newStockQty) : 0,
        reorder_point: newStockReorder ? Number(newStockReorder) : 0,
        cost_per_unit: newStockCost ? Number(newStockCost) : 0,
      });
      setNewStockName('');
      setNewStockUnit('');
      setNewStockQty('');
      setNewStockReorder('');
      setNewStockCost('');
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function addRecipe(e: FormEvent) {
    e.preventDefault();
    if (!newRecipeProductId || !newRecipeStockId || !newRecipeQty) return;
    setBusy('add-recipe');
    setError(null);
    try {
      await api.createRecipe({
        product_id: newRecipeProductId,
        stock_item_id: newRecipeStockId,
        quantity_per_product: Number(newRecipeQty),
      });
      setNewRecipeProductId('');
      setNewRecipeStockId('');
      setNewRecipeQty('');
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function removeRecipe(id: string) {
    if (!window.confirm('Delete this recipe line?')) return;
    setBusy('recipe-' + id);
    setError(null);
    try {
      await api.deleteRecipe(id);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="menu-page">
      <h1 className="menu-title">Menu Management</h1>
      <p className="muted">
        Manage products, stock items, and recipes. Recipes define which stock items
        get deducted when a product is ordered.
      </p>

      {error && <div className="error">{error}</div>}

      <section className="menu-section">
        <h2>Products</h2>
        <form className="menu-form" onSubmit={addProduct}>
          <input
            placeholder="Name"
            value={newProdName}
            onChange={(e) => setNewProdName(e.target.value)}
            required
          />
          <input
            placeholder="Category (optional)"
            value={newProdCategory}
            onChange={(e) => setNewProdCategory(e.target.value)}
          />
          <input
            type="number"
            step="0.01"
            min="0"
            placeholder="Price"
            value={newProdPrice}
            onChange={(e) => setNewProdPrice(e.target.value)}
            required
          />
          <select
            value={newProdTaxTyCd}
            onChange={(e) => setNewProdTaxTyCd(e.target.value as 'A' | 'B' | 'C' | 'D' | 'E')}
          >
            <option value={'A'}>A</option>
            <option value={'B'}>B</option>
            <option value={'C'}>C</option>
            <option value={'D'}>D</option>
            <option value={'E'}>E</option>
          </select>
          <button type="submit" disabled={busy === 'add-product'}>
            {busy === 'add-product' ? 'Adding…' : '+ Add Product'}
          </button>
        </form>

        {products.length === 0 ? (
          <p className="muted">No products yet.</p>
        ) : (
          <table className="menu-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Category</th>
                <th>Price</th>
                <th>Tax</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} className={p.active ? '' : 'menu-row-inactive'}>
                  <td>{p.name}</td>
                  <td className="muted">{p.category ?? '—'}</td>
                  <td>{p.price}</td>
                  <td>{p.tax_ty_cd ?? 'B'}</td>
                  <td>
                    <span className={`badge ${p.active ? 'badge-active' : 'badge-inactive'}`}>
                      {p.active ? 'active' : '86'}
                    </span>
                  </td>
                  <td className="menu-actions">
                    <button
                      onClick={() => editProductPrice(p)}
                      disabled={busy === 'edit-' + p.id}
                    >
                      {busy === 'edit-' + p.id ? '…' : 'Edit price'}
                    </button>
                    <button
                      onClick={() => toggleActive(p)}
                      disabled={busy === 'toggle-' + p.id}
                      className={p.active ? 'btn-warn' : 'btn-success'}
                    >
                      {busy === 'toggle-' + p.id
                        ? '…'
                        : p.active
                          ? '86 (deactivate)'
                          : 'Reactivate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="menu-section">
        <h2>Stock Items</h2>
        <form className="menu-form" onSubmit={addStock}>
          <input
            placeholder="Name"
            value={newStockName}
            onChange={(e) => setNewStockName(e.target.value)}
            required
          />
          <input
            placeholder="Unit (kg, L, pcs)"
            value={newStockUnit}
            onChange={(e) => setNewStockUnit(e.target.value)}
            required
          />
          <input
            type="number"
            step="0.01"
            min="0"
            placeholder="Initial qty"
            value={newStockQty}
            onChange={(e) => setNewStockQty(e.target.value)}
          />
          <input
            type="number"
            step="0.01"
            min="0"
            placeholder="Reorder point"
            value={newStockReorder}
            onChange={(e) => setNewStockReorder(e.target.value)}
          />
          <input
            type="number"
            step="0.01"
            min="0"
            placeholder="Cost/unit"
            value={newStockCost}
            onChange={(e) => setNewStockCost(e.target.value)}
          />
          <button type="submit" disabled={busy === 'add-stock'}>
            {busy === 'add-stock' ? 'Adding…' : '+ Add Stock'}
          </button>
        </form>

        {stockItems.length === 0 ? (
          <p className="muted">No stock items yet.</p>
        ) : (
          <table className="menu-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Unit</th>
                <th>Quantity</th>
                <th>Reorder</th>
                <th>Cost/unit</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {stockItems.map((s) => (
                <tr key={s.id} className={s.is_low ? 'menu-row-inactive' : ''}>
                  <td>{s.name}</td>
                  <td className="muted">{s.unit}</td>
                  <td>{s.quantity}</td>
                  <td>{s.reorder_point}</td>
                  <td>{s.cost_per_unit}</td>
                  <td>
                    <span className={`badge ${s.is_low ? 'badge-inactive' : 'badge-active'}`}>
                      {s.is_low ? 'low' : 'ok'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="menu-section">
        <h2>Recipes</h2>
        <p className="muted">
          Link a product to the stock items consumed when it is ordered.
          Quantity is per single unit of the product.
        </p>

        {products.length === 0 || stockItems.length === 0 ? (
          <p className="muted">
            Add at least one product and one stock item before creating recipes.
          </p>
        ) : (
          <>
            <form className="menu-form" onSubmit={addRecipe}>
              <select
                value={newRecipeProductId}
                onChange={(e) => setNewRecipeProductId(e.target.value)}
                required
              >
                <option value="">— Product —</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <select
                value={newRecipeStockId}
                onChange={(e) => setNewRecipeStockId(e.target.value)}
                required
              >
                <option value="">— Stock item —</option>
                {stockItems.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.unit})
                  </option>
                ))}
              </select>
              <input
                type="number"
                step="0.01"
                min="0.01"
                placeholder="Qty per unit"
                value={newRecipeQty}
                onChange={(e) => setNewRecipeQty(e.target.value)}
                required
              />
              <button type="submit" disabled={busy === 'add-recipe'}>
                {busy === 'add-recipe' ? 'Adding…' : '+ Add Recipe Line'}
              </button>
            </form>

            {recipes.length === 0 ? (
              <p className="muted">No recipe lines yet.</p>
            ) : (
              <table className="menu-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Stock item</th>
                    <th>Qty per product</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {recipes.map((r) => (
                    <tr key={r.id}>
                      <td>{r.product_name}</td>
                      <td>
                        {r.stock_name} <span className="muted">({r.unit})</span>
                      </td>
                      <td>{r.quantity_per_product}</td>
                      <td className="menu-actions">
                        <button
                          onClick={() => removeRecipe(r.id)}
                          disabled={busy === 'recipe-' + r.id}
                          className="btn-warn"
                        >
                          {busy === 'recipe-' + r.id ? '…' : 'Delete'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </section>
    </div>
  );
}
