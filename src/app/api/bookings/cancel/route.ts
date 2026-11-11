import { z } from 'zod';
import { bookingFailure, INVALID_REQUEST, linkFailure } from '@/lib/bookingApi';
import { cancelBooking } from '@/lib/bookings';
import { getBaseUrl } from '@/lib/env';
import { fromAnotherSite, guarded, json, NOT_ALLOWED, readJson, tooMany } from '@/lib/http';
import { findBookingByLink } from '@/lib/manage';
import { consume, LIMITS } from '@/lib/rateLimit';

// POST /api/bookings/cancel  { token, reason }
// An invitee cancels, proving who they are with the token from their link.

export const maxDuration = 60;

const schema = z.object({ token: z.string().min(1).max(100), reason: z.string().max(2000) });

export const POST = guarded(async (request: Request): Promise<Response> => {
  if (fromAnotherSite(request)) return NOT_ALLOWED();
  const limit = await consume(LIMITS.cancel);
  if (!limit.allowed) return tooMany(LIMITS.cancel, limit);

  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return INVALID_REQUEST();
  try {
    const lookup = await findBookingByLink(parsed.data.token);
    if (lookup.status !== 'found') return linkFailure(lookup);
    await cancelBooking(lookup.booking, 'invitee', parsed.data.reason, await getBaseUrl());
    return json({ ok: true, token: parsed.data.token });
  } catch (err) {
    return bookingFailure(err);
  }
});
