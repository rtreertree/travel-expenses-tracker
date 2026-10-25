import { describe, expect, it } from 'vitest';
import {
  isValidDate,
  isValidTimestamp,
  tokyoDate,
  tokyoDateRange,
  tokyoDateTimeInput,
  tokyoMonthRange,
  tokyoWallTimeToIso,
} from '../../src/shared/time';

describe('explicit Tokyo time handling', () => {
  it('groups instants after 15:00 UTC into the next Tokyo day', () => {
    expect(tokyoDate('2026-10-25T15:30:00Z')).toBe('2026-10-26');
    expect(tokyoDateTimeInput('2026-10-25T15:30:00Z')).toBe('2026-10-26T00:30');
  });

  it('interprets custom time in Tokyo independent of device timezone', () => {
    expect(tokyoWallTimeToIso('2026-10-25T14:30')).toBe('2026-10-25T05:30:00.000Z');
    expect(tokyoDateTimeInput(tokyoWallTimeToIso('2026-10-25T14:30'))).toBe('2026-10-25T14:30');
  });

  it('builds an inclusive date interval using an exclusive next-day instant', () => {
    expect(tokyoDateRange({ from: '2026-10-25', to: '2026-10-25' })).toEqual({
      from: '2026-10-24T15:00:00.000Z',
      toExclusive: '2026-10-25T15:00:00.000Z',
    });
    expect(tokyoDateRange({})).toEqual({});
  });

  it('rejects invalid dates, clock times, and timestamps without offsets', () => {
    for (const invalid of ['2026-02-29', '2026-04-31', '0000-01-01', '2026-1-01']) {
      expect(isValidDate(invalid), invalid).toBe(false);
    }
    expect(isValidDate('2024-02-29')).toBe(true);
    for (const invalid of [
      '2026-02-29T14:30:00Z',
      '2026-10-25T24:30:00Z',
      '2026-10-25T14:30:00',
      '2026-10-25T14:30:60Z',
      '2026-10-25T14:30:00+24:00',
    ])
      expect(isValidTimestamp(invalid), invalid).toBe(false);
    expect(isValidTimestamp('2026-10-25T14:30:00+09:00')).toBe(true);
    expect(() => tokyoWallTimeToIso('2026-02-29T14:30')).toThrow();
    expect(() => tokyoDateRange({ from: '2026-11-01', to: '2026-10-25' })).toThrow();
  });

  it('calculates Tokyo month presets, including leap years and year end', () => {
    expect(tokyoMonthRange('2026-10-31T15:30:00Z')).toEqual({
      from: '2026-11-01',
      to: '2026-11-30',
    });
    expect(tokyoMonthRange('2024-02-15T00:00:00Z')).toEqual({
      from: '2024-02-01',
      to: '2024-02-29',
    });
    expect(tokyoMonthRange('2026-12-15T00:00:00Z')).toEqual({
      from: '2026-12-01',
      to: '2026-12-31',
    });
  });
});
