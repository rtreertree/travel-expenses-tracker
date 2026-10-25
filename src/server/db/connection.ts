import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import type { SQL } from 'drizzle-orm';
import { ApiError } from '../middleware/errors';
export type Row = Record<string, unknown>;
export interface Database {
  query(statement: SQL): Promise<Row[]>;
}
export function connect(databaseUrl: string | undefined): Database {
  if (!databaseUrl)
    throw new ApiError(
      503,
      'DATABASE_UNAVAILABLE',
      'The database is not configured. Add the server DATABASE_URL secret.',
    );
  const db = drizzle(neon(databaseUrl));
  return {
    async query(statement) {
      const result = await db.execute(statement);
      return result.rows;
    },
  };
}
