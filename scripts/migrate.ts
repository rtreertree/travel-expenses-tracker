import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { neon } from '@neondatabase/serverless';

const targetIndex = process.argv.indexOf('--environment');
const target = process.argv[targetIndex + 1];
if (targetIndex < 0 || !['development', 'production', 'test'].includes(target ?? '')) {
  console.error(
    'Identify the database target: npm run db:migrate -- --environment development|production|test',
  );
  process.exit(1);
}
if (existsSync('.dev.vars')) process.loadEnvFile('.dev.vars');
const url = process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL;
if (!url) {
  console.error(
    'Set DATABASE_MIGRATION_URL or DATABASE_URL in the server environment or ignored .dev.vars.',
  );
  process.exit(1);
}
const host = new URL(url).hostname;
console.log(
  `Migration target: ${target}; database host: ${host}. No destructive resets are performed.`,
);
const db = neon(url);
const journalExists = await db`SELECT to_regclass('public.ledger_migrations') AS relation`;
const existing =
  await db`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('app_settings','purchasers','purchases')`;
if (!journalExists[0]?.relation && existing.length) {
  console.error(
    'Existing ledger tables found without migration history. Inspect and reconcile the schema before applying the initial migration.',
  );
  process.exit(1);
}
await db`CREATE TABLE IF NOT EXISTS ledger_migrations (name text PRIMARY KEY, hash text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`;
const applied = await db`SELECT name,hash FROM ledger_migrations`;
for (const name of readdirSync('drizzle')
  .filter((file) => /^\d+.*\.sql$/.test(file))
  .sort()) {
  const source = readFileSync(`drizzle/${name}`, 'utf8');
  const hash = createHash('sha256').update(source).digest('hex');
  const previous = applied.find((row) => row.name === name);
  if (previous) {
    if (previous.hash !== hash)
      throw new Error(
        `Migration ${name} has changed since application. Restore the original and create a new migration.`,
      );
    console.log(`Already applied: ${name}`);
    continue;
  }
  const statements = source
    .split('--> statement-breakpoint')
    .map((part) => part.trim())
    .filter(Boolean);
  await db.transaction([
    db`SELECT pg_advisory_xact_lock(84632217)`,
    ...statements.map((statement) => db.query(statement)),
    db`INSERT INTO ledger_migrations(name,hash) VALUES (${name},${hash})`,
  ]);
  console.log(`Applied: ${name}`);
}
console.log('Database migrations complete.');
