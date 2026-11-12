import type { Interval } from '../types';

/** A calendar as the provider describes it. */
export type ExternalCalendar = {
  externalId: string;
  name: string;
  color: string;
  canWrite: boolean;
  primary: boolean;
};

/** What we ask a provider to put on the calendar for a booking. */
export type EventInput = {
  /** Stable id for the event (the booking id). */
  uid: string;
  title: string;
  description: string;
  location: string;
  start: Date;
  end: Date;
  organizer: { name: string; email: string };
  attendees: { name: string; email: string }[];
  /** Ask the provider to create a video meeting. */
  conference: 'google_meet' | 'teams' | null;
  sequence: number;
};

export type CreatedEvent = {
  externalEventId: string;
  /** Join link, when the provider created a video meeting. */
  meetingUrl: string;
  /** True when the provider emailed the calendar invitation to attendees itself. */
  invited: boolean;
};

export type OAuthTokens = {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms. */
  expiresAt: number;
};

export type OAuthCredentials = OAuthTokens & { email: string };
export type CalDavCredentials = {
  serverUrl: string;
  username: string;
  password: string;
  /** Set for accounts added with "Connect iCloud". */
  service?: 'icloud';
};
export type IcsCredentials = { url: string };

export type OAuthClient = { clientId: string; clientSecret: string; tenant?: string };

export interface CalendarProvider<Credentials> {
  listCalendars(credentials: Credentials): Promise<ExternalCalendar[]>;
  /** Busy time across the given calendars. `defaultZone` places all-day events. */
  getBusy(
    credentials: Credentials,
    externalIds: string[],
    from: Date,
    to: Date,
    defaultZone: string,
    /** Skip any short-lived cache (used when confirming a booking). */
    fresh?: boolean,
  ): Promise<Interval[]>;
  createEvent?(credentials: Credentials, externalId: string, event: EventInput): Promise<CreatedEvent>;
  updateEvent?(
    credentials: Credentials,
    externalId: string,
    externalEventId: string,
    event: EventInput,
  ): Promise<void>;
  deleteEvent?(credentials: Credentials, externalId: string, externalEventId: string): Promise<void>;
}

/** A provider call failed. `reconnect` means the owner has to link the account again. */
export class ProviderError extends Error {
  status: number;
  reconnect: boolean;
  constructor(message: string, status = 0, reconnect = false) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.reconnect = reconnect;
  }
}

const DEFAULT_TIMEOUT_MS = 15_000;

/** fetch with a timeout that turns network failures into ProviderError. */
export async function request(
  url: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' });
  } catch (err) {
    const reason =
      err instanceof Error && err.name === 'TimeoutError' ? 'timed out' : 'could not be reached';
    throw new ProviderError(`${new URL(url).host} ${reason}`);
  }
}

/** Sends a request with a bearer token and parses the JSON reply. */
export async function requestJson<T>(
  url: string,
  accessToken: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await request(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new ProviderError(
      `${new URL(url).host} answered ${response.status}: ${body.slice(0, 300)}`,
      response.status,
      response.status === 401,
    );
  }
  if (response.status === 204) return undefined as T;
  const textBody = await response.text();
  return (textBody ? JSON.parse(textBody) : undefined) as T;
}

/**
 * How long calendar lookups are remembered, in milliseconds. One minute by
 * default: long enough to make browsing a booking page quick, short enough
 * that a new event shows up almost at once. Confirming a booking always
 * re-reads the calendars regardless. Set CALENDAR_CACHE_SECONDS=0 to switch
 * the cache off.
 */
export function calendarCacheMs(): number {
  const seconds = Number(process.env.CALENDAR_CACHE_SECONDS ?? 60);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : 60_000;
}
