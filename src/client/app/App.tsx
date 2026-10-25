import { lazy, Suspense, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import {
  ArrowUpRight,
  ChartNoAxesCombined,
  CircleHelp,
  Compass,
  CreditCard,
  MapPin,
  Plus,
  Settings2,
  Wallet,
  X,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import type { Currency, Purchase, Settings } from '../../shared/types';
import { AppContext, type Filters } from './context';
import { api } from '../lib/api';
import { readLocal, tokyoToday, writeLocal } from '../lib/format';
import { PurchasesPage } from '../features/purchases/PurchasesPage';
import { PurchaseForm } from '../features/purchases/PurchaseForm';
import { Loading } from '../components/ui';
const DashboardPage = lazy(() =>
  import('../features/dashboard/DashboardPage').then((module) => ({
    default: module.DashboardPage,
  })),
);
const SettingsPage = lazy(() =>
  import('../features/settings/SettingsPage').then((module) => ({ default: module.SettingsPage })),
);

const destinations = [
  { to: '/purchases', label: 'Purchases', icon: CreditCard },
  { to: '/dashboard', label: 'Dashboard', icon: ChartNoAxesCombined },
  { to: '/settings', label: 'Settings', icon: Settings2 },
];
export function App() {
  const [currency, updateCurrency] = useState<Currency>(() =>
    readLocal('tabi.currency') === 'JPY' ? 'JPY' : 'THB',
  );
  const [filters, setFilters] = useState<Filters>(() => {
    const today = tokyoToday();
    const [year, month] = today.split('-').map(Number);
    return {
      from: `${today.slice(0, 7)}-01`,
      to: `${today.slice(0, 7)}-${new Date(Date.UTC(year!, month!, 0)).getUTCDate()}`,
      q: '',
      purchaserId: '',
      preset: 'month',
    };
  });
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Purchase>();
  const [message, setMessage] = useState('');
  const location = useLocation();
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => api<{ data: Settings }>('/settings'),
  });
  function setCurrency(value: Currency) {
    updateCurrency(value);
    writeLocal('tabi.currency', value);
  }
  function openPurchase(purchase?: Purchase) {
    setEditing(purchase);
    setFormOpen(true);
  }
  function notify(value: string) {
    setMessage(value);
  }
  const current = destinations.find((item) => location.pathname.startsWith(item.to));
  return (
    <AppContext value={{ currency, setCurrency, filters, setFilters, openPurchase, notify }}>
      <div className="app-shell">
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>
        <aside className="sidebar">
          <Link to="/purchases" className="brand" aria-label="Tabi home">
            <span className="brand-mark">
              <Compass size={26} strokeWidth={1.5} />
            </span>
            <span>
              tabi<span className="brand-dot">.</span>
            </span>
          </Link>
          <p className="brand-caption">LITTLE MOMENTS. EVERY YEN.</p>
          <div className="workspace-label">YOUR TRAVEL LEDGER</div>
          <nav aria-label="Main navigation">
            {destinations.map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to}>
                <Icon size={19} strokeWidth={1.7} />
                {label}
                <span className="nav-active-dot" />
              </NavLink>
            ))}
          </nav>
          <div className="japan-card">
            <span className="japan-sun" />
            <div className="mountain mountain-back" />
            <div className="mountain mountain-front" />
            <div className="japan-card-text">
              <span className="tiny-label">THE JOURNEY</span>
              <strong>Made for Japan.</strong>
              <span>
                Collect memories.
                <br />
                Keep track of the rest.
              </span>
              <span className="japan-coordinates">35.6762° N · 139.6503° E</span>
            </div>
          </div>
          <div className="sidebar-footer">
            <span className="shared-dot" />
            Shared ledger <span className="public-label">PUBLIC</span>
            <p>One trip. A little more clarity.</p>
          </div>
        </aside>
        <div className="main-shell">
          <header className="topbar">
            <span className="breadcrumb">
              Your workspace <span>/</span> <strong>{current?.label ?? 'Purchases'}</strong>
            </span>
            <Link to="/purchases" className="mobile-brand">
              <Compass size={22} />
              tabi.
            </Link>
            <div className="topbar-right">
              <span className="location-badge">
                <span className="flag-japan" />
                Japan<span className="desktop-only"> · Asia/Tokyo</span>
              </span>
              <span className="topbar-divider" />
              <span className="traveler-avatar" title="Shared ledger">
                旅
              </span>
            </div>
          </header>
          <main id="main-content" tabIndex={-1}>
            <div className="page-heading">
              <div>
                <div className="eyebrow">
                  <span />
                  YOUR JAPAN JOURNAL
                </div>
                <h1>
                  {current?.label === 'Purchases'
                    ? 'Every purchase, a memory.'
                    : current?.label === 'Dashboard'
                      ? 'A clearer picture of your trip.'
                      : 'Make it your own.'}
                </h1>
                <p>
                  {current?.label === 'Purchases'
                    ? 'A little less counting. A little more exploring.'
                    : current?.label === 'Dashboard'
                      ? 'See where your yen went, and who paid along the way.'
                      : 'Your travel companions, exchange rate, and preferences.'}
                </p>
              </div>
              <button className="button primary add-purchase" onClick={() => openPurchase()}>
                <Plus size={18} />
                Add purchase
              </button>
            </div>
            <div className="page-context">
              <span>
                <MapPin size={14} /> JAPAN <span className="context-dot">·</span> SHARED TRAVEL
                LEDGER
              </span>
              <div className="currency-toggle" aria-label="Display currency">
                {(['THB', 'JPY'] as Currency[]).map((value) => (
                  <button
                    key={value}
                    aria-pressed={currency === value}
                    className={currency === value ? 'selected' : ''}
                    onClick={() => setCurrency(value)}
                  >
                    {value === 'THB' ? '฿' : '¥'} {value}
                  </button>
                ))}
              </div>
            </div>
            {settings.data &&
              !settings.data.data.defaultThbPerJpy &&
              location.pathname !== '/settings' && (
                <div className="setup-banner">
                  <CircleHelp size={20} />
                  <div>
                    <strong>One small thing before your first purchase.</strong>
                    <p>Set your JPY → THB rate, or use a custom rate when adding a purchase.</p>
                  </div>
                  <Link to="/settings">
                    Set exchange rate
                    <ArrowUpRight size={16} />
                  </Link>
                </div>
              )}
            <Suspense fallback={<Loading label="Opening your travel journal…" />}>
              <Routes>
                <Route path="/" element={<Navigate to="/purchases" replace />} />
                <Route path="/purchases" element={<PurchasesPage />} />
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="*" element={<Navigate to="/purchases" replace />} />
              </Routes>
            </Suspense>
            <footer className="main-footer">
              <span>
                <Wallet size={13} />A place for your purchases. More room for your trip.
              </span>
              <span>All dates in Japan time · UTC+9</span>
            </footer>
          </main>
        </div>
        <nav className="mobile-nav" aria-label="Mobile navigation">
          {destinations.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to}>
              <Icon size={20} />
              {label}
            </NavLink>
          ))}
        </nav>
        {formOpen && (
          <PurchaseForm
            key={editing?.id ?? 'new'}
            purchase={editing}
            onClose={() => setFormOpen(false)}
          />
        )}
        {message && (
          <div className="toast" role="status">
            <span>{message}</span>
            <button aria-label="Dismiss notification" onClick={() => setMessage('')}>
              <X size={17} />
            </button>
          </div>
        )}
      </div>
    </AppContext>
  );
}
