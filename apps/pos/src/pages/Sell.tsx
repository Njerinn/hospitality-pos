import { useEffect, useState, type FormEvent } from 'react';
import { api, type Product, type Ticket } from '../api';

interface CartLine {
  product: Product;
  quantity: number;
}

type Phase = 'cart' | 'paid';
type ReceiptStatus =
  | { kind: 'unknown' }
  | { kind: 'not_applicable' }
  | { kind: 'pending' }
  | { kind: 'failed'; error: string | null }
  | { kind: 'submitted'; invc_no: number };

function vatRateForTaxCode(tax_ty_cd: string | undefined): number {
  switch (tax_ty_cd) {
    case 'B': return 0.16;
    case 'E': return 0.08;
    case 'A':
    case 'C':
    case 'D':
    default: return 0;
  }
}

export function Sell() {
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [phase, setPhase] = useState<Phase>('cart');
  const [paidTicket, setPaidTicket] = useState<Ticket | null>(null);
  const [receipt, setReceipt] = useState<ReceiptStatus>({ kind: 'unknown' });

  async function load() {
    try {
      const r = await api.listProducts();
      setProducts(r.products.filter((p) => p.active));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => { load(); }, []);

  function addToCart(p: Product) {
    setCart((prev) => {
      const existing = prev.find((l) => l.product.id === p.id);
      if (existing) {
        return prev.map((l) => l.product.id === p.id ? { ...l, quantity: l.quantity + 1 } : l);
      }
      return [...prev, { product: p, quantity: 1 }];
    });
  }

  function decrement(productId: string) {
    setCart((prev) => prev
      .map((l) => l.product.id === productId ? { ...l, quantity: l.quantity - 1 } : l)
      .filter((l) => l.quantity > 0));
  }

  function removeLine(productId: string) {
    setCart((prev) => prev.filter((l) => l.product.id !== productId));
  }

  function cartTotal(): number {
    return cart.reduce((sum, l) => sum + Number(l.product.price) * l.quantity, 0);
  }

  async function refreshReceipt(ticketId: string) {
    try {
      const r = await api.getEtimsReceipt(ticketId);
      if (r.status === 'submitted') {
        setReceipt({ kind: 'submitted', invc_no: r.invc_no });
      } else if (r.status === 'pending') {
        setReceipt({ kind: 'pending' });
      } else if (r.status === 'failed') {
        setReceipt({ kind: 'failed', error: r.last_error });
      } else {
        setReceipt({ kind: 'not_applicable' });
      }
    } catch {
      setReceipt({ kind: 'unknown' });
    }
  }

  async function submitSale(e: FormEvent) {
    e.preventDefault();
    if (cart.length === 0) {
      setError('Add at least one item to the cart');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const ticket = await api.openTicket(null, 'retail');
      for (const line of cart) {
        await api.addItem(ticket.id, {
          name: line.product.name,
          quantity: line.quantity,
          unit_price: Number(line.product.price),
          vat_rate: vatRateForTaxCode(line.product.tax_ty_cd),
        });
      }
      await api.payCash(ticket.id);
      setPaidTicket(ticket);
      setPhase('paid');
      setCart([]);
      await refreshReceipt(ticket.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function startNewSale() {
    setPhase('cart');
    setPaidTicket(null);
    setReceipt({ kind: 'unknown' });
    setCart([]);
    setError(null);
  }

  if (phase === 'paid' && paidTicket) {
    return (
      <div className="sell-page">
        <div className="sell-success">
          <h2>Sale Complete</h2>
          <p className="muted">Ticket {paidTicket.id.slice(0, 8)}</p>
          <p className="sell-success-total">KES {Number(paidTicket.total).toFixed(2)}</p>

          <div className="sell-receipt-status">
            {receipt.kind === 'submitted' && (
              <>
                <p className="sell-submitted">Fiscal receipt issued</p>
                <div className="sell-pdf-links">
                  <a
                    href={api.receiptPdfUrl(paidTicket.id, 'original')}
                    className="sell-pdf-link sell-pdf-original"
                  >
                    Download ORIGINAL (customer copy)
                  </a>
                  <a
                    href={api.receiptPdfUrl(paidTicket.id, 'copy')}
                    className="sell-pdf-link sell-pdf-copy"
                  >
                    Download COPY (restaurant record)
                  </a>
                </div>
                <p className="muted">Invoice CU-INV-{String(receipt.invc_no).padStart(6, '0')}</p>
              </>
            )}

            {receipt.kind === 'pending' && (
              <>
                <p className="sell-pending">Submitting to KRA eTIMS...</p>
                <button
                  className="sell-refresh-btn"
                  onClick={() => refreshReceipt(paidTicket.id)}
                >
                  Refresh Invoice Status
                </button>
              </>
            )}

            {receipt.kind === 'failed' && (
              <>
                <p className="error">Fiscal submission failed: {receipt.error ?? 'unknown error'}</p>
                <button
                  className="sell-refresh-btn"
                  onClick={() => refreshReceipt(paidTicket.id)}
                >
                  Retry Check
                </button>
              </>
            )}

            {receipt.kind === 'not_applicable' && (
              <p className="muted">
                eTIMS is not enabled for this tenant — invoice PDFs are not available.
                Enable eTIMS configuration to generate fiscal receipts.
              </p>
            )}

            {receipt.kind === 'unknown' && (
              <p className="muted">Invoice status unknown — click below to retry</p>
            )}
          </div>

          <button className="sell-new-btn" onClick={startNewSale}>
            New Sale
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="sell-page">
      <div className="sell-header">
        <h2>Quick Sale</h2>
        <button onClick={load} disabled={busy}>Refresh Products</button>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="sell-grid">
        <div className="sell-panel">
          <h3>Products</h3>
          {products.length === 0 && (
            <p className="muted">
              No active products yet. Add products on the Menu page first.
            </p>
          )}
          {products.length > 0 && (
            <div className="sell-product-grid">
              {products.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="sell-product-card"
                  onClick={() => addToCart(p)}
                >
                  <span className="sell-product-name">{p.name}</span>
                  {p.category && <span className="sell-product-cat">{p.category}</span>}
                  <span className="sell-product-price">KES {p.price}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="sell-panel">
          <h3>Cart</h3>
          {cart.length === 0 && <p className="muted">Click a product to add it.</p>}
          {cart.length > 0 && (
            <form className="sell-cart" onSubmit={submitSale}>
              <ul className="sell-cart-list">
                {cart.map((line) => (
                  <li key={line.product.id}>
                    <div className="sell-cart-main">
                      <span className="sell-cart-name">{line.product.name}</span>
                      <span className="sell-cart-price">
                        {line.quantity} × {line.product.price} ={' '}
                        <strong>
                          KES {(Number(line.product.price) * line.quantity).toFixed(2)}
                        </strong>
                      </span>
                    </div>
                    <div className="sell-cart-actions">
                      <button type="button" onClick={() => decrement(line.product.id)}>−</button>
                      <button type="button" onClick={() => removeLine(line.product.id)}>✕</button>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="sell-total">
                Total: KES {cartTotal().toFixed(2)}
              </div>
              <button type="submit" className="sell-submit-btn" disabled={busy}>
                {busy ? 'Processing…' : 'Complete Sale & Pay Cash'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
