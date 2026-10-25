import { describe, expect, it } from 'vitest';
import { calculateAmounts, normalizeRate, sumMoney } from '../../src/shared/money';

describe('persisted currency conversion', () => {
  it('converts yen to baht exactly', () => {
    expect(calculateAmounts('JPY', '1500', '0.23000000')).toEqual({
      amountJpy: '1500',
      amountThb: '345.00',
    });
  });

  it('preserves the baht input despite yen rounding loss', () => {
    expect(calculateAmounts('THB', '100.00', '0.23000000')).toEqual({
      amountJpy: '435',
      amountThb: '100.00',
    });
    expect(calculateAmounts('JPY', '435', '0.23').amountThb).toBe('100.05');
  });

  it('uses half-up rounding at both currency boundaries', () => {
    expect(calculateAmounts('JPY', '1', '0.235').amountThb).toBe('0.24');
    expect(calculateAmounts('THB', '0.50', '1').amountJpy).toBe('1');
    expect(calculateAmounts('THB', '0.49', '1').amountJpy).toBe('0');
  });

  it('permits a zero converted value with positive original input', () => {
    expect(calculateAmounts('JPY', '1', '0.00000001')).toEqual({
      amountJpy: '1',
      amountThb: '0.00',
    });
    expect(calculateAmounts('THB', '0.01', '100')).toEqual({ amountJpy: '0', amountThb: '0.01' });
  });

  it('accommodates the full allowed range without precision loss', () => {
    expect(calculateAmounts('THB', '999999999.99', '0.00000001')).toEqual({
      amountJpy: '99999999999000000',
      amountThb: '999999999.99',
    });
    expect(calculateAmounts('JPY', '999999999', '100')).toEqual({
      amountJpy: '999999999',
      amountThb: '99999999900.00',
    });
  });

  it('sums persisted values without binary floating point or re-conversion', () => {
    expect(sumMoney(['0.10', '0.20', '100.00'], 'THB')).toBe('100.30');
    expect(sumMoney(['99999999999000000', '1'], 'JPY')).toBe('99999999999000001');
    expect(sumMoney([], 'THB')).toBe('0.00');
  });

  it('normalizes rates to the database scale', () => {
    expect(normalizeRate('000.230')).toBe('0.23000000');
  });
});
