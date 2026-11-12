import 'server-only';
import { randomInt } from 'node:crypto';
import { secretsMatch, sign } from './crypto';
import { emailConfig, sendVerificationCode } from './email';
import {
  countOwnerEmailAttempt,
  deleteOwnerEmail,
  getOwnerEmail,
  insertOwnerEmail,
  listOwnerEmails,
  listVerifiedEmails,
  markOwnerEmailVerified,
  setOwnerEmailCode,
  updateOwner,
} from './store';
import type { Owner } from './types';

// The owner's email addresses. Any verified one signs in (with the one
// password); one of them is the notifications address (owner.email). An
// address is verified by typing in a six-digit code emailed to it, which
// needs outgoing email to be set up: until it is, a new address stays
// unverified and cannot be used to sign in.

export const MAX_ADDRESSES = 10;
export const CODE_MINUTES = 30;
export const MAX_CODE_ATTEMPTS = 5;
const RESEND_SECONDS = 30;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type EmailResult = { ok?: string; error?: string };

/** Lower-cased and checked, or null if it is not an email address. */
export function normalizeEmail(input: unknown): string | null {
  const email = typeof input === 'string' ? input.trim().toLowerCase() : '';
  return email.length <= 200 && EMAIL_PATTERN.test(email) ? email : null;
}

/**
 * The stored form of a code: an HMAC keyed with APP_SECRET and bound to the
 * address's row, so a copy of the database is no help in guessing it.
 */
export function codeHash(id: string, code: string): string {
  return sign(`owner-email-code:${id}:${code}`);
}

/** Whether a typed code matches the stored one. Spaces and dashes are ignored. */
export function codeMatches(id: string, typed: string, stored: string): boolean {
  const digits = typed.replace(/[\s-]/g, '');
  if (!/^\d{6}$/.test(digits) || !stored) return false;
  return secretsMatch(codeHash(id, digits), stored);
}

/** Emails a fresh code to an unverified address. */
export async function sendCode(owner: Owner, id: string, baseUrl: string): Promise<EmailResult> {
  const row = await getOwnerEmail(id);
  if (!row) return { error: 'That address is no longer on your account.' };
  if (row.verified_at) return { ok: 'Already confirmed.' };
  const config = emailConfig(owner);
  if (!config) {
    return { error: 'Email sending is not set up yet, so no code can be sent. Set it up under Email notifications below.' };
  }
  if (row.code_sent_at && Date.now() - row.code_sent_at.getTime() < RESEND_SECONDS * 1000) {
    return { error: 'A code was sent a moment ago. Check your inbox, or try again in half a minute.' };
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await setOwnerEmailCode(id, codeHash(id, code), new Date(Date.now() + CODE_MINUTES * 60_000));
  try {
    await sendVerificationCode(owner, config, row.email, code, baseUrl);
  } catch (err) {
    console.error('[email] could not send a confirmation code:', err);
    return { error: `The code could not be sent: ${err instanceof Error ? err.message.slice(0, 200) : 'unknown error'}` };
  }
  return { ok: `Code sent to ${row.email}.` };
}

/** Adds an address and, when email is set up, sends it a code. */
export async function addAddress(owner: Owner, input: unknown, baseUrl: string): Promise<EmailResult> {
  const email = normalizeEmail(input);
  if (!email) return { error: 'Enter a valid email address.' };
  const existing = await listOwnerEmails();
  if (existing.length >= MAX_ADDRESSES) return { error: `You can have up to ${MAX_ADDRESSES} addresses.` };
  const row = await insertOwnerEmail(email);
  if (!row) return { error: 'That address is already on your account.' };
  if (!emailConfig(owner)) {
    return {
      ok: `Added ${email}, but it is unverified: email sending is not set up, so no code could be sent. It cannot be used to sign in until it is confirmed.`,
    };
  }
  const sent = await sendCode(owner, row.id, baseUrl);
  return sent.error ? { ok: `Added ${email}, but it is unverified. ${sent.error}` } : sent;
}

/** Confirms an address with the code that was emailed to it. */
export async function confirmAddress(id: string, typed: string): Promise<EmailResult> {
  const row = await getOwnerEmail(id);
  if (!row) return { error: 'That address is no longer on your account.' };
  if (row.verified_at) return { ok: 'Confirmed.' };
  if (!row.code_hash || !row.code_expires_at || row.code_expires_at.getTime() < Date.now()) {
    return { error: 'That code has expired. Press “Send a new code”.' };
  }
  if (row.code_attempts >= MAX_CODE_ATTEMPTS) {
    return { error: 'Too many wrong codes. Press “Send a new code”.' };
  }
  if (!codeMatches(id, typed, row.code_hash)) {
    const attempts = await countOwnerEmailAttempt(id);
    const left = MAX_CODE_ATTEMPTS - attempts;
    return {
      error: left > 0 ? `That code is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Too many wrong codes. Press “Send a new code”.',
    };
  }
  await markOwnerEmailVerified(id);
  return { ok: `Confirmed. You can now sign in with ${row.email}.` };
}

/** Removes an address, unless it is the notifications address or the last one that can sign in. */
export async function removeAddress(owner: Owner, id: string): Promise<EmailResult> {
  const row = await getOwnerEmail(id);
  if (!row) return {};
  if (row.email.toLowerCase() === owner.email.toLowerCase()) {
    return { error: 'This is your notifications address. Choose another one for notifications first.' };
  }
  if (row.verified_at && (await listVerifiedEmails()).length <= 1) {
    return { error: 'You need at least one confirmed address to sign in with.' };
  }
  await deleteOwnerEmail(id);
  return {};
}

/** Makes a confirmed address the one booking alerts go to. */
export async function setNotificationAddress(id: string): Promise<EmailResult> {
  const row = await getOwnerEmail(id);
  if (!row?.verified_at) return { error: 'Only a confirmed address can receive notifications.' };
  await updateOwner({ email: row.email });
  return { ok: `Notifications now go to ${row.email}.` };
}

/** A meeting type's alert address must be '' (the default) or one of the confirmed addresses. */
export async function validAlertAddress(value: string): Promise<boolean> {
  if (!value) return true;
  const verified = await listVerifiedEmails();
  return verified.some((email) => email.toLowerCase() === value.toLowerCase());
}
