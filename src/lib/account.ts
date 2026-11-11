import 'server-only';
import { MIN_PASSWORD_LENGTH, MIN_SETUP_TOKEN_LENGTH } from './constants';
import { hashPassword, secretsMatch, verifyPassword } from './crypto';
import { pgCode, UNIQUE_VIOLATION } from './db';
import { isValidZone } from './format';
import { createOwner, getOwner, insertEventType, insertSchedule, updateOwner } from './store';
import type { Owner } from './types';

// The owner's account: creating it (once, with the setup token) and signing in.
// Rate limiting and the session cookie are handled by the routes that call this.

export type AccountResult =
  | { ok: true; owner: Owner }
  | { ok: false; status: number; message: string };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_FAILED_LOGINS = 8;
const LOCK_MINUTES = 15;

const refuse = (status: number, message: string): AccountResult => ({ ok: false, status, message });
const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/**
 * The SETUP_TOKEN setting, or '' when it is missing or too short to be safe.
 * Surrounding whitespace is dropped first: a value pasted into a host's
 * settings page often arrives with a trailing space or line break, which
 * nobody could then type on the setup form.
 */
export function configuredSetupToken(env: Record<string, string | undefined> = process.env): string {
  const token = (env.SETUP_TOKEN ?? '').trim();
  return token.length >= MIN_SETUP_TOKEN_LENGTH ? token : '';
}

export type SetupInput = {
  setupToken?: unknown;
  name?: unknown;
  email?: unknown;
  password?: unknown;
  timezone?: unknown;
};

/**
 * First-run setup: creates the one owner account plus sensible starting data.
 * Whoever submits the form with the right SETUP_TOKEN first becomes the owner;
 * after that this always refuses.
 */
export async function createAccount(input: SetupInput): Promise<AccountResult> {
  if (await getOwner()) return refuse(409, 'This site already has an owner. Sign in instead.');

  const expected = configuredSetupToken();
  if (!expected) {
    return refuse(
      403,
      `Setup is locked. Add a SETUP_TOKEN setting of at least ${MIN_SETUP_TOKEN_LENGTH} characters, redeploy, and try again.`,
    );
  }
  const given = typeof input.setupToken === 'string' ? input.setupToken.trim() : '';
  if (!secretsMatch(given, expected)) {
    return refuse(403, 'That setup token does not match the SETUP_TOKEN setting of this site.');
  }

  const name = text(input.name, 120);
  const email = text(input.email, 200).toLowerCase();
  const password = typeof input.password === 'string' ? input.password : '';
  const timezone = text(input.timezone, 100);
  if (!name) return refuse(400, 'Enter your name.');
  if (!EMAIL_PATTERN.test(email)) return refuse(400, 'Enter a valid email address.');
  if (password.length < MIN_PASSWORD_LENGTH) {
    return refuse(400, `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (password.length > 1000) return refuse(400, 'That password is too long.');
  if (!isValidZone(timezone)) return refuse(400, 'Choose your time zone.');

  let owner: Owner;
  try {
    owner = await createOwner({ name, email, passwordHash: await hashPassword(password), timezone });
  } catch (err) {
    // Someone else finished setup between the check above and now.
    if (pgCode(err) === UNIQUE_VIOLATION) return refuse(409, 'This site already has an owner. Sign in instead.');
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
  return { ok: true, owner };
}

export async function signIn(input: { email?: unknown; password?: unknown }): Promise<AccountResult> {
  const owner = await getOwner();
  if (!owner) return refuse(409, 'This site has not been set up yet.');

  if (owner.locked_until && owner.locked_until.getTime() > Date.now()) {
    const minutes = Math.ceil((owner.locked_until.getTime() - Date.now()) / 60_000);
    return refuse(429, `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`);
  }

  const email = text(input.email, 200).toLowerCase();
  const password = typeof input.password === 'string' ? input.password.slice(0, 1000) : '';
  // Always run the password check so timing does not reveal whether the email matched.
  const passwordOk = await verifyPassword(password, owner.password_hash);
  if (!passwordOk || !secretsMatch(email, owner.email.toLowerCase())) {
    const failed = owner.failed_logins + 1;
    const lock = failed >= MAX_FAILED_LOGINS;
    await updateOwner({
      failed_logins: lock ? 0 : failed,
      locked_until: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
    });
    return refuse(401, 'That email and password do not match.');
  }

  if (owner.failed_logins > 0 || owner.locked_until) {
    await updateOwner({ failed_logins: 0, locked_until: null });
  }
  return { ok: true, owner };
}
