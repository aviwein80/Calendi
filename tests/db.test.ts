import { describe, expect, it } from 'vitest';
import { connectionOptions } from '@/lib/db';

describe('connectionOptions', () => {
  it('drops parameters Postgres would reject and requires encryption off localhost', () => {
    const options = connectionOptions(
      'postgres://user:p%40ss@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require&supa=base-pooler.x',
    );
    expect(options.url).toBe('postgres://user:p%40ss@aws-0-us-east-1.pooler.supabase.com:6543/postgres');
    expect(options.ssl).toBe('require');
  });

  it('encrypts hosted databases even when the URL does not say so', () => {
    expect(connectionOptions('postgres://u:p@db.example.com/app').ssl).toBe('require');
  });

  it('leaves a local database unencrypted', () => {
    expect(connectionOptions('postgres://u:p@localhost:5432/app').ssl).toBe(false);
    expect(connectionOptions('postgres://u:p@127.0.0.1/app?sslmode=disable').ssl).toBe(false);
  });
});
