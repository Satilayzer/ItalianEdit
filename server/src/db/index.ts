import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

let pool: pg.Pool | null = null;

/**
 * Подключается к PostgreSQL и накатывает схему. Вызывается один раз на старте.
 *
 * При неудаче пул закрывается и обнуляется: иначе `isDbReady()` отвечал бы `true`
 * на заведомо мёртвом подключении, и задачи режима `api` полезли бы в него на
 * каждом проходе.
 */
export async function initDb(databaseUrl: string): Promise<pg.Pool> {
  const created = new pg.Pool({ connectionString: databaseUrl, max: 10 });
  try {
    const schemaPath = join(dirname(fileURLToPath(import.meta.url)), "schema.sql");
    await created.query(readFileSync(schemaPath, "utf8"));
  } catch (err) {
    await created.end().catch(() => {});
    pool = null;
    throw err;
  }
  pool = created;
  return created;
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
