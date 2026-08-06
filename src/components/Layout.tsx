import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { clearSession, getEmail } from '../api/client';
import { useLedger } from '../hooks/useLedger';
import { isInboxTxn } from '../lib/dataStore';

/** Primary bottom-nav parity: Home · Spending · Account · Reflect */
const primaryNav = [
  { to: '/', label: 'Home', end: true },
  { to: '/inbox', label: 'Spending' },
  { to: '/accounts', label: 'Account' },
  { to: '/reports', label: 'Reflect' },
];

const secondaryNav = [
  { to: '/transactions', label: 'All' },
  { to: '/categories', label: 'Categories' },
  { to: '/payees', label: 'Payees' },
  { to: '/connectors', label: 'Connectors' },
  { to: '/more', label: 'More' },
];

export function Layout() {
  const { data } = useLedger();
  const navigate = useNavigate();
  const email = getEmail();
  const inboxCount =
    data?.transactions.filter((t) => isInboxTxn(t, data)).length ?? 0;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">R2</div>
          <div>
            <div className="brand-title">R2Finance</div>
            <div className="brand-sub">
              {data?.plan.name || 'Loading…'}
            </div>
          </div>
        </div>
        <nav className="nav">
          {primaryNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                isActive ? 'nav-link active' : 'nav-link'
              }
            >
              <span>{item.label}</span>
              {item.to === '/inbox' && inboxCount > 0 && (
                <span className="badge">{inboxCount}</span>
              )}
            </NavLink>
          ))}
          <div className="nav-divider" aria-hidden />
          {secondaryNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                isActive ? 'nav-link active' : 'nav-link'
              }
            >
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="muted small">{email}</div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              clearSession();
              navigate('/login');
            }}
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
