import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Coffee,
  Pencil,
  Plus,
  ReceiptText,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import type { Purchase, PurchaseList, Settings, Summary } from '../../../shared/types';
import { useApp } from '../../app/context';
import { api, mutation, queryString } from '../../lib/api';
import { money, tokyoDate } from '../../lib/format';
import { FiltersBar } from '../../components/Filters';
import { Empty, ErrorNotice, Loading } from '../../components/ui';
import { SummaryCards } from '../../components/SummaryCards';
import { LocationDisplay } from '../../components/Location';

export function PurchasesPage() {
  const { filters, currency, openPurchase, notify } = useApp();
  const [status, setStatus] = useState<'active' | 'deleted'>('active');
  const [expanded, setExpanded] = useState<string>();
  const [deleting, setDeleting] = useState<Purchase>();
  const confirmDialog = useRef<HTMLDialogElement>(null);
  const queryClient = useQueryClient();
  const filterValues = {
    from: filters.from,
    to: filters.to,
    purchaserId: filters.purchaserId,
    q: filters.q.trim(),
  };
  const purchases = useInfiniteQuery({
    queryKey: ['purchases', filterValues, status],
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      api<PurchaseList>(
        `/purchases${queryString({ ...filterValues, status, cursor: pageParam, limit: '30' })}`,
      ),
    getNextPageParam: (lastPage) => lastPage.page.nextCursor ?? undefined,
  });
  const summary = useQuery({
    queryKey: ['summary', filterValues],
    queryFn: () => api<{ data: Summary }>(`/summary${queryString(filterValues)}`),
  });
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => api<{ data: Settings }>('/settings'),
  });
  const change = useMutation({
    mutationFn: ({ purchase, action }: { purchase: Purchase; action: 'delete' | 'restore' }) =>
      api(
        action === 'delete'
          ? `/purchases/${purchase.id}?version=${purchase.version}`
          : `/purchases/${purchase.id}/restore`,
        mutation(
          action === 'delete' ? 'DELETE' : 'POST',
          action === 'restore' ? { version: purchase.version } : undefined,
        ),
      ),
    onSuccess: async (_, { action }) => {
      await queryClient.invalidateQueries();
      setDeleting(undefined);
      confirmDialog.current?.close();
      notify(
        action === 'delete'
          ? 'Purchase moved to trash. You can restore it anytime.'
          : 'Purchase restored.',
      );
    },
  });
  const rows = purchases.data?.pages.flatMap((page) => page.data) ?? [];
  function requestDelete(purchase: Purchase) {
    change.reset();
    setDeleting(purchase);
    confirmDialog.current?.showModal();
  }
  return (
    <>
      <FiltersBar />
      <SummaryCards summary={summary.data?.data} loading={summary.isPending} />
      {summary.error && (
        <ErrorNotice
          error={summary.error}
          retry={() => {
            void summary.refetch();
          }}
        />
      )}
      <div className="ledger-grid">
        <section className="panel purchase-panel">
          <header className="panel-heading">
            <div>
              <span className="tiny-label">YOUR LEDGER</span>
              <h2>
                {status === 'deleted' ? 'In the trash' : 'Purchases'}
                <span className="count-badge">
                  {status === 'active' ? (summary.data?.data.count ?? '—') : rows.length}
                </span>
              </h2>
            </div>
            <div className="ledger-tabs" aria-label="Purchase status">
              <button
                className={status === 'active' ? 'selected' : ''}
                onClick={() => setStatus('active')}
              >
                Active
              </button>
              <button
                className={status === 'deleted' ? 'selected' : ''}
                onClick={() => setStatus('deleted')}
              >
                <Trash2 size={14} />
                Trash
              </button>
            </div>
          </header>
          {status === 'deleted' && (
            <p className="trash-note">
              Deleted purchases stay here until you restore them. They are excluded from all totals.
            </p>
          )}
          {purchases.isPending && <Loading />}
          {purchases.error && (
            <ErrorNotice
              error={purchases.error}
              retry={() => {
                void purchases.refetch();
              }}
            />
          )}
          {change.error && !deleting && (
            <ErrorNotice
              error={change.error}
              retry={() => {
                void purchases.refetch();
                change.reset();
              }}
            />
          )}
          {!purchases.isPending && !purchases.error && rows.length === 0 && (
            <Empty
              title={
                status === 'deleted'
                  ? 'Nothing in the trash.'
                  : filters.q || filters.purchaserId
                    ? 'No matching memories.'
                    : 'Your next memory starts here.'
              }
              action={
                status === 'active' && (
                  <button className="button primary" onClick={() => openPurchase()}>
                    <Plus size={16} />
                    Add your first purchase
                  </button>
                )
              }
            >
              {status === 'deleted'
                ? 'Purchases you delete will appear here, ready to restore.'
                : 'A morning coffee, a train to somewhere new. Add a purchase to begin your journey.'}
            </Empty>
          )}
          <div className="purchase-list">
            {rows.map((purchase, index) => {
              const previous = rows[index - 1];
              const date = tokyoDate(purchase.purchasedAt, { weekday: 'short' });
              const newDay =
                !previous || tokyoDate(previous.purchasedAt) !== tokyoDate(purchase.purchasedAt);
              const isExpanded = expanded === purchase.id;
              return (
                <div key={purchase.id}>
                  {newDay && (
                    <div className="day-divider">
                      <span>{date}</span>
                      <span>JAPAN TIME</span>
                    </div>
                  )}
                  <article className={`purchase-row ${isExpanded ? 'expanded' : ''}`}>
                    <div className="purchase-main">
                      <span className={`purchase-icon tone-${index % 4}`}>
                        <ReceiptText size={20} strokeWidth={1.5} />
                      </span>
                      <button
                        className="purchase-name-button"
                        aria-expanded={isExpanded}
                        onClick={() => setExpanded(isExpanded ? undefined : purchase.id)}
                      >
                        <strong>{purchase.name}</strong>
                        <span>
                          <span className="mini-avatar">{purchase.purchaser.name.slice(0, 1)}</span>
                          {purchase.purchaser.name}
                          <span className="context-dot">·</span>
                          {tokyoDate(purchase.purchasedAt, {
                            hour: '2-digit',
                            minute: '2-digit',
                            day: undefined,
                            month: undefined,
                            year: undefined,
                          })}
                          {purchase.purchaser.archived && (
                            <span className="archived-label">Archived</span>
                          )}
                        </span>
                      </button>
                      <div className="purchase-amount">
                        <strong>
                          {money(
                            currency === 'THB' ? purchase.amountThb : purchase.amountJpy,
                            currency,
                          )}
                        </strong>
                        <span>
                          {money(
                            currency === 'THB' ? purchase.amountJpy : purchase.amountThb,
                            currency === 'THB' ? 'JPY' : 'THB',
                          )}
                        </span>
                      </div>
                      <button
                        className="icon-button expand-button"
                        aria-label={`${isExpanded ? 'Hide' : 'Show'} details for ${purchase.name}`}
                        onClick={() => setExpanded(isExpanded ? undefined : purchase.id)}
                      >
                        {isExpanded ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
                      </button>
                    </div>
                    {purchase.location && <LocationDisplay location={purchase.location} compact />}
                    {isExpanded && (
                      <div className="purchase-detail">
                        <dl>
                          <div>
                            <dt>Original amount</dt>
                            <dd>
                              {money(purchase.originalAmount, purchase.originalCurrency)}{' '}
                              {purchase.originalCurrency}
                            </dd>
                          </div>
                          <div>
                            <dt>Saved rate</dt>
                            <dd>
                              1 JPY = {purchase.exchangeRate} THB{' '}
                              <span>({purchase.rateSource})</span>
                            </dd>
                          </div>
                          <div>
                            <dt>Purchased</dt>
                            <dd>
                              {tokyoDate(purchase.purchasedAt, {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}{' '}
                              · Tokyo
                            </dd>
                          </div>
                        </dl>
                        {purchase.location && <LocationDisplay location={purchase.location} />}
                        {purchase.description && (
                          <p className="purchase-description">{purchase.description}</p>
                        )}
                        <div className="purchase-actions">
                          {status === 'active' ? (
                            <>
                              <button
                                className="text-button"
                                onClick={() => openPurchase(purchase)}
                              >
                                <Pencil size={14} />
                                Edit purchase
                              </button>
                              <button
                                className="text-button danger"
                                onClick={() => requestDelete(purchase)}
                              >
                                <Trash2 size={14} />
                                Move to trash
                              </button>
                            </>
                          ) : (
                            <button
                              className="button secondary"
                              disabled={change.isPending}
                              onClick={() => change.mutate({ purchase, action: 'restore' })}
                            >
                              <RotateCcw size={15} />
                              {change.isPending ? 'Restoring…' : 'Restore purchase'}
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </article>
                </div>
              );
            })}
          </div>
          {purchases.hasNextPage && (
            <div className="load-more">
              <button
                className="button secondary"
                disabled={purchases.isFetchingNextPage}
                onClick={() => {
                  void purchases.fetchNextPage();
                }}
              >
                <ArrowDown size={15} />
                {purchases.isFetchingNextPage ? 'Loading…' : 'Load more purchases'}
              </button>
            </div>
          )}
          {rows.length > 0 && (
            <div className="list-footer">
              {rows.length} purchase{rows.length !== 1 ? 's' : ''} shown
              <span>All amounts use their saved exchange rate.</span>
            </div>
          )}
        </section>
        <aside className="ledger-aside">
          <section className="travel-note">
            <span className="tiny-label">A TRAVELER’S NOTE</span>
            <Coffee size={33} strokeWidth={1.2} />
            <h3>
              More moments.
              <br />
              Less mental math.
            </h3>
            <p>Your purchases are saved in both yen and baht, so you can stay in the moment.</p>
            <Link to="/dashboard">
              See your spending story
              <ArrowRight size={15} />
            </Link>
            <span className="note-japanese" aria-hidden="true">
              旅のきろく
            </span>
          </section>
          <section className="rate-note">
            <span className="tiny-label">YOUR EXCHANGE RATE</span>
            <div>
              <span>¥1</span>
              <ArrowRight size={17} />
              <strong>
                {settings.data?.data.defaultThbPerJpy
                  ? `฿${settings.data.data.defaultThbPerJpy.replace(/0+$/, '').replace(/\.$/, '')}`
                  : 'Not set'}
              </strong>
            </div>
            <p>Set by you. Saved with every purchase.</p>
            <Link to="/settings">
              Manage rate
              <ArrowRight size={13} />
            </Link>
          </section>
        </aside>
      </div>
      <dialog ref={confirmDialog} className="confirm-dialog" aria-labelledby="delete-title">
        <button
          className="icon-button confirm-close"
          aria-label="Close confirmation"
          disabled={change.isPending}
          onClick={() => {
            confirmDialog.current?.close();
            setDeleting(undefined);
          }}
        >
          <X size={18} />
        </button>
        <span className="empty-icon">
          <Trash2 size={25} />
        </span>
        <h2 id="delete-title">Move to trash?</h2>
        <p>
          “{deleting?.name}” will leave your ledger and totals. You can restore it from the Trash
          tab anytime.
        </p>
        {change.error && (
          <ErrorNotice
            error={change.error}
            retry={() => {
              void purchases.refetch();
              confirmDialog.current?.close();
              setDeleting(undefined);
              change.reset();
            }}
          />
        )}
        <div className="confirm-actions">
          <button
            className="button secondary"
            disabled={change.isPending}
            onClick={() => {
              confirmDialog.current?.close();
              setDeleting(undefined);
            }}
          >
            Keep purchase
          </button>
          <button
            className="button destructive"
            disabled={change.isPending}
            onClick={() => deleting && change.mutate({ purchase: deleting, action: 'delete' })}
          >
            {change.isPending ? 'Moving…' : 'Move to trash'}
          </button>
        </div>
      </dialog>
    </>
  );
}
