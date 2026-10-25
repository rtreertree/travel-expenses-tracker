import { sql, type SQL } from 'drizzle-orm';
import Decimal from 'decimal.js';
import type { Database, Row } from '../db/connection';
import { ApiError, conflict, notFound } from '../middleware/errors';
import type {
  Purchase,
  Purchaser,
  Settings,
  Summary,
  PurchaseCreate,
  PurchasePatch,
  PurchaseFilters,
  SummaryFilters,
} from '../../shared/types';
import { hashCreateRequest } from '../../shared/schemas';
import { tokyoDateRange } from '../../shared/time';
import { parseLocation } from '../../shared/location';
import { z } from 'zod';

const string = (v: unknown) => String(v);
const iso = (v: unknown) => new Date(v instanceof Date ? v : string(v)).toISOString();
const maybeIso = (v: unknown) => (v == null ? null : iso(v));
const payer = (r: Row): Purchaser => ({
  id: string(r.id),
  name: string(r.name),
  archivedAt: maybeIso(r.archived_at),
  archived: r.archived_at != null,
  version: Number(r.version),
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});
function purchase(r: Row): Purchase {
  const currency = r.original_currency === 'JPY' ? 'JPY' : 'THB';
  return {
    id: string(r.id),
    name: string(r.name),
    description: string(r.description),
    location: parseLocation(r.location ?? null),
    purchaserId: string(r.purchaser_id),
    originalCurrency: currency,
    originalAmount: new Decimal(string(r.original_amount)).toFixed(currency === 'JPY' ? 0 : 2),
    exchangeRate: new Decimal(string(r.thb_per_jpy)).toFixed(8),
    rateSource: r.rate_source === 'manual' ? 'manual' : 'default',
    amountJpy: new Decimal(string(r.amount_jpy)).toFixed(0),
    amountThb: new Decimal(string(r.amount_thb)).toFixed(2),
    purchasedAt: iso(r.purchased_at),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    deletedAt: maybeIso(r.deleted_at),
    version: Number(r.version),
    purchaser: {
      id: string(r.purchaser_id),
      name: string(r.payer_name),
      archived: r.payer_archived_at != null,
    },
  };
}
const joined = sql`SELECT p.*, to_char(p.purchased_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at, u.name AS payer_name, u.archived_at AS payer_archived_at FROM purchases p JOIN purchasers u ON u.id=p.purchaser_id`;
const versionConflict = () =>
  conflict(
    'VERSION_CONFLICT',
    'This record changed on another device. Reload and review your changes.',
  );
function filtersWhere(filters: SummaryFilters & { status?: string }): SQL {
  const range = tokyoDateRange(filters);
  const terms: SQL[] = [
    filters.status === 'deleted' ? sql`p.deleted_at IS NOT NULL` : sql`p.deleted_at IS NULL`,
  ];
  if (range.from) terms.push(sql`p.purchased_at >= ${range.from}::timestamptz`);
  if (range.toExclusive) terms.push(sql`p.purchased_at < ${range.toExclusive}::timestamptz`);
  if (filters.purchaserId) terms.push(sql`p.purchaser_id = ${filters.purchaserId}::uuid`);
  if (filters.q) {
    const pattern = `%${filters.q.replace(/[\\%_]/g, '\\$&')}%`;
    terms.push(
      sql`(p.name ILIKE ${pattern} OR p.description ILIKE ${pattern} OR p.location->>'text' ILIKE ${pattern})`,
    );
  }
  return sql.join(terms, sql` AND `);
}
function fingerprint(filters: PurchaseFilters): string {
  return JSON.stringify([
    filters.from ?? null,
    filters.to ?? null,
    filters.purchaserId ?? null,
    filters.q || null,
    filters.status,
  ]);
}
const cursorSchema = z.object({ at: z.iso.datetime(), id: z.uuid(), filter: z.string() }).strict();
function decodeCursor(cursor: string, filter: string) {
  try {
    const value = cursorSchema.parse(
      JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(
          Uint8Array.from(atob(cursor.replace(/-/g, '+').replace(/_/g, '/')), (c) =>
            c.charCodeAt(0),
          ),
        ),
      ),
    );
    if (value.filter !== filter) throw new Error();
    return value;
  } catch {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'Invalid cursor or filters changed. Start a new list.',
    );
  }
}
function encodeCursor(last: Purchase, rawTimestamp: string, filter: string) {
  return btoa(
    String.fromCharCode(
      ...new TextEncoder().encode(JSON.stringify({ at: rawTimestamp, id: last.id, filter })),
    ),
  )
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
export class Ledger {
  constructor(private db: Database) {}
  async settings(): Promise<Settings> {
    const [r] = await this.db.query(sql`SELECT * FROM app_settings WHERE id=1`);
    if (!r)
      throw new ApiError(
        503,
        'DATABASE_UNAVAILABLE',
        'Database setup is incomplete. Run the reviewed migrations.',
      );
    return {
      defaultThbPerJpy:
        r.default_thb_per_jpy == null
          ? null
          : new Decimal(string(r.default_thb_per_jpy)).toFixed(8),
      version: Number(r.version),
      updatedAt: iso(r.updated_at),
      timezone: 'Asia/Tokyo',
    };
  }
  async updateSettings(input: { defaultThbPerJpy: string; version: number }): Promise<Settings> {
    const rows = await this.db.query(
      sql`UPDATE app_settings SET default_thb_per_jpy=${input.defaultThbPerJpy}::numeric, version=version+1, updated_at=now() WHERE id=1 AND version=${input.version} RETURNING id`,
    );
    if (!rows.length) versionConflict();
    return this.settings();
  }
  async purchasers(includeArchived: boolean): Promise<Purchaser[]> {
    return (
      await this.db.query(
        sql`SELECT * FROM purchasers ${includeArchived ? sql`` : sql`WHERE archived_at IS NULL`} ORDER BY created_at,id`,
      )
    ).map(payer);
  }
  async createPurchaser(input: { name: string }): Promise<Purchaser> {
    const [r] = await this.db.query(
      sql`INSERT INTO purchasers(id,name) VALUES (${crypto.randomUUID()}::uuid,${input.name}) RETURNING *`,
    );
    return payer(r!);
  }
  async updatePurchaser(
    id: string,
    input: { name?: string; archived?: boolean; version: number },
  ): Promise<Purchaser> {
    const rows = await this.db.query(
      sql`UPDATE purchasers SET name=coalesce(${input.name ?? null},name), archived_at=CASE WHEN ${input.archived ?? null}::boolean IS NULL THEN archived_at WHEN ${input.archived ?? false} THEN coalesce(archived_at,now()) ELSE NULL END, version=version+1, updated_at=now() WHERE id=${id}::uuid AND version=${input.version} RETURNING *`,
    );
    if (!rows.length) {
      const exists = await this.db.query(sql`SELECT id FROM purchasers WHERE id=${id}::uuid`);
      if (!exists.length) notFound();
      versionConflict();
    }
    return payer(rows[0]!);
  }
  async detail(id: string): Promise<Purchase> {
    const [r] = await this.db.query(sql`${joined} WHERE p.id=${id}::uuid`);
    if (!r) notFound();
    return purchase(r);
  }
  private async replay(id: string, hash: string): Promise<Purchase | null> {
    const [r] = await this.db.query(sql`${joined} WHERE p.id=${id}::uuid`);
    if (!r) return null;
    if (r.create_request_hash !== hash)
      conflict('IDEMPOTENCY_CONFLICT', 'This creation ID was already used with different input.');
    if (r.deleted_at != null)
      conflict(
        'PURCHASE_DELETED',
        'This purchase is in Trash. Restore it instead of resubmitting.',
      );
    return purchase(r);
  }
  async create(input: PurchaseCreate): Promise<{ data: Purchase; replay: boolean }> {
    const hash = await hashCreateRequest(input);
    const previous = await this.replay(input.id, hash);
    if (previous) return { data: previous, replay: true };
    const rate = sql`coalesce(${input.exchangeRate ?? null}::numeric,s.default_thb_per_jpy)`;
    const amount = sql`${input.originalAmount}::numeric`;
    const currency = input.originalCurrency;
    const purchaserMatch = input.purchaserId
      ? sql`id=${input.purchaserId}::uuid`
      : sql`lower(name)=lower(${input.purchaser ?? 'Me'})`;
    const rows = await this.db
      .query(sql`WITH payer AS MATERIALIZED (SELECT id,archived_at FROM purchasers WHERE ${purchaserMatch} FOR SHARE), inserted AS (
      INSERT INTO purchases(id,name,description,location,purchaser_id,original_currency,original_amount,thb_per_jpy,rate_source,amount_jpy,amount_thb,purchased_at,create_request_hash)
      SELECT ${input.id}::uuid,${input.name},${input.description ?? ''},${input.location == null ? null : JSON.stringify(input.location)}::jsonb,u.id,${currency},${amount},${rate},${input.exchangeRate ? 'manual' : 'default'},
      CASE WHEN ${currency}='JPY' THEN ${amount} ELSE round(${amount}/${rate},0) END,
      CASE WHEN ${currency}='THB' THEN ${amount} ELSE round(${amount}*${rate},2) END,
      coalesce(${input.purchasedAt ?? null}::timestamptz,now()),${hash}
      FROM payer u CROSS JOIN app_settings s WHERE s.id=1 AND u.archived_at IS NULL AND ${rate} IS NOT NULL
      ON CONFLICT (id) DO NOTHING RETURNING id) SELECT id FROM inserted`);
    if (!rows.length) {
      const duplicate = await this.replay(input.id, hash);
      if (duplicate) return { data: duplicate, replay: true };
      const [u] = await this.db.query(
        sql`SELECT archived_at FROM purchasers WHERE ${purchaserMatch}`,
      );
      if (!u || u.archived_at != null)
        conflict(
          'PURCHASER_UNAVAILABLE',
          'Choose an existing active purchaser by name or ID. The default purchaser is Me.',
        );
      conflict(
        'RATE_NOT_CONFIGURED',
        'Set a default exchange rate in Settings or enter a purchase rate.',
      );
    }
    return { data: await this.detail(input.id), replay: false };
  }
  async update(id: string, input: PurchasePatch): Promise<Purchase> {
    if (input.originalAmount && !input.originalCurrency && input.originalAmount.includes('.')) {
      const current = await this.detail(id);
      if (current.originalCurrency === 'JPY')
        throw new ApiError(400, 'VALIDATION_ERROR', 'JPY must be a whole number.', {
          originalAmount: ['JPY must be a whole number.'],
        });
    }
    const c = sql`coalesce(${input.originalCurrency ?? null},p.original_currency)`;
    const a = sql`coalesce(${input.originalAmount ?? null}::numeric,p.original_amount)`;
    const r = sql`coalesce(${input.exchangeRate ?? null}::numeric,p.thb_per_jpy)`;
    const rows = await this.db
      .query(sql`WITH payer AS MATERIALIZED (SELECT id,archived_at FROM purchasers WHERE id=${input.purchaserId ?? null}::uuid FOR SHARE)
      UPDATE purchases p SET name=coalesce(${input.name ?? null},p.name),description=coalesce(${input.description ?? null},p.description),
      location=CASE WHEN ${input.location !== undefined} THEN ${input.location == null ? null : JSON.stringify(input.location)}::jsonb ELSE p.location END,
      purchaser_id=coalesce(${input.purchaserId ?? null}::uuid,p.purchaser_id),original_currency=${c},original_amount=${a},thb_per_jpy=${r},
      rate_source=CASE WHEN ${input.exchangeRate != null} THEN 'manual' ELSE p.rate_source END,
      amount_jpy=CASE WHEN ${c}='JPY' THEN ${a} ELSE round(${a}/${r},0) END,
      amount_thb=CASE WHEN ${c}='THB' THEN ${a} ELSE round(${a}*${r},2) END,
      purchased_at=coalesce(${input.purchasedAt ?? null}::timestamptz,p.purchased_at),version=p.version+1,updated_at=now()
      WHERE p.id=${id}::uuid AND p.version=${input.version} AND p.deleted_at IS NULL
      AND (${input.purchaserId ?? null}::uuid IS NULL OR p.purchaser_id=${input.purchaserId ?? null}::uuid OR EXISTS (SELECT 1 FROM payer WHERE archived_at IS NULL)) RETURNING p.id`);
    if (!rows.length) {
      const current = await this.detail(id);
      if (current.version !== input.version) versionConflict();
      if (current.deletedAt)
        conflict('PURCHASE_DELETED', 'Restore this purchase before editing it.');
      conflict('PURCHASER_UNAVAILABLE', 'Choose an active purchaser.');
    }
    return this.detail(id);
  }
  async remove(id: string, version: number): Promise<void> {
    const rows = await this.db.query(
      sql`UPDATE purchases SET deleted_at=now(),version=version+1,updated_at=now() WHERE id=${id}::uuid AND version=${version} AND deleted_at IS NULL RETURNING id`,
    );
    if (!rows.length) {
      const row = await this.detail(id);
      if (row.version !== version) versionConflict();
      conflict('PURCHASE_DELETED', 'This purchase is already in Trash.');
    }
  }
  async restore(id: string, version: number): Promise<Purchase> {
    const rows = await this.db.query(
      sql`UPDATE purchases SET deleted_at=NULL,version=version+1,updated_at=now() WHERE id=${id}::uuid AND version=${version} AND deleted_at IS NOT NULL RETURNING id`,
    );
    if (!rows.length) {
      const row = await this.detail(id);
      if (row.version !== version) versionConflict();
      conflict('PURCHASE_ACTIVE', 'This purchase is already active.');
    }
    return this.detail(id);
  }
  async list(
    filters: PurchaseFilters,
  ): Promise<{ data: Purchase[]; page: { nextCursor: string | null } }> {
    const fp = fingerprint(filters);
    const cursor = filters.cursor ? decodeCursor(filters.cursor, fp) : null;
    const rows = await this.db.query(
      sql`${joined} WHERE ${filtersWhere(filters)} ${cursor ? sql`AND (p.purchased_at,p.id) < (${cursor.at}::timestamptz,${cursor.id}::uuid)` : sql``} ORDER BY p.purchased_at DESC,p.id DESC LIMIT ${filters.limit + 1}`,
    );
    const data = rows.slice(0, filters.limit).map(purchase);
    return {
      data,
      page: {
        nextCursor:
          rows.length > filters.limit
            ? encodeCursor(data.at(-1)!, string(rows[filters.limit - 1]!.cursor_at), fp)
            : null,
      },
    };
  }
  async summary(filters: SummaryFilters): Promise<Summary> {
    const [row] = await this.db
      .query(sql`WITH filtered AS MATERIALIZED (SELECT p.*,u.name AS payer_name FROM purchases p JOIN purchasers u ON u.id=p.purchaser_id WHERE ${filtersWhere(filters)}),
      days AS (SELECT (purchased_at AT TIME ZONE 'Asia/Tokyo')::date AS date,count(*)::int AS count,sum(amount_jpy)::text AS jpy,sum(amount_thb)::text AS thb FROM filtered GROUP BY 1),
      people AS (SELECT purchaser_id,payer_name,count(*)::int AS count,sum(amount_jpy)::text AS jpy,sum(amount_thb)::text AS thb FROM filtered GROUP BY 1,2)
      SELECT json_build_object('timezone','Asia/Tokyo','count',(SELECT count(*)::int FROM filtered),
      'totals',json_build_object('jpy',(SELECT coalesce(sum(amount_jpy),0)::text FROM filtered),'thb',(SELECT coalesce(sum(amount_thb),0.00)::numeric(30,2)::text FROM filtered)),
      'byDay',coalesce((SELECT json_agg(json_build_object('date',date::text,'count',count,'jpy',jpy,'thb',thb) ORDER BY date) FROM days),'[]'::json),
      'byPurchaser',coalesce((SELECT json_agg(json_build_object('purchaserId',purchaser_id,'name',payer_name,'count',count,'jpy',jpy,'thb',thb) ORDER BY payer_name,purchaser_id) FROM people),'[]'::json)) AS summary`);
    return row!.summary as Summary;
  }
}
