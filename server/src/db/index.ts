import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { drizzle as drizzlePostgres } from 'drizzle-orm/node-postgres';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { migrate as migratePostgres } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppConfig } from '../config.js';
import * as schema from './schema.js';

export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export type DatabaseConnection = {
  db: Database;
  migrate: () => Promise<void>;
  close: () => Promise<void>;
};

const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');

export async function createDatabase(config: Pick<AppConfig, 'databaseDriver' | 'databaseUrl' | 'pgliteDataDir'>): Promise<DatabaseConnection> {
  if (config.databaseDriver === 'postgres') {
    const pool = new Pool({ connectionString: config.databaseUrl, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 });
    const db = drizzlePostgres(pool, { schema });
    return {
      db,
      migrate: () => migratePostgres(db, { migrationsFolder }),
      close: () => pool.end(),
    };
  }
  if (config.pgliteDataDir !== ':memory:') mkdirSync(dirname(config.pgliteDataDir), { recursive: true });
  const client = config.pgliteDataDir === ':memory:' ? new PGlite() : new PGlite(config.pgliteDataDir);
  const db = drizzlePglite(client, { schema });
  return {
    db,
    migrate: () => migratePglite(db, { migrationsFolder }),
    close: () => client.close(),
  };
}