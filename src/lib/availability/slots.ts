import { DateTime } from 'luxon';
import type { DateOverrides, Interval, TimeRange, WeeklyHours } from '../types';

// The slot engine. Pure functions only: no database, no network, no clock.
// Everything is epoch milliseconds except working hours, which are wall-clock
// times in the schedule's time zone (so 9:00 stays 9:00 across daylight saving).

const MINUTE = 60_000;

export type SlotBooking = {
  start: number;
  end: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  eventTypeId: string | null;
};

export type SlotInput = {
  /** Only slots starting inside [rangeStart, rangeEnd) are returned. */
  rangeStart: number;
  rangeEnd: number;
  now: number;
  timezone: string;
  weekly: WeeklyHours;
  overrides: DateOverrides;
  durationMin: number;
  intervalMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  minNoticeMin: number;
  maxDaysAhead: number;
  dailyLimit: number | null;
  eventTypeId: string;
  /** Busy time from connected calendars. */
  busy: Interval[];
  /** Confirmed bookings made through this app. */
  bookings: SlotBooking[];
};

/** "09:30" → 570. "24:00" is allowed and means the end of the day. */
export function parseTime(hhmm: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!match) return NaN;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes >= 0 && minutes <= 1440 && Number(match[2]) < 60 ? minutes : NaN;
}

export function isValidRange(range: TimeRange): boolean {
  const start = parseTime(range.start);
  const end = parseTime(range.end);
  return Number.isFinite(start) && Number.isFinite(end) && end > start;
}

/** Sorts intervals and joins any that touch or overlap. */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = intervals
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last && interval.start <= last.end) {
      last.end = Math.max(last.end, interval.end);
    } else {
      merged.push({ start: interval.start, end: interval.end });
    }
  }
  return merged;
}

/** Removes `hole` from every interval (used to ignore a booking's own calendar event). */
export function subtractInterval(intervals: Interval[], hole: Interval): Interval[] {
  const out: Interval[] = [];
  for (const interval of intervals) {
    if (hole.end <= interval.start || hole.start >= interval.end) {
      out.push(interval);
      continue;
    }
    if (interval.start < hole.start) out.push({ start: interval.start, end: hole.start });
    if (interval.end > hole.end) out.push({ start: hole.end, end: interval.end });
  }
  return out;
}

/** True if [start, end) overlaps any interval. `merged` must come from mergeIntervals. */
export function overlapsAny(merged: Interval[], start: number, end: number): boolean {
  let lo = 0;
  let hi = merged.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (merged[mid].end <= start) lo = mid + 1;
    else hi = mid;
  }
  return lo < merged.length && merged[lo].start < end;
}

function atWallClock(day: DateTime, minutes: number): DateTime {
  if (minutes >= 1440) return day.plus({ days: 1 }).startOf('day');
  return day.set({ hour: Math.floor(minutes / 60), minute: minutes % 60, second: 0, millisecond: 0 });
}

/** Working hours as concrete instants for every local day touching [from, to). */
export function workingWindows(
  timezone: string,
  weekly: WeeklyHours,
  overrides: DateOverrides,
  from: number,
  to: number,
): Interval[] {
  const windows: Interval[] = [];
  let day = DateTime.fromMillis(from, { zone: timezone }).startOf('day');
  const last = DateTime.fromMillis(to, { zone: timezone }).startOf('day');
  while (day <= last) {
    const dateKey = day.toISODate()!;
    const ranges = overrides[dateKey] ?? weekly[String(day.weekday)] ?? [];
    for (const range of ranges) {
      if (!isValidRange(range)) continue;
      const start = atWallClock(day, parseTime(range.start)).toMillis();
      const end = atWallClock(day, parseTime(range.end)).toMillis();
      if (end > start) windows.push({ start, end });
    }
    day = day.plus({ days: 1 }).startOf('day');
  }
  return mergeIntervals(windows);
}

/** Every bookable start time in the requested range, ascending, as epoch ms. */
export function computeSlots(input: SlotInput): number[] {
  const zone = input.timezone;
  const duration = input.durationMin * MINUTE;
  const step = Math.max(5, input.intervalMin) * MINUTE;
  const padBefore = input.bufferBeforeMin * MINUTE;
  const padAfter = input.bufferAfterMin * MINUTE;

  const earliest = Math.max(input.rangeStart, input.now + input.minNoticeMin * MINUTE);
  const horizon = DateTime.fromMillis(input.now, { zone })
    .startOf('day')
    .plus({ days: input.maxDaysAhead + 1 })
    .toMillis();
  const latest = Math.min(input.rangeEnd, horizon);
  if (latest <= earliest) return [];

  // A slot is blocked if, with its own buffers added, it touches anything on
  // the calendar, or if it lands inside another booking's buffers.
  const hardBusy = mergeIntervals([
    ...input.busy,
    ...input.bookings.map((b) => ({ start: b.start, end: b.end })),
  ]);
  const bufferedBookings = mergeIntervals(
    input.bookings.map((b) => ({
      start: b.start - b.bufferBeforeMin * MINUTE,
      end: b.end + b.bufferAfterMin * MINUTE,
    })),
  );

  const perDay = new Map<string, number>();
  if (input.dailyLimit !== null) {
    for (const booking of input.bookings) {
      if (booking.eventTypeId !== input.eventTypeId) continue;
      const key = DateTime.fromMillis(booking.start, { zone }).toISODate()!;
      perDay.set(key, (perDay.get(key) ?? 0) + 1);
    }
  }

  const slots = new Set<number>();
  for (const window of workingWindows(zone, input.weekly, input.overrides, earliest, latest)) {
    for (let start = window.start; start + duration <= window.end; start += step) {
      if (start < earliest || start >= latest) continue;
      const end = start + duration;
      if (overlapsAny(hardBusy, start - padBefore, end + padAfter)) continue;
      if (overlapsAny(bufferedBookings, start, end)) continue;
      if (input.dailyLimit !== null) {
        const key = DateTime.fromMillis(start, { zone }).toISODate()!;
        if ((perDay.get(key) ?? 0) >= input.dailyLimit) continue;
      }
      slots.add(start);
    }
  }
  return [...slots].sort((a, b) => a - b);
}
