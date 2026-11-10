import { useEffect, useState } from 'react';
import { api, type AuthClaims } from './api';
import { Login } from './pages/Login';
import { Tables } from './pages/Tables';
import { TicketDetail } from './pages/TicketDetail';
import { WaiterHome } from './pages/WaiterHome';
import { WaiterTicket } from './pages/WaiterTicket';

type Page = { kind: 'home' } | { kind: 'ticket'; ticketId: string };

export function App() {
  const [user, setUser] = useState<AuthClaims | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState<Page>({ kind: 'home' });

  const isWaiterMode = window.location.pathname.startsWith('/waiter');

  useEffect(() => {
    api.whoami()
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading">Loading…</div>;
  if (!user) return <Login onLogin={setUser} />;

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
