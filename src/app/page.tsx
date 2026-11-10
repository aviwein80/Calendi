import { ChevronRight, Clock } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { PublicFrame, PublicSkeleton } from '@/components/PublicFrame';
import { Avatar, brandStyle } from '@/components/ui';
import { formatDuration, LOCATION_LABELS } from '@/lib/format';
import { getOwner, listEventTypes } from '@/lib/store';

// The owner's landing page: who they are and what can be booked.

export default function HomePage() {
  return (
    <PublicFrame>
      <Suspense fallback={<PublicSkeleton />}>
        <Profile />
      </Suspense>
    </PublicFrame>
  );
}

async function Profile() {
  await connection();
  const owner = await getOwner();
  if (!owner) redirect('/admin/setup');
  const eventTypes = (await listEventTypes()).filter((e) => e.is_active && !e.is_hidden);

  return (
    <div className="fade-in mx-auto w-full max-w-xl" style={brandStyle(owner.brand_color)}>
      <div className="flex flex-col items-center text-center">
        <Avatar name={owner.name} url={owner.avatar_url} size={72} />
        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-zinc-900">{owner.name}</h1>
        <p className="mt-2 max-w-md whitespace-pre-line text-sm leading-6 text-zinc-600">
          {owner.welcome_message || 'Pick a meeting type below to find a time that works.'}
        </p>
      </div>

      {eventTypes.length === 0 ? (
        <p className="mt-8 rounded-xl border border-dashed border-zinc-300 bg-white p-6 text-center text-sm text-zinc-600">
          Nothing is open for booking right now.
        </p>
      ) : (
        <ul className="mt-8 space-y-3">
          {eventTypes.map((eventType) => (
            <li key={eventType.id}>
              <Link
                href={`/${eventType.slug}`}
                className="group flex items-center gap-4 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm transition hover:border-brand hover:shadow-md"
              >
                <span
                  className="h-12 w-1.5 shrink-0 rounded-full"
                  style={{ background: eventType.color }}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-base font-semibold text-zinc-900">{eventType.name}</span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-sm text-zinc-600">
                    <Clock className="size-3.5" aria-hidden />
                    {formatDuration(eventType.duration_minutes)}
                    {eventType.location_type !== 'none' && (
                      <span> · {LOCATION_LABELS[eventType.location_type]}</span>
                    )}
                  </span>
                </span>
                <ChevronRight className="size-5 shrink-0 text-zinc-400 group-hover:text-brand" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
