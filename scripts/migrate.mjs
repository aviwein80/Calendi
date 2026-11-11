// Applies db/migrations/*.sql in order, once each. Runs before every build
// (see package.json), so deploying the app also brings the database up to date.
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import postgres from 'postgres';

// Hosts give the same database several addresses. A direct ("non pooling")
// one is best for creating tables, but it is not always reachable from the
// build machine, so the others are tried in turn.
const candidates = [
  ['DATABASE_URL', process.env.DATABASE_URL],
  ['POSTGRES_URL_NON_POOLING', process.env.POSTGRES_URL_NON_POOLING],
  ['POSTGRES_URL', process.env.POSTGRES_URL],
].filter(([, value], index, all) => value && all.findIndex(([, other]) => other === value) === index);

// A preview deployment of an unmerged branch usually shares the production
// database. Letting it change the tables would break the live site, which is
// still running the old code, so only production builds migrate.
if (process.env.VERCEL_ENV === 'preview' && process.env.MIGRATE_ON_PREVIEW !== '1') {
  console.log('[migrate] Preview deployment: leaving the database as it is.');
  console.log('[migrate] (Set MIGRATE_ON_PREVIEW=1 for previews that have a database of their own.)');
  process.exit(0);
}

if (candidates.length === 0) {
  console.log('[migrate] No DATABASE_URL set; skipping migrations.');
  console.log('[migrate] The app will show a setup checklist until a database is connected.');
  process.exit(0);
}

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations');

function connect(url) {
  // Same rule as src/lib/db.ts: drop provider-specific query parameters that
  // Postgres would reject, and encrypt anything that is not on localhost.
  const target = new URL(url);
  const sslmode = target.searchParams.get('sslmode');
  const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(target.hostname);
  target.search = '';
  return postgres(target.href, {
    max: 1,
    connect_timeout: 15,
    ssl: sslmode === 'disable' || (local && !sslmode) ? false : 'require',
    prepare: false,
    onnotice: () => {},
  });
}

async function migrate(sql) {
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
}

/** Could not even talk to the server (as opposed to a migration that failed). */
const CONNECTION_CODES = ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'CONNECT_TIMEOUT'];

let failure = null;
for (const [name, url] of candidates) {
  let sql;
  try {
    sql = connect(url);
    await migrate(sql);
    console.log(`[migrate] Database is up to date (using ${name}).`);
    failure = null;
    break;
  } catch (err) {
    failure = err;
    const code = err?.code ?? err?.cause?.code ?? '';
    console.error(`[migrate] ${name} failed: ${err.message}${code ? ` (${code})` : ''}`);
    // Only a connection problem is worth retrying on another address.
    if (!CONNECTION_CODES.includes(code)) break;
  } finally {
    await sql?.end({ timeout: 5 }).catch(() => {});
  }
}

if (failure) {
  console.error('[migrate] The database could not be prepared, so the build is stopping here.');
  console.error('[migrate] Check the database connection string in the project settings, then deploy again.');
  process.exit(1);
}
