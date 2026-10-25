import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createApp } from '../../src/server';
import { createTestDatabase } from './database';
import type { Purchase, Purchaser, Settings, Summary } from '../../src/shared/types';

let test: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof createApp>;
const env = {} as Env;
const me = '00000000-0000-4000-8000-000000000001';
function input(extra: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    name: 'Ramen ラーメン',
    originalAmount: '1500',
    originalCurrency: 'JPY',
    purchaserId: me,
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
describe('isolated PostgreSQL API', () => {
  it('has liveness and JSON unknown routes', async () => {
    expect((await request('/health')).status).toBe(200);
    const r = await request('/missing');
    expect(r.status).toBe(404);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe('NOT_FOUND');
  });
  it('starts without an invented rate and allows explicit rate creation', async () => {
    const settings = await resource<Settings>('/settings');
    expect(settings.data.defaultThbPerJpy).toBeNull();
    const failed = await resource('/purchases', 'POST', input());
    expect(failed.error?.code).toBe('RATE_NOT_CONFIGURED');
    const made = await resource<Purchase>('/purchases', 'POST', input({ exchangeRate: '0.23' }));
    expect(made.response.status).toBe(201);
    expect(made.data.amountThb).toBe('345.00');
    expect(made.data.exchangeRate).toBe('0.23000000');
  });
  it('sets rates with version predicates, preserves snapshots and round trips original THB', async () => {
    const configured = await resource<Settings>('/settings', 'PATCH', {
      defaultThbPerJpy: '0.23',
      version: 1,
    });
    expect(configured.data.version).toBe(2);
    expect(
      (await request('/settings', 'PATCH', { defaultThbPerJpy: '0.5', version: 1 })).status,
    ).toBe(409);
    const made = await resource<Purchase>(
      '/purchases',
      'POST',
      input({ originalAmount: '100.00', originalCurrency: 'THB' }),
    );
    expect(made.data.amountJpy).toBe('435');
    expect(made.data.amountThb).toBe('100.00');
    await request('/settings', 'PATCH', { defaultThbPerJpy: '0.3', version: 2 });
    const changed = await resource<Purchase>(`/purchases/${made.data.id}`, 'PATCH', {
      name: 'Renamed',
      version: 1,
    });
    expect(changed.data.amountThb).toBe('100.00');
    expect(changed.data.exchangeRate).toBe('0.23000000');
    expect(changed.data.version).toBe(2);
  });
  it('is safe under simultaneous duplicate submissions and creation replay after edits', async () => {
    const body = input();
    const responses = await Promise.all([
      request('/purchases', 'POST', body),
      request('/purchases', 'POST', body),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 201]);
    const count = await test.database.query(
      sql`SELECT count(*)::int AS count FROM purchases WHERE id=${body.id}::uuid`,
    );
    expect(count[0]?.count).toBe(1);
    await request(`/purchases/${body.id}`, 'PATCH', { name: 'Changed later', version: 1 });
    await request('/settings', 'PATCH', { defaultThbPerJpy: '0.4', version: 3 });
    const replay = await resource<Purchase>('/purchases', 'POST', body);
    expect(replay.response.status).toBe(200);
    expect(replay.data.name).toBe('Changed later');
    expect(replay.data.exchangeRate).toBe('0.30000000');
    expect((await resource('/purchases', 'POST', { ...body, name: 'Different' })).error?.code).toBe(
      'IDEMPOTENCY_CONFLICT',
    );
    await request(`/purchases/${body.id}?version=2`, 'DELETE');
    expect((await resource('/purchases', 'POST', body)).error?.code).toBe('PURCHASE_DELETED');
  });
  it('rejects stale edits and preserves recoverable deletion', async () => {
    const made = await resource<Purchase>('/purchases', 'POST', input());
    const edits = await Promise.all([
      request(`/purchases/${made.data.id}`, 'PATCH', { name: 'First editor', version: 1 }),
      request(`/purchases/${made.data.id}`, 'PATCH', { description: 'Second editor', version: 1 }),
    ]);
    expect(edits.map((r) => r.status).sort()).toEqual([200, 409]);
    const before = await resource<Summary>('/summary');
    expect((await request(`/purchases/${made.data.id}?version=2`, 'DELETE')).status).toBe(204);
    const after = await resource<Summary>('/summary');
    expect(after.data.count).toBe(before.data.count - 1);
    const detail = await resource<Purchase>(`/purchases/${made.data.id}`);
    expect(detail.data.deletedAt).not.toBeNull();
    const restored = await resource<Purchase>(`/purchases/${made.data.id}/restore`, 'POST', {
      version: 3,
    });
    expect(restored.data.version).toBe(4);
    expect(restored.data.amountThb).toBe(made.data.amountThb);
  });
  it('archives and renames purchasers without losing history, rejects new assignments', async () => {
    const u = await resource<Purchaser>('/purchasers', 'POST', { name: '旅行者' });
    const p = await resource<Purchase>('/purchases', 'POST', input({ purchaserId: u.data.id }));
    await request(`/purchasers/${u.data.id}`, 'PATCH', {
      archived: true,
      name: '旅行者 ใหม่',
      version: 1,
    });
    expect(
      (await resource('/purchases', 'POST', input({ purchaserId: u.data.id }))).error?.code,
    ).toBe('PURCHASER_UNAVAILABLE');
    expect(
      (
        await request(`/purchases/${p.data.id}`, 'PATCH', {
          description: 'Still editable',
          version: 1,
        })
      ).status,
    ).toBe(200);
    const detail = await resource<Purchase>(`/purchases/${p.data.id}`);
    expect(detail.data.purchaser.archived).toBe(true);
    expect(detail.data.purchaser.name).toBe('旅行者 ใหม่');
    expect((await request('/purchasers', 'POST', { name: '旅行者 ใหม่' })).status).toBe(409);
    await request(`/purchasers/${u.data.id}`, 'PATCH', { archived: false, version: 2 });
    expect((await request('/purchases', 'POST', input({ purchaserId: u.data.id }))).status).toBe(
      201,
    );
  });
  it('groups Tokyo days and inclusive dates; pagination uses equal timestamp plus UUID', async () => {
    const label = `page-${crypto.randomUUID()}`;
    for (let i = 0; i < 4; i++)
      await request(
        '/purchases',
        'POST',
        input({ name: label, purchasedAt: '2026-10-25T15:30:00Z', exchangeRate: '0.23' }),
      );
    const first = await request(`/purchases?q=${label}&limit=2`);
    const a = (await first.json()) as { data: Purchase[]; page: { nextCursor: string } };
    expect(a.data).toHaveLength(2);
    const b = await request(`/purchases?q=${label}&limit=2&cursor=${a.page.nextCursor}`);
    const page = (await b.json()) as { data: Purchase[]; page: { nextCursor: null } };
    expect(new Set([...a.data, ...page.data].map((p) => p.id)).size).toBe(4);
    expect(page.page.nextCursor).toBeNull();
    expect((await request(`/purchases?q=changed&cursor=${a.page.nextCursor}`)).status).toBe(400);
    const summary = await resource<Summary>(`/summary?q=${label}&from=2026-10-26&to=2026-10-26`);
    expect(summary.data.count).toBe(4);
    expect(summary.data.byDay[0]?.date).toBe('2026-10-26');
    expect(summary.data.totals.thb).toBe('1380.00');
    expect((await resource<Summary>(`/summary?q=${label}&to=2026-10-25`)).data.count).toBe(0);
  });
  it('treats SQL wildcard and injection-like searches literally', async () => {
    const name = "100%_ ramen ' OR 1=1 --";
    await request('/purchases', 'POST', input({ name }));
    expect((await resource<Summary>('/summary?q=' + encodeURIComponent('%_'))).data.count).toBe(1);
    expect(
      (await resource<Summary>('/summary?q=' + encodeURIComponent("' OR 1=1 --"))).data.count,
    ).toBe(1);
  });
  it('rejects malformed input, unknown fields and cross-origin mutation', async () => {
    expect((await request('/purchases', 'POST', input({ amountJpy: '7' }))).status).toBe(400);
    expect(
      (await request('/purchases', 'POST', input({ purchasedAt: '2026-02-30T00:00:00Z' }))).status,
    ).toBe(400);
    expect((await request('/purchases?limit=1&limit=2')).status).toBe(400);
    expect((await request('/summary?status=deleted')).status).toBe(400);
    expect(
      (
        await app.request(
          'https://ledger.test/api/v1/settings',
          {
            method: 'PATCH',
            headers: { Origin: 'https://foreign.test', 'Content-Type': 'application/json' },
            body: '{}',
          },
          env,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await app.request(
          'https://ledger.test/api/v1/settings',
          { method: 'PATCH', headers: { 'Content-Type': 'text/plain' }, body: '{}' },
          env,
        )
      ).status,
    ).toBe(415);
    expect(
      (
        await app.request(
          'https://ledger.test/api/v1/settings',
          { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{' },
          env,
        )
      ).status,
    ).toBe(400);
    expect(
      (await request('/purchases', 'POST', input({ description: 'x'.repeat(17000) }))).status,
    ).toBe(413);
  });
  it('protects immutable hashes and database conversion constraints', async () => {
    const made = await resource<Purchase>('/purchases', 'POST', input());
    await expect(
      test.database.query(
        sql`UPDATE purchases SET create_request_hash=${'a'.repeat(64)} WHERE id=${made.data.id}::uuid`,
      ),
    ).rejects.toThrow();
    await expect(
      test.database.query(sql`UPDATE purchases SET amount_jpy=1 WHERE id=${made.data.id}::uuid`),
    ).rejects.toThrow();
  });
  it('returns a retryable JSON error on database network failures', async () => {
    const broken = createApp(() => ({
      query: async () => {
        throw new TypeError('private connection must never leak');
      },
    }));
    const response = await broken.request('https://ledger.test/api/v1/settings', {}, env);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('private connection');
  });
  it('keeps Unicode and submillisecond timestamps safe across cursor pages', async () => {
    const label = `日本 ไทย ${crypto.randomUUID()}`;
    for (const purchasedAt of [
      '2026-10-25T01:00:00.123001Z',
      '2026-10-25T01:00:00.123002Z',
      '2026-10-25T01:00:00.123003Z',
    ]) {
      const made = await resource<Purchase>(
        '/purchases',
        'POST',
        input({ name: label, purchasedAt }),
      );
      await test.database.query(
        sql`UPDATE purchases SET purchased_at=${purchasedAt}::timestamptz WHERE id=${made.data.id}::uuid`,
      );
    }
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const response = await request(
        '/purchases?q=' +
          encodeURIComponent(label) +
          '&limit=1' +
          (cursor ? '&cursor=' + cursor : ''),
      );
      expect(response.status).toBe(200);
      const result = (await response.json()) as {
        data: Purchase[];
        page: { nextCursor: string | null };
      };
      ids.push(...result.data.map((p) => p.id));
      cursor = result.page.nextCursor;
    } while (cursor);
    expect(new Set(ids).size).toBe(3);
  });
  it('rejects archived reassignments, permits unchanged archived payer and serializes archive/create', async () => {
    const user = await resource<Purchaser>('/purchasers', 'POST', { name: 'Archive race' });
    const original = await resource<Purchase>('/purchases', 'POST', input());
    const [archived, created] = await Promise.all([
      request(`/purchasers/${user.data.id}`, 'PATCH', { archived: true, version: 1 }),
      request('/purchases', 'POST', input({ purchaserId: user.data.id })),
    ]);
    expect(archived.status).toBe(200);
    expect([201, 409]).toContain(created.status);
    expect(
      (
        await request(`/purchases/${original.data.id}`, 'PATCH', {
          purchaserId: user.data.id,
          version: 1,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(`/purchases/${original.data.id}`, 'PATCH', {
          originalAmount: '1.25',
          version: 1,
        })
      ).status,
    ).toBe(400);
    expect((await request('/purchases', 'POST', input({ purchaserId: user.data.id }))).status).toBe(
      409,
    );
  });
  it('returns consistent all-page grouped sums and empty totals, including tiny/large conversions', async () => {
    const label = 'sum-' + crypto.randomUUID();
    await request(
      '/purchases',
      'POST',
      input({ name: label, originalAmount: '0.01', originalCurrency: 'THB', exchangeRate: '100' }),
    );
    await request(
      '/purchases',
      'POST',
      input({
        name: label,
        originalAmount: '999999999.99',
        originalCurrency: 'THB',
        exchangeRate: '0.00000001',
      }),
    );
    const result = await resource<Summary>('/summary?q=' + label);
    expect(result.data.count).toBe(2);
    expect(result.data.totals.jpy).toBe('99999999999000000');
    expect(result.data.totals.thb).toBe('1000000000.00');
    expect(result.data.byDay[0]?.jpy).toBe(result.data.totals.jpy);
    expect(result.data.byPurchaser[0]?.thb).toBe(result.data.totals.thb);
    const empty = await resource<Summary>('/summary?q=no-match-' + crypto.randomUUID());
    expect(empty.data).toEqual({
      timezone: 'Asia/Tokyo',
      count: 0,
      totals: { jpy: '0', thb: '0.00' },
      byDay: [],
      byPurchaser: [],
    });
  });

  it('allows restoring historical purchases with archived purchasers and requires valid state/version', async () => {
    const user = await resource<Purchaser>('/purchasers', 'POST', { name: 'Archived restore' });
    const made = await resource<Purchase>(
      '/purchases',
      'POST',
      input({ purchaserId: user.data.id }),
    );
    await request(`/purchasers/${user.data.id}`, 'PATCH', { archived: true, version: 1 });
    await request(`/purchases/${made.data.id}?version=1`, 'DELETE');
    expect(
      (await request(`/purchases/${made.data.id}/restore`, 'POST', { version: 1 })).status,
    ).toBe(409);
    const restored = await resource<Purchase>(`/purchases/${made.data.id}/restore`, 'POST', {
      version: 2,
    });
    expect(restored.response.status).toBe(200);
    expect(restored.data.purchaser.archived).toBe(true);
    expect(
      (await resource(`/purchases/${made.data.id}/restore`, 'POST', { version: 3 })).error?.code,
    ).toBe('PURCHASE_ACTIVE');
    expect((await resource(`/purchases/${made.data.id}?version=2`, 'DELETE')).error?.code).toBe(
      'VERSION_CONFLICT',
    );
    await request(`/purchases/${made.data.id}?version=3`, 'DELETE');
    expect(
      (
        await resource(`/purchases/${made.data.id}`, 'PATCH', {
          name: 'Cannot edit Trash',
          version: 4,
        })
      ).error?.code,
    ).toBe('PURCHASE_DELETED');
    const deleted = await request('/purchases?status=deleted&purchaserId=' + user.data.id);
    expect(((await deleted.json()) as { data: Purchase[] }).data.map((p) => p.id)).toContain(
      made.data.id,
    );
  });
  it('validates partial currency changes and recalculates saved amounts only when requested', async () => {
    const made = await resource<Purchase>('/purchases', 'POST', input({ exchangeRate: '0.23' }));
    expect(
      (
        await request(`/purchases/${made.data.id}`, 'PATCH', {
          originalCurrency: 'THB',
          version: 1,
        })
      ).status,
    ).toBe(400);
    const changed = await resource<Purchase>(`/purchases/${made.data.id}`, 'PATCH', {
      originalCurrency: 'THB',
      originalAmount: '100.00',
      version: 1,
    });
    expect(changed.data.amountJpy).toBe('435');
    expect(changed.data.amountThb).toBe('100.00');
    expect(changed.data.exchangeRate).toBe('0.23000000');
    const rate = await resource<Purchase>(`/purchases/${made.data.id}`, 'PATCH', {
      exchangeRate: '0.5',
      version: 2,
    });
    expect(rate.data.amountJpy).toBe('200');
    expect(rate.data.amountThb).toBe('100.00');
    const max = await resource<Purchase>(
      '/purchases',
      'POST',
      input({ originalAmount: '999999999', exchangeRate: '100' }),
    );
    expect(max.data.amountThb).toBe('99999999900.00');
    const half = await resource<Purchase>(
      '/purchases',
      'POST',
      input({ originalAmount: '1', exchangeRate: '0.235' }),
    );
    expect(half.data.amountThb).toBe('0.24');
  });
});
