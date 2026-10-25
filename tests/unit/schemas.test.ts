import { describe, expect, it } from 'vitest';
import {
  canonicalCreationInput,
  createPurchaseSchema,
  hashCreateRequest,
  listFiltersSchema,
  patchPurchaseSchema,
  purchaserCreateSchema,
  purchaserPatchSchema,
  rateSchema,
  settingsPatchSchema,
  summaryFiltersSchema,
} from '../../src/shared/schemas';

const valid = {
  id: '4903709b-cea6-4cb8-9ff4-6362805444db',
  name: '  ラーメン  ',
  originalAmount: '1500',
  originalCurrency: 'JPY' as const,
  purchaserId: '93149f36-6aae-4489-8bb2-1ece7351caaf',
};

describe('strict API input validation', () => {
  it('normalizes names, decimals, and explicit timestamps', () => {
    expect(
      createPurchaseSchema.parse({
        ...valid,
        exchangeRate: '00.2300',
        purchasedAt: '2026-10-25T14:30:00+09:00',
      }),
    ).toMatchObject({
      name: 'ラーメン',
      description: '',
      originalAmount: '1500',
      exchangeRate: '0.23000000',
      purchasedAt: '2026-10-25T05:30:00.000Z',
    });
    expect(
      createPurchaseSchema.parse({ ...valid, originalCurrency: 'THB', originalAmount: '0100.0' })
        .originalAmount,
    ).toBe('100.00');
  });

  it('leaves omitted server-time and default-rate fields unresolved', () => {
    const parsed = createPurchaseSchema.parse(valid);
    expect(parsed).not.toHaveProperty('purchasedAt');
    expect(parsed).not.toHaveProperty('exchangeRate');
  });

  it.each([
    '-1',
    '0',
    'NaN',
    'Infinity',
    '1e2',
    '1,000',
    '.1',
    '1.',
    '1.001',
    '1000000000',
    ' 100',
  ])('rejects invalid amount %s', (originalAmount) => {
    expect(
      createPurchaseSchema.safeParse({ ...valid, originalCurrency: 'THB', originalAmount }).success,
    ).toBe(false);
  });

  it.each(['0', '-1', '100.00000001', '0.123456789', 'NaN', 'Infinity', '1e-2', '1,0', '.23'])(
    'rejects invalid exchange rate %s',
    (rate) => {
      expect(rateSchema.safeParse(rate).success).toBe(false);
    },
  );

  it('rejects fractional yen, null optional values, derived values, and unknown fields', () => {
    for (const extra of [
      { originalAmount: '1.1' },
      { purchasedAt: null },
      { exchangeRate: null },
      { description: null },
      { amountJpy: '1' },
      { amountThb: '1' },
      { unexpected: true },
    ])
      expect(createPurchaseSchema.safeParse({ ...valid, ...extra }).success).toBe(false);
  });

  it('accepts amount and rate extremes while rejecting oversized text', () => {
    expect(
      createPurchaseSchema.safeParse({
        ...valid,
        originalAmount: '999999999',
        exchangeRate: '0.00000001',
      }).success,
    ).toBe(true);
    expect(
      createPurchaseSchema.safeParse({
        ...valid,
        originalCurrency: 'THB',
        originalAmount: '999999999.99',
        exchangeRate: '100',
      }).success,
    ).toBe(true);
    expect(
      createPurchaseSchema.safeParse({ ...valid, description: 'a'.repeat(4_001) }).success,
    ).toBe(false);
    expect(createPurchaseSchema.safeParse({ ...valid, name: ' ' }).success).toBe(false);
  });

  it('requires optimistic versions and meaningful patch fields', () => {
    expect(patchPurchaseSchema.safeParse({ name: 'Tea' }).success).toBe(false);
    expect(patchPurchaseSchema.safeParse({ version: 1 }).success).toBe(false);
    expect(patchPurchaseSchema.safeParse({ version: 1, originalCurrency: 'THB' }).success).toBe(
      false,
    );
    expect(patchPurchaseSchema.safeParse({ version: 1, name: 'Tea' }).success).toBe(true);
    expect(patchPurchaseSchema.safeParse({ version: 1, originalAmount: '0.01' }).success).toBe(
      true,
    );
    expect(settingsPatchSchema.safeParse({ version: 0, defaultThbPerJpy: '0.23' }).success).toBe(
      false,
    );
    expect(settingsPatchSchema.safeParse({ version: 1, defaultThbPerJpy: null }).success).toBe(
      false,
    );
    expect(purchaserPatchSchema.safeParse({ version: 1, archived: false }).success).toBe(true);
    expect(purchaserPatchSchema.safeParse({ version: 1 }).success).toBe(false);
    expect(purchaserCreateSchema.parse({ name: '  ฉัน  ' }).name).toBe('ฉัน');
  });

  it('validates filter calendars, ordering, bounds, and unknown parameters', () => {
    expect(listFiltersSchema.parse({})).toEqual({ status: 'active', limit: 50 });
    expect(listFiltersSchema.parse({ limit: '100', q: ' tea ' })).toEqual({
      status: 'active',
      limit: 100,
      q: 'tea',
    });
    for (const query of [
      { limit: '101' },
      { limit: '1.5' },
      { limit: '1e1' },
      { from: '2026-02-29' },
      { from: '2026-11-01', to: '2026-10-31' },
      { purchaserId: 'no' },
      { q: 'a'.repeat(101) },
      { unknown: 'x' },
    ])
      expect(listFiltersSchema.safeParse(query).success).toBe(false);
    expect(summaryFiltersSchema.safeParse({ status: 'deleted' }).success).toBe(false);
    expect(summaryFiltersSchema.safeParse({ limit: '5' }).success).toBe(false);
  });
});

describe('canonical creation identity', () => {
  it('equates key ordering, trimmed names, decimal spelling, and timestamp offsets', async () => {
    const first = {
      ...valid,
      originalCurrency: 'THB' as const,
      originalAmount: '0100.0',
      exchangeRate: '00.2300',
      purchasedAt: '2026-10-25T14:30:00+09:00',
    };
    const second = {
      purchasedAt: '2026-10-25T05:30:00Z',
      exchangeRate: '0.23000000',
      originalAmount: '100.00',
      originalCurrency: 'THB' as const,
      name: 'ラーメン',
      id: valid.id,
      purchaserId: valid.purchaserId,
      description: '',
    };
    expect(canonicalCreationInput(first)).toBe(canonicalCreationInput(second));
    expect(await hashCreateRequest(first)).toBe(await hashCreateRequest(second));
    expect(await hashCreateRequest(first)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('distinguishes omitted defaults from explicit rate and time', async () => {
    const omitted = await hashCreateRequest(valid);
    expect(await hashCreateRequest({ ...valid, exchangeRate: '0.23' })).not.toBe(omitted);
    expect(await hashCreateRequest({ ...valid, purchasedAt: '2026-10-25T05:30:00Z' })).not.toBe(
      omitted,
    );
    expect(await hashCreateRequest({ ...valid, name: 'Tea' })).not.toBe(omitted);
  });
});
