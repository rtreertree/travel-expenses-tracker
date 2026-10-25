import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createApp } from '../../src/server';
import { createTestDatabase } from './database';
import type { Purchase, Purchaser } from '../../src/shared/types';

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof createApp>;
const me = '00000000-0000-4000-8000-000000000001';
async function create(body: unknown) {
  const response = await app.request(
    'https://ledger.test/api/v1/purchases',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    {} as Env,
  );
  const payload = (await response.json()) as { data: Purchase; error?: { code: string } };
  return { response, ...payload };
}
beforeAll(async () => {
  database = await createTestDatabase();
  app = createApp(() => database.database);
  await database.database.query(sql`UPDATE app_settings SET default_thb_per_jpy=0.23 WHERE id=1`);
}, 30_000);
afterAll(async () => {
  await database.close();
});

describe('simple purchase creation', () => {
  it('needs only a name and numeric yen price, resolving Me and configured defaults', async () => {
    const before = Date.now();
    const result = await create({ name: 'Lunch', price: 1500 });
    expect(result.response.status).toBe(201);
    expect(result.data).toMatchObject({
      name: 'Lunch',
      originalAmount: '1500',
      originalCurrency: 'JPY',
      amountJpy: '1500',
      amountThb: '345.00',
      purchaserId: me,
      purchaser: { name: 'Me' },
      description: '',
      rateSource: 'default',
      exchangeRate: '0.23000000',
      version: 1,
    });
    expect(result.data.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Date.parse(result.data.purchasedAt)).toBeGreaterThanOrEqual(before - 1000);
    expect(Date.parse(result.data.purchasedAt)).toBeLessThanOrEqual(Date.now());
  });

  it('matches purchaser names case-insensitively, trims them, and accepts string prices', async () => {
    for (const purchaser of ['a', 'A', '  a  ']) {
      const result = await create({ name: 'Tea', price: '100', purchaser });
      expect(result.response.status).toBe(201);
      expect(result.data.purchaser).toMatchObject({
        name: 'A',
        id: '00000000-0000-4000-8000-000000000002',
      });
    }
    const meResult = await create({ name: 'Coffee', price: 500, purchaser: 'mE' });
    expect(meResult.data.purchaserId).toBe(me);
  });

  it('uses current purchaser names and rejects missing or archived names without creating people', async () => {
    const person = await app.request(
      'https://ledger.test/api/v1/purchasers',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Travel Buddy' }),
      },
      {} as Env,
    );
    const { data } = (await person.json()) as { data: Purchaser };
    const named = await create({ name: 'Train', price: 1200, purchaser: 'tRaVeL bUdDy' });
    expect(named.data.purchaserId).toBe(data.id);
    await database.database.query(
      sql`UPDATE purchasers SET archived_at=now() WHERE id=${data.id}::uuid`,
    );
    expect(
      (await create({ name: 'Train', price: 1200, purchaser: 'travel buddy' })).error?.code,
    ).toBe('PURCHASER_UNAVAILABLE');
    expect(
      (await create({ name: 'Train', price: 1200, purchaser: 'Unknown person' })).error?.code,
    ).toBe('PURCHASER_UNAVAILABLE');
    const count = await database.database.query(sql`SELECT count(*)::int AS count FROM purchasers`);
    expect(count[0]?.count).toBe(4);
  });

  it('supports optional UUID retry identity and case/price normalization without resolving defaults again', async () => {
    const id = crypto.randomUUID();
    const body = { id, name: 'Snack', price: 100, purchaser: 'a' };
    const first = await create(body);
    expect(first.response.status).toBe(201);
    await database.database.query(sql`UPDATE app_settings SET default_thb_per_jpy=0.5 WHERE id=1`);
    const replay = await create({ ...body, price: '0100', purchaser: 'A' });
    expect(replay.response.status).toBe(200);
    expect(replay.data.amountThb).toBe('23.00');
    expect(replay.data.purchasedAt).toBe(first.data.purchasedAt);
    expect((await create({ ...body, price: 101 })).error?.code).toBe('IDEMPOTENCY_CONFLICT');
    await database.database.query(sql`UPDATE app_settings SET default_thb_per_jpy=0.23 WHERE id=1`);
  });

  it('preserves the detailed UI contract and allows originalAmount with omitted currency/purchaser', async () => {
    const legacy = await create({
      id: crypto.randomUUID(),
      name: 'Legacy THB',
      originalAmount: '100.00',
      originalCurrency: 'THB',
      purchaserId: me,
    });
    expect(legacy.response.status).toBe(201);
    expect(legacy.data.amountJpy).toBe('435');
    const simpler = await create({ name: 'Yen amount', originalAmount: '1000' });
    expect(simpler.response.status).toBe(201);
    expect(simpler.data.originalCurrency).toBe('JPY');
    expect(simpler.data.purchaserId).toBe(me);
  });

  it('rejects invalid/ambiguous fields with JSON validation errors', async () => {
    for (const body of [
      { name: 'Missing price' },
      { price: 1 },
      { name: 'Zero', price: 0 },
      { name: 'Negative', price: -1 },
      { name: 'Fractional', price: 1.5 },
      { name: 'Fractional string', price: '1.50' },
      { name: 'Exponent', price: '1e3' },
      { name: 'Too large', price: 1_000_000_000 },
      { name: 'Null', price: null },
      { name: 'Two amounts', price: 1, originalAmount: '1' },
      { name: 'THB price', price: 1, originalCurrency: 'THB' },
      { name: 'Two purchasers', price: 1, purchaser: 'Me', purchaserId: me },
      { name: 'Null purchaser', price: 1, purchaser: null },
    ]) {
      const result = await create(body);
      expect(result.response.status, JSON.stringify(body)).toBe(400);
      expect(result.error?.code).toBe('VALIDATION_ERROR');
    }
  });

  it('requires a configured rate or an optional manual rate and never selects an archived default', async () => {
    await database.database.query(sql`UPDATE app_settings SET default_thb_per_jpy=NULL WHERE id=1`);
    expect((await create({ name: 'No rate', price: 100 })).error?.code).toBe('RATE_NOT_CONFIGURED');
    const manual = await create({ name: 'Manual rate', price: 100, exchangeRate: '0.3' });
    expect(manual.data).toMatchObject({ amountThb: '30.00', rateSource: 'manual' });
    await database.database.query(
      sql`UPDATE purchasers SET archived_at=now() WHERE id=${me}::uuid`,
    );
    expect((await create({ name: 'No Me', price: 100, exchangeRate: '0.3' })).error?.code).toBe(
      'PURCHASER_UNAVAILABLE',
    );
  });
});
