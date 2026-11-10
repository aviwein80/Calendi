import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Booker } from '@/components/Booker';
import { PublicFrame, PublicMessage, PublicSkeleton } from '@/components/PublicFrame';
import { brandStyle } from '@/components/ui';
import { formatDuration } from '@/lib/format';
import { publicEventType, publicOwner } from '@/lib/public';
import { getEventTypeBySlug, getOwner } from '@/lib/store';

// The booking page for one event type: /30min, /intro-call and so on.
// Add ?embed=1 to drop the page background (for use inside an iframe) and
// ?name=…&email=… to fill in the form ahead of time.

export async function generateMetadata({ params }: PageProps<'/[slug]'>): Promise<Metadata> {
  const { slug } = await params;
  const [eventType, owner] = await Promise.all([getEventTypeBySlug(slug), getOwner()]);
  if (!eventType || !owner || !eventType.is_active) return { title: 'Not available' };
  return {
    title: `${eventType.name} with ${owner.name}`,
    description: `Book a ${formatDuration(eventType.duration_minutes)} meeting with ${owner.name}.`,
    robots: eventType.is_hidden ? { index: false } : undefined,
  };
}

// Actions on this page talk to calendar and email services; allow them time.
export const maxDuration = 60;

export default function EventPage(props: PageProps<'/[slug]'>) {
  return (
    <Suspense
      fallback={
        <PublicFrame>
          <PublicSkeleton wide />
        </PublicFrame>
      }
    >
      <BookingContent {...props} />
    </Suspense>
  );
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function BookingContent({ params, searchParams }: PageProps<'/[slug]'>) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const [eventType, owner] = await Promise.all([getEventTypeBySlug(slug), getOwner()]);

  if (!eventType || !owner || !eventType.is_active) {
    return (
      <PublicFrame>
        <PublicMessage title="This page is not available">
          The link may be out of date, or this meeting type is no longer offered.
        </PublicMessage>
      </PublicFrame>
    );
  }

  const booker = (
    <div className="w-full" style={brandStyle(owner.brand_color)}>
      <Booker
        owner={publicOwner(owner)}
        eventType={publicEventType(eventType)}
        hostTimezone={owner.timezone}
        prefill={{ name: first(query.name)?.slice(0, 120), email: first(query.email)?.slice(0, 200) }}
      />
    </div>
  );

  if (first(query.embed)) {
    return <div className="fixed inset-0 overflow-auto bg-white p-2 sm:p-4">{booker}</div>;
  }
  return <PublicFrame>{booker}</PublicFrame>;
}
