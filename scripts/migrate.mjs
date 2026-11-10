// Applies db/migrations/*.sql in order, once each. Runs before every build
// (see package.json), so deploying the app also brings the database up to date.
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import postgres from 'postgres';

const url =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.POSTGRES_URL;

if (!url) {
  console.log('[migrate] No DATABASE_URL set; skipping migrations.');
  process.exit(0);
}

// Same rule as src/lib/db.ts: drop provider-specific query parameters that
// Postgres would reject, and encrypt anything that is not on localhost.
const target = new URL(url);
const sslmode = target.searchParams.get('sslmode');
const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(target.hostname);
target.search = '';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations');
const sql = postgres(target.href, {
  max: 1,
  ssl: sslmode === 'disable' || (local && !sslmode) ? false : 'require',
  prepare: false,
  onnotice: () => {},
});

try {
  await sql`create table if not exists _migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  )`;
  await sql`alter table _migrations enable row level security`;
  const done = new Set((await sql`select name from _migrations`).map((r) => r.name));
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    if (done.has(file)) continue;
    const text = await readFile(path.join(dir, file), 'utf8');
    await sql.begin(async (tx) => {
      await tx.unsafe(text);
      await tx`insert into _migrations (name) values (${file})`;
    });
    console.log(`[migrate] Applied ${file}`);
  }
  console.log('[migrate] Database is up to date.');
} catch (err) {
  console.error('[migrate] Failed:', err.message);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
