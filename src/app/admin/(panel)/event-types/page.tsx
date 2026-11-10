import { Clock, ExternalLink, Pencil, Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { EventTypeToggle } from '@/components/EventTypeBits';
import { CopyButton } from '@/components/client';
import { Badge, Card, LinkButton, Notice, PageHeader, Skeleton } from '@/components/ui';
import { getBaseUrl } from '@/lib/env';
import { formatDuration, LOCATION_LABELS } from '@/lib/format';
import { requireOwner } from '@/lib/session';
import { listCalendarAccounts, listEventTypes } from '@/lib/store';

export const metadata: Metadata = { title: 'Event types' };

export default function EventTypesPage(props: PageProps<'/admin/event-types'>) {
  return (
    <>
      <PageHeader
        title="Event types"
        description="Each event type is a kind of meeting people can book, with its own link."
        action={
          <LinkButton href="/admin/event-types/new">
            <Plus className="size-4" aria-hidden />
            New event type
          </LinkButton>
        }
      />
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <Content {...props} />
      </Suspense>
    </>
  );
}

async function Content({ searchParams }: PageProps<'/admin/event-types'>) {
  await requireOwner();
  const [query, eventTypes, accounts, baseUrl] = await Promise.all([
    searchParams,
    listEventTypes(),
    listCalendarAccounts(),
    getBaseUrl(),
  ]);
  const broken = accounts.filter((a) => a.status === 'error');

  return (
    <div className="space-y-4">
      {query.welcome && (
        <Notice tone="green">
          You are set up. Your booking page is live at{' '}
          <a href={baseUrl} className="font-medium underline">
            {baseUrl.replace(/^https?:\/\//, '')}
          </a>
          . Next, <Link href="/admin/calendars" className="font-medium underline">connect a calendar</Link> so
          your busy times are blocked automatically.
        </Notice>
      )}
      {broken.length > 0 && (
        <Notice tone="red">
          {broken.length === 1 ? 'A calendar has' : 'Some calendars have'} stopped syncing, so your booking pages
          are paused. <Link href="/admin/calendars" className="font-medium underline">Fix it under Calendars</Link>.
        </Notice>
      )}
      {accounts.length === 0 && !query.welcome && (
        <Notice tone="amber">
          No calendar is connected, so times are offered from your working hours alone.{' '}
          <Link href="/admin/calendars" className="font-medium underline">Connect a calendar</Link> to block
          the times you are busy.
        </Notice>
      )}

      <Card className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Your booking page</p>
          <a href={baseUrl} target="_blank" className="block truncate text-sm font-medium text-brand hover:underline">
            {baseUrl.replace(/^https?:\/\//, '')}
          </a>
        </div>
        <CopyButton text={baseUrl} />
      </Card>

      {eventTypes.length === 0 && (
        <Card className="p-8 text-center text-sm text-zinc-600">
          You have no event types yet. Create one to get a booking link.
        </Card>
      )}

      <ul className="grid gap-4 sm:grid-cols-2">
        {eventTypes.map((eventType) => {
          const url = `${baseUrl}/${eventType.slug}`;
          return (
            <li key={eventType.id}>
              <Card className="flex h-full flex-col overflow-hidden">
                <div className="h-1.5" style={{ background: eventType.color }} aria-hidden />
                <div className="flex flex-1 flex-col p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate text-base font-semibold text-zinc-900">{eventType.name}</h2>
                      <p className="mt-1 flex items-center gap-1.5 text-sm text-zinc-600">
                        <Clock className="size-3.5" aria-hidden />
                        {formatDuration(eventType.duration_minutes)}
                        {eventType.location_type !== 'none' && ` · ${LOCATION_LABELS[eventType.location_type]}`}
                      </p>
                    </div>
                    <EventTypeToggle id={eventType.id} active={eventType.is_active} name={eventType.name} />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {!eventType.is_active && <Badge>Off</Badge>}
                    {eventType.is_hidden && <Badge tone="amber">Secret link</Badge>}
                  </div>
                  <a
                    href={url}
                    target="_blank"
                    className="mt-3 inline-flex items-center gap-1 truncate text-sm text-brand hover:underline"
                  >
                    /{eventType.slug}
                    <ExternalLink className="size-3.5 shrink-0" aria-hidden />
                  </a>
                  <div className="mt-auto flex flex-wrap gap-2 pt-4">
                    <CopyButton text={url} />
                    <LinkButton href={`/admin/event-types/${eventType.id}`} variant="secondary" size="sm">
                      <Pencil className="size-4" aria-hidden />
                      Edit
                    </LinkButton>
                  </div>
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
