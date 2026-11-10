import { DateTime, IANAZone } from 'luxon';
import type { LocationType } from './types';

// Formatting helpers shared by the server (emails, calendar events) and the
// browser (booking pages). No server-only imports here.

export function isValidZone(zone: string): boolean {
  return typeof zone === 'string' && zone.length > 0 && IANAZone.isValidZone(zone);
}

/** "Thursday, November 12, 2026" */
export function formatDate(date: Date | number | string, zone: string): string {
  return toDateTime(date, zone).toFormat('cccc, LLLL d, yyyy');
}

/** "3:00 PM" or "15:00" */
export function formatTime(date: Date | number | string, zone: string, hour12 = true): string {
  return toDateTime(date, zone).toFormat(hour12 ? 'h:mm a' : 'HH:mm');
}

/** "3:00 PM – 3:30 PM, Thursday, November 12, 2026" */
export function formatRange(
  start: Date | number | string,
  end: Date | number | string,
  zone: string,
  hour12 = true,
): string {
  return `${formatTime(start, zone, hour12)} – ${formatTime(end, zone, hour12)}, ${formatDate(start, zone)}`;
}

/** "Eastern Time (New York)" style label: the zone's long name plus its city. */
export function zoneLabel(zone: string, at: Date | number | string = Date.now()): string {
  const dt = toDateTime(at, zone);
  const city = zone.split('/').pop()!.replace(/_/g, ' ');
  const long = dt.offsetNameLong;
  return long && long !== zone ? `${long} (${city})` : zone.replace(/_/g, ' ');
}

function toDateTime(date: Date | number | string, zone: string): DateTime {
  const dt =
    typeof date === 'string'
      ? DateTime.fromISO(date, { zone: 'utc' })
      : DateTime.fromMillis(typeof date === 'number' ? date : date.getTime());
  return dt.setZone(isValidZone(zone) ? zone : 'utc').setLocale('en-US');
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const h = `${hours} hr${hours === 1 ? '' : 's'}`;
  return rest ? `${h} ${rest} min` : h;
}

export const LOCATION_LABELS: Record<LocationType, string> = {
  none: 'No location',
  google_meet: 'Google Meet',
  teams: 'Microsoft Teams',
  link: 'Video call',
  phone: 'Phone call',
  in_person: 'In person',
};

/** What an invitee is told about where the meeting happens, before booking. */
export function locationSummary(type: LocationType, value: string): string {
  switch (type) {
    case 'google_meet':
      return 'Google Meet (link sent after booking)';
    case 'teams':
      return 'Microsoft Teams (link sent after booking)';
    case 'link':
      return 'Video call (link sent after booking)';
    case 'phone':
      return 'Phone call';
    case 'in_person':
      return value || 'In person';
    default:
      return '';
  }
}
