import { Hono, type Context } from 'hono';
import { z, ZodError } from 'zod';
import { connect, type Database } from './db/connection';
import { Ledger } from './services/ledger';
import { ApiError } from './middleware/errors';
import {
  createPurchaseSchema,
  patchPurchaseSchema,
  settingsPatchSchema,
  purchaserCreateSchema,
  purchaserPatchSchema,
  listFiltersSchema,
  summaryFiltersSchema,
  versionSchema,
  uuidSchema,
} from '../shared/schemas';

type AppEnv = { Bindings: Env; Variables: { requestId: string; body: unknown; ledger: Ledger } };
type DatabaseFactory = (env: Env) => Database;
function parseQuery<T>(c: Context<AppEnv>, schema: z.ZodType<T>): T {
  const pairs = new URL(c.req.url).searchParams;
  if (new Set(pairs.keys()).size !== [...pairs.keys()].length)
    throw new ApiError(400, 'VALIDATION_ERROR', 'Query parameters cannot be repeated.');
  return schema.parse(Object.fromEntries(pairs));
}
function dbError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof ZodError) {
    const fields: Record<string, string[]> = {};
    for (const issue of error.issues) {
      const name = issue.path.join('.') || '_form';
      (fields[name] ??= []).push(issue.message);
    }
    return new ApiError(400, 'VALIDATION_ERROR', 'Check the highlighted fields.', fields);
  }
  const e =
    error && typeof error === 'object'
      ? (error as { code?: string; cause?: unknown; name?: string })
      : {};
  if (e.cause) return dbError(e.cause);
  if (e.code === '23505')
    return new ApiError(
      409,
      'NAME_CONFLICT',
      'A purchaser with that name already exists, including archived purchasers.',
      { name: ['Choose a different name or reactivate the existing purchaser.'] },
    );
  if (e.code === '23514' || e.code === '22003')
    return new ApiError(
      400,
      'VALIDATION_ERROR',
      'The submitted values are outside the allowed range.',
    );
  if (
    e.code?.startsWith('08') ||
    e.code?.startsWith('53') ||
    e.code?.startsWith('57') ||
    (e.name === 'NeonDbError' && !e.code) ||
    e.name === 'TypeError'
  )
    return new ApiError(
      503,
      'DATABASE_UNAVAILABLE',
      'The database is temporarily unavailable. Your input has not been discarded; try again.',
    );
  return new ApiError(500, 'INTERNAL_ERROR', 'The request could not be completed.');
}
async function readJson(request: Request): Promise<unknown> {
  const declared = request.headers.get('content-length');
  if (declared && Number(declared) > 16_384)
    throw new ApiError(413, 'BODY_TOO_LARGE', 'Requests must be at most 16 KiB.');
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, 'MALFORMED_JSON', 'Send a JSON request body.');
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    length += part.value.byteLength;
    if (length > 16_384) {
      await reader.cancel();
      throw new ApiError(413, 'BODY_TOO_LARGE', 'Requests must be at most 16 KiB.');
    }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new ApiError(400, 'MALFORMED_JSON', 'Send valid JSON.');
  }
}
export function createApp(databaseFactory: DatabaseFactory = (env) => connect(env.DATABASE_URL)) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('requestId', crypto.randomUUID());
    const start = performance.now();
    c.header('Cache-Control', 'no-store');
    c.header('X-Request-Id', c.get('requestId'));
    c.header('X-Content-Type-Options', 'nosniff');
    await next();
    console.log(
      JSON.stringify({
        requestId: c.get('requestId'),
        route: c.req.routePath,
        status: c.res.status,
        durationMs: Math.round(performance.now() - start),
      }),
    );
  });
  app.onError((error, c) => {
    const safe = dbError(error);
    return c.json(
      {
        error: {
          code: safe.code,
          message: safe.message,
          ...(safe.fieldErrors ? { fieldErrors: safe.fieldErrors } : {}),
          requestId: c.get('requestId'),
        },
      },
      safe.status,
    );
  });
  app.use('*', async (c, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
      const origin = c.req.header('Origin');
      if (origin && origin !== new URL(c.req.url).origin)
        throw new ApiError(403, 'FOREIGN_ORIGIN', 'Use the same origin for browser changes.');
      if (['POST', 'PATCH', 'PUT'].includes(c.req.method)) {
        if (!/^application\/json(?:\s*;|$)/i.test(c.req.header('Content-Type') ?? ''))
          throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send application/json.');
        c.set('body', await readJson(c.req.raw));
      }
    }
    await next();
  });
  app.get('/api/v1/health', (c) => c.json({ data: { status: 'ok' } }));
  app.use('/api/v1/*', async (c, next) => {
    // Unknown routes stay JSON 404 even before database setup.
    if (
      /^\/api\/v1\/(settings|purchasers(?:\/[^/]+)?|purchases(?:\/[^/]+(?:\/restore)?)?|summary)\/?$/.test(
        c.req.path,
      )
    )
      c.set('ledger', new Ledger(databaseFactory(c.env)));
    await next();
  });
  app.get('/api/v1/settings', async (c) => c.json({ data: await c.get('ledger').settings() }));
  app.patch('/api/v1/settings', async (c) =>
    c.json({
      data: await c.get('ledger').updateSettings(settingsPatchSchema.parse(c.get('body'))),
    }),
  );
  app.get('/api/v1/purchasers', async (c) => {
    const q = parseQuery(
      c,
      z.object({ includeArchived: z.enum(['true', 'false']).default('false') }).strict(),
    );
    return c.json({ data: await c.get('ledger').purchasers(q.includeArchived === 'true') });
  });
  app.post('/api/v1/purchasers', async (c) =>
    c.json(
      { data: await c.get('ledger').createPurchaser(purchaserCreateSchema.parse(c.get('body'))) },
      201,
    ),
  );
  app.patch('/api/v1/purchasers/:id', async (c) =>
    c.json({
      data: await c
        .get('ledger')
        .updatePurchaser(
          uuidSchema.parse(c.req.param('id')),
          purchaserPatchSchema.parse(c.get('body')),
        ),
    }),
  );
  app.get('/api/v1/purchases', async (c) =>
    c.json(await c.get('ledger').list(parseQuery(c, listFiltersSchema))),
  );
  app.get('/api/v1/purchases/:id', async (c) =>
    c.json({ data: await c.get('ledger').detail(uuidSchema.parse(c.req.param('id'))) }),
  );
  app.post('/api/v1/purchases', async (c) => {
    const result = await c.get('ledger').create(createPurchaseSchema.parse(c.get('body')));
    return c.json({ data: result.data }, result.replay ? 200 : 201);
  });
  app.patch('/api/v1/purchases/:id', async (c) =>
    c.json({
      data: await c
        .get('ledger')
        .update(uuidSchema.parse(c.req.param('id')), patchPurchaseSchema.parse(c.get('body'))),
    }),
  );
  app.delete('/api/v1/purchases/:id', async (c) => {
    const query = parseQuery(
      c,
      z
        .object({
          version: z
            .string()
            .regex(/^[1-9]\d*$/)
            .transform(Number)
            .pipe(z.number().int().max(2_147_483_647)),
        })
        .strict(),
    );
    await c.get('ledger').remove(uuidSchema.parse(c.req.param('id')), query.version);
    return c.body(null, 204);
  });
  app.post('/api/v1/purchases/:id/restore', async (c) =>
    c.json({
      data: await c
        .get('ledger')
        .restore(uuidSchema.parse(c.req.param('id')), versionSchema.parse(c.get('body')).version),
    }),
  );
  app.get('/api/v1/summary', async (c) =>
    c.json({ data: await c.get('ledger').summary(parseQuery(c, summaryFiltersSchema)) }),
  );
  app.notFound((c) =>
    c.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: 'The requested resource was not found.',
          requestId: c.get('requestId'),
        },
      },
      404,
    ),
  );
  return app;
}
export default createApp();
