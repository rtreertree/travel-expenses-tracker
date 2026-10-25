import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowRight, BarChart3, Info } from 'lucide-react';
import type { Summary } from '../../../shared/types';
import { useApp } from '../../app/context';
import { api, queryString } from '../../lib/api';
import { money } from '../../lib/format';
import { FiltersBar } from '../../components/Filters';
import { SummaryCards } from '../../components/SummaryCards';
import { Empty, ErrorNotice, Loading } from '../../components/ui';

type ChartRow = { label: string; jpy: string; thb: string; value: number };
function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: ChartRow }>;
}) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return (
    <div className="chart-tooltip">
      <strong>{row.label}</strong>
      <span>
        {money(row.jpy, 'JPY')} · {money(row.thb, 'THB')}
      </span>
    </div>
  );
}
export function DashboardPage() {
  const { currency, filters, openPurchase } = useApp();
  const values = {
    from: filters.from,
    to: filters.to,
    purchaserId: filters.purchaserId,
    q: filters.q.trim(),
  };
  const summary = useQuery({
    queryKey: ['summary', values],
    queryFn: () => api<{ data: Summary }>(`/summary${queryString(values)}`),
  });
  const data = summary.data?.data;
  const key = currency === 'THB' ? 'thb' : 'jpy';
  // Number conversion happens only here, at the chart rendering boundary.
  const days: ChartRow[] =
    data?.byDay.map((day) => ({ ...day, label: day.date, value: Number(day[key]) })) ?? [];
  const people: ChartRow[] =
    data?.byPurchaser.map((person) => ({
      ...person,
      label: person.name,
      value: Number(person[key]),
    })) ?? [];
  const dateRange =
    filters.from || filters.to
      ? `${filters.from || 'Beginning'} → ${filters.to || 'Today and beyond'}`
      : 'All time';
  return (
    <>
      <FiltersBar />
      <div className="dashboard-range">
        <span>{dateRange}</span>
        <span>Asia/Tokyo · All matching purchases</span>
      </div>
      <SummaryCards summary={data} loading={summary.isPending} />
      {summary.isPending && <Loading label="Putting your spending story together…" />}
      {summary.error && (
        <ErrorNotice
          error={summary.error}
          retry={() => {
            void summary.refetch();
          }}
        />
      )}
      {data && data.count === 0 && (
        <section className="panel">
          <Empty
            title="A story waiting to be explored."
            action={
              <button className="button primary" onClick={() => openPurchase()}>
                Add a purchase
              </button>
            }
          >
            Your spending charts will appear here once you add purchases in this date range.
          </Empty>
        </section>
      )}
      {data && data.count > 0 && (
        <>
          <div className="chart-grid">
            <section className="panel chart-panel">
              <div className="panel-heading">
                <div>
                  <span className="tiny-label">THE DAILY PICTURE</span>
                  <h2>Spending by day</h2>
                </div>
                <span className="chart-unit">{currency}</span>
              </div>
              <p className="chart-caption">Each little adventure, day by day.</p>
              <div
                className="chart"
                role="img"
                aria-label={`Daily spending in ${currency}. See the daily spending table below for exact values.`}
              >
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart
                    data={days}
                    margin={{ left: 0, right: 10, top: 14, bottom: 0 }}
                    accessibilityLayer
                  >
                    <CartesianGrid vertical={false} stroke="#e9e9e2" strokeDasharray="3 4" />
                    <XAxis
                      dataKey="label"
                      tickFormatter={(value: string) => value.slice(5)}
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 11, fill: '#7c8078' }}
                      dy={10}
                      minTickGap={28}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 11, fill: '#7c8078' }}
                      width={54}
                    />
                    <Tooltip cursor={{ fill: '#f4f1e9' }} content={<ChartTooltip />} />
                    <Bar
                      isAnimationActive={false}
                      dataKey="value"
                      fill="#c25a46"
                      radius={[5, 5, 0, 0]}
                      maxBarSize={46}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <details className="chart-table">
                <summary>View daily spending table</summary>
                <div className="table-scroll">
                  <table>
                    <caption className="sr-only">Spending by Tokyo calendar day</caption>
                    <thead>
                      <tr>
                        <th scope="col">Tokyo date</th>
                        <th scope="col">Purchases</th>
                        <th scope="col">JPY</th>
                        <th scope="col">THB</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.byDay.map((day) => (
                        <tr key={day.date}>
                          <th scope="row">{day.date}</th>
                          <td>{day.count}</td>
                          <td>{money(day.jpy, 'JPY')}</td>
                          <td>{money(day.thb, 'THB')}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <th scope="row">Total</th>
                        <td>{data.count}</td>
                        <td>{money(data.totals.jpy, 'JPY')}</td>
                        <td>{money(data.totals.thb, 'THB')}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </details>
            </section>
            <section className="panel chart-panel">
              <div className="panel-heading">
                <div>
                  <span className="tiny-label">YOUR TRAVEL COMPANIONS</span>
                  <h2>Spending by purchaser</h2>
                </div>
                <BarChart3 size={20} />
              </div>
              <p className="chart-caption">Who paid, and how much. Everyone included.</p>
              <div
                className="chart"
                role="img"
                aria-label={`Purchaser spending in ${currency}. See the purchaser table below for exact values.`}
              >
                <ResponsiveContainer width="100%" height={Math.max(260, people.length * 50)}>
                  <BarChart
                    data={people}
                    layout="vertical"
                    margin={{ left: 4, right: 22, top: 14, bottom: 0 }}
                    accessibilityLayer
                  >
                    <CartesianGrid horizontal={false} stroke="#e9e9e2" strokeDasharray="3 4" />
                    <XAxis
                      type="number"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 11, fill: '#7c8078' }}
                    />
                    <YAxis
                      type="category"
                      dataKey="label"
                      width={92}
                      tickFormatter={(value: string) =>
                        Array.from(value).length > 10
                          ? `${Array.from(value).slice(0, 8).join('')}…`
                          : value
                      }
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 12, fill: '#424e42' }}
                    />
                    <Tooltip cursor={{ fill: '#f4f1e9' }} content={<ChartTooltip />} />
                    <Bar
                      isAnimationActive={false}
                      dataKey="value"
                      fill="#526b59"
                      radius={[0, 5, 5, 0]}
                      maxBarSize={30}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <details className="chart-table">
                <summary>View purchaser spending table</summary>
                <div className="table-scroll">
                  <table>
                    <caption className="sr-only">
                      Spending by purchaser, including archived purchasers
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Purchaser</th>
                        <th scope="col">Purchases</th>
                        <th scope="col">JPY</th>
                        <th scope="col">THB</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.byPurchaser.map((person) => (
                        <tr key={person.purchaserId}>
                          <th scope="row">{person.name}</th>
                          <td>{person.count}</td>
                          <td>{money(person.jpy, 'JPY')}</td>
                          <td>{money(person.thb, 'THB')}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <th scope="row">Total</th>
                        <td>{data.count}</td>
                        <td>{money(data.totals.jpy, 'JPY')}</td>
                        <td>{money(data.totals.thb, 'THB')}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </details>
            </section>
          </div>
          <div className="dashboard-note">
            <Info size={17} />
            <p>
              Every total uses the amounts saved with each purchase. Your current default exchange
              rate only applies to future purchases.
            </p>
            <Link to="/purchases">
              Explore these purchases
              <ArrowRight size={15} />
            </Link>
          </div>
        </>
      )}
    </>
  );
}
