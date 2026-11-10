import { useEffect, useState } from 'react';
import { api, type AuthClaims } from './api';
import { Login } from './pages/Login';
import { Tables } from './pages/Tables';
import { TicketDetail } from './pages/TicketDetail';

type Page = { kind: 'tables' } | { kind: 'ticket'; ticketId: string };

export function App() {
  const [user, setUser] = useState<AuthClaims | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState<Page>({ kind: 'tables' });

  useEffect(() => {
    api.whoami()
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading">Loading…</div>;
  if (!user) return <Login onLogin={setUser} />;

  return (
    <div className="app">
      <header className="header">
        <h1>Hospitality POS</h1>
        <div className="header-right">
          <span>{user.role}</span>
          <button
            onClick={async () => {
              await api.logout().catch(() => undefined);
              setUser(null);
              setPage({ kind: 'tables' });
            }}
          >
            Log out
          </button>
        </div>
      </header>
      <main>
        {page.kind === 'tables' && (
          <Tables onOpenTicket={(id) => setPage({ kind: 'ticket', ticketId: id })} />
        )}
        {page.kind === 'ticket' && (
          <TicketDetail ticketId={page.ticketId} onBack={() => setPage({ kind: 'tables' })} />
        )}
      </main>
    </div>
  );
}
