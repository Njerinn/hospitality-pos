import { useEffect, useState, type FormEvent } from 'react';
import {
  api,
  type EtimsTenantConfig,
  type MpesaRegistrationStatus,
  type UnallocatedMpesa,
} from '../api';

interface Props {
  userRole: string;
}

export function MpesaConfig({ userRole }: Props) {
  const isAdmin = userRole === 'admin';
  const isManagerOrAdmin = userRole === 'admin' || userRole === 'manager';

  const [cfg, setCfg] = useState<EtimsTenantConfig | null>(null);
  const [reg, setReg] = useState<MpesaRegistrationStatus | null>(null);
  const [unallocated, setUnallocated] = useState<UnallocatedMpesa[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmReReg, setConfirmReReg] = useState(false);

  const [paybillNumber, setPaybillNumber] = useState('');
  const [fixedAccount, setFixedAccount] = useState('');

  async function loadAll() {
    setError(null);
    try {
      const tasks: Array<Promise<void>> = [
        api.getMpesaUnallocated().then((r) => setUnallocated(r.unallocated)),
      ];
      if (isManagerOrAdmin) {
        tasks.push(api.getEtimsConfig().then((c) => {
          setCfg(c);
          setPaybillNumber(c.paybill_number ?? '');
          setFixedAccount(c.mpesa_fixed_account ?? '');
        }));
        tasks.push(api.getMpesaRegistrationStatus().then((r) => setReg(r)));
      }
      await Promise.all(tasks);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function saveConfig(e: FormEvent) {
    e.preventDefault();
    if (!isAdmin) return;
    setBusy('save-config');
    setError(null);
    try {
      await api.updateEtimsConfig({
        paybill_number: paybillNumber || null,
        mpesa_fixed_account: fixedAccount || null,
      });
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally { setBusy(null); }
  }

  async function registerUrls() {
    if (!isAdmin || !confirmReReg) return;
    setBusy('register');
    setError(null);
    try {
      const r = await api.registerMpesaUrls();
      await loadAll();
      setConfirmReReg(false);
      alert(
        r.ok
          ? `URLs registered successfully. Safaricom response status: ${r.status}`
          : `Registration FAILED. Safaricom returned status ${r.status}. See /mpesa/registration-status.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally { setBusy(null); }
  }

  async function assign(id: string, ticketId: string) {
    setBusy('assign-' + id);
    setError(null);
    try {
      await api.assignMpesaUnallocated(id, ticketId);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally { setBusy(null); }
  }

  async function ignore(id: string) {
    if (!isAdmin) return;
    if (!window.confirm('Ignore this payment? It will not be linked to any ticket.')) return;
    setBusy('ignore-' + id);
    setError(null);
    try {
      await api.ignoreMpesaUnallocated(id);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally { setBusy(null); }
  }

  if (loading) return <div className="loading">Loading M-Pesa config…</div>;

  return (
    <div className="mpesa-page">
      <h1 className="mpesa-title">M-Pesa Auto-Match</h1>
      <p className="muted">
        PayBill confirmation webhook auto-links payments to open tickets.
        Unallocated payments (no unique match) appear below for manual assignment.
      </p>

      {error && <div className="error">{error}</div>}

      {isManagerOrAdmin && (
        <section className="mpesa-section">
          <h2>PayBill configuration</h2>
          <p className="muted">
            Customers pay into this PayBill, using the fixed account reference or their ticket UUID.
          </p>
          <form onSubmit={saveConfig} className="mpesa-form">
            <label>
              PayBill number
              <input
                type="text"
                value={paybillNumber}
                onChange={(e) => setPaybillNumber(e.target.value)}
                placeholder="e.g. 400200"
                disabled={!isAdmin}
              />
            </label>
            <label>
              Fixed account reference
              <input
                type="text"
                value={fixedAccount}
                onChange={(e) => setFixedAccount(e.target.value)}
                placeholder="e.g. HOTEL01 (all customers can type this)"
                disabled={!isAdmin}
              />
            </label>
            {isAdmin && (
              <button type="submit" disabled={busy === 'save-config'}>
                {busy === 'save-config' ? 'Saving…' : 'Save PayBill config'}
              </button>
            )}
          </form>
        </section>
      )}

      {isManagerOrAdmin && (
        <section className="mpesa-section">
          <h2>URL registration</h2>
          <p className="muted">
            Safaricom must know your confirmation and validation URLs.
            Re-registering requires Safaricom to delete existing URLs first — do not re-register during service hours.
          </p>

          {reg?.last_registration ? (
            <div className={`mpesa-status mpesa-status-${reg.last_registration.response_status >= 200 && reg.last_registration.response_status < 300 ? 'ok' : 'fail'}`}>
              <div>
                <strong>Last registered:</strong>{' '}
                {new Date(reg.last_registration.registered_at).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })}
              </div>
              <div>
                <strong>Safaricom response:</strong> {reg.last_registration.response_status}
                {reg.last_registration.registered_by_email && (
                  <> &middot; by {reg.last_registration.registered_by_email}</>
                )}
              </div>
            </div>
          ) : (
            <p className="mpesa-status mpesa-status-fail">
              URLs have never been registered. Customers cannot pay via PayBill until you register.
            </p>
          )}

          {isAdmin && (
            <div className="mpesa-register-form">
              <label className="mpesa-confirm-checkbox">
                <input
                  type="checkbox"
                  checked={confirmReReg}
                  onChange={(e) => setConfirmReReg(e.target.checked)}
                />
                I understand re-registration may interrupt live payments
              </label>
              <button
                type="button"
                onClick={registerUrls}
                disabled={!confirmReReg || busy === 'register'}
              >
                {busy === 'register' ? 'Registering…' : 'Register URLs with Safaricom'}
              </button>
            </div>
          )}
        </section>
      )}

      <section className="mpesa-section">
        <h2>Unallocated payments</h2>
        <p className="muted">
          Payments that could not be uniquely matched. Suggested tickets are shown by amount
          (within 4 hours). Click Assign to link — this closes the ticket and fires the KRA fiscal invoice.
        </p>

        {unallocated.length === 0 ? (
          <p className="muted">No unallocated payments.</p>
        ) : (
          <table className="mpesa-table">
            <thead>
              <tr>
                <th>Trans ID</th>
                <th>Amount</th>
                <th>From</th>
                <th>Time</th>
                <th>Reference</th>
                <th>Suggested tickets</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {unallocated.map((u) => (
                <tr key={u.id}>
                  <td className="muted">{u.trans_id}</td>
                  <td><strong>KES {u.amount}</strong></td>
                  <td className="muted">{u.msisdn}</td>
                  <td className="muted">
                    {new Date(u.trans_time).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })}
                  </td>
                  <td className="muted">{u.bill_ref || '—'}</td>
                  <td>
                    {u.suggested_tickets.length === 0 ? (
                      <span className="muted">None</span>
                    ) : (
                      <div className="mpesa-suggested">
                        {u.suggested_tickets.map((t) => (
                          <button
                            key={t.id}
                            type="button"
                            className="mpesa-suggest-btn"
                            onClick={() => assign(u.id, t.id)}
                            disabled={busy === 'assign-' + u.id}
                          >
                            {t.id.slice(0, 8)}…
                            {t.table_id ? ' (table)' : ''}
                          </button>
                        ))}
                      </div>
                    )}
                  </td>
                  <td>
                    {isAdmin && (
                      <button
                        type="button"
                        className="mpesa-ignore-btn"
                        onClick={() => ignore(u.id)}
                        disabled={busy === 'ignore-' + u.id}
                      >
                        {busy === 'ignore-' + u.id ? '…' : 'Ignore'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
