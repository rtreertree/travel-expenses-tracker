export const TIMEZONE = 'Asia/Tokyo' as const;
const DAY_MS = 86_400_000;

export function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function isValidTimestamp(value: string): boolean {
  const match =
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|([+-])(\d{2}):(\d{2}))$/.exec(
      value,
    );
  if (!match || !isValidDate(match[1]!)) return false;
  const [, , hour, minute, second, , , offsetHour, offsetMinute] = match;
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return false;
  if (offsetHour && (Number(offsetHour) > 23 || Number(offsetMinute) > 59)) return false;
  return Number.isFinite(Date.parse(value));
}

function tokyoParts(value: Date | string): Record<string, string> {
  const date = typeof value === 'string' ? new Date(value) : value;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
}

export function tokyoDate(value: Date | string = new Date()): string {
  const parts = tokyoParts(value);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function tokyoDateTimeInput(value: Date | string = new Date()): string {
  const parts = tokyoParts(value);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function tokyoWallTimeToIso(value: string): string {
  const withSeconds = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? `${value}:00` : value;
  const explicitTokyoTime = `${withSeconds}+09:00`;
  if (!isValidTimestamp(explicitTokyoTime))
    throw new RangeError('Enter a valid Tokyo date and time.');
  return new Date(explicitTokyoTime).toISOString();
}

export function tokyoDateRange(filters: { from?: string; to?: string }): {
  from?: string;
  toExclusive?: string;
} {
  if (filters.from && !isValidDate(filters.from)) throw new RangeError('Invalid start date.');
  if (filters.to && !isValidDate(filters.to)) throw new RangeError('Invalid end date.');
  if (filters.from && filters.to && filters.from > filters.to)
    throw new RangeError('Start date must be before end date.');
  return {
    ...(filters.from ? { from: new Date(`${filters.from}T00:00:00+09:00`).toISOString() } : {}),
    ...(filters.to
      ? { toExclusive: new Date(Date.parse(`${filters.to}T00:00:00+09:00`) + DAY_MS).toISOString() }
      : {}),
  };
}

export function tokyoMonthRange(value: Date | string = new Date()): { from: string; to: string } {
  const today = tokyoDate(value);
  const first = `${today.slice(0, 7)}-01`;
  const firstInstant = new Date(`${first}T00:00:00Z`);
  firstInstant.setUTCMonth(firstInstant.getUTCMonth() + 1);
  firstInstant.setUTCDate(0);
  return { from: first, to: firstInstant.toISOString().slice(0, 10) };
}
