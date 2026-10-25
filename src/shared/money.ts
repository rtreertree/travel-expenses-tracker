import Decimal from 'decimal.js';
import type { Currency } from './types';

// A private constructor keeps unrelated Decimal consumers from changing money rules.
const MoneyDecimal = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export const MAX_ORIGINAL_AMOUNT = '999999999.99';
export const MAX_EXCHANGE_RATE = '100';

export function normalizeAmount(amount: string, currency: Currency): string {
  return new MoneyDecimal(amount).toFixed(currency === 'JPY' ? 0 : 2);
}

export function normalizeRate(rate: string): string {
  return new MoneyDecimal(rate).toFixed(8);
}

/** Call after schema validation; no floating point arithmetic touches money. */
export function calculateAmounts(currency: Currency, amount: string, rate: string) {
  const original = new MoneyDecimal(amount);
  const exchange = new MoneyDecimal(rate);
  if (!original.isFinite() || original.lte(0) || !exchange.isFinite() || exchange.lte(0)) {
    throw new RangeError('A positive amount and exchange rate are required.');
  }
  return currency === 'JPY'
    ? { amountJpy: original.toFixed(0), amountThb: original.times(exchange).toFixed(2) }
    : { amountJpy: original.div(exchange).toFixed(0), amountThb: original.toFixed(2) };
}

export const calculateMoney = calculateAmounts;

/** Aggregate already rounded persisted values, never reconvert a total. */
export function sumMoney(values: Iterable<string>, currency: Currency): string {
  let total = new MoneyDecimal(0);
  for (const value of values) total = total.plus(value);
  return total.toFixed(currency === 'JPY' ? 0 : 2);
}

export function isPositiveDecimalInRange(value: string, maximum: string): boolean {
  try {
    const decimal = new MoneyDecimal(value);
    return decimal.isFinite() && decimal.gt(0) && decimal.lte(maximum);
  } catch {
    return false;
  }
}
