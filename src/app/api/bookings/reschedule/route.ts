import { z } from 'zod';
import { bookingFailure, INVALID_REQUEST, linkFailure } from '@/lib/bookingApi';
import { rescheduleBooking } from '@/lib/bookings';
import { getBaseUrl } from '@/lib/env';
import { fromAnotherSite, guarded, json, NOT_ALLOWED, readJson, tooMany } from '@/lib/http';
import { findBookingByLink } from '@/lib/manage';
import { consume, LIMITS } from '@/lib/rateLimit';

// POST /api/bookings/reschedule  { token, start, timezone? }
// An invitee moves their booking, proving who they are with the token from their link.

export const maxDuration = 60;

const schema = z.object({
  token: z.string().min(1).max(100),
  start: z.string().min(10).max(40),
  timezone: z.string().max(100).optional(),
});

export const POST = guarded(async (request: Request): Promise<Response> => {
  if (fromAnotherSite(request)) return NOT_ALLOWED();
  const limit = await consume(LIMITS.reschedule);
  if (!limit.allowed) return tooMany(LIMITS.reschedule, limit);

  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return INVALID_REQUEST();
  try {
    const lookup = await findBookingByLink(parsed.data.token);
    if (lookup.status !== 'found') return linkFailure(lookup);
    await rescheduleBooking(lookup.booking, parsed.data.start, 'invitee', await getBaseUrl(), parsed.data.timezone);
    return json({ ok: true, token: parsed.data.token });
  } catch (err) {
    return bookingFailure(err);
  }
});
