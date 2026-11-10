import type { Metadata } from 'next';
import { Suspense } from 'react';
import { EventTypeForm } from '@/components/EventTypeForm';
import { Notice, PageHeader, Skeleton } from '@/components/ui';
import { bookingTargetProvider } from '@/lib/calendars';
import { getBaseUrl } from '@/lib/env';
import { requireOwner } from '@/lib/session';
import { getEventType, listSchedules } from '@/lib/store';

export const metadata: Metadata = { title: 'Event type' };

// /admin/event-types/new creates one; /admin/event-types/<id> edits one.

export default function EventTypePage(props: PageProps<'/admin/event-types/[id]'>) {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Content {...props} />
    </Suspense>
  );
}

async function Content({ params }: PageProps<'/admin/event-types/[id]'>) {
  await requireOwner();
  const { id } = await params;
  const isNew = id === 'new';
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  const [eventType, schedules, baseUrl, bookingTarget] = await Promise.all([
    isNew || !uuid ? null : getEventType(id),
    listSchedules(),
    getBaseUrl(),
    bookingTargetProvider(),
  ]);

  if (!isNew && !eventType) {
    return (
      <>
        <PageHeader title="Event type" />
        <Notice tone="amber">This event type no longer exists.</Notice>
      </>
    );
  }

  return (
    <>
      <PageHeader title={eventType ? eventType.name : 'New event type'} />
      <EventTypeForm
        eventType={eventType}
        schedules={schedules.map((s) => ({ id: s.id, name: s.name, is_default: s.is_default }))}
        baseUrl={baseUrl}
        bookingTarget={bookingTarget}
      />
    </>
  );
}
