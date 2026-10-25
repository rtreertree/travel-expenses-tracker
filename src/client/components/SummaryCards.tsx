import { ArrowUpRight, CalendarDays, ReceiptText, Wallet } from 'lucide-react';
import type { Summary } from '../../shared/types';
import { useApp } from '../app/context';
import { money } from '../lib/format';

export function SummaryCards({
  summary,
  loading = false,
}: {
  summary?: Summary;
  loading?: boolean;
}) {
  const { currency } = useApp();
  const primary = currency === 'THB' ? summary?.totals.thb : summary?.totals.jpy;
  const secondary = currency === 'THB' ? summary?.totals.jpy : summary?.totals.thb;
  return (
    <div className="summary-cards">
      <section className="summary-card total-card">
        <div className="stat-top">
          <span>Total spent</span>
          <Wallet size={18} />
        </div>
        <div className="stat-value">
          {loading ? '…' : money(primary ?? '0', currency)}
          <span>{currency}</span>
        </div>
        <div className="stat-foot">
          <span>
            {money(secondary ?? '0', currency === 'THB' ? 'JPY' : 'THB')}{' '}
            {currency === 'THB' ? 'JPY' : 'THB'}
          </span>
          <span
            className="saved-rate-label"
            title="Totals sum each purchase’s saved rate. Changing the default rate does not change past purchases."
          >
            Saved rates
            <ArrowUpRight size={12} />
          </span>
        </div>
      </section>
      <section className="summary-card">
        <div className="stat-top">
          <span>Purchases</span>
          <ReceiptText size={18} />
        </div>
        <div className="stat-value">
          {loading ? '…' : (summary?.count ?? 0)}
          <span>moments</span>
        </div>
        <div className="stat-foot">The little things add up.</div>
      </section>
      <section className="summary-card">
        <div className="stat-top">
          <span>Days of exploring</span>
          <CalendarDays size={18} />
        </div>
        <div className="stat-value">
          {loading ? '…' : (summary?.byDay.length ?? 0)}
          <span>days</span>
        </div>
        <div className="stat-foot">With purchases in this date range</div>
      </section>
    </div>
  );
}
