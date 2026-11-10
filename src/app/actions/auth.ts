'use server';

import { redirect } from 'next/navigation';
import { MIN_PASSWORD_LENGTH } from '@/lib/constants';
import { hashPassword, verifyPassword } from '@/lib/crypto';
import { pgCode, UNIQUE_VIOLATION } from '@/lib/db';
import { isValidZone } from '@/lib/format';
import { endSession, startSession } from '@/lib/session';
import { createOwner, getOwner, insertEventType, insertSchedule, updateOwner } from '@/lib/store';

export type FormState = { error?: string; ok?: string } | undefined;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_FAILED_LOGINS = 8;
const LOCK_MINUTES = 15;

const field = (data: FormData, name: string) => String(data.get(name) ?? '').trim();

/** First-run setup: creates the one owner account plus sensible starting data. */
export async function setupAction(_previous: FormState, data: FormData): Promise<FormState> {
  if (await getOwner()) redirect('/admin/login');

  const name = field(data, 'name').slice(0, 120);
  const email = field(data, 'email').toLowerCase().slice(0, 200);
  const password = String(data.get('password') ?? '');
  const timezone = field(data, 'timezone');
  if (!name) return { error: 'Enter your name.' };
  if (!EMAIL_PATTERN.test(email)) return { error: 'Enter a valid email address.' };
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { error: `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  if (!isValidZone(timezone)) return { error: 'Choose your time zone.' };

  let owner;
  try {
    owner = await createOwner({ name, email, passwordHash: await hashPassword(password), timezone });
  } catch (err) {
    if (pgCode(err) === UNIQUE_VIOLATION) redirect('/admin/login');
    throw err;
  }

  const workday = [{ start: '09:00', end: '17:00' }];
  await insertSchedule({
    name: 'Working hours',
    timezone,
    is_default: true,
    weekly: { '1': workday, '2': workday, '3': workday, '4': workday, '5': workday },
    overrides: {},
  });
  await insertEventType({
    slug: '30min',
    name: '30 Minute Meeting',
    description: '',
    duration_minutes: 30,
    color: '#4f46e5',
    location_type: 'none',
    location_value: '',
    schedule_id: null,
    slot_interval_minutes: 30,
    buffer_before_minutes: 0,
    buffer_after_minutes: 0,
    min_notice_minutes: 240,
    max_days_ahead: 60,
    daily_limit: null,
    questions: [],
    allow_guests: false,
    is_active: true,
    is_hidden: false,
  });

  await startSession(owner);
  redirect('/admin/event-types?welcome=1');
}

export async function loginAction(_previous: FormState, data: FormData): Promise<FormState> {
  const owner = await getOwner();
  if (!owner) redirect('/admin/setup');

  if (owner.locked_until && owner.locked_until.getTime() > Date.now()) {
    const minutes = Math.ceil((owner.locked_until.getTime() - Date.now()) / 60_000);
    return { error: `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.` };
  }

  const email = field(data, 'email').toLowerCase();
  const password = String(data.get('password') ?? '');
  // Always run the password check so timing does not reveal whether the email matched.
  const passwordOk = await verifyPassword(password, owner.password_hash);
  if (!passwordOk || email !== owner.email.toLowerCase()) {
    const failed = owner.failed_logins + 1;
    const lock = failed >= MAX_FAILED_LOGINS;
    await updateOwner({
      failed_logins: lock ? 0 : failed,
      locked_until: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
    });
    return { error: 'That email and password do not match.' };
  }

  if (owner.failed_logins > 0 || owner.locked_until) {
    await updateOwner({ failed_logins: 0, locked_until: null });
  }
  await startSession(owner);
  redirect('/admin/event-types');
}

export async function logoutAction(): Promise<void> {
  await endSession();
  redirect('/admin/login');
}
