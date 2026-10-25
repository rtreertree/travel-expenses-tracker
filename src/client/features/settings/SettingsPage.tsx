import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ArrowRight,
  ArrowRightLeft,
  Check,
  Globe2,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Users,
  X,
} from 'lucide-react';
import type { Currency, Purchaser, Settings } from '../../../shared/types';
import { settingsPatchSchema } from '../../../shared/schemas';
import { useApp } from '../../app/context';
import { api, ApiError, mutation } from '../../lib/api';
import { tokyoDate } from '../../lib/format';
import { ErrorNotice, Field, Loading } from '../../components/ui';

function RateSettings({ settings }: { settings: Settings }) {
  const [rate, setRate] = useState(settings.defaultThbPerJpy ?? '');
  const [version, setVersion] = useState(settings.version);
  const [error, setError] = useState<unknown>();
  const queryClient = useQueryClient();
  const { notify } = useApp();
  const update = useMutation({
    mutationFn: (body: unknown) => api<{ data: Settings }>('/settings', mutation('PATCH', body)),
    onSuccess: async (result) => {
      setVersion(result.data.version);
      setRate(result.data.defaultThbPerJpy ?? '');
      await queryClient.invalidateQueries();
      notify('Default exchange rate saved. Existing purchases keep their saved rates.');
    },
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    const parsed = settingsPatchSchema.safeParse({ defaultThbPerJpy: rate, version });
    if (!parsed.success) {
      setError(new Error(parsed.error.issues.map((issue) => issue.message).join(' ')));
      return;
    }
    update.mutate(parsed.data);
  }
  return (
    <section className="panel settings-panel">
      <div className="settings-title">
        <span className="settings-icon">
          <ArrowRightLeft size={20} />
        </span>
        <div>
          <h2>Exchange rate</h2>
          <p>A familiar currency, wherever you are.</p>
        </div>
      </div>
      <form onSubmit={submit}>
        <div className="rate-equation">
          <span>
            ¥1 <small>JPY</small>
          </span>
          <ArrowRight size={21} />
          <span>
            ฿{' '}
            <strong>
              {settings.defaultThbPerJpy
                ? settings.defaultThbPerJpy.replace(/0+$/, '').replace(/\.$/, '')
                : '—'}
            </strong>
            <small>THB</small>
          </span>
        </div>
        <Field
          label="Default THB per 1 JPY"
          hint="Use your own cash or card exchange rate. This is not a live market rate."
        >
          <input
            aria-label="Default exchange rate"
            inputMode="decimal"
            required
            placeholder="Enter your exchange rate"
            value={rate}
            onChange={(event) => setRate(event.target.value)}
          />
        </Field>
        {(error || update.error) && <ErrorNotice error={error ?? update.error} />}
        {update.error instanceof ApiError && update.error.code === 'VERSION_CONFLICT' && (
          <div className="conflict-review">
            <p>
              Your rate input is preserved. The latest saved rate is{' '}
              {settings.defaultThbPerJpy ?? 'unset'} (version {settings.version}).
            </p>
            <button
              type="button"
              className="text-button"
              onClick={async () => {
                try {
                  const latest = await queryClient.fetchQuery({
                    queryKey: ['settings'],
                    queryFn: () => api<{ data: Settings }>('/settings'),
                    staleTime: 0,
                  });
                  setVersion(latest.data.version);
                  update.reset();
                } catch (failure) {
                  setError(failure);
                }
              }}
            >
              Review latest version and keep my rate
            </button>
          </div>
        )}
        <p className="settings-help">
          Each purchase keeps a snapshot of its rate. Changing this default only affects new
          purchases.
        </p>
        <div className="settings-form-footer">
          <span>
            {settings.defaultThbPerJpy
              ? `Updated ${tokyoDate(settings.updatedAt, { hour: '2-digit', minute: '2-digit' })} JST`
              : 'No default rate configured yet'}
          </span>
          <button className="button primary" disabled={update.isPending}>
            <Save size={16} />
            {update.isPending ? 'Saving…' : 'Save rate'}
          </button>
        </div>
      </form>
    </section>
  );
}
function PurchaserRow({ person }: { person: Purchaser }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(person.name);
  const [version, setVersion] = useState(person.version);
  const [reviewError, setReviewError] = useState<unknown>();
  const queryClient = useQueryClient();
  const { notify } = useApp();
  const update = useMutation({
    mutationFn: (body: unknown) => api(`/purchasers/${person.id}`, mutation('PATCH', body)),
    onSuccess: async () => {
      setEditing(false);
      await queryClient.invalidateQueries();
      notify('Purchaser updated.');
    },
  });
  function rename(event: FormEvent) {
    event.preventDefault();
    update.mutate({ name, version });
  }
  return (
    <div className="purchaser-settings-row">
      <span className={`person-avatar ${person.archivedAt ? 'is-archived' : ''}`}>
        {person.name.slice(0, 1)}
      </span>
      <div className="person-settings-main">
        {editing ? (
          <form className="rename-form" onSubmit={rename}>
            <input
              aria-label={`New name for ${person.name}`}
              value={name}
              maxLength={60}
              required
              autoFocus
              onChange={(event) => setName(event.target.value)}
            />
            <button
              className="icon-button"
              aria-label="Save purchaser name"
              disabled={update.isPending}
            >
              <Check size={18} />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Cancel rename"
              disabled={update.isPending}
              onClick={() => setEditing(false)}
            >
              <X size={18} />
            </button>
          </form>
        ) : (
          <>
            <strong>{person.name}</strong>
            <span>
              {person.archivedAt
                ? 'Archived · kept in purchase history'
                : 'Available for new purchases'}
            </span>
          </>
        )}
        {(reviewError || update.error) && <ErrorNotice error={reviewError ?? update.error} />}
        {update.error instanceof ApiError && update.error.code === 'VERSION_CONFLICT' && (
          <button
            className="text-button"
            onClick={async () => {
              try {
                await queryClient.invalidateQueries({ queryKey: ['purchasers'] });
                const latest = await api<{ data: Purchaser[] }>('/purchasers?includeArchived=true');
                setVersion(latest.data.find((row) => row.id === person.id)?.version ?? version);
                update.reset();
                setReviewError(undefined);
              } catch (failure) {
                setReviewError(failure);
              }
            }}
          >
            Reload latest version; keep draft name
          </button>
        )}
      </div>
      {!editing && (
        <div className="person-settings-actions">
          <button
            className="icon-button"
            aria-label={`Rename ${person.name}`}
            disabled={update.isPending}
            onClick={() => {
              setEditing(true);
              setName(person.name);
              setVersion(person.version);
              update.reset();
            }}
          >
            <Pencil size={16} />
          </button>
          <button
            className="icon-button"
            aria-label={`${person.archivedAt ? 'Reactivate' : 'Archive'} ${person.name}`}
            title={person.archivedAt ? 'Reactivate purchaser' : 'Archive purchaser'}
            disabled={update.isPending}
            onClick={() => update.mutate({ archived: !person.archivedAt, version: person.version })}
          >
            {person.archivedAt ? <RotateCcw size={17} /> : <Archive size={17} />}
          </button>
        </div>
      )}
    </div>
  );
}
export function SettingsPage() {
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => api<{ data: Settings }>('/settings'),
  });
  const purchasers = useQuery({
    queryKey: ['purchasers'],
    queryFn: () => api<{ data: Purchaser[] }>('/purchasers?includeArchived=true'),
  });
  const queryClient = useQueryClient();
  const { currency, setCurrency, notify } = useApp();
  const [newName, setNewName] = useState('');
  const create = useMutation({
    mutationFn: () => api('/purchasers', mutation('POST', { name: newName })),
    onSuccess: async () => {
      setNewName('');
      await queryClient.invalidateQueries();
      notify('New purchaser added.');
    },
  });
  return (
    <div className="settings-grid">
      <div className="settings-main">
        {settings.isPending && <Loading label="Loading your settings…" />}
        {settings.error && (
          <ErrorNotice
            error={settings.error}
            retry={() => {
              void settings.refetch();
            }}
          />
        )}
        {settings.data && <RateSettings settings={settings.data.data} />}
        <section className="panel settings-panel">
          <div className="settings-title">
            <span className="settings-icon">
              <Users size={20} />
            </span>
            <div>
              <h2>Your travel companions</h2>
              <p>The people behind the purchases.</p>
            </div>
          </div>
          <p className="settings-help">
            Purchasers are the people who paid. Rename anyone, add a companion, or archive a name
            you no longer use.
          </p>
          {purchasers.isPending && <Loading />}
          {purchasers.error && (
            <ErrorNotice
              error={purchasers.error}
              retry={() => {
                void purchasers.refetch();
              }}
            />
          )}
          <div className="purchaser-settings-list">
            {purchasers.data?.data.map((person) => (
              <PurchaserRow key={person.id} person={person} />
            ))}
          </div>
          <form
            className="add-person-form"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              create.mutate();
            }}
          >
            <label className="sr-only" htmlFor="new-purchaser">
              New purchaser name
            </label>
            <input
              id="new-purchaser"
              name="purchaserName"
              required
              maxLength={60}
              placeholder="A new travel companion…"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
            />
            <button className="button secondary" disabled={create.isPending}>
              <Plus size={17} />
              {create.isPending ? 'Adding…' : 'Add purchaser'}
            </button>
          </form>
          {create.error && <ErrorNotice error={create.error} />}
          <p className="settings-help small">
            Archived purchasers stay in your history and charts. Their names remain reserved until
            renamed.
          </p>
        </section>
      </div>
      <aside className="settings-aside">
        <section className="panel settings-panel">
          <div className="settings-title">
            <span className="settings-icon">
              <Globe2 size={20} />
            </span>
            <div>
              <h2>Display currency</h2>
              <p>A preference just for this browser.</p>
            </div>
          </div>
          <div className="display-options">
            {(['THB', 'JPY'] as Currency[]).map((value) => (
              <button
                key={value}
                className={currency === value ? 'selected' : ''}
                aria-pressed={currency === value}
                onClick={() => setCurrency(value)}
              >
                <span>{value === 'THB' ? '฿' : '¥'}</span>
                <div>
                  <strong>{value === 'THB' ? 'Thai baht' : 'Japanese yen'}</strong>
                  <small>{value}</small>
                </div>
                {currency === value && <Check size={17} />}
              </button>
            ))}
          </div>
        </section>
        <section className="shared-ledger-note">
          <span className="tiny-label">TRAVEL TOGETHER</span>
          <h3>One shared ledger.</h3>
          <p>
            Everyone with this address can view and change purchases, purchasers, and rates. There
            are no accounts or private entries.
          </p>
          <div>
            <span className="shared-dot" />
            Public by design
          </div>
        </section>
      </aside>
    </div>
  );
}
