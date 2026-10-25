import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { createApp } from '../../src/server';
import { createTestDatabase } from './database';
import type { Purchase, PurchaseLocation, Summary } from '../../src/shared/types';

let test: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof createApp>;
const env = {} as Env;
const me = '00000000-0000-4000-8000-000000000001';
function input(extra: Record<string, unknown> = {}): Record<string, unknown> & { id: string } {
  return {
    id: crypto.randomUUID(),
    name: 'Location fixture',
    price: 1500,
    exchangeRate: '0.23',
    ...extra,
  };
}
async function request(path: string, method = 'GET', body?: unknown) {
  return app.request(
    `https://ledger.test/api/v1${path}`,
    {
      method,
      ...(body === undefined
        ? {}
        : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    },
    env,
  );
}
async function resource<T>(path: string, method = 'GET', body?: unknown) {
  const response = await request(path, method, body);
  const json = (await response.json()) as { data: T; error?: { code: string } };
  return { response, ...json };
}
beforeAll(async () => {
  test = await createTestDatabase();
  app = createApp(() => test.database);
}, 30_000);
afterAll(async () => {
  await test.close();
});

describe('purchase location API and persistence', () => {
  it('creates text locations, generates safe map links, and supports minimal legacy input', async () => {
    const made = await resource<Purchase>(
      '/purchases',
      'POST',
      input({ location: '  浅草寺 Sensoji  ' }),
    );
    expect(made.response.status).toBe(201);
    expect(made.data.location).toMatchObject({
      text: '浅草寺 Sensoji',
      latitude: null,
      longitude: null,
    });
    expect(new URL(made.data.location!.googleMapsUrl).searchParams.get('query')).toBe(
      '浅草寺 Sensoji',
    );
    const old = await resource<Purchase>('/purchases', 'POST', input());
    expect(old.response.status).toBe(201);
    expect(old.data.location).toBeNull();
    expect(old.data.amountThb).toBe('345.00');
    const detail = await resource<Purchase>(`/purchases/${made.data.id}`);
    expect(detail.data.location).toEqual(made.data.location);
  });
  it('normalizes GPS aliases, top-level coordinates, zero coordinates and Maps URLs', async () => {
    const inputs = [
      { gps: { lat: 35.65858006, lng: 139.74543216 } },
      { latitude: 35.65858006, longitude: 139.74543216 },
      { location: '35.65858006, 139.74543216' },
      { location: { latitude: 35.65858006, longitude: 139.74543216 } },
    ];
    for (const extra of inputs) {
      const made = await resource<Purchase>('/purchases', 'POST', input(extra));
      expect(made.response.status).toBe(201);
      expect(made.data.location?.latitude).toBe(35.6585801);
      expect(made.data.location?.longitude).toBe(139.7454322);
      expect(made.data.location?.googleMapsUrl).toContain('query=35.6585801%2C139.7454322');
    }
    const zero = await resource<Purchase>('/purchases', 'POST', input({ gps: { lat: 0, lng: 0 } }));
    expect(zero.data.location?.latitude).toBe(0);
    expect(zero.data.location?.longitude).toBe(0);
    const url = await resource<Purchase>(
      '/purchases',
      'POST',
      input({ location: 'https://www.google.com/maps?q=35.6586,139.7454' }),
    );
    expect(url.response.status).toBe(201);
    expect(url.data.location?.latitude).toBe(35.6586);
  });
  it('accepts copied coordinate formats and preserves trusted shortlinks without following them', async () => {
    const forms = [
      [35.6586, 139.7454],
      'lat: 35.6586, lng: 139.7454',
      '35°39′30.96″N 139°44′43.44″E',
      'geo:35.6586,139.7454',
      'POINT (139.7454 35.6586)',
      { type: 'Point', coordinates: [139.7454, 35.6586] },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [139.7454, 35.6586] } },
      { coords: { latitude: 35.6586, longitude: 139.7454, accuracy: 15 } },
      'https://maps.apple.com/?ll=35.6586,139.7454',
      'https://www.openstreetmap.org/?mlat=35.6586&mlon=139.7454',
    ];
    for (const location of forms) {
      const made = await resource<Purchase>('/purchases', 'POST', input({ location }));
      expect(made.response.status).toBe(201);
      expect(made.data.location).toMatchObject({ latitude: 35.6586, longitude: 139.7454 });
      expect(new URL(made.data.location!.googleMapsUrl).hostname).toBe('www.google.com');
    }
    const short = 'https://maps.app.goo.gl/ExamplePlace';
    const made = await resource<Purchase>('/purchases', 'POST', input({ location: short }));
    expect(made.data.location?.googleMapsUrl).toBe(short);
    expect((await resource<Purchase>(`/purchases/${made.data.id}`)).data.location).toEqual(
      made.data.location,
    );
    const untrusted = await resource<Purchase>(
      '/purchases',
      'POST',
      input({ location: { text: 'Tokyo', googleMapsUrl: 'javascript:alert(1)' } }),
    );
    expect(untrusted.response.status).toBe(201);
    expect(untrusted.data.location?.googleMapsUrl).toContain('https://www.google.com/maps/search/');
    expect(
      (await request('/purchases', 'POST', input({ location: 'https://evil.example/35,139' })))
        .status,
    ).toBe(400);
  });
  it('merges a location label with GPS while rejecting contradictory or cleared coordinate sources', async () => {
    const body = input({ location: 'Tokyo Tower', gps: { lat: 35.6586, lng: 139.7454 } });
    const made = await resource<Purchase>('/purchases', 'POST', body);
    expect(made.response.status).toBe(201);
    expect(made.data.location).toMatchObject({
      text: 'Tokyo Tower',
      latitude: 35.6586,
      longitude: 139.7454,
    });
    expect(new URL(made.data.location!.googleMapsUrl).searchParams.get('query')).toBe(
      '35.6586,139.7454',
    );
    const { gps: oldGps, ...base } = body;
    void oldGps;
    const replay = await resource<Purchase>('/purchases', 'POST', {
      ...base,
      latitude: 35.6586,
      longitude: 139.7454,
    });
    expect(replay.response.status).toBe(200);
    expect(replay.data.location).toEqual(made.data.location);
    const edit = await resource<Purchase>(`/purchases/${made.data.id}`, 'PATCH', {
      location: 'Tokyo Station',
      latitude: 35.6812,
      longitude: 139.7671,
      version: 1,
    });
    expect(edit.response.status).toBe(200);
    expect(edit.data.location).toMatchObject({
      text: 'Tokyo Station',
      latitude: 35.6812,
      longitude: 139.7671,
    });
    for (const extra of [
      {
        location: { latitude: 35.6586, longitude: 139.7454 },
        gps: { lat: 35.6812, lng: 139.7671 },
      },
      { location: null, gps: { lat: 35.6586, lng: 139.7454 } },
      { location: '', latitude: 35.6586, longitude: 139.7454 },
      {
        location: 'Tokyo Tower',
        gps: { text: 'Tokyo Station', latitude: 35.6812, longitude: 139.7671 },
      },
    ])
      expect((await request('/purchases', 'POST', input(extra))).status).toBe(400);
  });
  it('supports editing, omission retention, explicit clearing, Trash and restore with saved location', async () => {
    const made = await resource<Purchase>(
      '/purchases',
      'POST',
      input({ location: 'Tokyo station' }),
    );
    const edited = await resource<Purchase>(`/purchases/${made.data.id}`, 'PATCH', {
      gps: { latitude: 35.6812, longitude: 139.7671 },
      version: 1,
    });
    expect(edited.response.status).toBe(200);
    expect(edited.data.location?.latitude).toBe(35.6812);
    const retained = await resource<Purchase>(`/purchases/${made.data.id}`, 'PATCH', {
      description: 'Retain map',
      version: 2,
    });
    expect(retained.data.location).toEqual(edited.data.location);
    const deletion = await request(`/purchases/${made.data.id}?version=3`, 'DELETE');
    expect(deletion.status).toBe(204);
    const trash = await resource<Purchase[]>('/purchases?status=deleted');
    expect(trash.data.find((p) => p.id === made.data.id)?.location).toEqual(edited.data.location);
    const restored = await resource<Purchase>(`/purchases/${made.data.id}/restore`, 'POST', {
      version: 4,
    });
    expect(restored.data.location).toEqual(edited.data.location);
    const cleared = await resource<Purchase>(`/purchases/${made.data.id}`, 'PATCH', {
      location: null,
      version: 5,
    });
    expect(cleared.data.location).toBeNull();
    expect(cleared.data.amountThb).toBe('345.00');
    expect(
      (
        await request(`/purchases/${made.data.id}`, 'PATCH', {
          location: 'Stale change',
          version: 5,
        })
      ).status,
    ).toBe(409);
  });
  it('includes normalized locations in retry identity while retaining old hashes', async () => {
    const body = input({ location: { latitude: 35.1, longitude: 139.2 } });
    const made = await resource<Purchase>('/purchases', 'POST', body);
    expect(made.response.status).toBe(201);
    const { location: omittedLocation, ...base } = body;
    void omittedLocation;
    const replay = await resource<Purchase>('/purchases', 'POST', {
      ...base,
      gps: { lat: 35.1, lng: 139.2 },
    });
    expect(replay.response.status).toBe(200);
    expect(replay.data.location).toEqual(made.data.location);
    const conflict = await resource('/purchases', 'POST', { ...body, location: 'Different place' });
    expect(conflict.error?.code).toBe('IDEMPOTENCY_CONFLICT');
    const legacy = {
      id: '00000000-0000-4000-8000-000000000099',
      name: 'Legacy retry',
      originalAmount: '1500',
      originalCurrency: 'JPY',
      purchaserId: me,
      exchangeRate: '0.23',
    };
    await test.database.query(
      sql`INSERT INTO purchases(id,name,purchaser_id,original_currency,original_amount,thb_per_jpy,rate_source,amount_jpy,amount_thb,purchased_at,create_request_hash) VALUES (${legacy.id}::uuid,${legacy.name},${me}::uuid,'JPY',1500,0.23,'manual',1500,345,now(),'ed90a5debbbe8e955dfa1bac1ab9ab6981d485e9e3cfd743584f56848ec52cac')`,
    );
    expect((await resource<Purchase>('/purchases', 'POST', legacy)).response.status).toBe(200);
    const nullReplay = await resource<Purchase>('/purchases', 'POST', {
      ...legacy,
      location: null,
    });
    expect(nullReplay.response.status).toBe(200);
    expect(nullReplay.data.location).toBeNull();
  });
  it('rejects malformed coordinates instead of persisting partial or out-of-range GPS', async () => {
    for (const extra of [
      { latitude: 91, longitude: 0 },
      { latitude: 0, longitude: -181 },
      { latitude: 35 },
      { gps: { lat: 'NaN', lng: 139 } },
      { gps: { lat: 35, lng: 'Infinity' } },
      { location: { latitude: 35, longitude: null } },
    ]) {
      const response = await resource('/purchases', 'POST', input(extra));
      expect(response.response.status).toBe(400);
      expect(response.error?.code).toBe('VALIDATION_ERROR');
    }
    const made = await resource<Purchase>('/purchases', 'POST', input());
    expect(
      (
        await request(`/purchases/${made.data.id}`, 'PATCH', {
          latitude: 'not a number',
          longitude: 139,
          version: 1,
        })
      ).status,
    ).toBe(400);
  });
  it('returns locations on lists and finds place names using the same summary filters', async () => {
    const label = `Unique place 日本 ${crypto.randomUUID()}`;
    const made = await resource<Purchase>(
      '/purchases',
      'POST',
      input({ name: 'Unrelated purchase title', location: label }),
    );
    const list = await resource<Purchase[]>('/purchases?q=' + encodeURIComponent(label));
    expect(list.data).toHaveLength(1);
    expect(list.data[0]?.location).toEqual(made.data.location);
    const summary = await resource<Summary>('/summary?q=' + encodeURIComponent(label));
    expect(summary.data.count).toBe(1);
    expect(summary.data.totals).toEqual({ jpy: '1500', thb: '345.00' });
    await request(`/purchases/${made.data.id}`, 'PATCH', { location: 'Changed place', version: 1 });
    expect((await resource<Summary>('/summary?q=' + encodeURIComponent(label))).data.count).toBe(0);
    expect((await resource<Purchase>(`/purchases/${made.data.id}`)).data.amountThb).toBe('345.00');
  });
  it('validates JSONB shape in PostgreSQL while leaving old ledger rows unchanged', async () => {
    const legacy = new PGlite();
    try {
      for (const file of ['0000_strange_champions.sql', '0001_seed_and_guard.sql'])
        await legacy.exec(await readFile('drizzle/' + file, 'utf8'));
      await legacy.exec(
        `INSERT INTO purchases(id,name,purchaser_id,original_currency,original_amount,thb_per_jpy,rate_source,amount_jpy,amount_thb,purchased_at,create_request_hash) VALUES ('00000000-0000-4000-8000-000000000099','Old row','${me}','JPY',1500,0.23,'manual',1500,345,now(),'${'a'.repeat(64)}')`,
      );
      await legacy.exec(await readFile('drizzle/0002_special_mesmero.sql', 'utf8'));
      const old = await legacy.query<{ location: PurchaseLocation | null; amount_thb: string }>(
        'SELECT location,amount_thb FROM purchases',
      );
      expect(old.rows[0]).toEqual({ location: null, amount_thb: '345.00' });
      for (const location of [
        {},
        { text: null, latitude: 35, longitude: null, googleMapsUrl: 'https://www.google.com/maps' },
        {
          text: 'Place',
          latitude: 91,
          longitude: 139,
          googleMapsUrl: 'https://www.google.com/maps',
        },
      ]) {
        await expect(
          legacy.query('UPDATE purchases SET location=$1::jsonb', [JSON.stringify(location)]),
        ).rejects.toThrow();
      }
    } finally {
      await legacy.close();
    }
  });
});
