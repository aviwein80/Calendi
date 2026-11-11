import 'server-only';
import { BookingError, type BookingErrorCode } from './bookings';
import { json, tooMany } from './http';
import { BLOCKED_MESSAGE, type LinkLookup } from './manage';
import { LIMITS } from './rateLimit';

// How the booking endpoints (/api/bookings…) answer. Every reply is JSON:
//   { ok: true, token }                       the booking's manage-link token
//   { ok: false, code, message }              with a matching HTTP status

const STATUS: Record<BookingErrorCode, number> = {
  invalid: 400,
  not_found: 404,
  slot_taken: 409,
  too_late: 409,
  calendar_unavailable: 503,
  rate_limited: 429,
};

export const INVALID_REQUEST = () =>
  json(
    { ok: false, code: 'invalid', message: 'Some of the details could not be read. Please check the form and try again.' },
    400,
  );

export function bookingFailure(err: unknown): Response {
  if (err instanceof BookingError) {
    return json({ ok: false, code: err.code, message: err.message }, STATUS[err.code]);
  }
  console.error('[booking] unexpected error:', err);
  return json({ ok: false, code: 'error', message: 'Something went wrong on our side. Please try again.' }, 500);
}

/** The reply for a manage link that was not found, or for too many wrong ones. */
export function linkFailure(lookup: Exclude<LinkLookup, { status: 'found' }>): Response {
  if (lookup.status === 'blocked') {
    return tooMany({ ...LIMITS.wrongToken, message: BLOCKED_MESSAGE }, { allowed: false, retryAfterSeconds: lookup.retryAfterSeconds });
  }
  return json({ ok: false, code: 'not_found', message: 'This booking could not be found.' }, 404);
}
