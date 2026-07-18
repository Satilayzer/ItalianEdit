import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

let pool: pg.Pool | null = null;

/** Подключается к PostgreSQL и накатывает схему. Вызывается один раз на старте. */
export async function initDb(databaseUrl: string): Promise<pg.Pool> {
  pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
  const schemaPath = join(dirname(fileURLToPath(import.meta.url)), "schema.sql");
  await pool.query(readFileSync(schemaPath, "utf8"));
  return pool;
}

/** Пул соединений; кидает ошибку, если БД не инициализирована. */
export function db(): pg.Pool {
  if (!pool) {
    throw new Error("БД не инициализирована — задайте DATABASE_URL в .env");
  }
  return pool;
}

export function isDbReady(): boolean {
  return pool !== null;
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = null;
}
