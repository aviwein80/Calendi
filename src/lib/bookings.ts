import 'server-only';
import { getSlots } from './availability';
import {
  bookingTargetProvider,
  CalendarUnavailableError,
  clearBusyCache,
  createCalendarEvent,
  deleteCalendarEvent,
  updateCalendarEvent,
} from './calendars';
import type { EventInput } from './calendars/types';
import { EXCLUSION_VIOLATION, pgCode } from './db';
import { sendBookingEmails, type BookingEvent } from './email';
import { formatRange, isValidZone, zoneLabel } from './format';
import {
  countRecentBookings,
  getEventType,
  getEventTypeBySlug,
  getOwner,
  insertBooking,
  newBookingToken,
  updateBooking,
} from './store';
import type { Answer, Booking, EventType, Owner } from './types';
import { sendBookingWebhook } from './webhook';

// Creating, cancelling and rescheduling bookings. Each operation follows the
// same order: check the time is really free, write to the database (which
// itself refuses overlaps and broken buffers, so a race between two visitors
// cannot get through), then update the owner's calendar and send notices.
// Calendar and notification problems are recorded but never undo a booking.
//
// Callers find the booking first (by manage-link token for invitees, by id
// for the owner) and are responsible for rate limiting; see lib/manage.ts.

export type BookingErrorCode =
  | 'not_found'
  | 'invalid'
  | 'slot_taken'
  | 'too_late'
  | 'calendar_unavailable'
  | 'rate_limited';

export class BookingError extends Error {
  code: BookingErrorCode;
  constructor(code: BookingErrorCode, message: string) {
    super(message);
    this.name = 'BookingError';
    this.code = code;
  }
}

const SLOT_TAKEN = 'That time is no longer available. Please pick another.';
const CALENDAR_DOWN =
  'We could not check the calendar just now. Please try again in a few minutes.';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** A single-person calendar never fills this fast; a script might. */
const MAX_BOOKINGS_PER_HOUR = 40;

export type BookingRequest = {
  slug: string;
  /** ISO timestamp of the chosen slot. */
  start: string;
  name: string;
  email: string;
  timezone: string;
  phone?: string;
  notes?: string;
  guests?: string[];
  /** Keyed by question id. */
  answers?: Record<string, string>;
};

function clean(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/** For one-line fields that end up in email subjects and calendar titles. */
function cleanLine(value: unknown, max: number): string {
  return clean(typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]+/g, ' ') : value, max);
}

async function requireFreeSlot(eventType: EventType, startMs: number, excluding?: Booking): Promise<void> {
  let slots: number[];
  try {
    slots = await getSlots(eventType, startMs, startMs + 1, { fresh: true, excluding });
  } catch (err) {
    if (err instanceof CalendarUnavailableError) throw new BookingError('calendar_unavailable', CALENDAR_DOWN);
    throw err;
  }
  if (!slots.includes(startMs)) throw new BookingError('slot_taken', SLOT_TAKEN);
}

function locationText(booking: Pick<Booking, 'location_type' | 'invitee_phone'>, eventType: EventType): string {
  switch (eventType.location_type) {
    case 'google_meet':
      return 'Google Meet';
    case 'teams':
      return 'Microsoft Teams';
    case 'link':
      return eventType.location_value;
    case 'phone':
      return `Phone call: ${eventType.location_value || 'the host will call'} ${booking.invitee_phone}`.trim();
    case 'in_person':
      return eventType.location_value;
    default:
      return '';
  }
}

/** The event as it should appear on the owner's calendar. */
function calendarEvent(booking: Booking, owner: Owner, baseUrl: string, conference: EventInput['conference']): EventInput {
  const lines = [
    `Event: ${booking.event_name}`,
    `Invitee: ${booking.invitee_name} <${booking.invitee_email}>`,
    `Invitee time zone: ${zoneLabel(booking.invitee_timezone, booking.start_at)}`,
  ];
  if (booking.invitee_phone) lines.push(`Phone: ${booking.invitee_phone}`);
  if (booking.meeting_url) lines.push(`Join: ${booking.meeting_url}`);
  else if (booking.location) lines.push(`Where: ${booking.location}`);
  for (const answer of booking.answers) lines.push('', answer.label, answer.value);
  if (booking.notes) lines.push('', 'Notes', booking.notes);
  if (booking.token) {
    const manage = `${baseUrl}/booking/${booking.token}`;
    lines.push('', 'Need to make a change?', `Reschedule: ${manage}/reschedule`, `Cancel: ${manage}/cancel`);
  }

  return {
    uid: booking.id,
    title: `${booking.event_name}: ${booking.invitee_name} and ${owner.name}`,
    description: lines.join('\n'),
    location: booking.meeting_url || booking.location,
    start: booking.start_at,
    end: booking.end_at,
    organizer: { name: owner.name, email: owner.email },
    attendees: [
      { name: booking.invitee_name, email: booking.invitee_email },
      ...booking.guests.map((email) => ({ name: email, email })),
    ],
    conference,
    sequence: booking.sequence,
  };
}

async function conferenceFor(eventType: EventType | null): Promise<EventInput['conference']> {
  if (!eventType) return null;
  const provider = await bookingTargetProvider(eventType);
  if (eventType.location_type === 'google_meet' && provider === 'google') return 'google_meet';
  if (eventType.location_type === 'teams' && provider === 'microsoft') return 'teams';
  return null;
}

async function notify(
  event: BookingEvent,
  booking: Booking,
  owner: Owner,
  baseUrl: string,
  eventType?: EventType | null,
): Promise<void> {
  const type = eventType !== undefined ? eventType : booking.event_type_id ? await getEventType(booking.event_type_id) : null;
  await Promise.allSettled([
    sendBookingEmails(event, booking, owner, baseUrl, type?.notify_email),
    sendBookingWebhook(`booking.${event}`, booking, owner, baseUrl),
  ]);
}

function syncMessage(err: unknown): string {
  return (err instanceof Error ? err.message : 'Unknown calendar error').slice(0, 400);
}

export async function createBooking(request: BookingRequest, baseUrl: string): Promise<Booking> {
  const [eventType, owner] = await Promise.all([getEventTypeBySlug(clean(request.slug, 100)), getOwner()]);
  if (!eventType || !eventType.is_active || !owner) {
    throw new BookingError('not_found', 'This event is not available for booking.');
  }

  const name = cleanLine(request.name, 120);
  const email = cleanLine(request.email, 200).toLowerCase();
  const phone = cleanLine(request.phone, 40);
  const timezone = isValidZone(request.timezone) ? request.timezone : owner.timezone;
  if (!name) throw new BookingError('invalid', 'Please enter your name.');
  if (!EMAIL_PATTERN.test(email)) throw new BookingError('invalid', 'Please enter a valid email address.');
  if (eventType.location_type === 'phone' && phone.replace(/\D/g, '').length < 7) {
    throw new BookingError('invalid', 'Please enter a phone number we can call.');
  }

  const answers: Answer[] = [];
  for (const question of eventType.questions) {
    const value = clean(request.answers?.[question.id], 2000);
    if (question.required && !value) {
      throw new BookingError('invalid', `Please answer "${question.label}".`);
    }
    if (question.type === 'select' && value && !question.options.includes(value)) {
      throw new BookingError('invalid', `Please choose one of the options for "${question.label}".`);
    }
    if (value) answers.push({ label: question.label, value });
  }

  const guests = eventType.allow_guests
    ? [...new Set((request.guests ?? []).map((g) => cleanLine(g, 200).toLowerCase()).filter(Boolean))]
        .filter((g) => g !== email)
        .slice(0, 10)
    : [];
  const badGuest = guests.find((g) => !EMAIL_PATTERN.test(g));
  if (badGuest) throw new BookingError('invalid', `"${badGuest}" is not a valid email address.`);

  const startMs = Date.parse(request.start);
  if (!Number.isFinite(startMs)) throw new BookingError('invalid', 'Please pick a time.');
  if ((await countRecentBookings()) >= MAX_BOOKINGS_PER_HOUR) {
    throw new BookingError('rate_limited', 'Too many bookings are coming in right now. Please try again a little later.');
  }
  await requireFreeSlot(eventType, startMs);

  let booking: Booking;
  try {
    const { token_hash, token_sealed } = newBookingToken();
    booking = await insertBooking({
      token_hash,
      token_sealed,
      event_type_id: eventType.id,
      event_name: eventType.name,
      start_at: new Date(startMs),
      end_at: new Date(startMs + eventType.duration_minutes * 60_000),
      buffer_before_minutes: eventType.buffer_before_minutes,
      buffer_after_minutes: eventType.buffer_after_minutes,
      invitee_name: name,
      invitee_email: email,
      invitee_timezone: timezone,
      invitee_phone: phone,
      guests,
      answers,
      notes: clean(request.notes, 4000),
      location_type: eventType.location_type,
      location: locationText({ location_type: eventType.location_type, invitee_phone: phone }, eventType),
    });
  } catch (err) {
    if (pgCode(err) === EXCLUSION_VIOLATION) throw new BookingError('slot_taken', SLOT_TAKEN);
    throw err;
  }
  clearBusyCache();

  if (eventType.location_type === 'link') {
    booking = (await updateBooking(booking.id, { meeting_url: eventType.location_value })) ?? booking;
  }
  booking = await saveToCalendar(booking, owner, eventType, baseUrl);
  await notify('created', booking, owner, baseUrl, eventType);
  return booking;
}

/** Puts a booking on the owner's calendar and records the result on the booking. */
async function saveToCalendar(
  booking: Booking,
  owner: Owner,
  eventType: EventType | null,
  baseUrl: string,
): Promise<Booking> {
  try {
    const conference = await conferenceFor(eventType);
    const saved = await createCalendarEvent(calendarEvent(booking, owner, baseUrl, conference), eventType);
    if (!saved) return booking;
    const meetingUrl = saved.created.meetingUrl || booking.meeting_url;
    return (
      (await updateBooking(booking.id, {
        calendar_id: saved.calendarId,
        external_event_id: saved.created.externalEventId,
        invited_by_calendar: saved.created.invited,
        meeting_url: meetingUrl,
        sync_error: '',
      })) ?? booking
    );
  } catch (err) {
    console.error('[calendar] could not save booking:', err);
    return (await updateBooking(booking.id, { sync_error: syncMessage(err) })) ?? booking;
  }
}

/**
 * A booking as just re-read from the database, with the manage-link token the
 * caller already holds carried over. (For bookings older than encrypted
 * tokens, the token cannot be recovered from the row alone.)
 */
function withKnownToken(fresh: Booking | null, known: Booking): Booking {
  if (!fresh) return known;
  return fresh.token ? fresh : { ...fresh, token: known.token };
}

async function requireConfirmed(booking: Booking): Promise<Owner> {
  const owner = await getOwner();
  if (!owner) throw new BookingError('not_found', 'This booking could not be found.');
  if (booking.status !== 'confirmed') {
    throw new BookingError('invalid', 'This booking has already been cancelled.');
  }
  return owner;
}

export async function cancelBooking(
  booking: Booking,
  by: 'invitee' | 'host',
  reason: string,
  baseUrl: string,
): Promise<Booking> {
  const owner = await requireConfirmed(booking);
  if (by === 'invitee' && booking.start_at.getTime() <= Date.now()) {
    throw new BookingError('too_late', 'This meeting has already started, so it can no longer be cancelled.');
  }

  let updated = withKnownToken(
    await updateBooking(booking.id, {
      status: 'cancelled',
      cancel_reason: clean(reason, 1000),
      cancelled_by: by,
      cancelled_at: new Date(),
      sequence: booking.sequence + 1,
    }),
    booking,
  );
  clearBusyCache();

  if (booking.calendar_id && booking.external_event_id) {
    try {
      await deleteCalendarEvent(booking.calendar_id, booking.external_event_id);
    } catch (err) {
      console.error('[calendar] could not remove cancelled booking:', err);
      updated = withKnownToken(await updateBooking(booking.id, { sync_error: syncMessage(err) }), updated);
    }
  }
  await notify('cancelled', updated, owner, baseUrl);
  return updated;
}

export async function rescheduleBooking(
  booking: Booking,
  start: string,
  by: 'invitee' | 'host',
  baseUrl: string,
  timezone?: string,
): Promise<Booking> {
  const owner = await requireConfirmed(booking);
  if (by === 'invitee' && booking.start_at.getTime() <= Date.now()) {
    throw new BookingError('too_late', 'This meeting has already started, so it can no longer be moved.');
  }
  const eventType = booking.event_type_id ? await getEventType(booking.event_type_id) : null;
  if (!eventType) {
    throw new BookingError('not_found', 'This event is no longer offered, so it cannot be rescheduled.');
  }
  const startMs = Date.parse(start);
  if (!Number.isFinite(startMs)) throw new BookingError('invalid', 'Please pick a time.');
  if (startMs === booking.start_at.getTime()) {
    throw new BookingError('invalid', 'That is the time you already have.');
  }
  await requireFreeSlot(eventType, startMs, booking);

  let updated: Booking;
  try {
    updated = withKnownToken(
      await updateBooking(booking.id, {
        start_at: new Date(startMs),
        end_at: new Date(startMs + eventType.duration_minutes * 60_000),
        previous_start_at: booking.start_at,
        rescheduled_at: new Date(),
        sequence: booking.sequence + 1,
        ...(timezone && isValidZone(timezone) ? { invitee_timezone: timezone } : {}),
      }),
      booking,
    );
  } catch (err) {
    if (pgCode(err) === EXCLUSION_VIOLATION) throw new BookingError('slot_taken', SLOT_TAKEN);
    throw err;
  }
  clearBusyCache();

  if (updated.calendar_id && updated.external_event_id) {
    try {
      await updateCalendarEvent(
        updated.calendar_id,
        updated.external_event_id,
        calendarEvent(updated, owner, baseUrl, null),
      );
      if (updated.sync_error) updated = withKnownToken(await updateBooking(updated.id, { sync_error: '' }), updated);
    } catch (err) {
      console.error('[calendar] could not move booking:', err);
      updated = withKnownToken(await updateBooking(updated.id, { sync_error: syncMessage(err) }), updated);
    }
  } else {
    // It never made it onto the calendar the first time; try again now.
    updated = withKnownToken(await saveToCalendar(updated, owner, eventType, baseUrl), updated);
  }
  await notify('rescheduled', updated, owner, baseUrl, eventType);
  return updated;
}

/** One line describing a booking's time for the person looking at it. */
export function describeWhen(booking: Booking, zone: string): string {
  return `${formatRange(booking.start_at, booking.end_at, zone)} (${zoneLabel(zone, booking.start_at)})`;
}
