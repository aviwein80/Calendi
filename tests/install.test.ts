import { describe, expect, it } from 'vitest';
import { describeDatabaseError, settingProblems } from '@/lib/install';

const SECRET = 'x'.repeat(32);

describe('settingProblems', () => {
  it('flags a deployment with nothing set', () => {
    expect(settingProblems({}).map((p) => p.id)).toEqual(['database_missing', 'secret_missing']);
  });

  it('accepts either database variable', () => {
    expect(settingProblems({ DATABASE_URL: 'postgres://x', APP_SECRET: SECRET })).toEqual([]);
    expect(settingProblems({ POSTGRES_URL: 'postgres://x', APP_SECRET: SECRET })).toEqual([]);
  });

  it('insists on a secret of at least 32 characters', () => {
    const [problem] = settingProblems({ DATABASE_URL: 'postgres://x', APP_SECRET: 'short' });
    expect(problem.id).toBe('secret_missing');
    expect(problem.title).toBe('APP_SECRET is too short');
  });
});

describe('describeDatabaseError', () => {
  const withCode = (code: string, message = 'boom') => Object.assign(new Error(message), { code });

  it('recognises tables that were never created', () => {
    const problem = describeDatabaseError(withCode('42P01', 'relation "owner" does not exist'));
    expect(problem.id).toBe('database_empty');
    expect(problem.fix).toContain('Redeploy');
  });

  it('recognises a wrong password, including the pooler wording', () => {
    expect(describeDatabaseError(withCode('28P01')).id).toBe('database_login');
    expect(describeDatabaseError(withCode('XX000', 'Tenant or user not found')).id).toBe('database_login');
  });

  it('recognises an unreachable server, even when the code is on the cause', () => {
    expect(describeDatabaseError(withCode('ECONNREFUSED')).id).toBe('database_unreachable');
    expect(describeDatabaseError(withCode('CONNECT_TIMEOUT')).id).toBe('database_unreachable');
    const wrapped = Object.assign(new Error('fetch failed'), { cause: withCode('ENOTFOUND') });
    expect(describeDatabaseError(wrapped).id).toBe('database_unreachable');
  });

  it('recognises a malformed address', () => {
    expect(describeDatabaseError(withCode('ERR_INVALID_URL', 'Invalid URL')).id).toBe('database_address');
  });

  it('falls back to a generic message that carries the code', () => {
    const problem = describeDatabaseError(withCode('53300', 'too many connections'));
    expect(problem.id).toBe('database_error');
    expect(problem.fix).toContain('53300');
  });

  it('never repeats the raw error text, which can contain the connection string', () => {
    const problem = describeDatabaseError(new Error('connect failed for postgres://user:hunter2@host/db'));
    expect(JSON.stringify(problem)).not.toContain('hunter2');
  });
});
