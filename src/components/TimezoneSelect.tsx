'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import { Select } from './ui';

const noopSubscribe = () => () => {};

function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * A time zone picker. With no `defaultValue` it starts on the browser's zone.
 * Uncontrolled by default (submits under `name`); pass `onChange` to listen.
 */
export function TimezoneSelect({
  name,
  id,
  defaultValue,
  onChange,
}: {
  name?: string;
  id?: string;
  defaultValue?: string;
  onChange?: (zone: string) => void;
}) {
  const detected = useSyncExternalStore(noopSubscribe, browserZone, () => '');
  const ready = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const [chosen, setChosen] = useState(defaultValue ?? '');
  const value = chosen || detected || 'UTC';

  const zones = useMemo(() => {
    let all: string[] = [];
    if (ready) {
      try {
        all = Intl.supportedValuesOf('timeZone');
      } catch {
        // Older browsers: only the current value is offered.
      }
    }
    return [...new Set([value, 'UTC', ...all])].sort();
  }, [ready, value]);

  return (
    <Select
      id={id}
      name={name}
      value={value}
      onChange={(event) => {
        setChosen(event.target.value);
        onChange?.(event.target.value);
      }}
    >
      {zones.map((zone) => (
        <option key={zone} value={zone}>
          {zone.replace(/_/g, ' ')}
        </option>
      ))}
    </Select>
  );
}
