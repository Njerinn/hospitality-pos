import { useEffect, useState, type FormEvent } from 'react';
import { api, type Shift, type ShiftWithExpected } from '../api';

export function Shifts() {
  const [current, setCurrent] = useState<ShiftWithExpected | null>(null);
  const [history, setHistory] = useState<Shift[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [openingFloat, setOpeningFloat] = useState('1000');
  const [countedCash, setCountedCash] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      try {
        const c = await api.getCurrentShift();
        setCurrent(c);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('404')) setCurrent(null);
        else throw err;
      }
      const h = await api.listShifts(20, 0);
      setHistory(h.shifts);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function submitOpen(e: FormEvent) {
    e.preventDefault();
    const float = Number(openingFloat);
    if (!Number.isFinite(float) || float < 0) {
      setError('Opening float must be a non-negative number');
      return;
    }
    setBusy('open');
    setError(null);
    try {
      await api.openShift(float);
      setCountedCash('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function submitClose(e: FormEvent) {
    e.preventDefault();
    if (!current) return;
    const cash = Number(countedCash);
    if (!Number.isFinite(cash) || cash < 0) {
      setError('Counted cash must be a non-negative number');
      return;
    }
    setBusy('close');
    setError(null);
    try {
      await api.closeShift(current.id, cash);
      setCountedCash('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function approveVariance(id: string) {
    setBusy('approve-' + id);
    setError(null);
    try {
      await api.approveShiftVariance(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="shift-page">
      <h2 className="shift-title">Cash Drawer Shifts</h2>

      {error && <div className="error">{error}</div>}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : current ? (
        <div className="shift-section">
          <h3>Current Shift</h3>
          <div className="shift-current-info">
            <div><span className="muted">Opened:</span> {new Date(current.opened_at).toLocaleString()}</div>
            <div><span className="muted">Opening float:</span> {current.opening_float}</div>
            <div><span className="muted">Paid tickets:</span> {current.ticket_count}</div>
            <div><span className="muted">Expected cash:</span> <strong>{current.expected_cash}</strong></div>
          </div>
          <form className="shift-form" onSubmit={submitClose}>
            <h4>Close Shift</h4>
            <input
              type="number"
              step="0.01"
              min="0"
              placeholder="Counted cash"
              value={countedCash}
              onChange={(e) => setCountedCash(e.target.value)}
              required
            />
            <button type="submit" disabled={busy === 'close'}>
              {busy === 'close' ? 'Closing…' : 'Close Shift'}
            </button>
          </form>
        </div>
      ) : (
        <div className="shift-section">
          <h3>No Open Shift</h3>
          <form className="shift-form" onSubmit={submitOpen}>
            <h4>Open Shift</h4>
            <input
              type="number"
              step="0.01"
              min="0"
              placeholder="Opening float"
              value={openingFloat}
              onChange={(e) => setOpeningFloat(e.target.value)}
              required
            />
            <button type="submit" disabled={busy === 'open'}>
              {busy === 'open' ? 'Opening…' : 'Open Shift'}
            </button>
          </form>
        </div>
      )}

      <div className="shift-section">
        <h3>History</h3>
        {history.length === 0 ? (
          <p className="muted">No closed shifts yet.</p>
        ) : (
          <table className="shift-table">
            <thead>
              <tr>
                <th>Opened</th>
                <th>Closed</th>
                <th>Float</th>
                <th>Expected</th>
                <th>Counted</th>
                <th>Variance</th>
                <th>Approved</th>
              </tr>
            </thead>
            <tbody>
              {history.map((s) => (
                <tr key={s.id}>
                  <td>{new Date(s.opened_at).toLocaleString()}</td>
                  <td>{s.closed_at ? new Date(s.closed_at).toLocaleString() : '—'}</td>
                  <td>{s.opening_float}</td>
                  <td>{s.expected_cash ?? '—'}</td>
                  <td>{s.counted_cash ?? '—'}</td>
                  <td className={Number(s.variance) < 0 ? 'shift-variance-neg' : 'shift-variance-pos'}>
                    {s.variance ?? '—'}
                  </td>
                  <td>
                    {s.requires_second_approval ? (
                      <button
                        onClick={() => approveVariance(s.id)}
                        disabled={busy === 'approve-' + s.id}
                        className="shift-approve-btn"
                      >
                        {busy === 'approve-' + s.id ? '…' : 'Approve'}
                      </button>
                    ) : s.variance_approved_by ? (
                      <span className="shift-badge-approved">✓ Approved</span>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
