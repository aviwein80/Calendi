import 'server-only';
import { decryptJson } from '../crypto';
import {
  claimAccountAlert,
  getBookingTarget,
  getCalendar,
  getCalendarAccount,
  getIntegrations,
  insertCalendarAccount,
  listCalendarAccounts,
  listCalendars,
  replaceAccountCalendars,
  saveAccountCredentials,
  setAccountStatus,
  setBookingTarget,
} from '../store';
import type { CalendarAccount, CalendarProviderId, Interval } from '../types';
import { caldavProvider } from './caldav';
import { googleProvider, googleRefresh } from './google';
import { icsProvider } from './ics';
import { microsoftProvider, microsoftRefresh } from './microsoft';
import {
  calendarCacheMs,
  ProviderError,
  type CalendarProvider,
  type CreatedEvent,
  type EventInput,
  type OAuthClient,
  type OAuthCredentials,
} from './types';

// The one place the rest of the app talks to calendars through. It picks the
// right provider, keeps OAuth tokens fresh, caches busy lookups briefly and
// records when a connection stops working.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const providers: Record<CalendarProviderId, CalendarProvider<any>> = {
  google: googleProvider,
  microsoft: microsoftProvider,
  caldav: caldavProvider,
  ics: icsProvider,
};

export const PROVIDER_NAMES: Record<CalendarProviderId, string> = {
  google: 'Google Calendar',
  microsoft: 'Outlook / Microsoft 365',
  caldav: 'CalDAV',
  ics: 'Calendar feed',
};

/** The OAuth app credentials: environment variables win, then what was saved in the admin. */
export async function oauthClient(provider: 'google' | 'microsoft'): Promise<OAuthClient | null> {
  if (provider === 'google') {
    if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
      return { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET };
    }
  } else if (process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET) {
    return {
      clientId: process.env.MICROSOFT_CLIENT_ID,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
      tenant: process.env.MICROSOFT_TENANT_ID,
    };
  }
  const saved = (await getIntegrations())[provider];
  return saved?.clientId && saved.clientSecret ? saved : null;
}

function isOAuth(account: CalendarAccount): boolean {
  return account.provider === 'google' || account.provider === 'microsoft';
}

const refreshing = new Map<string, Promise<OAuthCredentials>>();

async function credentialsFor(account: CalendarAccount, forceRefresh: boolean): Promise<unknown> {
  const credentials = decryptJson<unknown>(account.credentials);
  if (!isOAuth(account)) return credentials;

  const oauth = credentials as OAuthCredentials;
  if (!forceRefresh && oauth.expiresAt - Date.now() > 120_000) return oauth;

  const provider = account.provider as 'google' | 'microsoft';
  const client = await oauthClient(provider);
  if (!client) {
    throw new ProviderError(
      `The ${PROVIDER_NAMES[provider]} app credentials are missing. Add them again under Calendars.`,
      0,
      true,
    );
  }
  // Several requests can find the token expired at the same moment. They share
  // one refresh, so a provider that hands out single-use refresh tokens is
  // never sent the same one twice.
  let pending = refreshing.get(account.id);
  if (!pending) {
    pending = (async () => {
      const refresh = provider === 'google' ? googleRefresh : microsoftRefresh;
      const tokens = await refresh(client, oauth.refreshToken);
      const next: OAuthCredentials = { ...oauth, ...tokens };
      await saveAccountCredentials(account.id, next);
      return next;
    })().finally(() => refreshing.delete(account.id));
    refreshing.set(account.id, pending);
  }
  return pending;
}

/** Runs a provider call, refreshing the access token once if it was rejected. */
async function withCredentials<T>(
  account: CalendarAccount,
  run: (credentials: unknown) => Promise<T>,
): Promise<T> {
  const credentials = await credentialsFor(account, false);
  try {
    return await run(credentials);
  } catch (err) {
    if (isOAuth(account) && err instanceof ProviderError && err.status === 401) {
      return run(await credentialsFor(account, true));
    }
    throw err;
  }
}

function describe(err: unknown): string {
  if (err instanceof ProviderError && err.reconnect) {
    return `${err.message} Reconnect this account.`;
  }
  return err instanceof Error ? err.message : 'Unknown error';
}

/** Thrown when a connected calendar cannot be read, so we never guess at availability. */
export class CalendarUnavailableError extends Error {
  accountLabel: string;
  constructor(account: CalendarAccount, detail: string) {
    super(`Could not read ${PROVIDER_NAMES[account.provider]} (${account.label}): ${detail}`);
    this.name = 'CalendarUnavailableError';
    this.accountLabel = account.label;
  }
}

type AlertHandler = (account: CalendarAccount, detail: string) => Promise<void>;
let alertHandler: AlertHandler | null = null;
/** Lets the email module hear about broken connections without a circular import. */
export function onCalendarFailure(handler: AlertHandler): void {
  alertHandler = handler;
}

async function recordFailure(account: CalendarAccount, detail: string): Promise<void> {
  try {
    await setAccountStatus(account.id, detail);
    if (alertHandler && (await claimAccountAlert(account.id))) {
      await alertHandler(account, detail);
    }
  } catch {
    // Reporting the failure must never mask the failure itself.
  }
}

const busyCache = new Map<string, { at: number; intervals: Interval[] }>();

export function clearBusyCache(): void {
  busyCache.clear();
}

/**
 * Busy time from every calendar marked "check for conflicts".
 * Fails loudly (CalendarUnavailableError) if any of them cannot be read.
 */
export async function getCalendarBusy(
  from: Date,
  to: Date,
  defaultZone: string,
  fresh = false,
): Promise<Interval[]> {
  const [accounts, calendars] = await Promise.all([listCalendarAccounts(), listCalendars()]);
  const perAccount = await Promise.all(
    accounts.map(async (account) => {
      const ids = calendars
        .filter((c) => c.account_id === account.id && c.check_conflicts)
        .map((c) => c.external_id);
      if (ids.length === 0) return [];

      const key = [account.id, ids.join(','), from.getTime(), to.getTime(), defaultZone].join('|');
      const hit = busyCache.get(key);
      if (!fresh && hit && Date.now() - hit.at < calendarCacheMs()) return hit.intervals;

      try {
        const intervals = await withCredentials(account, (credentials) =>
          providers[account.provider].getBusy(credentials, ids, from, to, defaultZone, fresh),
        );
        if (busyCache.size > 200) busyCache.clear();
        busyCache.set(key, { at: Date.now(), intervals });
        if (account.status === 'error') await setAccountStatus(account.id, null);
        return intervals;
      } catch (err) {
        const detail = describe(err);
        await recordFailure(account, detail);
        throw new CalendarUnavailableError(account, detail);
      }
    }),
  );
  return perAccount.flat();
}

/** Which provider new bookings are saved to, if any. */
export async function bookingTargetProvider(): Promise<CalendarProviderId | null> {
  const target = await getBookingTarget();
  if (!target) return null;
  return (await getCalendarAccount(target.account_id))?.provider ?? null;
}

/** Adds the booking to the owner's chosen calendar. Null when none is chosen. */
export async function createCalendarEvent(
  event: EventInput,
): Promise<{ calendarId: string; created: CreatedEvent } | null> {
  const target = await getBookingTarget();
  if (!target) return null;
  const account = await getCalendarAccount(target.account_id);
  const provider = account ? providers[account.provider] : null;
  if (!account || !provider?.createEvent) return null;
  const created = await withCredentials(account, (credentials) =>
    provider.createEvent!(credentials, target.external_id, event),
  );
  clearBusyCache();
  return { calendarId: target.id, created };
}

async function eventContext(calendarId: string) {
  const calendar = await getCalendar(calendarId);
  const account = calendar ? await getCalendarAccount(calendar.account_id) : null;
  if (!calendar || !account) {
    throw new ProviderError('The calendar this booking was saved to is no longer connected.');
  }
  return { calendar, account, provider: providers[account.provider] };
}

export async function updateCalendarEvent(
  calendarId: string,
  externalEventId: string,
  event: EventInput,
): Promise<void> {
  const { calendar, account, provider } = await eventContext(calendarId);
  if (!provider.updateEvent) return;
  await withCredentials(account, (credentials) =>
    provider.updateEvent!(credentials, calendar.external_id, externalEventId, event),
  );
  clearBusyCache();
}

export async function deleteCalendarEvent(calendarId: string, externalEventId: string): Promise<void> {
  const { calendar, account, provider } = await eventContext(calendarId);
  if (!provider.deleteEvent) return;
  await withCredentials(account, (credentials) =>
    provider.deleteEvent!(credentials, calendar.external_id, externalEventId),
  );
  clearBusyCache();
}

async function syncCalendars(account: CalendarAccount, credentials: unknown): Promise<void> {
  const found = await providers[account.provider].listCalendars(credentials);
  await replaceAccountCalendars(
    account.id,
    found.map((calendar) => ({
      externalId: calendar.externalId,
      name: calendar.name,
      color: calendar.color,
      canWrite: calendar.canWrite && Boolean(providers[account.provider].createEvent),
      // Holiday and other read-only calendars start unchecked.
      checkByDefault: calendar.primary || calendar.canWrite || account.provider === 'ics',
    })),
  );

  // The first writable calendar to be connected becomes where bookings are saved.
  if (!(await getBookingTarget())) {
    const primary = found.find((c) => c.primary && c.canWrite) ?? found.find((c) => c.canWrite);
    if (primary && providers[account.provider].createEvent) {
      const row = (await listCalendars()).find(
        (c) => c.account_id === account.id && c.external_id === primary.externalId,
      );
      if (row) await setBookingTarget(row.id);
    }
  }
  clearBusyCache();
}

/**
 * Links a calendar account. Credentials are checked against the provider
 * first, so a wrong password or dead link is rejected here. Connecting the
 * same account twice just refreshes it.
 */
export async function connectAccount(
  provider: CalendarProviderId,
  label: string,
  credentials: unknown,
): Promise<CalendarAccount> {
  await providers[provider].listCalendars(credentials);
  const existing = (await listCalendarAccounts()).find(
    (a) => a.provider === provider && a.label === label,
  );
  let account: CalendarAccount;
  if (existing) {
    await saveAccountCredentials(existing.id, credentials);
    await setAccountStatus(existing.id, null);
    account = existing;
  } else {
    account = await insertCalendarAccount({ provider, label, credentials });
  }
  await syncCalendars(account, credentials);
  return account;
}

/** Re-reads the list of calendars in an account (new ones appear, deleted ones go). */
export async function refreshAccountCalendars(accountId: string): Promise<void> {
  const account = await getCalendarAccount(accountId);
  if (!account) return;
  try {
    await withCredentials(account, (credentials) => syncCalendars(account, credentials));
    await setAccountStatus(account.id, null);
  } catch (err) {
    await setAccountStatus(account.id, describe(err));
    throw err;
  }
}
