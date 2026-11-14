import { useEffect, useState, type FormEvent } from 'react';
import {
  api,
  type EtimsTenantConfig,
  type EtimsQueueCount,
  type EtimsQueueRecent,
} from '../api';

interface Props {
  userRole: string;
}

const STRUCTURES = [
  'sole_proprietor',
  'private_company',
  'public_company',
  'partnership',
  'sacco',
  'cooperative',
] as const;

export function EtimsConfig({ userRole }: Props) {
  const isAdmin = userRole === 'admin';

  const [cfg, setCfg] = useState<EtimsTenantConfig | null>(null);
  const [counts, setCounts] = useState<EtimsQueueCount[]>([]);
  const [recent, setRecent] = useState<EtimsQueueRecent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [form, setForm] = useState<Partial<EtimsTenantConfig>>({});
  const [deviceBhfId, setDeviceBhfId] = useState('00');
  const [deviceSerial, setDeviceSerial] = useState('');

  async function loadAll() {
    setError(null);
    try {
      const [c, q] = await Promise.all([api.getEtimsConfig(), api.getEtimsQueue()]);
      setCfg(c);
      setCounts(q.counts);
      setRecent(q.recent);
      setForm({
        business_structure: c.business_structure,
        kra_pin: c.kra_pin,
        kra_pin_type: c.kra_pin_type,
        vat_registered: c.vat_registered,
        etims_enabled: c.etims_enabled,
        etims_mode: c.etims_mode,
        vat_inclusive: c.vat_inclusive,
        paybill_number: c.paybill_number,
        mpesa_fixed_account: c.mpesa_fixed_account,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveConfig(e: FormEvent) {
    e.preventDefault();
    if (!isAdmin) return;
    setBusy('save');
    setError(null);
    try {
      await api.updateEtimsConfig(form);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function initDevice(e: FormEvent) {
    e.preventDefault();
    if (!isAdmin) return;
    setBusy('device');
    setError(null);
    try {
      await api.initEtimsDevice({ bhf_id: deviceBhfId, dvc_srl_no: deviceSerial });
      setDeviceSerial('');
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function retryRow(id: string) {
    if (!isAdmin) return;
    setBusy('retry-' + id);
    setError(null);
    try {
      await api.retryEtimsQueueRow(id);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <div className="loading">Loading eTIMS config…</div>;
  if (!cfg) return <div className="error">Failed to load eTIMS config</div>;

  return (
    <div className="etims-page">
      <h1 className="etims-title">KRA eTIMS Configuration</h1>
      <p className="muted">
        Configure your KRA PIN and eTIMS mode. {isAdmin
          ? 'You can edit and save changes.'
          : 'Read-only — only admin can edit.'}
      </p>

      {error && <div className="error">{error}</div>}

      <section className="etims-section">
        <h2>Tenant configuration</h2>
        <form onSubmit={saveConfig} className="etims-form">
          <label>
            Business structure
            <select
              value={form.business_structure ?? ''}
              onChange={(e) =>
                setForm({ ...form, business_structure: e.target.value || null })
              }
              disabled={!isAdmin}
            >
              <option value="">— not set —</option>
              {STRUCTURES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>

          <label>
            KRA PIN
            <input
              type="text"
              value={form.kra_pin ?? ''}
              onChange={(e) => setForm({ ...form, kra_pin: e.target.value || null })}
              placeholder="e.g. P051234567A"
              disabled={!isAdmin}
            />
          </label>

          <label>
            PIN type
            <select
              value={form.kra_pin_type ?? ''}
              onChange={(e) =>
                setForm({ ...form, kra_pin_type: e.target.value || null })
              }
              disabled={!isAdmin}
            >
              <option value="">— not set —</option>
              <option value="personal">personal (sole proprietor)</option>
              <option value="non_individual">non_individual (company/partnership)</option>
            </select>
          </label>

          <label>
            eTIMS mode
            <select
              value={form.etims_mode ?? 'disabled'}
              onChange={(e) => setForm({ ...form, etims_mode: e.target.value })}
              disabled={!isAdmin}
            >
              <option value="disabled">disabled</option>
              <option value="sandbox">sandbox</option>
              <option value="production">production</option>
            </select>
          </label>

          <label className="etims-checkbox">
            <input
              type="checkbox"
              checked={form.etims_enabled ?? false}
              onChange={(e) => setForm({ ...form, etims_enabled: e.target.checked })}
              disabled={!isAdmin}
            />
            eTIMS submission enabled
          </label>

          <label className="etims-checkbox">
            <input
              type="checkbox"
              checked={form.vat_registered ?? false}
              onChange={(e) => setForm({ ...form, vat_registered: e.target.checked })}
              disabled={!isAdmin}
            />
            VAT registered
          </label>

          <label className="etims-checkbox">
            <input
              type="checkbox"
              checked={form.vat_inclusive ?? false}
              onChange={(e) => setForm({ ...form, vat_inclusive: e.target.checked })}
              disabled={!isAdmin}
            />
            Prices are VAT-inclusive
          </label>

          <label>
            PayBill number
            <input
              type="text"
              value={form.paybill_number ?? ''}
              onChange={(e) =>
                setForm({ ...form, paybill_number: e.target.value || null })
              }
              placeholder="e.g. 400200"
              disabled={!isAdmin}
            />
          </label>

          <label>
            Fixed account (all customers)
            <input
              type="text"
              value={form.mpesa_fixed_account ?? ''}
              onChange={(e) =>
                setForm({ ...form, mpesa_fixed_account: e.target.value || null })
              }
              placeholder="e.g. HOTEL01"
              disabled={!isAdmin}
            />
          </label>

          {isAdmin && (
            <button type="submit" disabled={busy === 'save'}>
              {busy === 'save' ? 'Saving…' : 'Save config'}
            </button>
          )}
        </form>
      </section>

      <section className="etims-section">
        <h2>Device registration</h2>
        <p className="muted">
          Register this POS server with KRA. Requires PIN and non-disabled mode.
          The response cmcKey is encrypted at rest.
        </p>
        <form onSubmit={initDevice} className="etims-form">
          <label>
            Branch ID (bhfId)
            <input
              type="text"
              value={deviceBhfId}
              onChange={(e) => setDeviceBhfId(e.target.value)}
              placeholder="00"
              disabled={!isAdmin}
            />
          </label>
          <label>
            Device serial no
            <input
              type="text"
              value={deviceSerial}
              onChange={(e) => setDeviceSerial(e.target.value)}
              placeholder="e.g. POS-NAIROBI-01"
              required
              disabled={!isAdmin}
            />
          </label>
          {isAdmin && (
            <button type="submit" disabled={busy === 'device'}>
              {busy === 'device' ? 'Registering…' : 'Register device'}
            </button>
          )}
        </form>
      </section>

      <section className="etims-section">
        <h2>Submission queue</h2>
        {counts.length === 0 ? (
          <p className="muted">No submissions yet.</p>
        ) : (
          <div className="etims-counts">
            {counts.map((c) => (
              <span key={c.status} className={`etims-count etims-count-${c.status}`}>
                {c.status}: <strong>{c.n}</strong>
              </span>
            ))}
          </div>
        )}

        {recent.length === 0 ? (
          <p className="muted">Queue is empty.</p>
        ) : (
          <table className="etims-table">
            <thead>
              <tr>
                <th>Ticket</th>
                <th>Status</th>
                <th>Attempts</th>
                <th>Last error</th>
                <th>Updated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.id}>
                  <td className="muted">{r.ticket_id.slice(0, 8)}…</td>
                  <td>
                    <span className={`etims-badge etims-badge-${r.status}`}>
                      {r.status}
                    </span>
                  </td>
                  <td>{r.attempts}</td>
                  <td className="muted">{r.last_error ?? '—'}</td>
                  <td className="muted">
                    {new Date(r.updated_at).toLocaleString()}
                  </td>
                  <td>
                    {isAdmin && r.status === 'permanent_fail' && (
                      <button
                        onClick={() => retryRow(r.id)}
                        disabled={busy === 'retry-' + r.id}
                      >
                        {busy === 'retry-' + r.id ? '…' : 'Retry'}
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
