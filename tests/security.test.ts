import { describe, expect, it } from 'vitest';
import { configuredSetupToken } from '@/lib/account';
import { randomToken, secretsMatch, sha256Hex } from '@/lib/crypto';
import { setupTokenProblem } from '@/lib/install';

describe('setup token', () => {
  it('is required, and must be at least 24 characters', () => {
    expect(configuredSetupToken({})).toBe('');
    expect(configuredSetupToken({ SETUP_TOKEN: 'x'.repeat(23) })).toBe('');
    expect(configuredSetupToken({ SETUP_TOKEN: 'x'.repeat(24) })).toBe('x'.repeat(24));
  });

  it('shows up in the checklist with wording for each case', () => {
    expect(setupTokenProblem({})?.title).toBe('SETUP_TOKEN is not set');
    expect(setupTokenProblem({ SETUP_TOKEN: 'short' })?.title).toBe('SETUP_TOKEN is too short');
    expect(setupTokenProblem({ SETUP_TOKEN: 'x'.repeat(24) })).toBeNull();
  });
});

describe('secretsMatch', () => {
  it('accepts only the exact value, whatever the lengths', () => {
    const secret = 'correct-setup-token-0123456789';
    expect(secretsMatch(secret, secret)).toBe(true);
    expect(secretsMatch(secret.slice(0, -1), secret)).toBe(false);
    expect(secretsMatch(secret + 'x', secret)).toBe(false);
    expect(secretsMatch('', secret)).toBe(false);
    expect(secretsMatch(secret.toUpperCase(), secret)).toBe(false);
  });
});

describe('manage-link tokens', () => {
  it('carry at least 128 bits and never repeat', () => {
    const tokens = new Set(Array.from({ length: 500 }, () => randomToken(24)));
    expect(tokens.size).toBe(500);
    for (const token of tokens) {
      expect(Buffer.from(token, 'base64url').length).toBe(24);
      expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    }
  });

  it('are stored as a SHA-256, which says nothing about the token', () => {
    const token = randomToken(24);
    const hash = sha256Hex(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
