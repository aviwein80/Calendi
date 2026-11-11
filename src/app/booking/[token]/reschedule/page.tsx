import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { Booker } from '@/components/Booker';
import { PublicFrame, PublicMessage, PublicSkeleton } from '@/components/PublicFrame';
import { brandStyle } from '@/components/ui';
import { BLOCKED_MESSAGE, findBookingByLink } from '@/lib/manage';
import { hasStarted, publicEventType, publicOwner } from '@/lib/public';
import { getEventType, getOwner } from '@/lib/store';

export const metadata: Metadata = { title: 'Reschedule meeting', robots: { index: false } };

// Actions on this page talk to calendar and email services; allow them time.
export const maxDuration = 60;

export default function ReschedulePage(props: PageProps<'/booking/[token]/reschedule'>) {
  return (
    <PublicFrame>
      <Suspense fallback={<PublicSkeleton wide />}>
        <Content {...props} />
      </Suspense>
    </PublicFrame>
  );
}

async function Content({ params }: PageProps<'/booking/[token]/reschedule'>) {
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
  const eventType = booking.event_type_id ? await getEventType(booking.event_type_id) : null;
  if (!eventType) {
    return (
      <PublicMessage title="This meeting cannot be moved online">
        This meeting type is no longer offered. Please contact {owner.name} directly to change the time.
      </PublicMessage>
    );
  }

  return (
    <div className="w-full" style={brandStyle(owner.brand_color)}>
      <Booker
        owner={publicOwner(owner)}
        eventType={publicEventType(eventType)}
        hostTimezone={owner.timezone}
        reschedule={{ token: booking.token, start: booking.start_at.toISOString() }}
      />
    </div>
  );
}
