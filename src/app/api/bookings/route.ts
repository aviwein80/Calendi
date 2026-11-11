import { z } from 'zod';
import { bookingFailure, INVALID_REQUEST } from '@/lib/bookingApi';
import { createBooking } from '@/lib/bookings';
import { getBaseUrl } from '@/lib/env';
import { fromAnotherSite, guarded, json, NOT_ALLOWED, readJson, tooMany } from '@/lib/http';
import { consume, LIMITS } from '@/lib/rateLimit';

// POST /api/bookings: book a time. Anyone on the internet can call this, so
// nothing in the request is trusted: the shape is checked here and the rules
// (is this time really free?) are enforced again in lib/bookings and by the
// database.

export const maxDuration = 60;

const schema = z.object({
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

export const POST = guarded(async (request: Request): Promise<Response> => {
  if (fromAnotherSite(request)) return NOT_ALLOWED();
  const limit = await consume(LIMITS.booking);
  if (!limit.allowed) return tooMany(LIMITS.booking, limit);

  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success || parsed.data.company) return INVALID_REQUEST();
  try {
    const booking = await createBooking(parsed.data, await getBaseUrl());
    return json({ ok: true, token: booking.token });
  } catch (err) {
    return bookingFailure(err);
  }
});
