import { CalendarCheck, CalendarDays, CalendarX, Download, Globe, MapPin, User, Video } from 'lucide-react';
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { PublicFrame, PublicMessage, PublicSkeleton } from '@/components/PublicFrame';
import { brandStyle, buttonClass, LinkButton } from '@/components/ui';
import { emailConfig } from '@/lib/email';
import { formatRange, zoneLabel } from '@/lib/format';
import { BLOCKED_MESSAGE, findBookingByLink } from '@/lib/manage';
import { hasStarted } from '@/lib/public';
import { getOwner } from '@/lib/store';
import type { Booking, Owner } from '@/lib/types';

// What an invitee sees after booking, and where their emailed links lead:
// the details, add-to-calendar buttons, and reschedule / cancel.

export const metadata: Metadata = { title: 'Your booking', robots: { index: false } };

export default function BookingPage(props: PageProps<'/booking/[token]'>) {
  return (
    <PublicFrame>
      <Suspense fallback={<PublicSkeleton />}>
        <Content {...props} />
      </Suspense>
    </PublicFrame>
  );
}

function compact(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function calendarLinks(booking: Booking, owner: Owner) {
  const title = `${booking.event_name} with ${owner.name}`;
  const where = booking.meeting_url || booking.location;
  const details = booking.meeting_url ? `Join: ${booking.meeting_url}` : '';
  const google = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${compact(booking.start_at)}/${compact(booking.end_at)}`,
    details,
    location: where,
  });
  const outlook = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: title,
    startdt: booking.start_at.toISOString(),
    enddt: booking.end_at.toISOString(),
    body: details,
    location: where,
  });
  return {
    google: `https://calendar.google.com/calendar/render?${google}`,
    outlook: `https://outlook.office.com/calendar/0/deeplink/compose?${outlook}`,
    ics: `/api/ics/${booking.token}`,
  };
}

async function Content({ params, searchParams }: PageProps<'/booking/[token]'>) {
  await connection();
  const [{ token }, query] = await Promise.all([params, searchParams]);
  const [lookup, owner] = await Promise.all([findBookingByLink(token), getOwner()]);
  if (lookup.status === 'blocked') {
    return <PublicMessage title="Too many attempts">{BLOCKED_MESSAGE}</PublicMessage>;
  }
  if (lookup.status !== 'found' || !owner) {
    return <PublicMessage title="Booking not found">This link may be incomplete or out of date.</PublicMessage>;
  }
  const booking = lookup.booking;

  const zone = booking.invitee_timezone;
  const cancelled = booking.status === 'cancelled';
  const started = hasStarted(booking);
  const links = calendarLinks(booking, owner);
  const emailOn = emailConfig(owner) !== null;

  const heading = cancelled
    ? 'This meeting was cancelled'
    : started
      ? 'This meeting has taken place'
      : query.moved
        ? 'Your meeting was moved'
        : 'You are scheduled';
  const sub = cancelled
    ? booking.cancel_reason
      ? `Reason: ${booking.cancel_reason}`
      : ''
    : started
      ? ''
      : booking.invited_by_calendar
        ? `A calendar invitation has been sent to ${booking.invitee_email}.`
        : emailOn
          ? `A confirmation has been sent to ${booking.invitee_email}.`
          : 'Add it to your calendar below so you do not miss it.';

  return (
    <div
      className="fade-in mx-auto w-full max-w-xl rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8"
      style={brandStyle(owner.brand_color)}
    >
      <div className="flex flex-col items-center text-center">
        <span
          className={`inline-flex size-12 items-center justify-center rounded-full ${cancelled ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'}`}
        >
          {cancelled ? <CalendarX className="size-6" aria-hidden /> : <CalendarCheck className="size-6" aria-hidden />}
        </span>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-zinc-900">{heading}</h1>
        {sub && <p className="mt-2 text-sm leading-6 text-zinc-600">{sub}</p>}
      </div>

      <div className="mt-6 rounded-xl border border-zinc-200 p-5">
        <h2 className="text-base font-semibold text-zinc-900">{booking.event_name}</h2>
        <ul className="mt-3 space-y-2.5 text-sm text-zinc-700">
          <li className="flex items-start gap-2.5">
            <User className="mt-0.5 size-4 shrink-0 text-zinc-500" aria-hidden />
            {owner.name} and {booking.invitee_name}
          </li>
          <li className={`flex items-start gap-2.5 ${cancelled ? 'line-through' : ''}`}>
            <CalendarDays className="mt-0.5 size-4 shrink-0 text-zinc-500" aria-hidden />
            {formatRange(booking.start_at, booking.end_at, zone)}
          </li>
          <li className="flex items-start gap-2.5">
            <Globe className="mt-0.5 size-4 shrink-0 text-zinc-500" aria-hidden />
            {zoneLabel(zone, booking.start_at)}
          </li>
          {!cancelled && (booking.meeting_url || booking.location) && (
            <li className="flex items-start gap-2.5">
              {booking.meeting_url ? (
                <Video className="mt-0.5 size-4 shrink-0 text-zinc-500" aria-hidden />
              ) : (
                <MapPin className="mt-0.5 size-4 shrink-0 text-zinc-500" aria-hidden />
              )}
              {booking.meeting_url ? (
                <a href={booking.meeting_url} className="min-w-0 break-all font-medium text-brand hover:underline">
                  {booking.meeting_url}
                </a>
              ) : (
                <span className="min-w-0 break-words">{booking.location}</span>
              )}
            </li>
          )}
        </ul>
      </div>

      {!cancelled && !started && (
        <>
          <div className="mt-5">
            <p className="text-sm font-medium text-zinc-800">Add to your calendar</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <a href={links.google} target="_blank" rel="noreferrer" className={buttonClass('secondary', 'sm')}>
                Google
              </a>
              <a href={links.outlook} target="_blank" rel="noreferrer" className={buttonClass('secondary', 'sm')}>
                Outlook
              </a>
              <a href={links.ics} className={buttonClass('secondary', 'sm')}>
                <Download className="size-4" aria-hidden />
                Apple / other (.ics)
              </a>
            </div>
          </div>
          <div className="mt-6 flex flex-wrap gap-2 border-t border-zinc-200 pt-5">
            <LinkButton href={`/booking/${booking.token}/reschedule`} variant="secondary">
              Reschedule
            </LinkButton>
            <LinkButton href={`/booking/${booking.token}/cancel`} variant="danger">
              Cancel
            </LinkButton>
          </div>
        </>
      )}
    </div>
  );
}
