import type { NextRequest } from 'next/server';
import { buildIcs } from '@/lib/calendars/icsBuild';
import { BLOCKED_MESSAGE, findBookingByLink } from '@/lib/manage';
import { getOwner } from '@/lib/store';

// GET /api/ics/<booking token>: the booking as a downloadable .ics file.

export async function GET(_request: NextRequest, context: RouteContext<'/api/ics/[token]'>): Promise<Response> {
  const { token } = await context.params;
  const [lookup, owner] = await Promise.all([findBookingByLink(token), getOwner()]);
  if (lookup.status === 'blocked') {
    return new Response(BLOCKED_MESSAGE, { status: 429, headers: { 'Retry-After': String(lookup.retryAfterSeconds) } });
  }
  if (lookup.status !== 'found' || !owner) return new Response('Not found', { status: 404 });
  const booking = lookup.booking;

  const ics = buildIcs({
    uid: `${booking.id}@calendi`,
    start: booking.start_at,
    end: booking.end_at,
    title: `${booking.event_name} with ${owner.name}`,
    description: booking.meeting_url ? `Join: ${booking.meeting_url}` : '',
    location: booking.meeting_url || booking.location,
    sequence: booking.sequence,
    cancelled: booking.status === 'cancelled',
  });
  return new Response(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="meeting.ics"',
      'Cache-Control': 'no-store',
    },
  });
}
