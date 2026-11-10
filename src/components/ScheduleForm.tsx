'use client';

import { LoaderCircle, Plus, Trash2, X } from 'lucide-react';
import { useState, useTransition } from 'react';
import {
  deleteScheduleAction,
  saveScheduleAction,
  setDefaultScheduleAction,
} from '@/app/actions/admin';
import type { DateOverrides, TimeRange, WeeklyHours } from '@/lib/types';
import { ActionButton } from './client';
import { TimezoneSelect } from './TimezoneSelect';
import { Badge, Button, Card, cx, Field, Input, Notice, Select } from './ui';

// Edits one availability schedule: the weekly hours, plus one-off dates that
// differ (a day off, or special hours).

const DAYS: [key: string, label: string][] = [
  ['7', 'Sunday'],
  ['1', 'Monday'],
  ['2', 'Tuesday'],
  ['3', 'Wednesday'],
  ['4', 'Thursday'],
  ['5', 'Friday'],
  ['6', 'Saturday'],
];

const TIMES: string[] = [];
for (let minutes = 0; minutes <= 1440; minutes += 15) {
  TIMES.push(`${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`);
}

function timeLabel(value: string): string {
  if (value === '24:00') return '12:00 am (midnight)';
  const [h, m] = value.split(':').map(Number);
  const suffix = h < 12 ? 'am' : 'pm';
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${suffix}`;
}

function nextRange(ranges: TimeRange[]): TimeRange {
  const last = ranges[ranges.length - 1];
  if (!last) return { start: '09:00', end: '17:00' };
  const [h, m] = last.end.split(':').map(Number);
  const start = Math.min(h * 60 + m + 60, 1380);
  const end = Math.min(start + 60, 1440);
  const fmt = (t: number) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  return { start: fmt(start), end: fmt(end) };
}

function RangeRows({
  ranges,
  onChange,
  label,
}: {
  ranges: TimeRange[];
  onChange: (ranges: TimeRange[]) => void;
  label: string;
}) {
  return (
    <div className="space-y-2">
      {ranges.map((range, index) => (
        <div key={index} className="flex items-center gap-2">
          <Select
            aria-label={`${label} start`}
            className="w-32"
            value={range.start}
            onChange={(e) => onChange(ranges.map((r, i) => (i === index ? { ...r, start: e.target.value } : r)))}
          >
            {TIMES.slice(0, -1).map((time) => (
              <option key={time} value={time}>
                {timeLabel(time)}
              </option>
            ))}
          </Select>
          <span className="text-zinc-400">–</span>
          <Select
            aria-label={`${label} end`}
            className="w-32"
            value={range.end}
            onChange={(e) => onChange(ranges.map((r, i) => (i === index ? { ...r, end: e.target.value } : r)))}
          >
            {TIMES.slice(1).map((time) => (
              <option key={time} value={time}>
                {timeLabel(time)}
              </option>
            ))}
          </Select>
          <button
            type="button"
            aria-label={`Remove ${label} hours`}
            onClick={() => onChange(ranges.filter((_, i) => i !== index))}
            className="inline-flex size-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}

export function ScheduleForm({
  schedule,
  defaultTimezone,
  onDone,
}: {
  schedule: {
    id: string;
    name: string;
    timezone: string;
    is_default: boolean;
    weekly: WeeklyHours;
    overrides: DateOverrides;
  } | null;
  defaultTimezone: string;
  onDone?: () => void;
}) {
  const [name, setName] = useState(schedule?.name ?? '');
  const [timezone, setTimezone] = useState(schedule?.timezone ?? defaultTimezone);
  const [weekly, setWeekly] = useState<WeeklyHours>(
    schedule?.weekly ?? Object.fromEntries(['1', '2', '3', '4', '5'].map((d) => [d, [{ start: '09:00', end: '17:00' }]])),
  );
  const [overrides, setOverrides] = useState<DateOverrides>(schedule?.overrides ?? {});
  const [newDate, setNewDate] = useState('');
  const [message, setMessage] = useState<{ error?: string; ok?: string }>({});
  const [pending, startTransition] = useTransition();

  const setDay = (day: string, ranges: TimeRange[]) => setWeekly((w) => ({ ...w, [day]: ranges }));
  const dates = Object.keys(overrides).sort();

  function save() {
    setMessage({});
    startTransition(async () => {
      const result = await saveScheduleAction(schedule?.id ?? null, { name, timezone, weekly, overrides });
      setMessage(result);
      if (result.ok) onDone?.();
    });
  }

  return (
    <Card className="p-5 sm:p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Schedule name" htmlFor={`name-${schedule?.id ?? 'new'}`}>
          <Input
            id={`name-${schedule?.id ?? 'new'}`}
            value={name}
            maxLength={80}
            placeholder="Working hours"
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Time zone" htmlFor={`tz-${schedule?.id ?? 'new'}`} hint="The hours below are in this zone.">
          <TimezoneSelect id={`tz-${schedule?.id ?? 'new'}`} defaultValue={timezone} onChange={setTimezone} />
        </Field>
      </div>

      <h3 className="mb-2 mt-6 text-sm font-semibold text-zinc-900">Weekly hours</h3>
      <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200">
        {DAYS.map(([day, label]) => {
          const ranges = weekly[day] ?? [];
          const on = ranges.length > 0;
          return (
            <li key={day} className="flex flex-wrap items-start gap-x-4 gap-y-2 px-3 py-3">
              <label className="flex w-32 shrink-0 items-center gap-2 pt-1.5 text-sm font-medium text-zinc-800">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--brand)]"
                  checked={on}
                  onChange={(e) => setDay(day, e.target.checked ? [{ start: '09:00', end: '17:00' }] : [])}
                />
                {label}
              </label>
              <div className="min-w-0 flex-1">
                {on ? (
                  <RangeRows ranges={ranges} label={label} onChange={(next) => setDay(day, next)} />
                ) : (
                  <p className="pt-1.5 text-sm text-zinc-500">Unavailable</p>
                )}
              </div>
              {on && (
                <button
                  type="button"
                  aria-label={`Add more hours on ${label}`}
                  onClick={() => setDay(day, [...ranges, nextRange(ranges)])}
                  className="inline-flex size-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100"
                >
                  <Plus className="size-4" aria-hidden />
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <h3 className="mb-1 mt-6 text-sm font-semibold text-zinc-900">Specific dates</h3>
      <p className="mb-3 text-sm text-zinc-600">
        Days that differ from your weekly hours: time off, or special hours for one date.
      </p>
      {dates.length > 0 && (
        <ul className="mb-3 divide-y divide-zinc-100 rounded-lg border border-zinc-200">
          {dates.map((date) => {
            const ranges = overrides[date];
            const pretty = new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
              year: 'numeric',
              timeZone: 'UTC',
            });
            return (
              <li key={date} className="flex flex-wrap items-start gap-x-4 gap-y-2 px-3 py-3">
                <p className="w-40 shrink-0 pt-1.5 text-sm font-medium text-zinc-800">{pretty}</p>
                <div className="min-w-0 flex-1">
                  {ranges.length > 0 ? (
                    <RangeRows
                      ranges={ranges}
                      label={pretty}
                      onChange={(next) => setOverrides((o) => ({ ...o, [date]: next }))}
                    />
                  ) : (
                    <p className="pt-1.5 text-sm text-zinc-500">Unavailable all day</p>
                  )}
                </div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    aria-label={`Add hours on ${pretty}`}
                    onClick={() => setOverrides((o) => ({ ...o, [date]: [...ranges, nextRange(ranges)] }))}
                    className="inline-flex size-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100"
                  >
                    <Plus className="size-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${pretty}`}
                    onClick={() =>
                      setOverrides((o) => Object.fromEntries(Object.entries(o).filter(([key]) => key !== date)))
                    }
                    className="inline-flex size-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100"
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="date"
          aria-label="Date"
          className="w-44"
          value={newDate}
          onChange={(e) => setNewDate(e.target.value)}
        />
        <Button
          type="button"
          variant="secondary"
          size="md"
          disabled={!newDate || newDate in overrides}
          onClick={() => {
            setOverrides((o) => ({ ...o, [newDate]: [] }));
            setNewDate('');
          }}
        >
          Add date
        </Button>
        <span className="text-xs text-zinc-500">Added dates start as unavailable; use + to give them hours.</span>
      </div>

      {message.error && (
        <Notice tone="red" className="mt-5">
          {message.error}
        </Notice>
      )}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 pt-4">
        <div className="flex items-center gap-3">
          <Button type="button" disabled={pending || !name.trim()} onClick={save}>
            {pending && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
            {schedule ? 'Save' : 'Create schedule'}
          </Button>
          {message.ok && <span className={cx('text-sm text-emerald-700')}>{message.ok}</span>}
          {schedule?.is_default && <Badge tone="brand">Default</Badge>}
        </div>
        {schedule && !schedule.is_default && (
          <div className="flex gap-2">
            <ActionButton variant="secondary" size="sm" action={() => setDefaultScheduleAction(schedule.id)}>
              Make default
            </ActionButton>
            <ActionButton
              variant="danger"
              size="sm"
              confirm={`Delete "${schedule.name}"? Event types using it will switch to the default schedule.`}
              action={() => deleteScheduleAction(schedule.id)}
            >
              Delete
            </ActionButton>
          </div>
        )}
      </div>
    </Card>
  );
}

/** "New schedule" button that reveals an empty form. */
export function NewSchedule({ defaultTimezone }: { defaultTimezone: string }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden />
        New schedule
      </Button>
    );
  }
  return <ScheduleForm schedule={null} defaultTimezone={defaultTimezone} onDone={() => setOpen(false)} />;
}
