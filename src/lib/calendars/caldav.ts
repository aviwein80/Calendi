import { DAVClient, type DAVCalendar } from 'tsdav';
import type { Interval } from '../types';
import { buildIcs } from './icsBuild';
import { busyFromIcs } from './icsParse';
import {
  ProviderError,
  type CalDavCredentials,
  type CalendarProvider,
  type CreatedEvent,
  type EventInput,
  type ExternalCalendar,
} from './types';

// CalDAV covers Apple iCloud, Fastmail, Nextcloud and most self-hosted
// calendars. iCloud needs an app-specific password, not the Apple ID password.
// Only the server's address is needed: the account's calendars are found from
// there (the standard CalDAV discovery steps, which tsdav performs on login).

/** iCloud's CalDAV address. ICLOUD_CALDAV_URL exists only so tests can point it at a stand-in. */
export const icloudServerUrl = () => process.env.ICLOUD_CALDAV_URL || 'https://caldav.icloud.com';

export const CALDAV_PRESETS = {
  fastmail: 'https://caldav.fastmail.com/dav/',
} as const;

/** The name of the service behind a CalDAV connection, for display. */
export function caldavService(credentials: Pick<CalDavCredentials, 'serverUrl' | 'service'>): string {
  if (credentials.service === 'icloud') return 'Apple iCloud';
  let host = '';
  try {
    host = new URL(credentials.serverUrl).host;
  } catch {
    // fall through
  }
  if (/(^|\.)icloud\.com$/i.test(host)) return 'Apple iCloud';
  if (/(^|\.)fastmail\.com$/i.test(host)) return 'Fastmail';
  return host ? `CalDAV (${host})` : 'CalDAV';
}

async function connect(credentials: CalDavCredentials): Promise<DAVClient> {
  const client = new DAVClient({
    serverUrl: credentials.serverUrl,
    credentials: { username: credentials.username, password: credentials.password },
    authMethod: 'Basic',
    defaultAccountType: 'caldav',
    fetchOptions: { signal: AbortSignal.timeout(20_000) },
  });
  try {
    await client.login();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const denied = /401|403|unauthor|forbidden|invalid credentials/i.test(message);
    throw new ProviderError(
      denied
        ? 'The calendar server rejected the username or password.'
        : `Could not reach the calendar server (${message.slice(0, 200)}).`,
      denied ? 401 : 0,
      denied,
    );
  }
  return client;
}

function isEventCalendar(calendar: DAVCalendar): boolean {
  return !calendar.components || calendar.components.includes('VEVENT');
}

function displayName(calendar: DAVCalendar): string {
  return typeof calendar.displayName === 'string' && calendar.displayName
    ? calendar.displayName
    : 'Calendar';
}

function eventIcs(event: EventInput): string {
  // No ATTENDEE lines: some servers would send their own invitations, and
  // Calendi already emails the invitee itself for CalDAV calendars.
  return buildIcs({
    uid: event.uid,
    start: event.start,
    end: event.end,
    title: event.title,
    description: event.description,
    location: event.location,
    sequence: event.sequence,
  });
}

async function expectOk(response: Response, action: string): Promise<void> {
  if (response.ok) return;
  throw new ProviderError(
    `The calendar server refused to ${action} the event (${response.status}).`,
    response.status,
    response.status === 401,
  );
}

export const caldavProvider: CalendarProvider<CalDavCredentials> = {
  async listCalendars(credentials): Promise<ExternalCalendar[]> {
    const client = await connect(credentials);
    const calendars = await client.fetchCalendars();
    return calendars.filter(isEventCalendar).map((calendar, index) => ({
      externalId: calendar.url,
      name: displayName(calendar),
      color: typeof calendar.calendarColor === 'string' ? calendar.calendarColor.slice(0, 7) : '',
      // CalDAV has no reliable "read-only" flag; a failed save is reported at booking time.
      canWrite: true,
      primary: index === 0,
    }));
  },

  async getBusy(credentials, externalIds, from, to, defaultZone): Promise<Interval[]> {
    if (externalIds.length === 0) return [];
    const client = await connect(credentials);
    const busy: Interval[] = [];
    for (const url of externalIds) {
      let objects;
      try {
        objects = await client.fetchCalendarObjects({
          calendar: { url },
          timeRange: { start: from.toISOString(), end: to.toISOString() },
        });
      } catch (err) {
        throw new ProviderError(
          `Could not read a calendar over CalDAV (${err instanceof Error ? err.message.slice(0, 200) : 'error'}).`,
        );
      }
      for (const object of objects) {
        if (typeof object.data !== 'string' || !object.data.includes('BEGIN:VEVENT')) continue;
        try {
          busy.push(...busyFromIcs(object.data, from.getTime(), to.getTime(), defaultZone));
        } catch {
          // Skip an unreadable event rather than hide the whole calendar.
        }
      }
    }
    return busy;
  },

  async createEvent(credentials, externalId, event): Promise<CreatedEvent> {
    const client = await connect(credentials);
    const filename = `${event.uid}.ics`;
    const response = await client.createCalendarObject({
      calendar: { url: externalId },
      filename,
      iCalString: eventIcs(event),
    });
    await expectOk(response, 'save');
    return {
      externalEventId: new URL(filename, externalId.endsWith('/') ? externalId : externalId + '/').href,
      meetingUrl: '',
      invited: false,
    };
  },

  async updateEvent(credentials, _externalId, externalEventId, event): Promise<void> {
    const client = await connect(credentials);
    const response = await client.updateCalendarObject({
      calendarObject: { url: externalEventId, data: eventIcs(event) },
    });
    await expectOk(response, 'update');
  },

  async deleteEvent(credentials, _externalId, externalEventId): Promise<void> {
    const client = await connect(credentials);
    const response = await client.deleteCalendarObject({ calendarObject: { url: externalEventId } });
    if (response.status === 404 || response.status === 410) return;
    await expectOk(response, 'delete');
  },
};
