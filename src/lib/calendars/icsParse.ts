import ICAL from 'ical.js';
import { DateTime, IANAZone } from 'luxon';
import type { Interval } from '../types';

// Turns iCalendar text (an ICS feed, or events fetched over CalDAV) into busy
// intervals for a time range. Handles recurring events, edited or cancelled
// single occurrences, all-day events and events marked "free".

const DAY = 86_400_000;
/** Safety valve for pathological recurrence rules. */
const MAX_OCCURRENCES = 20_000;
/** How far past the range we keep expanding, to catch occurrences moved earlier. */
const LOOKAHEAD = 31 * DAY;

// Outlook writes Windows zone names. These cover the zones people actually use;
// anything else falls back to the VTIMEZONE block in the file itself.
const WINDOWS_ZONES: Record<string, string> = {
  'Dateline Standard Time': 'Etc/GMT+12',
  'Hawaiian Standard Time': 'Pacific/Honolulu',
  'Alaskan Standard Time': 'America/Anchorage',
  'Pacific Standard Time': 'America/Los_Angeles',
  'Pacific Standard Time (Mexico)': 'America/Tijuana',
  'US Mountain Standard Time': 'America/Phoenix',
  'Mountain Standard Time': 'America/Denver',
  'Mountain Standard Time (Mexico)': 'America/Mazatlan',
  'Central Standard Time': 'America/Chicago',
  'Central Standard Time (Mexico)': 'America/Mexico_City',
  'Canada Central Standard Time': 'America/Regina',
  'Central America Standard Time': 'America/Guatemala',
  'Eastern Standard Time': 'America/New_York',
  'US Eastern Standard Time': 'America/Indiana/Indianapolis',
  'SA Pacific Standard Time': 'America/Bogota',
  'Venezuela Standard Time': 'America/Caracas',
  'Atlantic Standard Time': 'America/Halifax',
  'SA Western Standard Time': 'America/La_Paz',
  'Pacific SA Standard Time': 'America/Santiago',
  'Newfoundland Standard Time': 'America/St_Johns',
  'E. South America Standard Time': 'America/Sao_Paulo',
  'Argentina Standard Time': 'America/Argentina/Buenos_Aires',
  'SA Eastern Standard Time': 'America/Cayenne',
  'Greenland Standard Time': 'America/Nuuk',
  'UTC-02': 'Etc/GMT+2',
  'Azores Standard Time': 'Atlantic/Azores',
  'Cape Verde Standard Time': 'Atlantic/Cape_Verde',
  UTC: 'UTC',
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'Morocco Standard Time': 'Africa/Casablanca',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Romance Standard Time': 'Europe/Paris',
  'Central European Standard Time': 'Europe/Warsaw',
  'W. Central Africa Standard Time': 'Africa/Lagos',
  'GTB Standard Time': 'Europe/Bucharest',
  'Middle East Standard Time': 'Asia/Beirut',
  'Egypt Standard Time': 'Africa/Cairo',
  'South Africa Standard Time': 'Africa/Johannesburg',
  'FLE Standard Time': 'Europe/Kyiv',
  'Israel Standard Time': 'Asia/Jerusalem',
  'Jordan Standard Time': 'Asia/Amman',
  'Turkey Standard Time': 'Europe/Istanbul',
  'Arabic Standard Time': 'Asia/Baghdad',
  'Arab Standard Time': 'Asia/Riyadh',
  'Russian Standard Time': 'Europe/Moscow',
  'E. Africa Standard Time': 'Africa/Nairobi',
  'Iran Standard Time': 'Asia/Tehran',
  'Arabian Standard Time': 'Asia/Dubai',
  'Azerbaijan Standard Time': 'Asia/Baku',
  'Georgian Standard Time': 'Asia/Tbilisi',
  'Afghanistan Standard Time': 'Asia/Kabul',
  'Pakistan Standard Time': 'Asia/Karachi',
  'West Asia Standard Time': 'Asia/Tashkent',
  'India Standard Time': 'Asia/Kolkata',
  'Sri Lanka Standard Time': 'Asia/Colombo',
  'Nepal Standard Time': 'Asia/Kathmandu',
  'Central Asia Standard Time': 'Asia/Almaty',
  'Bangladesh Standard Time': 'Asia/Dhaka',
  'Myanmar Standard Time': 'Asia/Yangon',
  'SE Asia Standard Time': 'Asia/Bangkok',
  'China Standard Time': 'Asia/Shanghai',
  'Singapore Standard Time': 'Asia/Singapore',
  'W. Australia Standard Time': 'Australia/Perth',
  'Taipei Standard Time': 'Asia/Taipei',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'Korea Standard Time': 'Asia/Seoul',
  'Cen. Australia Standard Time': 'Australia/Adelaide',
  'AUS Central Standard Time': 'Australia/Darwin',
  'E. Australia Standard Time': 'Australia/Brisbane',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'Tasmania Standard Time': 'Australia/Hobart',
  'West Pacific Standard Time': 'Pacific/Port_Moresby',
  'Central Pacific Standard Time': 'Pacific/Guadalcanal',
  'New Zealand Standard Time': 'Pacific/Auckland',
  'Fiji Standard Time': 'Pacific/Fiji',
  'Tonga Standard Time': 'Pacific/Tongatapu',
  'Samoa Standard Time': 'Pacific/Apia',
};

/** Maps a TZID from a calendar file to an IANA zone, if we can. */
export function resolveZone(tzid: string | undefined | null): string | undefined {
  if (!tzid) return undefined;
  const clean = tzid.replace(/^"|"$/g, '').trim();
  if (IANAZone.isValidZone(clean)) return clean;
  if (WINDOWS_ZONES[clean]) return WINDOWS_ZONES[clean];
  // Some producers prefix the zone, e.g. "/mozilla.org/20050126_1/Europe/Brussels".
  const tail = /([A-Za-z_]+\/[A-Za-z0-9_+\-/]+)$/.exec(clean);
  if (tail) {
    const parts = tail[1].split('/');
    for (let i = 0; i < parts.length - 1; i++) {
      const candidate = parts.slice(i).join('/');
      if (IANAZone.isValidZone(candidate)) return candidate;
    }
  }
  return undefined;
}

function isUtc(time: ICAL.Time): boolean {
  const tzid = time.zone?.tzid;
  return time.zone === ICAL.Timezone.utcTimezone || tzid === 'UTC' || tzid === 'Z';
}

/** Converts a calendar time to epoch ms. All-day and floating times use `defaultZone`. */
function toMillis(time: ICAL.Time, tzid: string | undefined, defaultZone: string): number {
  if (time.isDate) {
    return DateTime.fromObject(
      { year: time.year, month: time.month, day: time.day },
      { zone: defaultZone },
    ).toMillis();
  }
  const fields = {
    year: time.year,
    month: time.month,
    day: time.day,
    hour: time.hour,
    minute: time.minute,
    second: time.second,
  };
  if (isUtc(time)) {
    return Date.UTC(fields.year, fields.month - 1, fields.day, fields.hour, fields.minute, fields.second);
  }
  const zone = resolveZone(tzid);
  if (zone) return DateTime.fromObject(fields, { zone }).toMillis();
  // An unrecognised TZID that the file defines itself with a VTIMEZONE block.
  if (tzid && time.zone && time.zone !== ICAL.Timezone.localTimezone && time.zone.tzid !== 'floating') {
    return time.toUnixTime() * 1000;
  }
  return DateTime.fromObject(fields, { zone: defaultZone }).toMillis();
}

function text(component: ICAL.Component, name: string): string {
  const value = component.getFirstPropertyValue(name);
  return typeof value === 'string' ? value.toUpperCase() : '';
}

function blocksTime(component: ICAL.Component): boolean {
  if (text(component, 'status') === 'CANCELLED') return false;
  if (text(component, 'transp') === 'TRANSPARENT') return false;
  const outlook = text(component, 'x-microsoft-cdo-busystatus');
  return outlook !== 'FREE' && outlook !== 'WORKINGELSEWHERE';
}

function startTzid(component: ICAL.Component): string | undefined {
  const tzid = component.getFirstProperty('dtstart')?.getParameter('tzid');
  return typeof tzid === 'string' ? tzid : undefined;
}

function endTzid(component: ICAL.Component): string | undefined {
  const tzid = component.getFirstProperty('dtend')?.getParameter('tzid');
  return typeof tzid === 'string' ? tzid : startTzid(component);
}

/** The [start, end) of a single, non-repeating VEVENT. */
function singleInterval(event: ICAL.Event, defaultZone: string): Interval | null {
  const component = event.component;
  if (!event.startDate) return null;
  const start = toMillis(event.startDate, startTzid(component), defaultZone);
  let end: number;
  if (component.hasProperty('dtend')) {
    end = toMillis(event.endDate, endTzid(component), defaultZone);
  } else if (component.hasProperty('duration')) {
    end = start + event.duration.toSeconds() * 1000;
  } else if (event.startDate.isDate) {
    end = DateTime.fromMillis(start, { zone: defaultZone }).plus({ days: 1 }).toMillis();
  } else {
    end = start;
  }
  return end > start ? { start, end } : null;
}

export class IcsParseError extends Error {}

/**
 * Busy intervals overlapping [from, to), in epoch ms.
 * `defaultZone` is used for all-day events and times with no zone.
 */
export function busyFromIcs(icsText: string, from: number, to: number, defaultZone: string): Interval[] {
  let root: ICAL.Component;
  try {
    root = new ICAL.Component(ICAL.parse(icsText));
  } catch (err) {
    throw new IcsParseError(
      `The calendar data could not be read (${err instanceof Error ? err.message : 'parse error'}).`,
    );
  }
  if (root.name !== 'vcalendar') throw new IcsParseError('The data is not an iCalendar file.');

  const busy: Interval[] = [];
  const push = (interval: Interval | null) => {
    if (interval && interval.end > from && interval.start < to) busy.push(interval);
  };

  const vevents = root.getAllSubcomponents('vevent');
  const uidOf = (vevent: ICAL.Component) => String(vevent.getFirstPropertyValue('uid'));
  const masterUids = new Set<string>();
  // Edited occurrences, grouped by the series they belong to. They are handed
  // to each series explicitly: left to itself the library would try to attach
  // every edit in the file to every series.
  const editsByUid = new Map<string, ICAL.Component[]>();
  for (const vevent of vevents) {
    if (vevent.hasProperty('recurrence-id')) {
      const list = editsByUid.get(uidOf(vevent)) ?? [];
      list.push(vevent);
      editsByUid.set(uidOf(vevent), list);
    } else {
      masterUids.add(uidOf(vevent));
    }
  }

  for (const vevent of vevents) {
    try {
      const isException = vevent.hasProperty('recurrence-id');
      if (isException) {
        // An edited occurrence whose series is not in this file stands on its own.
        if (!masterUids.has(uidOf(vevent)) && blocksTime(vevent)) {
          push(singleInterval(new ICAL.Event(vevent), defaultZone));
        }
        continue;
      }

      const event = new ICAL.Event(vevent, {
        strictExceptions: true,
        exceptions: editsByUid.get(uidOf(vevent)) ?? [],
      });
      if (!event.startDate) continue;

      if (!event.isRecurring()) {
        if (blocksTime(vevent)) push(singleInterval(event, defaultZone));
        continue;
      }

      const masterBlocks = blocksTime(vevent);
      const masterTzid = startTzid(vevent);
      const base = singleInterval(event, defaultZone);
      const durationMs = base ? base.end - base.start : 0;
      const wholeDays = event.startDate.isDate ? Math.max(1, Math.round(durationMs / DAY)) : 0;

      const iterator = event.iterator();
      for (let count = 0; count < MAX_OCCURRENCES; count++) {
        const occurrence = iterator.next();
        if (!occurrence) break;
        const originalStart = toMillis(occurrence, masterTzid, defaultZone);
        if (originalStart > to + LOOKAHEAD) break;

        const details = event.getOccurrenceDetails(occurrence);
        if (details.item !== event) {
          // This occurrence was edited (moved, resized or cancelled) on its own.
          if (blocksTime(details.item.component)) push(singleInterval(details.item, defaultZone));
          continue;
        }
        if (!masterBlocks || durationMs <= 0) continue;
        const end = wholeDays
          ? DateTime.fromMillis(originalStart, { zone: defaultZone }).plus({ days: wholeDays }).toMillis()
          : originalStart + durationMs;
        push({ start: originalStart, end });
      }
    } catch {
      // One malformed event should not hide the rest of the calendar.
      continue;
    }
  }
  return busy;
}
