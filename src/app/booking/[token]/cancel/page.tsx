import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { CancelForm } from '@/components/CancelForm';
import { PublicFrame, PublicMessage, PublicSkeleton } from '@/components/PublicFrame';
import { brandStyle } from '@/components/ui';
import { formatRange, zoneLabel } from '@/lib/format';
import { BLOCKED_MESSAGE, findBookingByLink } from '@/lib/manage';
import { hasStarted } from '@/lib/public';
import { getOwner } from '@/lib/store';

export const metadata: Metadata = { title: 'Cancel meeting', robots: { index: false } };

// Actions on this page talk to calendar and email services; allow them time.
export const maxDuration = 60;

export default function CancelPage(props: PageProps<'/booking/[token]/cancel'>) {
  return (
    <PublicFrame>
      <Suspense fallback={<PublicSkeleton />}>
        <Content {...props} />
      </Suspense>
    </PublicFrame>
  );
}

async function Content({ params }: PageProps<'/booking/[token]/cancel'>) {
  await connection();
  const { token } = await params;
  const [lookup, owner] = await Promise.all([findBookingByLink(token), getOwner()]);
  if (lookup.status === 'blocked') {
    return <PublicMessage title="Too many attempts">{BLOCKED_MESSAGE}</PublicMessage>;
  }
  if (lookup.status !== 'found' || !owner) {
    return <PublicMessage title="Booking not found">This link may be incomplete or out of date.</PublicMessage>;
  }
  const booking = lookup.booking;
  if (booking.status !== 'confirmed' || hasStarted(booking)) {
    redirect(`/booking/${booking.token}`);
  }

  return (
    <div
      className="fade-in mx-auto w-full max-w-xl rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8"
      style={brandStyle(owner.brand_color)}
    >
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Cancel this meeting?</h1>
      <p className="mt-2 text-sm leading-6 text-zinc-600">
        {booking.event_name} with {owner.name}
        <br />
        {formatRange(booking.start_at, booking.end_at, booking.invitee_timezone)} (
        {zoneLabel(booking.invitee_timezone, booking.start_at)})
      </p>
      <CancelForm token={booking.token} />
    </div>
  );
}
