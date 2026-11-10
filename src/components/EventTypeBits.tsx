'use client';

import { setEventTypeActiveAction } from '@/app/actions/admin';
import { Toggle } from './client';

export function EventTypeToggle({ id, active, name }: { id: string; active: boolean; name: string }) {
  return (
    <Toggle
      checked={active}
      label={`${name} is open for booking`}
      onChange={(next) => setEventTypeActiveAction(id, next)}
    />
  );
}
