import 'server-only';
import { db } from './db';
import { decrypt, decryptJson, encrypt, encryptJson, randomToken, secretsMatch, sha256Hex } from './crypto';
import type {
  Booking,
  CalendarAccount,
  CalendarRow,
  EventType,
  Integrations,
  Owner,
  Schedule,
} from './types';

// Every database query lives here. Nothing in this file checks who is asking:
// callers (pages, actions, route handlers) are responsible for authorisation.

// ── Owner ────────────────────────────────────────────────────────────────

export async function getOwner(): Promise<Owner | null> {
  const rows = await db()<Owner[]>`select * from owner where id = 1`;
  return rows[0] ?? null;
}

export async function createOwner(input: {
  name: string;
  email: string;
  passwordHash: string;
  timezone: string;
}): Promise<Owner> {
  const rows = await db()<Owner[]>`
    insert into owner (id, name, email, password_hash, timezone)
    values (1, ${input.name}, ${input.email}, ${input.passwordHash}, ${input.timezone})
    returning *`;
  return rows[0];
}

export async function updateOwner(
  fields: Partial<
    Pick<
      Owner,
      | 'name'
      | 'email'
      | 'timezone'
      | 'welcome_message'
      | 'avatar_url'
      | 'brand_color'
      | 'webhook_url'
      | 'password_hash'
      | 'session_version'
      | 'failed_logins'
      | 'locked_until'
    >
  >,
): Promise<void> {
  if (Object.keys(fields).length === 0) return;
  const sql = db();
  await sql`update owner set ${sql(fields)} where id = 1`;
}

export function readIntegrations(owner: Pick<Owner, 'integrations'> | null): Integrations {
  if (!owner?.integrations) return {};
  try {
    return decryptJson<Integrations>(owner.integrations);
  } catch {
    return {};
  }
}

export async function getIntegrations(): Promise<Integrations> {
  return readIntegrations(await getOwner());
}

export async function saveIntegrations(next: Integrations): Promise<void> {
  await db()`update owner set integrations = ${encryptJson(next)} where id = 1`;
}

// ── Schedules ────────────────────────────────────────────────────────────

export async function listSchedules(): Promise<Schedule[]> {
  return db()<Schedule[]>`select * from schedules order by is_default desc, created_at`;
}

export async function getSchedule(id: string): Promise<Schedule | null> {
  const rows = await db()<Schedule[]>`select * from schedules where id = ${id}`;
  return rows[0] ?? null;
}

export async function getDefaultSchedule(): Promise<Schedule | null> {
  const rows = await db()<Schedule[]>`
    select * from schedules order by is_default desc, created_at limit 1`;
  return rows[0] ?? null;
}

/** The schedule an event type uses: its own, or the default one. */
export async function scheduleFor(eventType: Pick<EventType, 'schedule_id'>): Promise<Schedule | null> {
  if (eventType.schedule_id) {
    const own = await getSchedule(eventType.schedule_id);
    if (own) return own;
  }
  return getDefaultSchedule();
}

export async function insertSchedule(
  input: Pick<Schedule, 'name' | 'timezone' | 'weekly' | 'overrides' | 'is_default'>,
): Promise<Schedule> {
  const sql = db();
  const rows = await sql<Schedule[]>`
    insert into schedules (name, timezone, weekly, overrides, is_default)
    values (${input.name}, ${input.timezone}, ${sql.json(input.weekly)}, ${sql.json(input.overrides)}, ${input.is_default})
    returning *`;
  return rows[0];
}

export async function updateSchedule(
  id: string,
  input: Pick<Schedule, 'name' | 'timezone' | 'weekly' | 'overrides'>,
): Promise<void> {
  const sql = db();
  await sql`
    update schedules
    set name = ${input.name}, timezone = ${input.timezone},
        weekly = ${sql.json(input.weekly)}, overrides = ${sql.json(input.overrides)}
    where id = ${id}`;
}

export async function setDefaultSchedule(id: string): Promise<void> {
  await db().begin(async (tx) => {
    await tx`update schedules set is_default = false where is_default`;
    await tx`update schedules set is_default = true where id = ${id}`;
  });
}

export async function deleteSchedule(id: string): Promise<void> {
  await db()`delete from schedules where id = ${id} and not is_default`;
}

// ── Event types ──────────────────────────────────────────────────────────

export async function listEventTypes(): Promise<EventType[]> {
  return db()<EventType[]>`select * from event_types order by position, created_at`;
}

export async function getEventType(id: string): Promise<EventType | null> {
  const rows = await db()<EventType[]>`select * from event_types where id = ${id}`;
  return rows[0] ?? null;
}

export async function getEventTypeBySlug(slug: string): Promise<EventType | null> {
  const rows = await db()<EventType[]>`select * from event_types where slug = ${slug}`;
  return rows[0] ?? null;
}

export type EventTypeInput = Omit<EventType, 'id' | 'created_at' | 'position'>;

export async function insertEventType(input: EventTypeInput): Promise<EventType> {
  const sql = db();
  const rows = await sql<EventType[]>`
    insert into event_types ${sql({ ...input, questions: sql.json(input.questions) } as never)}
    returning *`;
  return rows[0];
}

export async function updateEventType(id: string, input: Partial<EventTypeInput>): Promise<void> {
  if (Object.keys(input).length === 0) return;
  const sql = db();
  const fields = input.questions ? { ...input, questions: sql.json(input.questions) } : input;
  await sql`update event_types set ${sql(fields as never)} where id = ${id}`;
}

export async function deleteEventType(id: string): Promise<void> {
  await db()`delete from event_types where id = ${id}`;
}

// ── Calendars ────────────────────────────────────────────────────────────

export async function listCalendarAccounts(): Promise<CalendarAccount[]> {
  return db()<CalendarAccount[]>`select * from calendar_accounts order by created_at`;
}

export async function getCalendarAccount(id: string): Promise<CalendarAccount | null> {
  const rows = await db()<CalendarAccount[]>`select * from calendar_accounts where id = ${id}`;
  return rows[0] ?? null;
}

export async function insertCalendarAccount(input: {
  provider: CalendarAccount['provider'];
  label: string;
  credentials: unknown;
}): Promise<CalendarAccount> {
  const rows = await db()<CalendarAccount[]>`
    insert into calendar_accounts (provider, label, credentials)
    values (${input.provider}, ${input.label}, ${encryptJson(input.credentials)})
    returning *`;
  return rows[0];
}

export async function saveAccountCredentials(id: string, credentials: unknown): Promise<void> {
  await db()`update calendar_accounts set credentials = ${encryptJson(credentials)} where id = ${id}`;
}

export async function setAccountStatus(id: string, error: string | null): Promise<void> {
  if (error === null) {
    await db()`
      update calendar_accounts
      set status = 'ok', last_error = null, last_error_at = null, alerted_at = null
      where id = ${id} and status <> 'ok'`;
  } else {
    await db()`
      update calendar_accounts
      set status = 'error', last_error = ${error.slice(0, 500)}, last_error_at = now()
      where id = ${id}`;
  }
}

/** Returns true the first time it is called for an account in any 24 hours. */
export async function claimAccountAlert(id: string): Promise<boolean> {
  const rows = await db()`
    update calendar_accounts set alerted_at = now()
    where id = ${id} and (alerted_at is null or alerted_at < now() - interval '24 hours')
    returning id`;
  return rows.length > 0;
}

export async function deleteCalendarAccount(id: string): Promise<void> {
  await db()`delete from calendar_accounts where id = ${id}`;
}

export async function listCalendars(): Promise<CalendarRow[]> {
  return db()<CalendarRow[]>`select * from calendars order by is_booking_target desc, lower(name)`;
}

export async function getCalendar(id: string): Promise<CalendarRow | null> {
  const rows = await db()<CalendarRow[]>`select * from calendars where id = ${id}`;
  return rows[0] ?? null;
}

export async function getBookingTarget(): Promise<CalendarRow | null> {
  const rows = await db()<CalendarRow[]>`select * from calendars where is_booking_target limit 1`;
  return rows[0] ?? null;
}

/** Adds new calendars, refreshes names, and removes ones that no longer exist. */
export async function replaceAccountCalendars(
  accountId: string,
  found: { externalId: string; name: string; color: string; canWrite: boolean; checkByDefault: boolean }[],
): Promise<void> {
  const sql = db();
  await sql.begin(async (tx) => {
    const keep = found.map((c) => c.externalId);
    if (keep.length > 0) {
      await tx`delete from calendars where account_id = ${accountId} and external_id not in ${tx(keep)}`;
    } else {
      await tx`delete from calendars where account_id = ${accountId}`;
    }
    for (const calendar of found) {
      await tx`
        insert into calendars (account_id, external_id, name, color, can_write, check_conflicts)
        values (${accountId}, ${calendar.externalId}, ${calendar.name}, ${calendar.color},
                ${calendar.canWrite}, ${calendar.checkByDefault})
        on conflict (account_id, external_id)
        do update set name = excluded.name, color = excluded.color, can_write = excluded.can_write`;
    }
    // A calendar that lost write access cannot stay the place bookings are saved.
    await tx`update calendars set is_booking_target = false where is_booking_target and not can_write`;
  });
}

export async function setCalendarConflicts(id: string, check: boolean): Promise<void> {
  await db()`update calendars set check_conflicts = ${check} where id = ${id}`;
}

export async function setBookingTarget(id: string | null): Promise<void> {
  await db().begin(async (tx) => {
    await tx`update calendars set is_booking_target = false where is_booking_target`;
    if (id) await tx`update calendars set is_booking_target = true where id = ${id} and can_write`;
  });
}

// ── Bookings ─────────────────────────────────────────────────────────────

/** Manage-link tokens: 24 random bytes (192 bits) as 32 URL-safe characters. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22,64}$/;

type BookingRow = Omit<Booking, 'token'>;

/** Adds the manage-link token, recovered from its encrypted copy. */
function withToken(row: BookingRow): Booking {
  let token = '';
  if (row.token_sealed) {
    try {
      token = decrypt(row.token_sealed);
    } catch {
      // APP_SECRET changed since this booking was made: the link still works
      // for whoever holds it, but it can no longer be shown again.
    }
  }
  return { ...row, token };
}

/** A fresh token plus the two forms of it that are stored. */
export function newBookingToken(): { token: string; token_hash: string; token_sealed: string } {
  const token = randomToken(24);
  return { token, token_hash: sha256Hex(token), token_sealed: encrypt(token) };
}

/**
 * Finds a booking by its manage-link token. The database is searched by the
 * token's hash, and the match is then confirmed with a constant-time
 * comparison, so response time says nothing about how close a guess was.
 */
export async function getBookingByToken(token: string): Promise<Booking | null> {
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) return null;
  const hash = sha256Hex(token);
  const rows = await db()<BookingRow[]>`select * from bookings where token_hash = ${hash}`;
  const row = rows[0];
  if (!row || !secretsMatch(row.token_hash, hash)) return null;
  return { ...row, token };
}

export async function getBooking(id: string): Promise<Booking | null> {
  const rows = await db()<BookingRow[]>`select * from bookings where id = ${id}`;
  return rows[0] ? withToken(rows[0]) : null;
}

export async function listConfirmedBookingsBetween(from: Date, to: Date): Promise<Booking[]> {
  const rows = await db()<BookingRow[]>`
    select * from bookings
    where status = 'confirmed' and start_at < ${to} and end_at > ${from}
    order by start_at`;
  return rows.map(withToken);
}

export async function listBookings(view: 'upcoming' | 'past' | 'cancelled'): Promise<Booking[]> {
  const sql = db();
  const rows =
    view === 'upcoming'
      ? await sql<BookingRow[]>`
          select * from bookings where status = 'confirmed' and end_at >= now()
          order by start_at limit 200`
      : view === 'past'
        ? await sql<BookingRow[]>`
            select * from bookings where status = 'confirmed' and end_at < now()
            order by start_at desc limit 200`
        : await sql<BookingRow[]>`
            select * from bookings where status = 'cancelled'
            order by start_at desc limit 200`;
  return rows.map(withToken);
}

export async function listAllBookings(): Promise<Booking[]> {
  const rows = await db()<BookingRow[]>`select * from bookings order by start_at desc limit 5000`;
  return rows.map(withToken);
}

/** How many bookings were made in the last hour (a brake on automated spam). */
export async function countRecentBookings(): Promise<number> {
  const rows = await db()<{ count: string }[]>`
    select count(*) as count from bookings where created_at > now() - interval '1 hour'`;
  return Number(rows[0]?.count ?? 0);
}

export type BookingInsert = Pick<
  Booking,
  | 'token_hash'
  | 'token_sealed'
  | 'event_type_id'
  | 'event_name'
  | 'start_at'
  | 'end_at'
  | 'buffer_before_minutes'
  | 'buffer_after_minutes'
  | 'invitee_name'
  | 'invitee_email'
  | 'invitee_timezone'
  | 'invitee_phone'
  | 'guests'
  | 'answers'
  | 'notes'
  | 'location_type'
  | 'location'
>;

export async function insertBooking(input: BookingInsert): Promise<Booking> {
  const sql = db();
  const rows = await sql<BookingRow[]>`
    insert into bookings ${sql({
      ...input,
      guests: sql.json(input.guests),
      answers: sql.json(input.answers),
    } as never)}
    returning *`;
  return withToken(rows[0]);
}

export async function updateBooking(
  id: string,
  fields: Partial<
    Pick<
      Booking,
      | 'start_at'
      | 'end_at'
      | 'status'
      | 'cancel_reason'
      | 'cancelled_by'
      | 'cancelled_at'
      | 'previous_start_at'
      | 'rescheduled_at'
      | 'sequence'
      | 'calendar_id'
      | 'external_event_id'
      | 'invited_by_calendar'
      | 'meeting_url'
      | 'location'
      | 'sync_error'
      | 'invitee_timezone'
    >
  >,
): Promise<Booking | null> {
  if (Object.keys(fields).length === 0) return getBooking(id);
  const sql = db();
  const rows = await sql<BookingRow[]>`update bookings set ${sql(fields)} where id = ${id} returning *`;
  return rows[0] ? withToken(rows[0]) : null;
}

// ── Rate limits ──────────────────────────────────────────────────────────

/** Adds one to a counter for the current time window and returns the new total. */
export async function bumpRateCounter(key: string, windowStart: Date): Promise<number> {
  const sql = db();
  const rows = await sql<{ count: number }[]>`
    insert into rate_limits (key, window_start, count) values (${key}, ${windowStart}, 1)
    on conflict (key, window_start) do update set count = rate_limits.count + 1
    returning count`;
  // Old windows are never read again. Sweep them whenever a new window opens.
  if (rows[0].count === 1) {
    await sql`delete from rate_limits where window_start < now() - interval '1 day'`;
  }
  return rows[0].count;
}

export async function readRateCounter(key: string, windowStart: Date): Promise<number> {
  const rows = await db()<{ count: number }[]>`
    select count from rate_limits where key = ${key} and window_start = ${windowStart}`;
  return rows[0]?.count ?? 0;
}
