import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { roleLabel, type Role } from '../api/auth';

const NAV: Record<Role, Array<{ to: string; label: string }>> = {
  CUSTOMER: [
    { to: '/customer', label: 'Dashboard' },
    { to: '/my-bookings', label: 'My bookings' },
    { to: '/payments', label: 'Payments' },
    { to: '/catalog', label: 'Catalog' },
  ],
  STAFF: [
    { to: '/staff', label: 'Dashboard' },
    { to: '/staff/bookings', label: 'Bookings' },
    { to: '/staff/inventory', label: 'Inventory' },
    { to: '/catalog', label: 'Catalog' },
  ],
  ADMIN: [
    { to: '/staff', label: 'Staff tools' },
    { to: '/staff/bookings', label: 'Bookings' },
    { to: '/admin', label: 'Admin' },
    { to: '/admin/inventory', label: 'Inventory' },
    { to: '/catalog', label: 'Catalog' },
  ],
};

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-1.5 text-sm font-medium ${
    isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'
  }`;

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function onLogout() {
    await logout();
    navigate('/login');
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link to="/" className="flex items-center gap-2 text-lg font-semibold text-brand-700">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white">
              ER
            </span>
            Equipment Rental
          </Link>

          <nav className="flex items-center gap-2" aria-label="Main">
            {user ? (
              <>
                {NAV[user.role].map((item) => (
                  <NavLink key={item.to} to={item.to} className={linkClass}>
                    {item.label}
                  </NavLink>
                ))}
                <span className="ml-2 hidden text-sm text-slate-600 sm:inline">
                  {user.name}
                  <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs">
                    {roleLabel[user.role]}
                  </span>
                </span>
                <button
                  onClick={onLogout}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Log out
                </button>
              </>
            ) : (
              <>
                <NavLink to="/catalog" className={linkClass}>
                  Catalog
                </NavLink>
                <NavLink to="/login" className={linkClass}>
                  Log in
                </NavLink>
                <NavLink to="/register" className={linkClass}>
                  Register
                </NavLink>
              </>
            )}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <Outlet />
      </main>

      <footer className="border-t border-slate-200 py-4 text-center text-xs text-slate-400">
        Equipment Rental &amp; Maintenance Management System
      </footer>
    </div>
  );
}