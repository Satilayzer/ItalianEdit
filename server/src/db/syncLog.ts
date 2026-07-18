import type { Pool } from "pg";

/** Записать результат синхронизации в журнал (видно, если что-то встало). */
export async function logSync(
  pool: Pool,
  kind: string,
  itemsUpdated: number,
  ok: boolean,
  message?: string
): Promise<void> {
  await pool.query(
    `INSERT INTO sync_log (kind, items_updated, ok, message)
     VALUES ($1, $2, $3, $4)`,
    [kind, itemsUpdated, ok, message ?? null]
  );
}
