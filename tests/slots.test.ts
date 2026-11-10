import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import {
  computeSlots,
  mergeIntervals,
  overlapsAny,
  parseTime,
  subtractInterval,
  workingWindows,
  type SlotInput,
} from '@/lib/availability/slots';

const NY = 'America/New_York';
const at = (iso: string, zone = NY) => DateTime.fromISO(iso, { zone }).toMillis();
const local = (ms: number, zone = NY) => DateTime.fromMillis(ms, { zone }).toFormat('yyyy-MM-dd HH:mm');

const weekdays9to5 = {
  '1': [{ start: '09:00', end: '17:00' }],
  '2': [{ start: '09:00', end: '17:00' }],
  '3': [{ start: '09:00', end: '17:00' }],
  '4': [{ start: '09:00', end: '17:00' }],
  '5': [{ start: '09:00', end: '17:00' }],
};

function input(overrides: Partial<SlotInput> = {}): SlotInput {
  return {
    // Monday 9 Nov 2026 through Tuesday.
    rangeStart: at('2026-11-09T00:00'),
    rangeEnd: at('2026-11-10T00:00'),
    now: at('2026-11-01T12:00'),
    timezone: NY,
    weekly: weekdays9to5,
    overrides: {},
    durationMin: 30,
    intervalMin: 30,
    bufferBeforeMin: 0,
    bufferAfterMin: 0,
    minNoticeMin: 0,
    maxDaysAhead: 60,
    dailyLimit: null,
    eventTypeId: 'evt',
    busy: [],
    bookings: [],
    ...overrides,
  };
}

describe('helpers', () => {
  it('parses times, including end of day', () => {
    expect(parseTime('09:30')).toBe(570);
    expect(parseTime('24:00')).toBe(1440);
    expect(parseTime('25:00')).toBeNaN();
    expect(parseTime('9:75')).toBeNaN();
    expect(parseTime('nope')).toBeNaN();
  });

  it('merges touching and overlapping intervals', () => {
    expect(
      mergeIntervals([
        { start: 10, end: 20 },
        { start: 0, end: 5 },
        { start: 20, end: 30 },
        { start: 25, end: 28 },
        { start: 7, end: 7 },
      ]),
    ).toEqual([
      { start: 0, end: 5 },
      { start: 10, end: 30 },
    ]);
  });

  it('finds overlaps but treats touching as free', () => {
    const merged = mergeIntervals([
      { start: 10, end: 20 },
      { start: 40, end: 50 },
    ]);
    expect(overlapsAny(merged, 0, 10)).toBe(false);
    expect(overlapsAny(merged, 20, 40)).toBe(false);
    expect(overlapsAny(merged, 19, 21)).toBe(true);
    expect(overlapsAny(merged, 45, 46)).toBe(true);
    expect(overlapsAny(merged, 50, 60)).toBe(false);
  });

  it('cuts a hole out of intervals', () => {
    expect(subtractInterval([{ start: 0, end: 100 }], { start: 40, end: 60 })).toEqual([
      { start: 0, end: 40 },
      { start: 60, end: 100 },
    ]);
    expect(subtractInterval([{ start: 40, end: 60 }], { start: 40, end: 60 })).toEqual([]);
    expect(subtractInterval([{ start: 0, end: 10 }], { start: 40, end: 60 })).toEqual([{ start: 0, end: 10 }]);
  });
});

describe('computeSlots', () => {
  it('fills working hours on the slot grid', () => {
    const slots = computeSlots(input());
    expect(slots).toHaveLength(16);
    expect(local(slots[0])).toBe('2026-11-09 09:00');
    expect(local(slots[15])).toBe('2026-11-09 16:30');
  });

  it('never lets a meeting run past the end of the day', () => {
    const slots = computeSlots(input({ durationMin: 45 }));
    expect(local(slots[slots.length - 1])).toBe('2026-11-09 16:00');
  });

  it('returns nothing on days with no hours', () => {
    const slots = computeSlots(
      input({ rangeStart: at('2026-11-07T00:00'), rangeEnd: at('2026-11-09T00:00') }),
    );
    expect(slots).toEqual([]);
  });

  it('removes slots that collide with calendar events', () => {
    const slots = computeSlots(
      input({ busy: [{ start: at('2026-11-09T10:00'), end: at('2026-11-09T11:15') }] }),
    );
    const times = slots.map((s) => local(s).slice(11));
    expect(times).toContain('09:30');
    expect(times).not.toContain('10:00');
    expect(times).not.toContain('10:30');
    expect(times).not.toContain('11:00');
    expect(times).toContain('11:30');
  });

  it('keeps the requested gap around calendar events', () => {
    const slots = computeSlots(
      input({
        bufferBeforeMin: 15,
        bufferAfterMin: 30,
        busy: [{ start: at('2026-11-09T12:00'), end: at('2026-11-09T13:00') }],
      }),
    );
    const times = slots.map((s) => local(s).slice(11));
    // 11:00 ends 11:30 and needs 30 clear minutes after: fine. 11:30 would not.
    expect(times).toContain('11:00');
    expect(times).not.toContain('11:30');
    // After the event a 15 minute gap is needed, so 13:00 is out and 13:30 is in.
    expect(times).not.toContain('13:00');
    expect(times).toContain('13:30');
  });

  it("respects another booking's own buffers", () => {
    const slots = computeSlots(
      input({
        bookings: [
          {
            start: at('2026-11-09T12:00'),
            end: at('2026-11-09T12:30'),
            bufferBeforeMin: 30,
            bufferAfterMin: 30,
            eventTypeId: 'other',
          },
        ],
      }),
    );
    const times = slots.map((s) => local(s).slice(11));
    expect(times).toContain('11:00');
    expect(times).not.toContain('11:30');
    expect(times).not.toContain('12:00');
    expect(times).not.toContain('12:30');
    expect(times).toContain('13:00');
  });

  it('applies minimum notice', () => {
    const slots = computeSlots(input({ now: at('2026-11-09T09:10'), minNoticeMin: 120 }));
    expect(local(slots[0])).toBe('2026-11-09 11:30');
  });

  it('never offers times in the past', () => {
    const slots = computeSlots(input({ now: at('2026-11-09T15:40') }));
    expect(slots.map((s) => local(s).slice(11))).toEqual(['16:00', '16:30']);
  });

  it('stops at the booking window', () => {
    const base = { now: at('2026-11-09T08:00'), maxDaysAhead: 2 };
    const inside = computeSlots(
      input({ ...base, rangeStart: at('2026-11-11T00:00'), rangeEnd: at('2026-11-12T00:00') }),
    );
    const outside = computeSlots(
      input({ ...base, rangeStart: at('2026-11-12T00:00'), rangeEnd: at('2026-11-13T00:00') }),
    );
    expect(inside).toHaveLength(16);
    expect(outside).toEqual([]);
  });

  it('enforces the daily limit for the same event type only', () => {
    const booked = (hour: string, eventTypeId: string) => ({
      start: at(`2026-11-09T${hour}:00`),
      end: at(`2026-11-09T${hour}:30`),
      bufferBeforeMin: 0,
      bufferAfterMin: 0,
      eventTypeId,
    });
    expect(
      computeSlots(input({ dailyLimit: 2, bookings: [booked('09', 'evt'), booked('10', 'evt')] })),
    ).toEqual([]);
    expect(
      computeSlots(input({ dailyLimit: 2, bookings: [booked('09', 'evt'), booked('10', 'other')] })),
    ).toHaveLength(14);
  });

  it('uses a date override instead of the weekly hours', () => {
    const closed = computeSlots(input({ overrides: { '2026-11-09': [] } }));
    expect(closed).toEqual([]);
    const short = computeSlots(input({ overrides: { '2026-11-09': [{ start: '13:00', end: '14:00' }] } }));
    expect(short.map((s) => local(s).slice(11))).toEqual(['13:00', '13:30']);
    // A Saturday opened up for one date.
    const saturday = computeSlots(
      input({
        rangeStart: at('2026-11-14T00:00'),
        rangeEnd: at('2026-11-15T00:00'),
        overrides: { '2026-11-14': [{ start: '10:00', end: '11:00' }] },
      }),
    );
    expect(saturday.map((s) => local(s))).toEqual(['2026-11-14 10:00', '2026-11-14 10:30']);
  });

  it('supports split days', () => {
    const slots = computeSlots(
      input({
        weekly: {
          '1': [
            { start: '09:00', end: '10:00' },
            { start: '14:00', end: '15:00' },
          ],
        },
      }),
    );
    expect(slots.map((s) => local(s).slice(11))).toEqual(['09:00', '09:30', '14:00', '14:30']);
  });

  it('keeps 9am at 9am across daylight saving changes', () => {
    // US clocks go forward on Sunday 8 March 2026 and back on Sunday 1 November 2026.
    const before = computeSlots(
      input({
        now: at('2026-03-01T00:00'),
        rangeStart: at('2026-03-06T00:00'),
        rangeEnd: at('2026-03-07T00:00'),
      }),
    );
    const after = computeSlots(
      input({
        now: at('2026-03-01T00:00'),
        rangeStart: at('2026-03-09T00:00'),
        rangeEnd: at('2026-03-10T00:00'),
      }),
    );
    expect(local(before[0])).toBe('2026-03-06 09:00');
    expect(local(after[0])).toBe('2026-03-09 09:00');
    expect(new Date(before[0]).toISOString()).toBe('2026-03-06T14:00:00.000Z');
    expect(new Date(after[0]).toISOString()).toBe('2026-03-09T13:00:00.000Z');
  });

  it('gives the right instants to someone in another time zone', () => {
    // The owner works 9–5 in New York; a visitor asks about "their" Tuesday in Tokyo.
    const slots = computeSlots(
      input({
        rangeStart: at('2026-11-10T00:00', 'Asia/Tokyo'),
        rangeEnd: at('2026-11-11T00:00', 'Asia/Tokyo'),
      }),
    );
    // Tokyo's Tuesday covers New York's Monday 10:00 through Tuesday 10:00.
    expect(local(slots[0])).toBe('2026-11-09 10:00');
    expect(local(slots[slots.length - 1])).toBe('2026-11-10 09:30');
    expect(local(slots[0], 'Asia/Tokyo')).toBe('2026-11-10 00:00');
  });

  it('handles hours that run to midnight', () => {
    const slots = computeSlots(input({ weekly: { '1': [{ start: '22:00', end: '24:00' }] }, durationMin: 60, intervalMin: 60 }));
    expect(slots.map((s) => local(s))).toEqual(['2026-11-09 22:00', '2026-11-09 23:00']);
  });
});

describe('workingWindows', () => {
  it('ignores malformed ranges', () => {
    const windows = workingWindows(
      NY,
      { '1': [{ start: '17:00', end: '09:00' }, { start: 'x', end: 'y' }] },
      {},
      at('2026-11-09T00:00'),
      at('2026-11-10T00:00'),
    );
    expect(windows).toEqual([]);
  });
});
