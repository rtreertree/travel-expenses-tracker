import { sql } from 'drizzle-orm';
import {
  pgTable,
  smallint,
  integer,
  numeric,
  timestamp,
  uuid,
  varchar,
  text,
  check,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
const instant = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });
export const appSettings = pgTable(
  'app_settings',
  {
    id: smallint('id').primaryKey(),
    defaultThbPerJpy: numeric('default_thb_per_jpy', { precision: 12, scale: 8 }),
    version: integer('version').notNull().default(1),
    updatedAt: instant('updated_at').notNull().defaultNow(),
  },
  (t) => [
    check('settings_singleton', sql`${t.id} = 1`),
    check('settings_rate', sql`${t.defaultThbPerJpy} > 0 AND ${t.defaultThbPerJpy} <= 100`),
    check('settings_version', sql`${t.version} > 0`),
  ],
);
export const purchasers = pgTable(
  'purchasers',
  {
    id: uuid('id').primaryKey(),
    name: varchar('name', { length: 60 }).notNull(),
    archivedAt: instant('archived_at'),
    version: integer('version').notNull().default(1),
    createdAt: instant('created_at').notNull().defaultNow(),
    updatedAt: instant('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('purchaser_name_unique').on(sql`lower(${t.name})`),
    check('purchaser_name', sql`${t.name} = btrim(${t.name}) AND length(${t.name}) > 0`),
    check('purchaser_version', sql`${t.version} > 0`),
  ],
);
export const purchases = pgTable(
  'purchases',
  {
    id: uuid('id').primaryKey(),
    name: varchar('name', { length: 160 }).notNull(),
    description: text('description').notNull().default(''),
    purchaserId: uuid('purchaser_id')
      .notNull()
      .references(() => purchasers.id, { onDelete: 'restrict' }),
    originalCurrency: text('original_currency').notNull(),
    originalAmount: numeric('original_amount', { precision: 20, scale: 2 }).notNull(),
    exchangeRate: numeric('thb_per_jpy', { precision: 12, scale: 8 }).notNull(),
    rateSource: text('rate_source').notNull(),
    amountJpy: numeric('amount_jpy', { precision: 20, scale: 0 }).notNull(),
    amountThb: numeric('amount_thb', { precision: 20, scale: 2 }).notNull(),
    purchasedAt: instant('purchased_at').notNull(),
    createdAt: instant('created_at').notNull().defaultNow(),
    updatedAt: instant('updated_at').notNull().defaultNow(),
    deletedAt: instant('deleted_at'),
    version: integer('version').notNull().default(1),
    createRequestHash: text('create_request_hash').notNull(),
  },
  (t) => [
    check('purchase_name', sql`${t.name} = btrim(${t.name}) AND length(${t.name}) > 0`),
    check('purchase_description', sql`length(${t.description}) <= 4000`),
    check('purchase_currency', sql`${t.originalCurrency} IN ('JPY','THB')`),
    check(
      'purchase_original',
      sql`${t.originalAmount} > 0 AND ${t.originalAmount} <= 999999999.99 AND (${t.originalCurrency} <> 'JPY' OR ${t.originalAmount} = trunc(${t.originalAmount}))`,
    ),
    check('purchase_rate', sql`${t.exchangeRate} > 0 AND ${t.exchangeRate} <= 100`),
    check('purchase_source', sql`${t.rateSource} IN ('default','manual')`),
    check(
      'purchase_jpy',
      sql`${t.amountJpy} >= 0 AND ${t.amountJpy} = CASE WHEN ${t.originalCurrency} = 'JPY' THEN ${t.originalAmount} ELSE round(${t.originalAmount} / ${t.exchangeRate}, 0) END`,
    ),
    check(
      'purchase_thb',
      sql`${t.amountThb} >= 0 AND ${t.amountThb} = CASE WHEN ${t.originalCurrency} = 'THB' THEN ${t.originalAmount} ELSE round(${t.originalAmount} * ${t.exchangeRate}, 2) END`,
    ),
    check('purchase_version', sql`${t.version} > 0`),
    check('purchase_hash', sql`${t.createRequestHash} ~ '^[0-9a-f]{64}$'`),
    index('purchase_active_date')
      .on(t.purchasedAt.desc(), t.id.desc())
      .where(sql`${t.deletedAt} IS NULL`),
    index('purchase_active_payer')
      .on(t.purchaserId, t.purchasedAt.desc(), t.id.desc())
      .where(sql`${t.deletedAt} IS NULL`),
    index('purchase_trash').on(t.deletedAt),
  ],
);
