import 'server-only';
import { getCalendarBusy } from '../calendars';
// Loaded for its side effect: it emails the owner when a calendar stops syncing.
import '../email';
import { listConfirmedBookingsBetween, scheduleFor } from '../store';
import type { Booking, EventType } from '../types';
import { computeSlots, subtractInterval } from './slots';

const DAY = 86_400_000;
const MINUTE = 60_000;
/** The most a single request may ask for. */
export const MAX_RANGE_MS = 62 * DAY;

export type SlotOptions = {
  /** Skip caches and re-read every calendar. Used when confirming a booking. */
  fresh?: boolean;
  /** When rescheduling: this booking's own time does not count as busy. */
  excluding?: Booking;
  now?: number;
};

/**
 * Bookable start times (epoch ms) for an event type inside [rangeStart, rangeEnd).
 * Combines the owner's working hours, every connected calendar and existing bookings.
 */
export async function getSlots(
  eventType: EventType,
  rangeStart: number,
  rangeEnd: number,
  options: SlotOptions = {},
): Promise<number[]> {
  const schedule = await scheduleFor(eventType);
  if (!schedule) return [];
  const now = options.now ?? Date.now();
  rangeEnd = Math.min(rangeEnd, rangeStart + MAX_RANGE_MS);
  if (rangeEnd <= now) return [];

  // Look a little beyond the range so meetings just outside it (and their
  // buffers) still count. Whole UTC days keep repeated lookups cacheable.
  const pad = DAY + (eventType.buffer_before_minutes + eventType.buffer_after_minutes) * MINUTE;
  const from = new Date(Math.floor((Math.max(rangeStart, now) - pad) / DAY) * DAY);
  const to = new Date(Math.ceil((rangeEnd + pad) / DAY) * DAY);

  const [calendarBusy, bookings] = await Promise.all([
    getCalendarBusy(from, to, schedule.timezone, options.fresh),
    listConfirmedBookingsBetween(from, to),
  ]);

  const excluded = options.excluding;
  const busy = excluded
    ? subtractInterval(calendarBusy, {
        start: excluded.start_at.getTime(),
        end: excluded.end_at.getTime(),
      })
    : calendarBusy;

  return computeSlots({
    rangeStart,
    rangeEnd,
    now,
    timezone: schedule.timezone,
    weekly: schedule.weekly,
    overrides: schedule.overrides,
    durationMin: eventType.duration_minutes,
    intervalMin: eventType.slot_interval_minutes,
    bufferBeforeMin: eventType.buffer_before_minutes,
    bufferAfterMin: eventType.buffer_after_minutes,
    minNoticeMin: eventType.min_notice_minutes,
    maxDaysAhead: eventType.max_days_ahead,
    dailyLimit: eventType.daily_limit,
    eventTypeId: eventType.id,
    busy,
    bookings: bookings
      .filter((b) => b.id !== excluded?.id)
      .map((b) => ({
        start: b.start_at.getTime(),
        end: b.end_at.getTime(),
        bufferBeforeMin: b.buffer_before_minutes,
        bufferAfterMin: b.buffer_after_minutes,
        eventTypeId: b.event_type_id,
      })),
  });
}
