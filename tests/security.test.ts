import { describe, expect, it } from 'vitest';
import { configuredSetupToken } from '@/lib/account';
import { randomToken, secretsMatch, sha256Hex } from '@/lib/crypto';
import { setupTokenProblem } from '@/lib/install';
import { addressFromHeaders } from '@/lib/rateLimit';

describe('setup token', () => {
  it('is required, and must be at least 24 characters', () => {
    expect(configuredSetupToken({})).toBe('');
    expect(configuredSetupToken({ SETUP_TOKEN: 'x'.repeat(23) })).toBe('');
    expect(configuredSetupToken({ SETUP_TOKEN: 'x'.repeat(24) })).toBe('x'.repeat(24));
  });

  it('ignores whitespace around the setting, as pasted values often have', () => {
    const token = 'x'.repeat(24);
    expect(configuredSetupToken({ SETUP_TOKEN: `${token}\n` })).toBe(token);
    expect(configuredSetupToken({ SETUP_TOKEN: `  ${token} \r\n` })).toBe(token);
    // Padding does not make a short token long enough.
    expect(configuredSetupToken({ SETUP_TOKEN: `${'x'.repeat(20)}      ` })).toBe('');
    expect(configuredSetupToken({ SETUP_TOKEN: ' '.repeat(40) })).toBe('');
    expect(setupTokenProblem({ SETUP_TOKEN: `${token}\n` })).toBeNull();
    expect(setupTokenProblem({ SETUP_TOKEN: ' '.repeat(40) })?.title).toBe('SETUP_TOKEN is not set');
    // What is compared is the trimmed value, so the typed token matches.
    expect(secretsMatch(token, configuredSetupToken({ SETUP_TOKEN: `${token} \n` }))).toBe(true);
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

describe('addressFromHeaders', () => {
  const from = (headers: Record<string, string>) => (name: string) => headers[name];

  it('on Vercel prefers X-Vercel-Forwarded-For, then X-Real-IP', () => {
    expect(addressFromHeaders(from({ 'x-vercel-forwarded-for': '203.0.113.7', 'x-real-ip': '198.51.100.1', 'x-forwarded-for': '1.2.3.4' }), true)).toBe('203.0.113.7');
    expect(addressFromHeaders(from({ 'x-vercel-forwarded-for': ' 203.0.113.7 , 10.0.0.1' }), true)).toBe('203.0.113.7');
    expect(addressFromHeaders(from({ 'x-real-ip': '198.51.100.1', 'x-forwarded-for': '1.2.3.4' }), true)).toBe('198.51.100.1');
  });

  it('on Vercel never trusts X-Forwarded-For, which the client can write', () => {
    expect(addressFromHeaders(from({ 'x-forwarded-for': '1.2.3.4, 203.0.113.7' }), true)).toBe('unknown');
    expect(addressFromHeaders(from({ 'x-vercel-forwarded-for': '', 'x-real-ip': ' ', 'x-forwarded-for': '1.2.3.4' }), true)).toBe('unknown');
  });

  it('elsewhere uses X-Real-IP, then the last X-Forwarded-For hop', () => {
    expect(addressFromHeaders(from({ 'x-real-ip': '198.51.100.1', 'x-forwarded-for': '1.2.3.4, 203.0.113.7' }), false)).toBe('198.51.100.1');
    // The first hop is the client's own claim; the last was added by the proxy.
    expect(addressFromHeaders(from({ 'x-forwarded-for': '1.2.3.4, 203.0.113.7' }), false)).toBe('203.0.113.7');
    expect(addressFromHeaders(from({ 'x-vercel-forwarded-for': '9.9.9.9' }), false)).toBe('unknown');
    expect(addressFromHeaders(from({}), false)).toBe('unknown');
  });
});
