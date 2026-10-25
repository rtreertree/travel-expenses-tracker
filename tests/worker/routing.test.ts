/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from 'cloudflare:test';
import { expect, it } from 'vitest';
import worker from '../../src/server/index';

it('serves health as JSON without connecting to a database', async () => {
  const response = await worker.fetch(new Request('https://ledger.test/api/v1/health'), env);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ data: { status: 'ok' } });
  expect(response.headers.get('cache-control')).toBe('no-store');
});

it('returns JSON for unknown API routes, including document navigations', async () => {
  const response = await worker.fetch(
    new Request('https://ledger.test/api/v1/missing', {
      headers: { accept: 'text/html', 'sec-fetch-mode': 'navigate' },
    }),
    env,
  );
  expect(response.status).toBe(404);
  expect(response.headers.get('content-type')).toContain('application/json');
});

it('rejects browser changes from a foreign origin before database access', async () => {
  const response = await worker.fetch(
    new Request('https://ledger.test/api/v1/settings', {
      method: 'PATCH',
      headers: { origin: 'https://foreign.test', 'content-type': 'application/json' },
      body: '{}',
    }),
    env,
  );
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ error: { code: 'FOREIGN_ORIGIN' } });
});

it('limits and validates JSON bodies in the Worker runtime', async () => {
  const malformed = await worker.fetch(
    new Request('https://ledger.test/api/v1/purchases', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    }),
    env,
  );
  expect(malformed.status).toBe(400);
  const oversized = await worker.fetch(
    new Request('https://ledger.test/api/v1/purchases', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ description: 'x'.repeat(17000) }),
    }),
    env,
  );
  expect(oversized.status).toBe(413);
  const unsupported = await worker.fetch(
    new Request('https://ledger.test/api/v1/purchases', { method: 'POST', body: 'name=test' }),
    env,
  );
  expect(unsupported.status).toBe(415);
});

it('returns a safe retryable response when the database is unconfigured', async () => {
  const response = await worker.fetch(new Request('https://ledger.test/api/v1/settings'), {
    DATABASE_URL: '',
  });
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ error: { code: 'DATABASE_UNAVAILABLE' } });
  expect(response.headers.get('cache-control')).toBe('no-store');
});
