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
  setCalendarConflicts,
} from '../store';
import type { CalendarAccount, CalendarProviderId, CalendarRow, EventType, Interval } from '../types';
import { caldavProvider, caldavService } from './caldav';
import { googleProvider, googleRefresh } from './google';
import { icsProvider } from './ics';
import { microsoftProvider, microsoftRefresh } from './microsoft';
import { oauthClientFromEnv, type OAuthProviderId } from './setup';
import {
  calendarCacheMs,
  ProviderError,
  type CalendarProvider,
  type CreatedEvent,
  type EventInput,
  type CalDavCredentials,
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
  ics: 'Calendar link',
};

/**
 * The Google or Microsoft app credentials for new connections. They come only
 * from the environment (GOOGLE_CLIENT_ID / _SECRET, MICROSOFT_CLIENT_ID /
 * _SECRET), set once by the owner; null until they are.
 */
export function oauthClient(provider: OAuthProviderId): OAuthClient | null {
  return oauthClientFromEnv(provider);
}

/**
 * The credentials used to refresh an account's tokens. Earlier versions let
 * the owner paste them into the admin instead; accounts connected that way
 * keep working with what was saved until the environment variables are set.
 */
async function refreshClient(provider: OAuthProviderId): Promise<OAuthClient | null> {
  const fromEnv = oauthClientFromEnv(provider);
  if (fromEnv) return fromEnv;
  const saved = (await getIntegrations())[provider];
  return saved?.clientId && saved.clientSecret ? saved : null;
}

/** Whether accounts still refresh with app credentials saved by an earlier version. */
export async function usesSavedAppCredentials(provider: OAuthProviderId): Promise<boolean> {
  if (oauthClientFromEnv(provider)) return false;
  return Boolean((await getIntegrations())[provider]?.clientId);
}

/** What the Calendars page shows for an account: the service, and which login it is. */
export function accountSummary(account: CalendarAccount): { service: string; email: string } {
  try {
    if (account.provider === 'google' || account.provider === 'microsoft') {
      const credentials = decryptJson<OAuthCredentials>(account.credentials);
      return { service: PROVIDER_NAMES[account.provider], email: credentials.email || account.label };
    }
    if (account.provider === 'caldav') {
      const credentials = decryptJson<CalDavCredentials>(account.credentials);
      return { service: caldavService(credentials), email: credentials.username };
    }
  } catch {
    // APP_SECRET changed since it was saved: fall back to what is stored in the clear.
  }
  return { service: PROVIDER_NAMES[account.provider], email: account.provider === 'ics' ? '' : account.label };
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

  const provider = account.provider as OAuthProviderId;
  const client = await refreshClient(provider);
  if (!client) {
    const names = provider === 'google' ? 'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET' : 'MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET';
    throw new ProviderError(`The ${PROVIDER_NAMES[provider]} app settings (${names}) are missing.`, 0, true);
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

/**
 * The calendar a meeting type's new bookings are added to: its own choice if
 * that calendar can still take bookings, otherwise the default one. Pure, so
 * the rule can be unit-tested.
 */
export function pickBookingCalendar(
  eventType: Pick<EventType, 'calendar_id'> | null | undefined,
  calendars: Pick<CalendarRow, 'id' | 'can_write' | 'is_booking_target'>[],
): string | null {
  const own = eventType?.calendar_id ? calendars.find((c) => c.id === eventType.calendar_id && c.can_write) : null;
  if (own) return own.id;
  return calendars.find((c) => c.is_booking_target && c.can_write)?.id ?? null;
}

async function bookingCalendar(eventType: Pick<EventType, 'calendar_id'> | null | undefined): Promise<CalendarRow | null> {
  const calendars = await listCalendars();
  const id = pickBookingCalendar(eventType, calendars);
  return calendars.find((c) => c.id === id) ?? null;
}

/** Which provider a meeting type's new bookings are saved to, if any. */
export async function bookingTargetProvider(
  eventType?: Pick<EventType, 'calendar_id'> | null,
): Promise<CalendarProviderId | null> {
  const target = await bookingCalendar(eventType);
  if (!target) return null;
  return (await getCalendarAccount(target.account_id))?.provider ?? null;
}

/** Adds the booking to the calendar chosen for its meeting type. Null when there is none. */
export async function createCalendarEvent(
  event: EventInput,
  eventType: Pick<EventType, 'calendar_id'> | null,
): Promise<{ calendarId: string; created: CreatedEvent } | null> {
  const target = await bookingCalendar(eventType);
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

/**
 * New calendars start with "check for conflicts" on. A few special calendars
 * (birthdays, some shared ones) cannot report busy times at all; left on, one
 * of those would pause every booking page, since an unreadable calendar is
 * treated as "no times can be offered". So each new calendar is tried once
 * here, and any the provider cannot read are switched off instead. The main
 * calendar is never switched off: if that cannot be read, connecting fails.
 */
async function switchOffUnreadable(account: CalendarAccount, credentials: unknown, added: CalendarRow[]): Promise<void> {
  const provider = providers[account.provider];
  const from = new Date();
  const to = new Date(from.getTime() + 86_400_000);
  const checked = added.filter((c) => c.check_conflicts);
  if (checked.length === 0) return;
  try {
    await provider.getBusy(credentials, checked.map((c) => c.external_id), from, to, 'UTC', true);
    return;
  } catch {
    // One of them (or the connection) failed: find out which.
  }
  await Promise.all(
    checked.map(async (calendar) => {
      try {
        await provider.getBusy(credentials, [calendar.external_id], from, to, 'UTC', true);
      } catch {
        await setCalendarConflicts(calendar.id, false);
      }
    }),
  );
}

async function syncCalendars(account: CalendarAccount, credentials: unknown): Promise<void> {
  const found = await providers[account.provider].listCalendars(credentials);
  const added = await replaceAccountCalendars(
    account.id,
    found.map((calendar) => ({
      externalId: calendar.externalId,
      name: calendar.name,
      color: calendar.color,
      canWrite: calendar.canWrite && Boolean(providers[account.provider].createEvent),
      checkByDefault: true,
    })),
  );
  const primaryIds = new Set(found.filter((c) => c.primary).map((c) => c.externalId));
  await switchOffUnreadable(
    account,
    credentials,
    added.filter((c) => !primaryIds.has(c.external_id)),
  );

  // Until one is chosen, bookings go to the main calendar of the first account connected.
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
    (a) => a.provider === provider && a.label.toLowerCase() === label.toLowerCase(),
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
