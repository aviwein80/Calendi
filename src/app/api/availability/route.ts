import type { NextRequest } from 'next/server';
import { getSlots, MAX_RANGE_MS } from '@/lib/availability';
import { CalendarUnavailableError } from '@/lib/calendars';
import { getBookingByToken, getEventTypeBySlug } from '@/lib/store';
import type { Booking } from '@/lib/types';

// GET /api/availability?slug=30min&from=<ISO>&to=<ISO>[&reschedule=<booking token>]
// Returns the bookable start times in that range as ISO timestamps (UTC).

export const maxDuration = 60;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(request: NextRequest): Promise<Response> {
  const params = request.nextUrl.searchParams;
  const slug = params.get('slug') ?? '';
  const from = Date.parse(params.get('from') ?? '');
  const to = Date.parse(params.get('to') ?? '');
  if (!slug || !Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > MAX_RANGE_MS) {
    return json({ error: 'invalid', message: 'Give a slug and a from/to range of at most two months.' }, 400);
  }

  const eventType = await getEventTypeBySlug(slug);
  if (!eventType) return json({ error: 'not_found', message: 'This event does not exist.' }, 404);

  // Someone moving an existing booking may reuse their own time, and may still
  // reschedule after the event type has been switched off for new bookings.
  let excluding: Booking | undefined;
  const token = params.get('reschedule');
  if (token) {
    const booking = await getBookingByToken(token);
    if (booking?.status === 'confirmed' && booking.event_type_id === eventType.id) excluding = booking;
  }
  if (!eventType.is_active && !excluding) {
    return json({ error: 'not_found', message: 'This event is not taking bookings.' }, 404);
  }

  try {
    const slots = await getSlots(eventType, from, to, { excluding });
    return json({ slots: slots.map((ms) => new Date(ms).toISOString()) });
  } catch (err) {
    if (err instanceof CalendarUnavailableError) {
      return json(
        {
          error: 'calendar_unavailable',
          message: 'Available times could not be loaded right now. Please try again in a few minutes.',
        },
        503,
      );
    }
    console.error('[availability] unexpected error:', err);
    return json({ error: 'error', message: 'Available times could not be loaded.' }, 500);
  }
}
