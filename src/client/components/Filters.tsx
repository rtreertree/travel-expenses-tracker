import { Search, SlidersHorizontal } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import type { Purchaser } from '../../shared/types';
import { useApp } from '../app/context';
import { api } from '../lib/api';
import { tokyoToday } from '../lib/format';

export function FiltersBar() {
  const { filters, setFilters } = useApp();
  const purchasers = useQuery({
    queryKey: ['purchasers'],
    queryFn: () => api<{ data: Purchaser[] }>('/purchasers?includeArchived=true'),
  });
  function preset(value: string) {
    const today = tokyoToday();
    let from = '',
      to = '';
    if (value === 'today') from = to = today;
    if (value === 'month') {
      from = `${today.slice(0, 7)}-01`;
      const [year, month] = today.split('-').map(Number);
      const last = new Date(Date.UTC(year!, month!, 0)).getUTCDate();
      to = `${today.slice(0, 7)}-${last}`;
    }
    setFilters({ ...filters, from, to, preset: value });
  }
  return (
    <div className="filters-card">
      <div className="filter-top">
        <div className="search-input">
          <Search size={17} aria-hidden="true" />
          <input
            aria-label="Search purchases"
            placeholder="Search your purchases…"
            maxLength={100}
            value={filters.q}
            onChange={(event) => setFilters({ ...filters, q: event.target.value })}
          />
        </div>
        <label className="person-filter">
          <span className="sr-only">Filter by purchaser</span>
          <select
            value={filters.purchaserId}
            onChange={(event) => setFilters({ ...filters, purchaserId: event.target.value })}
          >
            <option value="">All purchasers</option>
            {purchasers.data?.data.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
                {person.archivedAt ? ' (archived)' : ''}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="filter-bottom">
        <div className="range-pills" aria-label="Date range">
          {[
            ['today', 'Today'],
            ['month', 'This month'],
            ['all', 'All time'],
            ['custom', 'Custom'],
          ].map(([value, label]) => (
            <button
              key={value}
              className={filters.preset === value ? 'selected' : ''}
              onClick={() => preset(value!)}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="timezone-label">
          <SlidersHorizontal size={13} /> Japan time · UTC+9
        </span>
      </div>
      {filters.preset === 'custom' && (
        <div className="custom-range">
          <label>
            From
            <input
              type="date"
              aria-label="From date"
              value={filters.from}
              onChange={(event) => setFilters({ ...filters, from: event.target.value })}
            />
          </label>
          <span>—</span>
          <label>
            To
            <input
              type="date"
              aria-label="To date"
              min={filters.from}
              value={filters.to}
              onChange={(event) => setFilters({ ...filters, to: event.target.value })}
            />
          </label>
        </div>
      )}
    </div>
  );
}
