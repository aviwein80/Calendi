'use server';

import { z } from 'zod';
import { BookingError, cancelBooking, createBooking, rescheduleBooking } from '@/lib/bookings';
import { getBaseUrl } from '@/lib/env';

// Actions anyone on the internet can call from the booking pages. Nothing here
// trusts its input: shapes are checked here and the rules (is this time really
// free?) are enforced again inside lib/bookings.

export type PublicResult =
  | { ok: true; token: string }
  | { ok: false; code: string; message: string };

const bookingSchema = z.object({
  slug: z.string().min(1).max(100),
  start: z.string().min(10).max(40),
  name: z.string().max(200),
  email: z.string().max(300),
  timezone: z.string().max(100),
  phone: z.string().max(60).optional(),
  notes: z.string().max(5000).optional(),
  guests: z.array(z.string().max(300)).max(20).optional(),
  answers: z.record(z.string().max(60), z.string().max(3000)).optional(),
  // Hidden field real people never fill in; bots usually do.
  company: z.string().max(200).optional(),
});

function failure(err: unknown): PublicResult {
  if (err instanceof BookingError) return { ok: false, code: err.code, message: err.message };
  console.error('[booking] unexpected error:', err);
  return { ok: false, code: 'error', message: 'Something went wrong on our side. Please try again.' };
}

const INVALID: PublicResult = {
  ok: false,
  code: 'invalid',
  message: 'Some of the details could not be read. Please check the form and try again.',
};

export async function bookAction(input: unknown): Promise<PublicResult> {
  const parsed = bookingSchema.safeParse(input);
  if (!parsed.success || parsed.data.company) return INVALID;
  try {
    const booking = await createBooking(parsed.data, await getBaseUrl());
    return { ok: true, token: booking.token };
  } catch (err) {
    return failure(err);
  }
}

const cancelSchema = z.object({ token: z.string().min(10).max(100), reason: z.string().max(2000) });

export async function cancelAction(input: unknown): Promise<PublicResult> {
  const parsed = cancelSchema.safeParse(input);
  if (!parsed.success) return INVALID;
  try {
    const booking = await cancelBooking(parsed.data.token, 'invitee', parsed.data.reason, await getBaseUrl());
    return { ok: true, token: booking.token };
  } catch (err) {
    return failure(err);
  }
}

const rescheduleSchema = z.object({
  token: z.string().min(10).max(100),
  start: z.string().min(10).max(40),
  timezone: z.string().max(100).optional(),
});

export async function rescheduleAction(input: unknown): Promise<PublicResult> {
  const parsed = rescheduleSchema.safeParse(input);
  if (!parsed.success) return INVALID;
  try {
    const booking = await rescheduleBooking(
      parsed.data.token,
      parsed.data.start,
      'invitee',
      await getBaseUrl(),
      parsed.data.timezone,
    );
    return { ok: true, token: booking.token };
  } catch (err) {
    return failure(err);
  }
}
