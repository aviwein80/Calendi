import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import ICAL from 'ical.js';
import { busyFromIcs, IcsParseError, resolveZone } from '@/lib/calendars/icsParse';
import { buildIcs } from '@/lib/calendars/icsBuild';

const NY = 'America/New_York';
const at = (iso: string, zone = NY) => DateTime.fromISO(iso, { zone }).toMillis();
const show = (intervals: { start: number; end: number }[], zone = NY) =>
  intervals
    .sort((a, b) => a.start - b.start)
    .map(
      (i) =>
        `${DateTime.fromMillis(i.start, { zone }).toFormat('MM-dd HH:mm')}–${DateTime.fromMillis(i.end, { zone }).toFormat('MM-dd HH:mm')}`,
    );

const wrap = (...events: string[]) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN', ...events, 'END:VCALENDAR'].join('\r\n');

const NOV = [at('2026-11-01T00:00'), at('2026-12-01T00:00')] as const;

describe('busyFromIcs', () => {
  it('reads UTC, zoned and floating times', () => {
    const ics = wrap(
      'BEGIN:VEVENT\r\nUID:a\r\nDTSTART:20261110T150000Z\r\nDTEND:20261110T160000Z\r\nEND:VEVENT',
      'BEGIN:VEVENT\r\nUID:b\r\nDTSTART;TZID=America/Chicago:20261111T090000\r\nDTEND;TZID=America/Chicago:20261111T093000\r\nEND:VEVENT',
      'BEGIN:VEVENT\r\nUID:c\r\nDTSTART:20261112T130000\r\nDTEND:20261112T140000\r\nEND:VEVENT',
    );
    expect(show(busyFromIcs(ics, ...NOV, NY))).toEqual([
      '11-10 10:00–11-10 11:00',
      '11-11 10:00–11-11 10:30',
      '11-12 13:00–11-12 14:00',
    ]);
  });

  it('understands Outlook zone names', () => {
    const ics = wrap(
      'BEGIN:VEVENT\r\nUID:a\r\nDTSTART;TZID=Pacific Standard Time:20261110T090000\r\nDTEND;TZID=Pacific Standard Time:20261110T100000\r\nEND:VEVENT',
    );
    expect(show(busyFromIcs(ics, ...NOV, NY))).toEqual(['11-10 12:00–11-10 13:00']);
    expect(resolveZone('Eastern Standard Time')).toBe('America/New_York');
    expect(resolveZone('/mozilla.org/20050126_1/Europe/Brussels')).toBe('Europe/Brussels');
    expect(resolveZone('Nowhere/Special')).toBeUndefined();
  });

  it('falls back to a zone the file defines itself', () => {
    const ics = wrap(
      [
        'BEGIN:VTIMEZONE',
        'TZID:My Custom Zone',
        'BEGIN:STANDARD',
        'DTSTART:16010101T000000',
        'TZOFFSETFROM:+0300',
        'TZOFFSETTO:+0300',
        'END:STANDARD',
        'END:VTIMEZONE',
      ].join('\r\n'),
      'BEGIN:VEVENT\r\nUID:a\r\nDTSTART;TZID=My Custom Zone:20261110T180000\r\nDTEND;TZID=My Custom Zone:20261110T190000\r\nEND:VEVENT',
    );
    // 18:00 at UTC+3 is 15:00 UTC, which is 10:00 in New York.
    expect(show(busyFromIcs(ics, ...NOV, NY))).toEqual(['11-10 10:00–11-10 11:00']);
  });

  it('skips free, cancelled and out-of-range events', () => {
    const ics = wrap(
      'BEGIN:VEVENT\r\nUID:a\r\nDTSTART:20261110T150000Z\r\nDTEND:20261110T160000Z\r\nTRANSP:TRANSPARENT\r\nEND:VEVENT',
      'BEGIN:VEVENT\r\nUID:b\r\nDTSTART:20261110T170000Z\r\nDTEND:20261110T180000Z\r\nSTATUS:CANCELLED\r\nEND:VEVENT',
      'BEGIN:VEVENT\r\nUID:c\r\nDTSTART:20261110T190000Z\r\nDTEND:20261110T200000Z\r\nX-MICROSOFT-CDO-BUSYSTATUS:FREE\r\nEND:VEVENT',
      'BEGIN:VEVENT\r\nUID:d\r\nDTSTART:20250110T190000Z\r\nDTEND:20250110T200000Z\r\nEND:VEVENT',
      'BEGIN:VEVENT\r\nUID:e\r\nDTSTART:20261110T210000Z\r\nDTEND:20261110T220000Z\r\nX-MICROSOFT-CDO-BUSYSTATUS:BUSY\r\nEND:VEVENT',
    );
    expect(show(busyFromIcs(ics, ...NOV, NY))).toEqual(['11-10 16:00–11-10 17:00']);
  });

  it('blocks whole days for all-day events in the owner zone', () => {
    const ics = wrap(
      'BEGIN:VEVENT\r\nUID:a\r\nDTSTART;VALUE=DATE:20261112\r\nDTEND;VALUE=DATE:20261114\r\nEND:VEVENT',
      'BEGIN:VEVENT\r\nUID:b\r\nDTSTART;VALUE=DATE:20261120\r\nEND:VEVENT',
    );
    expect(show(busyFromIcs(ics, ...NOV, NY))).toEqual([
      '11-12 00:00–11-14 00:00',
      '11-20 00:00–11-21 00:00',
    ]);
  });

  it('uses DURATION when there is no DTEND', () => {
    const ics = wrap('BEGIN:VEVENT\r\nUID:a\r\nDTSTART:20261110T150000Z\r\nDURATION:PT45M\r\nEND:VEVENT');
    expect(show(busyFromIcs(ics, ...NOV, NY))).toEqual(['11-10 10:00–11-10 10:45']);
  });

  it('expands weekly repeats and keeps local time across daylight saving', () => {
    const ics = wrap(
      'BEGIN:VEVENT\r\nUID:a\r\nDTSTART;TZID=America/New_York:20261019T090000\r\nDTEND;TZID=America/New_York:20261019T100000\r\nRRULE:FREQ=WEEKLY;BYDAY=MO\r\nEND:VEVENT',
    );
    // 26 Oct is daylight time, 2 Nov onwards is standard time; always 9:00 locally.
    const busy = busyFromIcs(ics, at('2026-10-25T00:00'), at('2026-11-17T00:00'), NY);
    expect(show(busy)).toEqual([
      '10-26 09:00–10-26 10:00',
      '11-02 09:00–11-02 10:00',
      '11-09 09:00–11-09 10:00',
      '11-16 09:00–11-16 10:00',
    ]);
    expect(new Date(busy[0].start).toISOString()).toBe('2026-10-26T13:00:00.000Z');
    expect(new Date(busy[1].start).toISOString()).toBe('2026-11-02T14:00:00.000Z');
  });

  it('honours EXDATE, COUNT and UNTIL', () => {
    const ics = wrap(
      'BEGIN:VEVENT\r\nUID:a\r\nDTSTART:20261102T150000Z\r\nDTEND:20261102T153000Z\r\nRRULE:FREQ=DAILY;COUNT=4\r\nEXDATE:20261103T150000Z\r\nEND:VEVENT',
      'BEGIN:VEVENT\r\nUID:b\r\nDTSTART:20261116T200000Z\r\nDTEND:20261116T210000Z\r\nRRULE:FREQ=DAILY;UNTIL=20261117T235959Z\r\nEND:VEVENT',
    );
    expect(show(busyFromIcs(ics, ...NOV, 'UTC'), 'UTC')).toEqual([
      '11-02 15:00–11-02 15:30',
      '11-04 15:00–11-04 15:30',
      '11-05 15:00–11-05 15:30',
      '11-16 20:00–11-16 21:00',
      '11-17 20:00–11-17 21:00',
    ]);
  });

  it('applies edits to single occurrences of a series', () => {
    const ics = wrap(
      'BEGIN:VEVENT\r\nUID:a\r\nDTSTART:20261102T150000Z\r\nDTEND:20261102T160000Z\r\nRRULE:FREQ=WEEKLY;COUNT=4\r\nEND:VEVENT',
      // Second occurrence moved to the next day and lengthened.
      'BEGIN:VEVENT\r\nUID:a\r\nRECURRENCE-ID:20261109T150000Z\r\nDTSTART:20261110T170000Z\r\nDTEND:20261110T190000Z\r\nEND:VEVENT',
      // Third occurrence cancelled.
      'BEGIN:VEVENT\r\nUID:a\r\nRECURRENCE-ID:20261116T150000Z\r\nDTSTART:20261116T150000Z\r\nDTEND:20261116T160000Z\r\nSTATUS:CANCELLED\r\nEND:VEVENT',
      // A different series at the same times must not be affected.
      'BEGIN:VEVENT\r\nUID:z\r\nDTSTART:20261109T150000Z\r\nDTEND:20261109T151500Z\r\nRRULE:FREQ=WEEKLY;COUNT=2\r\nEND:VEVENT',
    );
    expect(show(busyFromIcs(ics, ...NOV, 'UTC'), 'UTC')).toEqual([
      '11-02 15:00–11-02 16:00',
      '11-09 15:00–11-09 15:15',
      '11-10 17:00–11-10 19:00',
      '11-16 15:00–11-16 15:15',
      '11-23 15:00–11-23 16:00',
    ]);
  });

  it('expands a long-running daily series without scanning forever', () => {
    const ics = wrap(
      'BEGIN:VEVENT\r\nUID:a\r\nDTSTART;TZID=America/New_York:20150105T120000\r\nDTEND;TZID=America/New_York:20150105T123000\r\nRRULE:FREQ=DAILY\r\nEND:VEVENT',
    );
    const busy = busyFromIcs(ics, at('2026-11-09T00:00'), at('2026-11-11T00:00'), NY);
    expect(show(busy)).toEqual(['11-09 12:00–11-09 12:30', '11-10 12:00–11-10 12:30']);
  });

  it('repeats all-day events', () => {
    const ics = wrap(
      'BEGIN:VEVENT\r\nUID:a\r\nDTSTART;VALUE=DATE:20261106\r\nDTEND;VALUE=DATE:20261107\r\nRRULE:FREQ=WEEKLY;COUNT=3\r\nEND:VEVENT',
    );
    expect(show(busyFromIcs(ics, ...NOV, NY))).toEqual([
      '11-06 00:00–11-07 00:00',
      '11-13 00:00–11-14 00:00',
      '11-20 00:00–11-21 00:00',
    ]);
  });

  it('rejects data that is not a calendar', () => {
    expect(() => busyFromIcs('<html>Sign in</html>', ...NOV, NY)).toThrow(IcsParseError);
  });

  it('survives one malformed event', () => {
    const ics = wrap(
      'BEGIN:VEVENT\r\nUID:bad\r\nDTSTART:not-a-date\r\nEND:VEVENT',
      'BEGIN:VEVENT\r\nUID:ok\r\nDTSTART:20261110T150000Z\r\nDTEND:20261110T160000Z\r\nEND:VEVENT',
    );
    let busy: { start: number; end: number }[] = [];
    try {
      busy = busyFromIcs(ics, ...NOV, 'UTC');
    } catch (err) {
      // Acceptable only if the whole file is reported as unreadable.
      expect(err).toBeInstanceOf(IcsParseError);
      return;
    }
    expect(show(busy, 'UTC')).toEqual(['11-10 15:00–11-10 16:00']);
  });
});

describe('buildIcs', () => {
  it('writes a file that parses back to the same event', () => {
    const text = buildIcs(
      {
        uid: 'booking-1@calendi',
        start: new Date('2026-11-10T15:00:00Z'),
        end: new Date('2026-11-10T15:30:00Z'),
        title: 'Intro call; with, punctuation',
        description: 'Line one\nLine two with a very long sentence that needs to be folded because it is far longer than seventy-five octets wide. Ünïcödé too.',
        location: 'https://meet.example.com/abc',
        organizer: { name: 'Avi "The Host"', email: 'host@example.com' },
        attendees: [{ name: 'Jane: Doe', email: 'jane@example.com' }],
        sequence: 2,
      },
      new Date('2026-11-01T00:00:00Z'),
    );
    for (const line of text.split('\r\n')) {
      expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
    }
    const vevent = new ICAL.Component(ICAL.parse(text)).getFirstSubcomponent('vevent')!;
    const event = new ICAL.Event(vevent);
    expect(event.summary).toBe('Intro call; with, punctuation');
    expect(event.description).toContain('Line one\nLine two');
    expect(event.description).toContain('Ünïcödé too.');
    expect(event.startDate.toJSDate().toISOString()).toBe('2026-11-10T15:00:00.000Z');
    expect(event.endDate.toJSDate().toISOString()).toBe('2026-11-10T15:30:00.000Z');
    expect(vevent.getFirstPropertyValue('sequence')).toBe(2);
    expect(String(vevent.getFirstPropertyValue('attendee'))).toBe('mailto:jane@example.com');
    const busy = busyFromIcs(text, Date.parse('2026-11-10T00:00Z'), Date.parse('2026-11-11T00:00Z'), 'UTC');
    expect(busy).toHaveLength(1);
  });

  it('marks cancellations', () => {
    const text = buildIcs({
      uid: 'x',
      start: new Date('2026-11-10T15:00:00Z'),
      end: new Date('2026-11-10T15:30:00Z'),
      title: 'Gone',
      description: '',
      location: '',
      cancelled: true,
      method: 'CANCEL',
    });
    expect(text).toContain('METHOD:CANCEL');
    expect(text).toContain('STATUS:CANCELLED');
  });
});
