import postgres from 'postgres';

let sql = null;

/**
 * Lazily open the pool. Returns null when DATABASE_URL is unset, which is what
 * keeps the in-memory path (and the already-deployed stage-2 service) working.
 */
export function getSql() {
  if (sql) return sql;
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  sql = postgres(url, {
    max: Number(process.env.DB_POOL_MAX) || 5,
    idle_timeout: 20,
    connect_timeout: 10,
    // Supabase's pooler terminates prepared statements; disable to be safe.
    prepare: false,
    onnotice: () => {},
  });
  return sql;
}

export const hasDb = () => Boolean(process.env.DATABASE_URL);

export async function closeDb() {
  if (sql) {
    await sql.end({ timeout: 5 });
    sql = null;
  }
}
