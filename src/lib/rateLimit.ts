import 'server-only';
import { headers } from 'next/headers';
import { sign } from './crypto';
import { bumpRateCounter, readRateCounter } from './store';

// Per-visitor request limits, counted in Postgres so every server instance
// shares them. Each limit is "at most `max` requests per `seconds` from one
// network address". Addresses are stored only as a keyed hash.

export type Limit = { name: string; max: number; seconds: number; message: string };

const MINUTE = 60;
const HOUR = 3600;

export const LIMITS = {
  /** Looking up times: one request per month viewed, so this is generous. */
  availability: {
    name: 'availability',
    max: 60,
    seconds: MINUTE,
    message: 'You are loading times very quickly. Please wait a minute and try again.',
  },
  booking: {
    name: 'booking',
    max: 8,
    seconds: HOUR,
    message: 'That is a lot of bookings from one place. Please try again in an hour.',
  },
  cancel: {
    name: 'cancel',
    max: 10,
    seconds: HOUR,
    message: 'Too many cancellations from one place. Please try again in an hour.',
  },
  reschedule: {
    name: 'reschedule',
    max: 10,
    seconds: HOUR,
    message: 'Too many changes from one place. Please try again in an hour.',
  },
  /** Below the account-wide lockout, so one address cannot lock the owner out alone. */
  login: {
    name: 'login',
    max: 5,
    seconds: 15 * MINUTE,
    message: 'Too many sign-in attempts from your network. Please wait 15 minutes and try again.',
  },
  setup: {
    name: 'setup',
    max: 5,
    seconds: 15 * MINUTE,
    message: 'Too many setup attempts from your network. Please wait 15 minutes and try again.',
  },
  /** Booking links that do not exist: guessing is cut off quickly. */
  wrongToken: {
    name: 'wrong-token',
    max: 10,
    seconds: 15 * MINUTE,
    message: 'Too many booking links that do not exist were tried from your network. Please wait 15 minutes.',
  },
} satisfies Record<string, Limit>;

export type LimitResult = { allowed: boolean; retryAfterSeconds: number };

/**
 * The visitor's network address, as reported by the hosting platform.
 * On Vercel only Vercel's own headers are trusted. Elsewhere the reverse
 * proxy is expected to set X-Real-IP (or append to X-Forwarded-For); with no
 * proxy at all a client can choose this value, so put one in front.
 */
export async function clientAddress(): Promise<string> {
  const list = await headers();
  const forwarded = list.get('x-forwarded-for')?.split(',').map((part) => part.trim()).filter(Boolean) ?? [];
  if (process.env.VERCEL) {
    return list.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() || forwarded[0] || 'unknown';
  }
  return list.get('x-real-ip')?.trim() || forwarded[forwarded.length - 1] || 'unknown';
}

function windowStart(limit: Limit, now: number): Date {
  const size = limit.seconds * 1000;
  return new Date(Math.floor(now / size) * size);
}

function counterKey(limit: Limit, address: string): string {
  // A keyed hash: the table never holds an address anyone could read back.
  return `${limit.name}:${sign(`rate-limit:${address}`).slice(0, 32)}`;
}

function result(limit: Limit, count: number, now: number): LimitResult {
  const end = windowStart(limit, now).getTime() + limit.seconds * 1000;
  return { allowed: count <= limit.max, retryAfterSeconds: Math.max(1, Math.ceil((end - now) / 1000)) };
}

/** Counts this request against the limit and says whether it may go ahead. */
export async function consume(limit: Limit, address?: string): Promise<LimitResult> {
  const now = Date.now();
  const count = await bumpRateCounter(counterKey(limit, address ?? (await clientAddress())), windowStart(limit, now));
  return result(limit, count, now);
}

/** Whether the limit is already used up, without counting this request. */
export async function exhausted(limit: Limit, address?: string): Promise<LimitResult> {
  const now = Date.now();
  const count = await readRateCounter(counterKey(limit, address ?? (await clientAddress())), windowStart(limit, now));
  // "Used up" means the next request would be over the limit.
  return result(limit, count + 1, now);
}
