import 'server-only';
import { configuredSetupToken } from './account';
import { MIN_SETUP_TOKEN_LENGTH } from './constants';
import { getOwner } from './store';
import type { Owner } from './types';

// "Is this deployment ready to run?" Used by the first pages a new owner
// lands on, so that a missing setting shows up as a to-do list with the fix
// rather than as a generic server error.

export type InstallProblem = {
  id:
    | 'database_missing'
    | 'secret_missing'
    | 'setup_token_missing'
    | 'database_address'
    | 'database_unreachable'
    | 'database_login'
    | 'database_empty'
    | 'database_error';
  title: string;
  fix: string;
};

/** Required settings, checked without touching the network. */
export function settingProblems(env: Record<string, string | undefined> = process.env): InstallProblem[] {
  const problems: InstallProblem[] = [];
  if (!env.DATABASE_URL && !env.POSTGRES_URL) {
    problems.push({
      id: 'database_missing',
      title: 'No database is connected',
      fix: 'On Vercel: open this project, go to Storage, create a Supabase or Neon database and connect it to the project (leave the optional "custom prefix" empty). Anywhere else: add a DATABASE_URL setting holding a Postgres connection string.',
    });
  }
  const secret = env.APP_SECRET ?? '';
  if (secret.length < 32) {
    problems.push({
      id: 'secret_missing',
      title: secret ? 'APP_SECRET is too short' : 'APP_SECRET is not set',
      fix: 'Add a setting named APP_SECRET with a long random value of at least 32 characters (on Vercel: Settings, then Environment Variables). It protects sign-in and encrypts saved calendar passwords, so keep it and do not change it later.',
    });
  }
  return problems;
}

/**
 * SETUP_TOKEN is what stops a stranger from claiming a freshly deployed site.
 * It is only needed until the owner account exists.
 */
export function setupTokenProblem(env: Record<string, string | undefined> = process.env): InstallProblem | null {
  if (configuredSetupToken(env)) return null;
  return {
    id: 'setup_token_missing',
    title: env.SETUP_TOKEN ? 'SETUP_TOKEN is too short' : 'SETUP_TOKEN is not set',
    fix: `Add a setting named SETUP_TOKEN with a random value of at least ${MIN_SETUP_TOKEN_LENGTH} characters. You type it once, on the form that creates your account, to prove the site is yours; nobody without it can claim the site. You can remove the setting once your account exists.`,
  };
}

function errorCode(err: unknown): string {
  if (typeof err !== 'object' || err === null) return '';
  const own = 'code' in err ? String((err as { code: unknown }).code) : '';
  if (own) return own;
  // Node wraps connection failures; the useful code is on the cause.
  return 'cause' in err ? errorCode((err as { cause: unknown }).cause) : '';
}

/** Turns a database failure into something the person deploying can act on. */
export function describeDatabaseError(err: unknown): InstallProblem {
  const code = errorCode(err);
  const message = err instanceof Error ? err.message : '';

  if (code === '42P01') {
    return {
      id: 'database_empty',
      title: 'The database is connected, but its tables have not been created',
      fix: 'Redeploy the project. The tables are created during the build, so the database has to be connected before the build runs. If a redeploy does not help, check that the build command is "npm run build".',
    };
  }
  if (code === 'ERR_INVALID_URL' || /invalid url/i.test(message)) {
    return {
      id: 'database_address',
      title: 'The database address is not a valid connection string',
      fix: 'DATABASE_URL should look like postgres://user:password@host:5432/database. Copy it again from your database provider.',
    };
  }
  if (code === '28P01' || code === '28000' || /password authentication|tenant or user not found/i.test(message)) {
    return {
      id: 'database_login',
      title: 'The database rejected the username or password',
      fix: 'Copy the connection string again from your database provider and update the DATABASE_URL setting. A password containing symbols must be percent-encoded.',
    };
  }
  if (['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'CONNECT_TIMEOUT', '3D000'].includes(code)) {
    return {
      id: 'database_unreachable',
      title: 'The database could not be reached',
      fix: 'Check that the database is running (free databases pause when unused) and that the connection string points at it. On Supabase, use the "Transaction pooler" connection string rather than the direct one.',
    };
  }
  return {
    id: 'database_error',
    title: 'The database returned an unexpected error',
    fix: `Check the connection string and that the database is running${code ? ` (error code ${code})` : ''}. The full error is in the server logs.`,
  };
}

export type InstallStatus =
  | { ready: true; owner: Owner | null }
  | { ready: false; problems: InstallProblem[] };

/** Checks the settings and then the database itself. Never throws. */
export async function installStatus(): Promise<InstallStatus> {
  const problems = settingProblems();
  const setupToken = setupTokenProblem();
  // With no database there cannot be an owner yet, so the setup token is
  // certainly still needed: list it now rather than after the next deploy.
  if (problems.some((problem) => problem.id === 'database_missing')) {
    return { ready: false, problems: setupToken ? [...problems, setupToken] : problems };
  }
  try {
    const owner = await getOwner();
    if (!owner && setupToken) problems.push(setupToken);
    return problems.length > 0 ? { ready: false, problems } : { ready: true, owner };
  } catch (err) {
    console.error('[install] database check failed:', err);
    const database = describeDatabaseError(err);
    // Missing tables also mean a brand-new install.
    const fresh = database.id === 'database_empty' && setupToken ? [setupToken] : [];
    return { ready: false, problems: [...problems, database, ...fresh] };
  }
}
