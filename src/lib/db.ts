import 'server-only';
import postgres from 'postgres';

// One connection pool per server instance. `globalThis` keeps it across
// hot reloads in development so we do not leak connections.
const globalForDb = globalThis as unknown as { __calendiSql?: ReturnType<typeof postgres> };

function connectionString(): string {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set. Point it at a Postgres database (see README.md).');
  }
  return url;
}

/**
 * Hosting integrations add their own query parameters to the connection
 * string (Supabase adds `supa=…`, for example). The driver would pass those
 * on to Postgres, which rejects settings it does not know, so only the ones
 * that mean something are kept. Anything not on localhost is encrypted.
 */
export function connectionOptions(raw: string): { url: string; ssl: 'require' | false } {
  const url = new URL(raw);
  const sslmode = url.searchParams.get('sslmode');
  const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname);
  url.search = '';
  return { url: url.href, ssl: sslmode === 'disable' || (local && !sslmode) ? false : 'require' };
}

export function db() {
  if (!globalForDb.__calendiSql) {
    const { url, ssl } = connectionOptions(connectionString());
    globalForDb.__calendiSql = postgres(url, {
      ssl,
      max: 5,
      idle_timeout: 20,
      connect_timeout: 15,
      // Hosted poolers (Supabase, Neon) do not support named prepared statements.
      prepare: false,
      onnotice: () => {},
    });
  }
  return globalForDb.__calendiSql;
}

/** Postgres error code for a violated exclusion constraint (overlapping booking). */
export const EXCLUSION_VIOLATION = '23P01';
/** Postgres error code for a violated unique constraint. */
export const UNIQUE_VIOLATION = '23505';

export function pgCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { code: unknown }).code)
    : undefined;
}
