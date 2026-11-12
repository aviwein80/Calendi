import { beforeAll, describe, expect, it } from 'vitest';
import { pickBookingCalendar } from '@/lib/calendars';
import { caldavService } from '@/lib/calendars/caldav';
import { GOOGLE_SCOPES, googleAuthorizeUrl } from '@/lib/calendars/google';
import { microsoftAuthorizeUrl } from '@/lib/calendars/microsoft';
import { OAUTH_SETUP, oauthClientFromEnv, oauthRedirectUri } from '@/lib/calendars/setup';
import { codeHash, codeMatches, normalizeEmail } from '@/lib/ownerEmails';

const client = { clientId: 'id', clientSecret: 'secret' };
const query = (url: string) => Object.fromEntries(new URL(url).searchParams);

describe('Google sign-in request', () => {
  it('asks only for the calendar scopes Calendi uses', () => {
    expect(GOOGLE_SCOPES).toEqual([
      'openid',
      'email',
      'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
      'https://www.googleapis.com/auth/calendar.freebusy',
      'https://www.googleapis.com/auth/calendar.events',
    ]);
    // In particular, never the scopes that read or manage everything.
    expect(GOOGLE_SCOPES).not.toContain('https://www.googleapis.com/auth/calendar');
    expect(GOOGLE_SCOPES).not.toContain('https://www.googleapis.com/auth/calendar.readonly');
    expect(query(googleAuthorizeUrl(client, 'https://x/cb', 's')).scope).toBe(GOOGLE_SCOPES.join(' '));
  });

  it('always shows the account picker, and asks for a refresh token', () => {
    const q = query(googleAuthorizeUrl(client, 'https://x/cb', 'state-1'));
    expect(q.prompt.split(' ')).toEqual(['select_account', 'consent']);
    expect(q.access_type).toBe('offline');
    expect(q.state).toBe('state-1');
    expect(q.include_granted_scopes).toBeUndefined();
    expect(q.login_hint).toBeUndefined();
  });

  it('pre-selects the account when reconnecting', () => {
    expect(query(googleAuthorizeUrl(client, 'https://x/cb', 's', 'me@gmail.com')).login_hint).toBe('me@gmail.com');
  });
});

describe('Microsoft sign-in request', () => {
  it('always shows the account picker and can pre-select one', () => {
    expect(query(microsoftAuthorizeUrl(client, 'https://x/cb', 's')).prompt).toBe('select_account');
    expect(query(microsoftAuthorizeUrl(client, 'https://x/cb', 's', 'me@outlook.com')).login_hint).toBe('me@outlook.com');
  });

  it('uses the tenant only when one is set', () => {
    expect(new URL(microsoftAuthorizeUrl(client, 'https://x/cb', 's')).pathname).toBe('/common/oauth2/v2.0/authorize');
    expect(new URL(microsoftAuthorizeUrl({ ...client, tenant: 'contoso' }, 'https://x/cb', 's')).pathname).toBe(
      '/contoso/oauth2/v2.0/authorize',
    );
  });
});

describe('app settings come only from the environment', () => {
  it('needs both the ID and the secret', () => {
    expect(oauthClientFromEnv('google', {})).toBeNull();
    expect(oauthClientFromEnv('google', { GOOGLE_CLIENT_ID: 'a' })).toBeNull();
    expect(oauthClientFromEnv('google', { GOOGLE_CLIENT_ID: 'a', GOOGLE_CLIENT_SECRET: '  ' })).toBeNull();
    expect(oauthClientFromEnv('google', { GOOGLE_CLIENT_ID: ' a\n', GOOGLE_CLIENT_SECRET: 'b ' })).toEqual({
      clientId: 'a',
      clientSecret: 'b',
    });
  });

  it('reads the Microsoft tenant, if any', () => {
    const env = { MICROSOFT_CLIENT_ID: 'a', MICROSOFT_CLIENT_SECRET: 'b' };
    expect(oauthClientFromEnv('microsoft', env)).toEqual({ clientId: 'a', clientSecret: 'b' });
    expect(oauthClientFromEnv('microsoft', { ...env, MICROSOFT_TENANT_ID: 't' })).toEqual({
      clientId: 'a',
      clientSecret: 'b',
      tenant: 't',
    });
    // Google settings are not Microsoft's.
    expect(oauthClientFromEnv('microsoft', { GOOGLE_CLIENT_ID: 'a', GOOGLE_CLIENT_SECRET: 'b' })).toBeNull();
  });
});

describe('the one-time setup guide', () => {
  it('gives the exact redirect URL', () => {
    expect(oauthRedirectUri('google', 'https://meet.example.com/')).toBe('https://meet.example.com/api/oauth/google/callback');
    expect(oauthRedirectUri('microsoft', 'https://x.vercel.app')).toBe('https://x.vercel.app/api/oauth/microsoft/callback');
  });

  it('has five steps for each provider, with links, the scopes and the variables', () => {
    for (const guide of Object.values(OAUTH_SETUP)) {
      expect(guide.steps).toHaveLength(5);
      expect(guide.steps.filter((step) => step.link?.href.startsWith('https://')).length).toBeGreaterThanOrEqual(3);
      expect(guide.variables).toHaveLength(2);
    }
    expect(OAUTH_SETUP.google.scopes).toEqual(GOOGLE_SCOPES);
    expect(OAUTH_SETUP.microsoft.scopes).toContain('Calendars.ReadWrite');
    expect(OAUTH_SETUP.google.steps.some((step) => /In production/.test(step.text))).toBe(true);
  });
});

describe('where a meeting type saves its bookings', () => {
  const calendars = [
    { id: 'default', can_write: true, is_booking_target: true },
    { id: 'work', can_write: true, is_booking_target: false },
    { id: 'holidays', can_write: false, is_booking_target: false },
  ];

  it('uses the type’s own calendar when it has one', () => {
    expect(pickBookingCalendar({ calendar_id: 'work' }, calendars)).toBe('work');
  });

  it('falls back to the default calendar', () => {
    expect(pickBookingCalendar({ calendar_id: null }, calendars)).toBe('default');
    expect(pickBookingCalendar(null, calendars)).toBe('default');
    // A choice that can no longer take bookings, or that was removed.
    expect(pickBookingCalendar({ calendar_id: 'holidays' }, calendars)).toBe('default');
    expect(pickBookingCalendar({ calendar_id: 'gone' }, calendars)).toBe('default');
  });

  it('is nothing when no calendar takes bookings', () => {
    expect(pickBookingCalendar({ calendar_id: null }, calendars.map((c) => ({ ...c, is_booking_target: false })))).toBeNull();
    expect(pickBookingCalendar({ calendar_id: 'work' }, [])).toBeNull();
  });
});

describe('CalDAV service names', () => {
  it('recognises iCloud and Fastmail', () => {
    expect(caldavService({ serverUrl: 'http://127.0.0.1:5232/', service: 'icloud' })).toBe('Apple iCloud');
    expect(caldavService({ serverUrl: 'https://caldav.icloud.com' })).toBe('Apple iCloud');
    expect(caldavService({ serverUrl: 'https://caldav.fastmail.com/dav/' })).toBe('Fastmail');
    expect(caldavService({ serverUrl: 'https://cloud.example.com/remote.php/dav' })).toBe('CalDAV (cloud.example.com)');
  });
});

describe('owner email addresses', () => {
  beforeAll(() => {
    process.env.APP_SECRET ??= 'unit-test-secret-0123456789abcdef0123';
  });

  it('normalises and checks an address', () => {
    expect(normalizeEmail('  Me@Example.COM ')).toBe('me@example.com');
    expect(normalizeEmail('not an email')).toBeNull();
    expect(normalizeEmail(42)).toBeNull();
    expect(normalizeEmail(`${'x'.repeat(200)}@example.com`)).toBeNull();
  });

  it('stores a code only as a keyed hash bound to the address', () => {
    const stored = codeHash('row-1', '123456');
    expect(stored).not.toContain('123456');
    expect(codeHash('row-2', '123456')).not.toBe(stored);
    expect(codeMatches('row-1', '123456', stored)).toBe(true);
    expect(codeMatches('row-1', ' 123-456 ', stored)).toBe(true);
    expect(codeMatches('row-1', '123457', stored)).toBe(false);
    expect(codeMatches('row-2', '123456', stored)).toBe(false);
    expect(codeMatches('row-1', '12345', stored)).toBe(false);
    expect(codeMatches('row-1', '123456', '')).toBe(false);
  });
});
