import type { Interval } from '../types';
import { busyFromIcs } from './icsParse';
import {
  calendarCacheMs,
  ProviderError,
  request,
  type CalendarProvider,
  type ExternalCalendar,
  type IcsCredentials,
} from './types';

// A read-only calendar subscription link (.ics / webcal). Every calendar
// product can produce one, so this is the universal fallback. Calendi can
// read busy times from it but cannot add bookings to it.

const MAX_BYTES = 25 * 1024 * 1024;
const cache = new Map<string, { at: number; text: string }>();

export function normalizeIcsUrl(input: string): string {
  const trimmed = input.trim().replace(/^webcals?:\/\//i, 'https://');
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new ProviderError('That does not look like a web address.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ProviderError('The calendar link must start with https:// or webcal://.');
  }
  return url.href;
}

export async function fetchIcs(url: string, fresh = false): Promise<string> {
  const hit = cache.get(url);
  if (!fresh && hit && Date.now() - hit.at < calendarCacheMs()) return hit.text;

  const response = await request(url, { headers: { Accept: 'text/calendar, text/plain, */*' } }, 20_000);
  if (!response.ok) {
    throw new ProviderError(
      `The calendar link answered ${response.status}. Check that the link is still shared.`,
      response.status,
      response.status === 401 || response.status === 403 || response.status === 404,
    );
  }
  const text = await response.text();
  if (text.length > MAX_BYTES) throw new ProviderError('The calendar file is too large to read.');
  if (!text.includes('BEGIN:VCALENDAR')) {
    throw new ProviderError('The link did not return calendar data (expected an .ics file).');
  }
  cache.set(url, { at: Date.now(), text });
  return text;
}

/** Reads the calendar's own name from the file, if it has one. */
export function icsCalendarName(text: string): string {
  const match = /^X-WR-CALNAME:(.+)$/m.exec(text);
  return match ? match[1].trim().replace(/\\([,;])/g, '$1').slice(0, 80) : '';
}

export const icsProvider: CalendarProvider<IcsCredentials> = {
  async listCalendars(credentials): Promise<ExternalCalendar[]> {
    const text = await fetchIcs(credentials.url, true);
    // Parse once now so a broken feed is reported when it is added, not later.
    busyFromIcs(text, Date.now(), Date.now() + 86_400_000, 'UTC');
    return [
      {
        externalId: 'feed',
        name: icsCalendarName(text) || 'Calendar feed',
        color: '',
        canWrite: false,
        primary: true,
      },
    ];
  },

  async getBusy(credentials, externalIds, from, to, defaultZone, fresh): Promise<Interval[]> {
    if (externalIds.length === 0) return [];
    const text = await fetchIcs(credentials.url, fresh);
    return busyFromIcs(text, from.getTime(), to.getTime(), defaultZone);
  },
};
