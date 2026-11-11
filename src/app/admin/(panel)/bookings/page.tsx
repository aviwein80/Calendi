import { ChevronDown, Download } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { HostCancel } from '@/components/BookingBits';
import { CopyButton } from '@/components/client';
import { Badge, buttonClass, Card, cx, PageHeader, Skeleton } from '@/components/ui';
import { getBaseUrl } from '@/lib/env';
import { formatDate, formatTime, zoneLabel } from '@/lib/format';
import { requireOwner } from '@/lib/session';
import { listBookings } from '@/lib/store';
import type { Booking } from '@/lib/types';

export const metadata: Metadata = { title: 'Bookings' };

const VIEWS = [
  ['upcoming', 'Upcoming'],
  ['past', 'Past'],
  ['cancelled', 'Cancelled'],
] as const;
type View = (typeof VIEWS)[number][0];

// Actions on this page talk to calendar and email services; allow them time.
export const maxDuration = 60;

export default function BookingsPage(props: PageProps<'/admin/bookings'>) {
  return (
    <>
      <PageHeader
        title="Bookings"
        action={
          // A file download from a route handler, not a page, so a plain link is right.
          // eslint-disable-next-line @next/next/no-html-link-for-pages
          <a href="/admin/bookings/export" className={buttonClass('secondary', 'md')}>
            <Download className="size-4" aria-hidden />
            Export CSV
          </a>
        }
      />
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <Content {...props} />
      </Suspense>
    </>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[9rem_1fr]">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="min-w-0 whitespace-pre-line break-words text-zinc-900">{children}</dd>
    </div>
  );
}

function BookingRow({ booking, zone, baseUrl, view }: { booking: Booking; zone: string; baseUrl: string; view: View }) {
  const manageUrl = booking.token ? `${baseUrl}/booking/${booking.token}` : '';
  return (
    <li>
      <details className="group">
        <summary className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-zinc-50">
          <span className="w-36 shrink-0 text-sm font-medium tabular-nums text-zinc-900">
            {formatTime(booking.start_at, zone)} – {formatTime(booking.end_at, zone)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-zinc-900">{booking.invitee_name}</span>
            <span className="block truncate text-sm text-zinc-600">{booking.event_name}</span>
          </span>
          <span className="flex items-center gap-1.5">
            {booking.rescheduled_at && view !== 'cancelled' && <Badge>Moved</Badge>}
            {booking.sync_error && <Badge tone="amber">Calendar problem</Badge>}
            <ChevronDown className="size-4 text-zinc-400 transition-transform group-open:rotate-180" aria-hidden />
          </span>
        </summary>
        <div className="space-y-4 border-t border-zinc-100 bg-zinc-50/60 px-4 py-4">
          <dl className="space-y-2 text-sm">
            <Detail label="Email">
              <a href={`mailto:${booking.invitee_email}`} className="text-brand hover:underline">
                {booking.invitee_email}
              </a>
            </Detail>
            {booking.invitee_phone && <Detail label="Phone">{booking.invitee_phone}</Detail>}
            <Detail label="Their time zone">{zoneLabel(booking.invitee_timezone, booking.start_at)}</Detail>
            {(booking.meeting_url || booking.location) && (
              <Detail label="Where">
                {booking.meeting_url ? (
                  <a href={booking.meeting_url} className="text-brand hover:underline">
                    {booking.meeting_url}
                  </a>
                ) : (
                  booking.location
                )}
              </Detail>
            )}
            {booking.guests.length > 0 && <Detail label="Guests">{booking.guests.join(', ')}</Detail>}
            {booking.answers.map((answer, index) => (
              <Detail key={index} label={answer.label}>
                {answer.value}
              </Detail>
            ))}
            {booking.notes && <Detail label="Notes">{booking.notes}</Detail>}
            {booking.previous_start_at && (
              <Detail label="Moved from">
                {formatTime(booking.previous_start_at, zone)}, {formatDate(booking.previous_start_at, zone)}
              </Detail>
            )}
            {booking.status === 'cancelled' && (
              <Detail label="Cancelled">
                By {booking.cancelled_by === 'host' ? 'you' : 'the invitee'}
                {booking.cancel_reason ? `: ${booking.cancel_reason}` : ''}
              </Detail>
            )}
            {booking.sync_error && (
              <Detail label="Calendar problem">
                <span className="text-amber-800">{booking.sync_error}</span>
              </Detail>
            )}
            <Detail label="Booked on">{formatDate(booking.created_at, zone)}</Detail>
          </dl>
          {view === 'upcoming' && (
            <div className="flex flex-wrap items-start gap-2">
              {/* Bookings from before links were stored encrypted cannot have theirs shown again. */}
              {manageUrl && (
                <>
                  <a href={`${manageUrl}/reschedule`} target="_blank" className={buttonClass('secondary', 'sm')}>
                    Reschedule
                  </a>
                  <CopyButton text={manageUrl} label="Copy invitee link" />
                </>
              )}
              <HostCancel bookingId={booking.id} invitee={booking.invitee_name} />
            </div>
          )}
        </div>
      </details>
    </li>
  );
}

async function Content({ searchParams }: PageProps<'/admin/bookings'>) {
  const owner = await requireOwner();
  const query = await searchParams;
  const view: View = VIEWS.some(([key]) => key === query.view) ? (query.view as View) : 'upcoming';
  const [bookings, baseUrl] = await Promise.all([listBookings(view), getBaseUrl()]);
  const zone = owner.timezone;

  // Group by calendar day in the owner's zone, keeping the query's order.
  const days: { date: string; items: Booking[] }[] = [];
  for (const booking of bookings) {
    const date = formatDate(booking.start_at, zone);
    const last = days[days.length - 1];
    if (last?.date === date) last.items.push(booking);
    else days.push({ date, items: [booking] });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Bookings" className="inline-flex rounded-lg border border-zinc-200 bg-white p-1">
          {VIEWS.map(([key, label]) => (
            <Link
              key={key}
              href={`/admin/bookings?view=${key}`}
              aria-current={view === key ? 'page' : undefined}
              className={cx(
                'rounded-md px-3 py-1.5 text-sm font-medium',
                view === key ? 'bg-zinc-900 text-white' : 'text-zinc-700 hover:bg-zinc-100',
              )}
            >
              {label}
            </Link>
          ))}
        </nav>
        <p className="text-xs text-zinc-500">Times shown in {zoneLabel(zone)}</p>
      </div>

      {days.length === 0 ? (
        <Card className="p-8 text-center text-sm text-zinc-600">
          {view === 'upcoming'
            ? 'No upcoming bookings. Share one of your links to get started.'
            : view === 'past'
              ? 'No past bookings yet.'
              : 'Nothing has been cancelled.'}
        </Card>
      ) : (
        days.map((day) => (
          <Card key={day.date} className="overflow-hidden">
            <h2 className="border-b border-zinc-200 bg-zinc-50 px-4 py-2 text-sm font-semibold text-zinc-800">
              {day.date}
            </h2>
            <ul className="divide-y divide-zinc-100">
              {day.items.map((booking) => (
                <BookingRow key={booking.id} booking={booking} zone={zone} baseUrl={baseUrl} view={view} />
              ))}
            </ul>
          </Card>
        ))
      )}
    </div>
  );
}
