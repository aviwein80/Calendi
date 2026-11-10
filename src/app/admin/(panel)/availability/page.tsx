import type { Metadata } from 'next';
import { Suspense } from 'react';
import { NewSchedule, ScheduleForm } from '@/components/ScheduleForm';
import { PageHeader, Skeleton } from '@/components/ui';
import { requireOwner } from '@/lib/session';
import { listSchedules } from '@/lib/store';

export const metadata: Metadata = { title: 'Availability' };

export default function AvailabilityPage() {
  return (
    <>
      <PageHeader
        title="Availability"
        description="The hours you are willing to take meetings. Connected calendars then remove the times you are busy."
      />
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <Content />
      </Suspense>
    </>
  );
}

async function Content() {
  const owner = await requireOwner();
  const schedules = await listSchedules();
  return (
    <div className="space-y-5">
      {schedules.map((schedule) => (
        <ScheduleForm
          key={schedule.id}
          schedule={{
            id: schedule.id,
            name: schedule.name,
            timezone: schedule.timezone,
            is_default: schedule.is_default,
            weekly: schedule.weekly,
            overrides: schedule.overrides,
          }}
          defaultTimezone={owner.timezone}
        />
      ))}
      <NewSchedule defaultTimezone={owner.timezone} />
    </div>
  );
}
