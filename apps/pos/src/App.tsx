import { useEffect, useState } from 'react';
import { api, setOnUnauthorized, type AuthClaims } from './api';
import { Login } from './pages/Login';
import { Tables } from './pages/Tables';
import { TicketDetail } from './pages/TicketDetail';
import { WaiterHome } from './pages/WaiterHome';
import { WaiterTicket } from './pages/WaiterTicket';
import { KDS } from './pages/KDS';
import { Inventory } from './pages/Inventory';
import { Reports } from './pages/Reports';

type Page = { kind: 'home' } | { kind: 'ticket'; ticketId: string };

export function App() {
  const [user, setUser] = useState<AuthClaims | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState<Page>({ kind: 'home' });

  useEffect(() => {
    if (!user) return;
    const p = window.location.pathname;
    if (p !== '/' && p !== '') return;
    if (user.role === 'waiter') window.location.href = '/waiter';
    else if (user.role === 'kitchen') window.location.href = '/kds';
  }, [user]);

  const isWaiterMode = window.location.pathname.startsWith('/waiter');
  const isKdsMode = window.location.pathname.startsWith('/kds');
  const isInventoryMode = window.location.pathname.startsWith('/inventory');
  const isReportsMode = window.location.pathname.startsWith('/reports');

  useEffect(() => {
    api.whoami()
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    setOnUnauthorized(() => {
      setUser(null);
      setPage({ kind: 'home' });
    });
    return () => setOnUnauthorized(null);
  }, []);

  if (loading) return <div className="loading">Loading…</div>;
  if (!user) return <Login onLogin={setUser} />;

  if (isKdsMode) {
    return (
      <div className="kds-shell">
        <div className="kds-topbar">
          <span className="kds-topbar-user">{user.role}</span>
          <button
            className="kds-topbar-logout"
            onClick={async () => {
              await api.logout().catch(() => undefined);
              setUser(null);
            }}
          >
            Log out
          </button>
        </div>
        <KDS />
      </div>
    );
  }

  if (isInventoryMode) {
    return (
      <div className="app">
        <header className="header">
          <h1>Hospitality POS — Inventory</h1>
          <div className="header-right">
            <span>{user.role}</span>
            <button
              onClick={async () => {
                await api.logout().catch(() => undefined);
                setUser(null);
              }}
            >
              Log out
            </button>
          </div>
        </header>
        <main>
          <Inventory />
        </main>
      </div>
    );
  }

  if (isReportsMode) {
    return (
      <div className="app">
        <header className="header">
          <h1>Hospitality POS — Reports</h1>
          <div className="header-right">
            <span>{user.role}</span>
            <button
              onClick={async () => {
                await api.logout().catch(() => undefined);
                setUser(null);
              }}
            >
              Log out
            </button>
          </div>
        </header>
        <main>
          <Reports />
        </main>
      </div>
    );
  }

  const goHome = () => setPage({ kind: 'home' });
  const openTicket = (id: string) => setPage({ kind: 'ticket', ticketId: id });

  return (
    <div className="app">
      <header className="header">
        <h1>
          Hospitality POS
          {isWaiterMode && <span className="muted-light"> — Waiter</span>}
        </h1>
        <div className="header-right">
          <span>{user.role}</span>
          <button
            onClick={async () => {
              await api.logout().catch(() => undefined);
              setUser(null);
              setPage({ kind: 'home' });
            }}
          >
            Log out
          </button>
        </div>
      </header>
      <main>
        {page.kind === 'ticket'
          ? (isWaiterMode
              ? <WaiterTicket ticketId={page.ticketId} onBack={goHome} />
              : <TicketDetail ticketId={page.ticketId} onBack={goHome} />)
          : (isWaiterMode
              ? <WaiterHome onOpenTicket={openTicket} />
              : <Tables onOpenTicket={openTicket} />)}
      </main>
    </div>
  );
}
