'use server';

import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { isValidRange } from '@/lib/availability/slots';
import { BookingError, cancelBooking } from '@/lib/bookings';
import { clearBusyCache, connectAccount, refreshAccountCalendars } from '@/lib/calendars';
import { CALDAV_PRESETS } from '@/lib/calendars/caldav';
import { normalizeIcsUrl } from '@/lib/calendars/ics';
import { ProviderError } from '@/lib/calendars/types';
import { MIN_PASSWORD_LENGTH, RESERVED_SLUGS } from '@/lib/constants';
import { hashPassword, verifyPassword } from '@/lib/crypto';
import { pgCode, UNIQUE_VIOLATION } from '@/lib/db';
import { emailConfig, sendTestEmail } from '@/lib/email';
import { getBaseUrl } from '@/lib/env';
import { isValidZone } from '@/lib/format';
import { assertOwner, startSession } from '@/lib/session';
import {
  deleteCalendarAccount,
  deleteEventType,
  deleteSchedule,
  getBooking,
  getIntegrations,
  getSchedule,
  insertEventType,
  insertSchedule,
  saveIntegrations,
  setBookingTarget,
  setCalendarConflicts,
  setDefaultSchedule,
  updateEventType,
  updateOwner,
  updateSchedule,
} from '@/lib/store';
import type { Integrations, TimeRange } from '@/lib/types';
import { postWebhook } from '@/lib/webhook';

// Everything the signed-in owner can change. Every action begins by checking
// the session: server actions are reachable by direct request, not just from
// the admin screens.

export type Result = { error?: string; ok?: string };
type FormState = Result | undefined;

const field = (data: FormData, name: string) => String(data.get(name) ?? '').trim();
const HEX = /^#[0-9a-f]{6}$/i;

function problem(error: z.ZodError): string {
  const issue = error.issues[0];
  const where = issue.path.length ? `${issue.path.join(' → ')}: ` : '';
  return `${where}${issue.message}`;
}

// ── Event types ──────────────────────────────────────────────────────────

const questionSchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().trim().min(1, 'Every question needs a label.').max(200),
  type: z.enum(['text', 'textarea', 'select']),
  required: z.boolean(),
  options: z.array(z.string().trim().min(1).max(100)).max(30),
});

const eventTypeSchema = z.object({
  name: z.string().trim().min(1, 'Give the event a name.').max(100),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .max(60)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'The link may only contain letters, numbers and dashes.'),
  description: z.string().trim().max(2000),
  duration_minutes: z.number().int().min(5, 'Duration must be at least 5 minutes.').max(720),
  color: z.string().regex(HEX),
  location_type: z.enum(['none', 'google_meet', 'teams', 'link', 'phone', 'in_person']),
  location_value: z.string().trim().max(500),
  schedule_id: z.uuid().nullable(),
  slot_interval_minutes: z.number().int().min(5).max(720),
  buffer_before_minutes: z.number().int().min(0).max(720),
  buffer_after_minutes: z.number().int().min(0).max(720),
  min_notice_minutes: z.number().int().min(0).max(60 * 24 * 90),
  max_days_ahead: z.number().int().min(1, 'People must be able to book at least 1 day ahead.').max(730),
  daily_limit: z.number().int().min(1).max(100).nullable(),
  questions: z.array(questionSchema).max(15),
  allow_guests: z.boolean(),
  is_active: z.boolean(),
  is_hidden: z.boolean(),
});

export async function saveEventTypeAction(id: string | null, input: unknown): Promise<Result> {
  await assertOwner();
  const parsed = eventTypeSchema.safeParse(input);
  if (!parsed.success) return { error: problem(parsed.error) };
  const data = parsed.data;

  if (RESERVED_SLUGS.has(data.slug)) return { error: `"${data.slug}" is used by the app itself. Pick another link.` };
  if (data.location_type === 'link' && !/^https?:\/\/\S+$/i.test(data.location_value)) {
    return { error: 'Enter the meeting link, starting with https://' };
  }
  if (data.location_type === 'in_person' && !data.location_value) return { error: 'Enter the address.' };
  if (['none', 'google_meet', 'teams'].includes(data.location_type)) data.location_value = '';
  for (const question of data.questions) {
    if (question.type === 'select' && question.options.length < 2) {
      return { error: `"${question.label}" needs at least two options to choose from.` };
    }
    if (question.type !== 'select') question.options = [];
  }
  if (data.schedule_id && !(await getSchedule(data.schedule_id))) data.schedule_id = null;

  try {
    if (id) await updateEventType(id, data);
    else await insertEventType(data);
  } catch (err) {
    if (pgCode(err) === UNIQUE_VIOLATION) return { error: 'Another event type already uses that link.' };
    throw err;
  }
  redirect('/admin/event-types');
}

export async function setEventTypeActiveAction(id: string, active: boolean): Promise<Result> {
  await assertOwner();
  await updateEventType(id, { is_active: active });
  refresh();
  return {};
}

export async function deleteEventTypeAction(id: string): Promise<Result> {
  await assertOwner();
  await deleteEventType(id);
  redirect('/admin/event-types');
}

// ── Availability ─────────────────────────────────────────────────────────

const rangeSchema = z
  .object({ start: z.string(), end: z.string() })
  .refine(isValidRange, 'Each time range needs an end later than its start.');
const sortRanges = (ranges: TimeRange[]) => [...ranges].sort((a, b) => a.start.localeCompare(b.start));

const scheduleSchema = z.object({
  name: z.string().trim().min(1, 'Give the schedule a name.').max(80),
  timezone: z.string().refine(isValidZone, 'Choose a time zone.'),
  // Days with no hours may simply be left out.
  weekly: z.partialRecord(z.enum(['1', '2', '3', '4', '5', '6', '7']), z.array(rangeSchema).max(6)),
  overrides: z.record(z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.array(rangeSchema).max(6)),
});

export async function saveScheduleAction(id: string | null, input: unknown): Promise<Result> {
  await assertOwner();
  const parsed = scheduleSchema.safeParse(input);
  if (!parsed.success) return { error: problem(parsed.error) };
  const data = {
    name: parsed.data.name,
    timezone: parsed.data.timezone,
    weekly: Object.fromEntries(Object.entries(parsed.data.weekly).map(([day, r]) => [day, sortRanges(r ?? [])])),
    overrides: Object.fromEntries(Object.entries(parsed.data.overrides).map(([date, r]) => [date, sortRanges(r)])),
  };
  if (id) await updateSchedule(id, data);
  else await insertSchedule({ ...data, is_default: false });
  clearBusyCache();
  refresh();
  return { ok: 'Saved.' };
}

export async function setDefaultScheduleAction(id: string): Promise<Result> {
  await assertOwner();
  await setDefaultSchedule(id);
  refresh();
  return {};
}

export async function deleteScheduleAction(id: string): Promise<Result> {
  await assertOwner();
  const schedule = await getSchedule(id);
  if (schedule?.is_default) return { error: 'Make another schedule the default before deleting this one.' };
  await deleteSchedule(id);
  refresh();
  return {};
}

// ── Calendars ────────────────────────────────────────────────────────────

function providerMessage(err: unknown): string {
  if (err instanceof ProviderError) return err.message;
  console.error('[calendars] unexpected error:', err);
  return err instanceof Error ? err.message : 'Something went wrong.';
}

/** Saves the Google or Microsoft app credentials used for "Connect" buttons. */
export async function saveOAuthAppAction(_previous: FormState, data: FormData): Promise<FormState> {
  await assertOwner();
  const provider = field(data, 'provider');
  if (provider !== 'google' && provider !== 'microsoft') return { error: 'Unknown provider.' };
  const clientId = field(data, 'clientId');
  const clientSecret = field(data, 'clientSecret');
  if (!clientId || !clientSecret) return { error: 'Enter both the client ID and the client secret.' };
  const integrations = await getIntegrations();
  const next: Integrations = {
    ...integrations,
    [provider]:
      provider === 'microsoft'
        ? { clientId, clientSecret, tenant: field(data, 'tenant') || undefined }
        : { clientId, clientSecret },
  };
  await saveIntegrations(next);
  refresh();
  return { ok: 'Saved. You can connect an account now.' };
}

export async function connectCalDavAction(_previous: FormState, data: FormData): Promise<FormState> {
  await assertOwner();
  const preset = field(data, 'preset');
  const username = field(data, 'username');
  const password = String(data.get('password') ?? '').replace(/\s+/g, preset === 'icloud' ? '' : ' ').trim();
  let serverUrl = preset in CALDAV_PRESETS ? CALDAV_PRESETS[preset as keyof typeof CALDAV_PRESETS] : field(data, 'serverUrl');
  if (!username || !password) return { error: 'Enter the username and password.' };
  try {
    serverUrl = new URL(serverUrl).href;
  } catch {
    return { error: 'Enter the server address, starting with https://' };
  }
  try {
    const host = new URL(serverUrl).host.replace(/^caldav\./, '');
    await connectAccount('caldav', `${username} (${host})`, { serverUrl, username, password });
  } catch (err) {
    return { error: providerMessage(err) };
  }
  refresh();
  return { ok: 'Connected.' };
}

export async function connectIcsAction(_previous: FormState, data: FormData): Promise<FormState> {
  await assertOwner();
  try {
    const url = normalizeIcsUrl(field(data, 'url'));
    const label = field(data, 'label').slice(0, 80) || new URL(url).host;
    await connectAccount('ics', label, { url });
  } catch (err) {
    return { error: providerMessage(err) };
  }
  refresh();
  return { ok: 'Added.' };
}

export async function setCalendarConflictsAction(calendarId: string, check: boolean): Promise<Result> {
  await assertOwner();
  await setCalendarConflicts(calendarId, check);
  clearBusyCache();
  refresh();
  return {};
}

export async function setBookingTargetAction(calendarId: string | null): Promise<Result> {
  await assertOwner();
  await setBookingTarget(calendarId);
  refresh();
  return {};
}

export async function refreshAccountAction(accountId: string): Promise<Result> {
  await assertOwner();
  try {
    await refreshAccountCalendars(accountId);
  } catch (err) {
    refresh();
    return { error: providerMessage(err) };
  }
  refresh();
  return {};
}

export async function disconnectAccountAction(accountId: string): Promise<Result> {
  await assertOwner();
  await deleteCalendarAccount(accountId);
  clearBusyCache();
  refresh();
  return {};
}

// ── Bookings ─────────────────────────────────────────────────────────────

export async function hostCancelAction(bookingId: string, reason: string): Promise<Result> {
  await assertOwner();
  const booking = await getBooking(bookingId);
  if (!booking) return { error: 'This booking could not be found.' };
  try {
    await cancelBooking(booking, 'host', reason, await getBaseUrl());
  } catch (err) {
    if (err instanceof BookingError) return { error: err.message };
    throw err;
  }
  refresh();
  return {};
}

// ── Settings ─────────────────────────────────────────────────────────────

export async function saveProfileAction(_previous: FormState, data: FormData): Promise<FormState> {
  await assertOwner();
  const name = field(data, 'name').slice(0, 120);
  const email = field(data, 'email').toLowerCase().slice(0, 200);
  const timezone = field(data, 'timezone');
  const avatar = field(data, 'avatar_url').slice(0, 500);
  const color = field(data, 'brand_color');
  if (!name) return { error: 'Enter your name.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Enter a valid email address.' };
  if (!isValidZone(timezone)) return { error: 'Choose a time zone.' };
  if (avatar && !/^https:\/\/\S+$/i.test(avatar)) return { error: 'The photo must be a link starting with https://' };
  if (!HEX.test(color)) return { error: 'Choose a colour.' };
  await updateOwner({
    name,
    email,
    timezone,
    avatar_url: avatar,
    brand_color: color.toLowerCase(),
    welcome_message: field(data, 'welcome_message').slice(0, 1000),
  });
  refresh();
  return { ok: 'Saved.' };
}

export async function saveEmailAction(_previous: FormState, data: FormData): Promise<FormState> {
  await assertOwner();
  const provider = field(data, 'provider');
  if (provider !== 'none' && provider !== 'resend' && provider !== 'smtp') return { error: 'Choose how to send email.' };
  const integrations = await getIntegrations();
  const before = integrations.email;
  const from = field(data, 'from');
  if (provider !== 'none' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from)) {
    return { error: 'Enter the address emails should come from.' };
  }
  // Secrets are never sent back to the browser, so a blank field means "keep what is saved".
  const resendApiKey = field(data, 'resendApiKey') || before?.resendApiKey;
  const smtpPass = String(data.get('smtpPass') ?? '') || before?.smtpPass;
  const smtpHost = field(data, 'smtpHost');
  if (provider === 'resend' && !resendApiKey) return { error: 'Enter your Resend API key.' };
  if (provider === 'smtp' && !smtpHost) return { error: 'Enter the SMTP server name.' };
  await saveIntegrations({
    ...integrations,
    email: {
      provider,
      from,
      resendApiKey,
      smtpHost,
      smtpPort: Number(field(data, 'smtpPort')) || 587,
      smtpUser: field(data, 'smtpUser'),
      smtpPass,
    },
  });
  refresh();
  return { ok: 'Saved.' };
}

export async function testEmailAction(): Promise<Result> {
  const owner = await assertOwner();
  const config = emailConfig(owner);
  if (!config) return { error: 'Email is not set up yet. Save the settings first.' };
  try {
    await sendTestEmail(owner, config);
  } catch (err) {
    return { error: `Could not send: ${err instanceof Error ? err.message : 'unknown error'}` };
  }
  return { ok: `Sent to ${owner.email}.` };
}

export async function saveWebhookAction(_previous: FormState, data: FormData): Promise<FormState> {
  await assertOwner();
  const url = field(data, 'webhook_url');
  if (url && !/^https?:\/\/\S+$/i.test(url)) return { error: 'The address must start with https://' };
  await updateOwner({ webhook_url: url });
  refresh();
  return { ok: url ? 'Saved.' : 'Webhook turned off.' };
}

export async function testWebhookAction(): Promise<Result> {
  const owner = await assertOwner();
  if (!owner.webhook_url) return { error: 'Save a webhook address first.' };
  try {
    await postWebhook(owner.webhook_url, 'test', { message: 'This is a test from Calendi.' });
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'The webhook could not be reached.' };
  }
  return { ok: 'Test sent.' };
}

export async function changePasswordAction(_previous: FormState, data: FormData): Promise<FormState> {
  const owner = await assertOwner();
  const current = String(data.get('current') ?? '');
  const next = String(data.get('next') ?? '');
  if (!(await verifyPassword(current, owner.password_hash))) return { error: 'Your current password is not right.' };
  if (next.length < MIN_PASSWORD_LENGTH) {
    return { error: `Choose a new password of at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  // Bumping the session version signs out every other browser.
  const sessionVersion = owner.session_version + 1;
  await updateOwner({ password_hash: await hashPassword(next), session_version: sessionVersion });
  await startSession({ session_version: sessionVersion });
  return { ok: 'Password changed. Other browsers have been signed out.' };
}
