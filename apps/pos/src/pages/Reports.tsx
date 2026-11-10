import { useEffect, useState } from 'react';
import {
  api,
  type ReportSummary,
  type ReportSalesDay,
  type ReportSalesHour,
  type ReportTopItem,
  type ReportVat,
  type ReportPayments,
  type ReportStockUsage,
} from '../api';

type Tab = 'summary' | 'sales' | 'top-items' | 'vat' | 'payments' | 'stock';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function thirtyDaysAgo(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

function ksh(n: string | number): string {
  const v = typeof n === 'string' ? Number(n) : n;
  return 'KES ' + v.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function Reports() {
  const [from, setFrom] = useState(thirtyDaysAgo());
  const [to, setTo] = useState(today());
  const [activeTab, setActiveTab] = useState<Tab>('summary');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [byDay, setByDay] = useState<ReportSalesDay[]>([]);
  const [byHour, setByHour] = useState<ReportSalesHour[]>([]);
  const [topItems, setTopItems] = useState<ReportTopItem[]>([]);
  const [vat, setVat] = useState<ReportVat | null>(null);
  const [payments, setPayments] = useState<ReportPayments | null>(null);
  const [stockUsage, setStockUsage] = useState<ReportStockUsage[]>([]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [s, d, h, t, v, p, st] = await Promise.all([
        api.reportSummary(from, to),
        api.reportSalesByDay(from, to),
        api.reportSalesByHour(from, to),
        api.reportTopItems(from, to),
        api.reportVat(from, to),
        api.reportPayments(from, to),
        api.reportStockUsage(from, to),
      ]);
      setSummary(s);
      setByDay(d.days);
      setByHour(h.hours);
      setTopItems(t.items);
      setVat(v);
      setPayments(p);
      setStockUsage(st.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function downloadPdf() {
    setDownloading(true);
    setError(null);
    try {
      const blob = await api.reportPdfDownload(from, to);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `statement-${from}-to-${to}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDownloading(false);
    }
  }

  async function downloadBackup() {
    setDownloading(true);
    setError(null);
    try {
      const blob = await api.backupDownload();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDownloading(false);
    }
  }

  const maxDay = byDay.reduce((m, d) => Math.max(m, Number(d.revenue)), 0);
  const maxHour = byHour.reduce((m, h) => Math.max(m, Number(h.revenue)), 0);

  return (
    <div className="reports">
      <div className="reports-header">
        <h1>Reports & Analytics</h1>
        <div className="reports-actions">
          <button
            className="btn-download"
            onClick={downloadPdf}
            disabled={downloading || loading}
          >
            {downloading ? 'Preparing…' : 'Download PDF'}
          </button>
          <button
            className="btn-backup"
            onClick={downloadBackup}
            disabled={downloading}
          >
            Backup JSON
          </button>
        </div>
      </div>

      <div className="reports-filter">
        <label>
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button className="btn-apply" onClick={load} disabled={loading}>
          {loading ? 'Loading…' : 'Apply'}
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      {loading && !summary && <div className="reports-loading">Loading report data…</div>}

      {summary && activeTab === 'summary' && (
        <div className="stat-cards">
          <div className="stat-card">
            <span className="stat-label">Total Revenue</span>
            <span className="stat-value">{ksh(summary.revenue)}</span>
          </div>
          <div className="stat-card">
            <span className="stat-label">Tickets Paid</span>
            <span className="stat-value">{summary.tickets}</span>
          </div>
          <div className="stat-card">
            <span className="stat-label">Average Ticket</span>
            <span className="stat-value">{ksh(summary.average_ticket)}</span>
          </div>
          <div className="stat-card">
            <span className="stat-label">VAT Collected</span>
            <span className="stat-value">{ksh(summary.vat_collected)}</span>
          </div>
          <div className="stat-card">
            <span className="stat-label">Stock Cost</span>
            <span className="stat-value">{ksh(summary.stock_cost)}</span>
          </div>
          <div className="stat-card stat-card-highlight">
            <span className="stat-label">Gross Profit</span>
            <span className="stat-value">{ksh(summary.gross_profit)}</span>
          </div>
        </div>
      )}

      <div className="reports-tabs">
        {(['summary', 'sales', 'top-items', 'vat', 'payments', 'stock'] as const).map((t) => (
          <button
            key={t}
            className={`reports-tab ${activeTab === t ? 'active' : ''}`}
            onClick={() => setActiveTab(t)}
          >
            {t === 'top-items' ? 'Top Items' : t === 'vat' ? 'VAT' : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {activeTab === 'summary' && summary && (
        <div className="report-panel">
          <h2>Sales by Day</h2>
          {byDay.length === 0 ? (
            <p className="empty-state">No sales in this period.</p>
          ) : (
            <>
              <svg className="bar-chart" viewBox={`0 0 ${byDay.length * 40} 200`} preserveAspectRatio="none">
                {byDay.map((d, i) => {
                  const h = maxDay > 0 ? (Number(d.revenue) / maxDay) * 180 : 0;
                  return (
                    <g key={d.day}>
                      <rect
                        x={i * 40 + 4}
                        y={200 - h}
                        width={32}
                        height={h}
                        fill="#2563eb"
                        rx={2}
                      >
                        <title>{d.day}: KES {Number(d.revenue).toFixed(2)} ({d.tickets} tickets)</title>
                      </rect>
                    </g>
                  );
                })}
              </svg>
              <table className="data-table">
                <thead>
                  <tr><th>Date</th><th>Tickets</th><th>Revenue</th></tr>
                </thead>
                <tbody>
                  {byDay.map((d) => (
                    <tr key={d.day}>
                      <td>{d.day}</td>
                      <td>{d.tickets}</td>
                      <td>{ksh(d.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}

      {activeTab === 'sales' && (
        <div className="report-panel">
          <h2>Sales by Day</h2>
          {byDay.length === 0 ? (
            <p className="empty-state">No sales in this period.</p>
          ) : (
            <svg className="bar-chart" viewBox={`0 0 ${byDay.length * 40} 200`} preserveAspectRatio="none">
              {byDay.map((d, i) => {
                const h = maxDay > 0 ? (Number(d.revenue) / maxDay) * 180 : 0;
                return (
                  <rect
                    key={d.day}
                    x={i * 40 + 4}
                    y={200 - h}
                    width={32}
                    height={h}
                    fill="#2563eb"
                    rx={2}
                  >
                    <title>{d.day}: KES {Number(d.revenue).toFixed(2)}</title>
                  </rect>
                );
              })}
            </svg>
          )}

          <h2 style={{ marginTop: '32px' }}>Sales by Hour</h2>
          {byHour.length === 0 ? (
            <p className="empty-state">No sales in this period.</p>
          ) : (
            <svg className="bar-chart" viewBox="0 0 960 200" preserveAspectRatio="none">
              {byHour.map((h) => {
                const height = maxHour > 0 ? (Number(h.revenue) / maxHour) * 180 : 0;
                return (
                  <g key={h.hour}>
                    <rect
                      x={h.hour * 40 + 4}
                      y={200 - height}
                      width={32}
                      height={height}
                      fill="#059669"
                      rx={2}
                    >
                      <title>{String(h.hour).padStart(2, '0')}:00 — KES {Number(h.revenue).toFixed(2)} ({h.tickets} tickets)</title>
                    </rect>
                    <text
                      x={h.hour * 40 + 20}
                      y={195}
                      textAnchor="middle"
                      fontSize="10"
                      fill="#94a3b8"
                    >
                      {String(h.hour).padStart(2, '0')}
                    </text>
                  </g>
                );
              })}
            </svg>
          )}
        </div>
      )}

      {activeTab === 'top-items' && (
        <div className="report-panel">
          <h2>Top Items</h2>
          {topItems.length === 0 ? (
            <p className="empty-state">No items sold in this period.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Quantity</th>
                  <th>Revenue</th>
                  <th>Tickets</th>
                </tr>
              </thead>
              <tbody>
                {topItems.map((it) => (
                  <tr key={it.name}>
                    <td>{it.name}</td>
                    <td>{it.quantity}</td>
                    <td>{ksh(it.revenue)}</td>
                    <td>{it.ticket_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {activeTab === 'vat' && vat && (
        <div className="report-panel">
          <h2>VAT Summary</h2>
          <div className="vat-breakdown">
            <div className="vat-line"><span>Net Sales</span><span>{ksh(vat.net_sales)}</span></div>
            <div className="vat-line"><span>VAT ({vat.rate})</span><span>{ksh(vat.vat_collected)}</span></div>
            <div className="vat-line vat-line-total"><span>Gross Sales</span><span>{ksh(vat.gross_sales)}</span></div>
            <div className="vat-line"><span>Transactions</span><span>{vat.transaction_count}</span></div>
          </div>
        </div>
      )}

      {activeTab === 'payments' && payments && (
        <div className="report-panel">
          <h2>Payment Breakdown</h2>
          <div className="payment-cards">
            <div className="payment-card payment-card-mpesa">
              <h3>M-Pesa</h3>
              <div className="payment-amount">{ksh(payments.mpesa.amount)}</div>
              <div className="payment-count">{payments.mpesa.count} transactions</div>
            </div>
            <div className="payment-card payment-card-other">
              <h3>Other</h3>
              <div className="payment-amount">{ksh(payments.other.amount)}</div>
              <div className="payment-count">{payments.other.count} transactions</div>
            </div>
            <div className="payment-card payment-card-total">
              <h3>Total</h3>
              <div className="payment-amount">{ksh(payments.total.amount)}</div>
              <div className="payment-count">{payments.total.count} transactions</div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'stock' && (
        <div className="report-panel">
          <h2>Stock Usage</h2>
          {stockUsage.length === 0 ? (
            <p className="empty-state">No stock consumed in this period.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Ingredient</th>
                  <th>Consumed</th>
                  <th>Cost</th>
                </tr>
              </thead>
              <tbody>
                {stockUsage.map((s) => (
                  <tr key={s.name}>
                    <td>{s.name}</td>
                    <td>{s.total_consumed} {s.unit}</td>
                    <td>{ksh(s.total_cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

    </div>
  );
}
