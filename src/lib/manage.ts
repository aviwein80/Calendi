import 'server-only';
import { consume, exhausted, LIMITS } from './rateLimit';
import { getBookingByToken } from './store';
import type { Booking } from './types';

// Finding a booking from the secret token in an invitee's link. Every place
// that accepts such a token goes through here, so that guessing is counted
// (per network address) and cut off, wherever the guess was made.

export type LinkLookup =
  | { status: 'found'; booking: Booking }
  | { status: 'missing' }
  | { status: 'blocked'; retryAfterSeconds: number };

export const BLOCKED_MESSAGE = LIMITS.wrongToken.message;

export async function findBookingByLink(token: string): Promise<LinkLookup> {
  const gate = await exhausted(LIMITS.wrongToken);
  if (!gate.allowed) return { status: 'blocked', retryAfterSeconds: gate.retryAfterSeconds };
  const booking = await getBookingByToken(token);
  if (booking) return { status: 'found', booking };
  await consume(LIMITS.wrongToken);
  return { status: 'missing' };
}
