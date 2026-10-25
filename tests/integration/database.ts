import { PGlite } from '@electric-sql/pglite';
import { PgDialect } from 'drizzle-orm/pg-core';
import { readFile, readdir } from 'node:fs/promises';
import type { Database, Row } from '../../src/server/db/connection';
export async function createTestDatabase() {
  const engine = new PGlite();
  for (const file of (await readdir('drizzle')).filter((name) => /^\d+.*\.sql$/.test(name)).sort())
    await engine.exec(await readFile(`drizzle/${file}`, 'utf8'));
  const dialect = new PgDialect();
  const database: Database = {
    async query(statement) {
      const q = dialect.sqlToQuery(statement);
      const result = await engine.query<Row>(q.sql, q.params);
      return result.rows;
    },
  };
  return { database, engine, close: () => engine.close() };
}
