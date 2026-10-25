import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft, Clock3, Info, Save, X } from 'lucide-react';
import type { Currency, Purchase, Purchaser, Settings } from '../../../shared/types';
import { calculateAmounts } from '../../../shared/money';
import { createPurchaseSchema, patchPurchaseSchema } from '../../../shared/schemas';
import { useApp } from '../../app/context';
import { api, ApiError, mutation } from '../../lib/api';
import { money, readLocal, tokyoDate, tokyoInput, writeLocal } from '../../lib/format';
import { ErrorNotice, Field } from '../../components/ui';

type Draft = {
  id: string;
  name: string;
  amount: string;
  authority: Currency;
  viewed: Currency;
  description: string;
  purchaserId: string;
  customTime: boolean;
  time: string;
  customRate: boolean;
  rate: string;
  attempted?: boolean;
};
const DRAFT_KEY = 'tabi.purchase-draft';
function initialDraft(purchase?: Purchase): Draft {
  if (purchase)
    return {
      id: purchase.id,
      name: purchase.name,
      amount: purchase.originalAmount,
      authority: purchase.originalCurrency,
      viewed: purchase.originalCurrency,
      description: purchase.description,
      purchaserId: purchase.purchaserId,
      customTime: true,
      time: tokyoInput(purchase.purchasedAt),
      customRate: true,
      rate: purchase.exchangeRate,
    };
  try {
    const saved = JSON.parse(readLocal(DRAFT_KEY, 'null')) as Draft | null;
    if (
      saved &&
      typeof saved.id === 'string' &&
      typeof saved.name === 'string' &&
      (saved.authority === 'JPY' || saved.authority === 'THB')
    )
      return saved;
  } catch {
    /* Invalid browser draft can safely be replaced. */
  }
  return {
    id: crypto.randomUUID(),
    name: '',
    amount: '',
    authority: 'JPY',
    viewed: 'JPY',
    description: '',
    purchaserId: '',
    customTime: false,
    time: tokyoInput(new Date().toISOString()),
    customRate: false,
    rate: '',
  };
}
export function PurchaseForm({ purchase, onClose }: { purchase?: Purchase; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(() => initialDraft(purchase));
  const [localError, setLocalError] = useState<unknown>();
  const [latest, setLatest] = useState<Purchase>();
  const [version, setVersion] = useState(purchase?.version);
  const { notify } = useApp();
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => api<{ data: Settings }>('/settings'),
  });
  const purchasers = useQuery({
    queryKey: ['purchasers'],
    queryFn: () => api<{ data: Purchaser[] }>('/purchasers?includeArchived=true'),
  });
  const people = purchasers.data?.data ?? [];
  const active = people.filter((person) => !person.archivedAt);
  const usableDraftPurchaser =
    draft.purchaserId &&
    (purchase ||
      draft.attempted ||
      !people.find((person) => person.id === draft.purchaserId)?.archivedAt)
      ? draft.purchaserId
      : '';
  const selectedId =
    usableDraftPurchaser ||
    active.find((person) => person.id === readLocal('tabi.last-purchaser'))?.id ||
    active.find((person) => person.name === 'Me')?.id ||
    active[0]?.id ||
    '';
  const rate = draft.customRate ? draft.rate : (settings.data?.data.defaultThbPerJpy ?? '');
  let converted: ReturnType<typeof calculateAmounts> | undefined;
  try {
    if (draft.amount && rate) converted = calculateAmounts(draft.authority, draft.amount, rate);
  } catch {
    /* Validation explains invalid values when saved. */
  }
  const inputValue =
    draft.viewed === draft.authority
      ? draft.amount
      : converted
        ? draft.viewed === 'JPY'
          ? converted.amountJpy
          : converted.amountThb
        : '';
  const save = useMutation({
    mutationFn: (body: unknown) =>
      api<{ data: Purchase }>(
        purchase ? `/purchases/${purchase.id}` : '/purchases',
        mutation(purchase ? 'PATCH' : 'POST', body),
      ),
    onSuccess: async () => {
      writeLocal('tabi.last-purchaser', selectedId);
      if (!purchase) writeLocal(DRAFT_KEY, 'null');
      await queryClient.invalidateQueries();
      notify(purchase ? 'Purchase updated.' : 'Purchase added to your journey.');
      onClose();
    },
  });
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  useEffect(() => {
    if (!purchase) writeLocal(DRAFT_KEY, JSON.stringify(draft));
  }, [draft, purchase]);
  function update(change: Partial<Draft>) {
    setDraft((previous) => ({ ...previous, ...change }));
    setLocalError(undefined);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setLocalError(undefined);
    let body: Record<string, unknown> = { name: draft.name, description: draft.description };
    if (purchase) {
      body.version = version;
      if (
        draft.amount !== purchase.originalAmount ||
        draft.authority !== purchase.originalCurrency
      ) {
        body.originalAmount = draft.amount;
        body.originalCurrency = draft.authority;
      }
      if (selectedId !== purchase.purchaserId) body.purchaserId = selectedId;
      if (draft.rate !== purchase.exchangeRate && draft.customRate) body.exchangeRate = draft.rate;
      if (draft.customTime && draft.time !== tokyoInput(purchase.purchasedAt))
        body.purchasedAt = `${draft.time}:00+09:00`;
      if (!draft.customTime) body.purchasedAt = new Date().toISOString();
    } else {
      body = {
        ...body,
        id: draft.id,
        originalAmount: draft.amount,
        originalCurrency: draft.authority,
        purchaserId: selectedId,
      };
      if (draft.customTime) body.purchasedAt = `${draft.time}:00+09:00`;
      if (draft.customRate) body.exchangeRate = draft.rate;
    }
    const result = (purchase ? patchPurchaseSchema : createPurchaseSchema).safeParse(body);
    if (!result.success) {
      const errors: Record<string, string[]> = {};
      for (const issue of result.error.issues) {
        const key = String(issue.path[0] ?? 'form');
        (errors[key] ??= []).push(issue.message);
      }
      setLocalError(
        new ApiError('Check the highlighted fields and try again.', 'VALIDATION_ERROR', errors),
      );
      return;
    }
    // Freeze the actual request purchaser across uncertain retries as well as the creation UUID.
    if (!purchase)
      setDraft((previous) => ({ ...previous, purchaserId: selectedId, attempted: true }));
    save.mutate(result.data);
  }
  async function reviewLatest() {
    if (!purchase) return;
    try {
      const result = await api<{ data: Purchase }>(`/purchases/${purchase.id}`);
      setLatest(result.data);
    } catch (error) {
      setLocalError(error);
    }
  }
  const error = localError ?? save.error;
  return (
    <dialog
      ref={dialog}
      className="purchase-dialog"
      aria-labelledby="purchase-form-title"
      onCancel={(event) => {
        if (save.isPending) event.preventDefault();
        else onClose();
      }}
    >
      <form
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        <header className="dialog-header">
          <div>
            <span className="eyebrow">A LITTLE MOMENT</span>
            <h2 id="purchase-form-title">{purchase ? 'Edit purchase' : 'Add a purchase'}</h2>
            <p>Keep the memory. We’ll keep the numbers.</p>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close purchase form"
            disabled={save.isPending}
            onClick={onClose}
          >
            <X size={21} />
          </button>
        </header>
        <div className="dialog-body">
          {error && <ErrorNotice error={error} />}
          {error instanceof ApiError && error.code === 'VERSION_CONFLICT' && (
            <div className="conflict-review">
              <p>Your draft is preserved. Review the latest saved purchase before trying again.</p>
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  void reviewLatest();
                }}
              >
                Review latest purchase
              </button>
              {latest && (
                <div>
                  <p>
                    Saved version {latest.version}: <strong>{latest.name}</strong>,{' '}
                    {money(latest.amountThb, 'THB')}, {tokyoDate(latest.updatedAt)}
                    {latest.deletedAt ? ' · In trash' : ''}.
                  </p>
                  <button
                    type="button"
                    className="text-button"
                    disabled={!!latest.deletedAt}
                    onClick={() => {
                      setVersion(latest.version);
                      save.reset();
                      setLatest(undefined);
                    }}
                  >
                    Use latest version and keep my draft
                  </button>
                </div>
              )}
            </div>
          )}
          <Field label="Purchase name">
            <input
              autoFocus
              name="name"
              placeholder="e.g. Ramen in Shinjuku"
              maxLength={160}
              required
              value={draft.name}
              onChange={(event) => update({ name: event.target.value })}
            />
          </Field>
          <div className="amount-label">
            <label htmlFor="purchase-amount">Amount</label>
            <div className="currency-toggle">
              {(['JPY', 'THB'] as Currency[]).map((currency) => (
                <button
                  key={currency}
                  type="button"
                  aria-pressed={draft.viewed === currency}
                  className={draft.viewed === currency ? 'selected' : ''}
                  onClick={() => update({ viewed: currency })}
                >
                  {currency}
                </button>
              ))}
            </div>
          </div>
          <div className="amount-entry">
            <span>{draft.viewed === 'JPY' ? '¥' : '฿'}</span>
            <input
              id="purchase-amount"
              name="originalAmount"
              aria-label="Purchase amount"
              inputMode="decimal"
              placeholder="0"
              required
              value={inputValue}
              onChange={(event) => update({ amount: event.target.value, authority: draft.viewed })}
            />
            <span>{draft.viewed}</span>
          </div>
          {draft.viewed !== draft.authority && (
            <p className="field-hint">
              Estimated {draft.viewed} amount. Your original {draft.authority} amount stays
              unchanged until you edit this field.
            </p>
          )}
          <div className="conversion-preview">
            <ArrowRightLeft size={17} />
            <span>Estimated {draft.viewed === 'JPY' ? 'THB' : 'JPY'}</span>
            <strong>
              {converted
                ? money(
                    draft.viewed === 'JPY' ? converted.amountThb : converted.amountJpy,
                    draft.viewed === 'JPY' ? 'THB' : 'JPY',
                  )
                : '—'}
            </strong>
          </div>
          <div className="rate-control">
            <div>
              <span>{purchase ? 'Saved rate' : 'Exchange rate'}</span>
              <strong>1 JPY = {rate || '—'} THB</strong>
            </div>
            {!purchase && (
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={draft.customRate}
                  onChange={(event) =>
                    update({
                      customRate: event.target.checked,
                      rate: draft.rate || settings.data?.data.defaultThbPerJpy || '',
                    })
                  }
                />
                Use custom rate
              </label>
            )}
          </div>
          {draft.customRate && (
            <Field
              label={purchase ? 'THB per 1 JPY (saved with this purchase)' : 'Custom THB per 1 JPY'}
            >
              <input
                aria-label="Purchase exchange rate"
                inputMode="decimal"
                placeholder="Enter your exchange rate"
                required
                value={draft.rate}
                onChange={(event) => update({ rate: event.target.value })}
              />
            </Field>
          )}
          {!rate && (
            <p className="inline-guidance">
              <Info size={15} />
              Enter a custom rate or{' '}
              <Link to="/settings" onClick={onClose}>
                set the default in Settings
              </Link>
              .
            </p>
          )}
          <Field label="Purchased by">
            <select
              aria-label="Purchased by"
              required
              value={selectedId}
              onChange={(event) => update({ purchaserId: event.target.value })}
            >
              <option value="" disabled>
                Select a purchaser
              </option>
              {people
                .filter(
                  (person) =>
                    !person.archivedAt ||
                    person.id === purchase?.purchaserId ||
                    person.id === selectedId,
                )
                .map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                    {person.archivedAt ? ' (archived)' : ''}
                  </option>
                ))}
            </select>
          </Field>
          {active.length === 0 && !purchase && (
            <p className="inline-guidance">
              No active purchasers.{' '}
              <Link to="/settings" onClick={onClose}>
                Create or reactivate a purchaser
              </Link>{' '}
              to continue.
            </p>
          )}
          <div className="time-label">
            <span>
              <Clock3 size={15} />
              Purchase time
            </span>
            <div className="range-pills">
              <button
                type="button"
                className={!draft.customTime ? 'selected' : ''}
                onClick={() => update({ customTime: false })}
              >
                Now
              </button>
              <button
                type="button"
                className={draft.customTime ? 'selected' : ''}
                onClick={() => update({ customTime: true })}
              >
                Custom
              </button>
            </div>
          </div>
          {draft.customTime ? (
            <Field label="Date and time in Japan (UTC+9)">
              <input
                aria-label="Purchase date and time"
                type="datetime-local"
                required
                value={draft.time}
                onChange={(event) => update({ time: event.target.value })}
              />
            </Field>
          ) : (
            <p className="field-hint">The time this purchase saves, in Asia/Tokyo.</p>
          )}
          <Field label="Description (optional)">
            <textarea
              name="description"
              rows={3}
              maxLength={4000}
              placeholder="A detail you’d like to remember…"
              value={draft.description}
              onChange={(event) => update({ description: event.target.value })}
            />
          </Field>
        </div>
        <footer className="dialog-footer">
          <button
            type="button"
            className="button secondary"
            disabled={save.isPending}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="button primary"
            type="submit"
            disabled={save.isPending || (!selectedId && !purchase)}
          >
            <Save size={17} />
            {save.isPending ? 'Saving…' : purchase ? 'Save changes' : 'Save purchase'}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
