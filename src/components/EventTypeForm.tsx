'use client';

import { LoaderCircle, Plus, Trash2 } from 'lucide-react';
import { useState, useTransition } from 'react';
import { deleteEventTypeAction, saveEventTypeAction } from '@/app/actions/admin';
import { EVENT_COLORS } from '@/lib/constants';
import type { CalendarProviderId, EventType, LocationType, Question, QuestionType } from '@/lib/types';
import { ActionButton, CopyButton } from './client';
import { Button, cx, Field, Input, LinkButton, Notice, Section, Select, Textarea } from './ui';

// Create or edit an event type. Everything is held in local state and sent to
// the server in one go when "Save" is pressed.

type Draft = Omit<EventType, 'id' | 'created_at' | 'position'>;

const DURATIONS = [15, 20, 30, 45, 60, 90, 120];
const BUFFERS = [0, 5, 10, 15, 30, 45, 60, 90, 120];
const INTERVALS = [5, 10, 15, 20, 30, 45, 60, 90, 120];

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function minutesLabel(minutes: number): string {
  if (minutes === 0) return 'None';
  if (minutes < 60) return `${minutes} min`;
  return minutes % 60 === 0 ? `${minutes / 60} hr` : `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
}

export function EventTypeForm({
  eventType,
  schedules,
  baseUrl,
  bookingTarget,
}: {
  eventType: EventType | null;
  schedules: { id: string; name: string; is_default: boolean }[];
  baseUrl: string;
  /** Which calendar provider new bookings are saved to, if any. */
  bookingTarget: CalendarProviderId | null;
}) {
  const [draft, setDraft] = useState<Draft>(
    eventType ?? {
      slug: '',
      name: '',
      description: '',
      duration_minutes: 30,
      color: EVENT_COLORS[0],
      location_type: 'none',
      location_value: '',
      schedule_id: null,
      slot_interval_minutes: 30,
      buffer_before_minutes: 0,
      buffer_after_minutes: 0,
      min_notice_minutes: 240,
      max_days_ahead: 60,
      daily_limit: null,
      questions: [],
      allow_guests: false,
      is_active: true,
      is_hidden: false,
    },
  );
  const [slugEdited, setSlugEdited] = useState(Boolean(eventType));
  const [noticeUnit, setNoticeUnit] = useState<'hours' | 'days'>(
    draft.min_notice_minutes >= 2880 && draft.min_notice_minutes % 1440 === 0 ? 'days' : 'hours',
  );
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const setQuestion = (index: number, patch: Partial<Question>) =>
    set(
      'questions',
      draft.questions.map((q, i) => (i === index ? { ...q, ...patch } : q)),
    );

  const noticeValue = draft.min_notice_minutes / (noticeUnit === 'days' ? 1440 : 60);
  const url = `${baseUrl}/${draft.slug || '…'}`;
  const embed = `<iframe src="${baseUrl}/${draft.slug}?embed=1" style="width:100%;height:760px;border:0" title="Book a time"></iframe>`;

  const conferenceWarning =
    draft.location_type === 'google_meet' && bookingTarget !== 'google'
      ? 'Google Meet links are created when bookings are saved to a Google calendar. Under Calendars, connect Google and choose one of its calendars for new bookings.'
      : draft.location_type === 'teams' && bookingTarget !== 'microsoft'
        ? 'Teams links are created when bookings are saved to a Microsoft 365 work or school calendar. Under Calendars, connect Microsoft and choose one of its calendars for new bookings.'
        : '';

  function save() {
    setError('');
    startTransition(async () => {
      const result = await saveEventTypeAction(eventType?.id ?? null, draft);
      if (result?.error) setError(result.error);
    });
  }

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <Section title="Basics">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="name" required>
            <Input
              id="name"
              value={draft.name}
              maxLength={100}
              required
              placeholder="30 Minute Meeting"
              onChange={(e) => {
                const name = e.target.value;
                setDraft((d) => ({ ...d, name, slug: slugEdited ? d.slug : slugify(name) }));
              }}
            />
          </Field>
          <Field label="Link" htmlFor="slug" required hint={url.replace(/^https?:\/\//, '')}>
            <Input
              id="slug"
              value={draft.slug}
              maxLength={60}
              required
              placeholder="30min"
              onChange={(e) => {
                setSlugEdited(true);
                set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'));
              }}
            />
          </Field>
          <Field label="Duration" htmlFor="duration">
            <div className="flex gap-2">
              <Select
                id="duration"
                value={DURATIONS.includes(draft.duration_minutes) ? draft.duration_minutes : 'custom'}
                onChange={(e) => {
                  if (e.target.value !== 'custom') set('duration_minutes', Number(e.target.value));
                  else set('duration_minutes', 25);
                }}
              >
                {DURATIONS.map((d) => (
                  <option key={d} value={d}>
                    {minutesLabel(d)}
                  </option>
                ))}
                <option value="custom">Custom…</option>
              </Select>
              {!DURATIONS.includes(draft.duration_minutes) && (
                <Input
                  type="number"
                  aria-label="Custom duration in minutes"
                  min={5}
                  max={720}
                  step={5}
                  className="w-28"
                  value={draft.duration_minutes}
                  onChange={(e) => set('duration_minutes', Number(e.target.value))}
                />
              )}
            </div>
          </Field>
          <Field label="Colour">
            <div className="flex flex-wrap gap-2 pt-1" role="radiogroup" aria-label="Colour">
              {EVENT_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  role="radio"
                  aria-checked={draft.color === color}
                  aria-label={color}
                  onClick={() => set('color', color)}
                  className={cx(
                    'size-7 rounded-full ring-offset-2',
                    draft.color === color && 'ring-2 ring-zinc-900',
                  )}
                  style={{ background: color }}
                />
              ))}
            </div>
          </Field>
          <Field label="Description" htmlFor="description" className="sm:col-span-2" hint="Shown on the booking page.">
            <Textarea
              id="description"
              value={draft.description}
              maxLength={2000}
              onChange={(e) => set('description', e.target.value)}
            />
          </Field>
        </div>
      </Section>

      <Section title="Location" description="Where the meeting happens. Invitees see the details once they have booked.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type" htmlFor="location_type">
            <Select
              id="location_type"
              value={draft.location_type}
              onChange={(e) => setDraft((d) => ({ ...d, location_type: e.target.value as LocationType, location_value: '' }))}
            >
              <option value="none">No location</option>
              <option value="google_meet">Google Meet (new link per booking)</option>
              <option value="teams">Microsoft Teams (new link per booking)</option>
              <option value="link">Video link of your own (Zoom room, etc.)</option>
              <option value="phone">Phone call (you call them)</option>
              <option value="in_person">In person</option>
            </Select>
          </Field>
          {draft.location_type === 'link' && (
            <Field label="Meeting link" htmlFor="location_value" required>
              <Input
                id="location_value"
                type="url"
                required
                placeholder="https://zoom.us/j/1234567890"
                value={draft.location_value}
                onChange={(e) => set('location_value', e.target.value)}
              />
            </Field>
          )}
          {draft.location_type === 'in_person' && (
            <Field label="Address" htmlFor="location_value" required>
              <Input
                id="location_value"
                required
                maxLength={300}
                placeholder="123 Main St, Suite 4"
                value={draft.location_value}
                onChange={(e) => set('location_value', e.target.value)}
              />
            </Field>
          )}
          {draft.location_type === 'phone' && (
            <p className="self-end pb-2 text-sm leading-6 text-zinc-600">
              Invitees will be asked for the phone number to call.
            </p>
          )}
        </div>
        {conferenceWarning && (
          <Notice tone="amber" className="mt-4">
            {conferenceWarning}
          </Notice>
        )}
      </Section>

      <Section title="Scheduling rules">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Available hours" htmlFor="schedule">
            <Select
              id="schedule"
              value={draft.schedule_id ?? ''}
              onChange={(e) => set('schedule_id', e.target.value || null)}
            >
              <option value="">
                Default schedule{schedules.find((s) => s.is_default) ? ` (${schedules.find((s) => s.is_default)!.name})` : ''}
              </option>
              {schedules
                .filter((s) => !s.is_default)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Offer start times every" htmlFor="interval">
            <Select
              id="interval"
              value={draft.slot_interval_minutes}
              onChange={(e) => set('slot_interval_minutes', Number(e.target.value))}
            >
              {[...new Set([...INTERVALS, draft.slot_interval_minutes])]
                .sort((a, b) => a - b)
                .map((m) => (
                  <option key={m} value={m}>
                    {minutesLabel(m)}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Free time before" htmlFor="buffer_before" hint="Kept clear ahead of each meeting.">
            <Select
              id="buffer_before"
              value={draft.buffer_before_minutes}
              onChange={(e) => set('buffer_before_minutes', Number(e.target.value))}
            >
              {BUFFERS.map((m) => (
                <option key={m} value={m}>
                  {minutesLabel(m)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Free time after" htmlFor="buffer_after" hint="Kept clear following each meeting.">
            <Select
              id="buffer_after"
              value={draft.buffer_after_minutes}
              onChange={(e) => set('buffer_after_minutes', Number(e.target.value))}
            >
              {BUFFERS.map((m) => (
                <option key={m} value={m}>
                  {minutesLabel(m)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Minimum notice" htmlFor="notice" hint="How soon before a slot someone can still book it.">
            <div className="flex gap-2">
              <Input
                id="notice"
                type="number"
                min={0}
                max={noticeUnit === 'days' ? 90 : 720}
                className="w-24"
                value={Number.isFinite(noticeValue) ? noticeValue : 0}
                onChange={(e) =>
                  set('min_notice_minutes', Math.max(0, Math.round(Number(e.target.value) * (noticeUnit === 'days' ? 1440 : 60))))
                }
              />
              <Select
                aria-label="Notice unit"
                value={noticeUnit}
                onChange={(e) => {
                  const unit = e.target.value as 'hours' | 'days';
                  setNoticeUnit(unit);
                  set('min_notice_minutes', Math.round(noticeValue) * (unit === 'days' ? 1440 : 60));
                }}
              >
                <option value="hours">hours</option>
                <option value="days">days</option>
              </Select>
            </div>
          </Field>
          <Field label="Bookable up to" htmlFor="window" hint="How far into the future people can book.">
            <div className="flex items-center gap-2">
              <Input
                id="window"
                type="number"
                min={1}
                max={730}
                className="w-24"
                value={draft.max_days_ahead}
                onChange={(e) => set('max_days_ahead', Number(e.target.value))}
              />
              <span className="text-sm text-zinc-600">days ahead</span>
            </div>
          </Field>
          <Field label="Daily limit" htmlFor="limit" hint="Most bookings of this type in one day. Leave empty for no limit.">
            <Input
              id="limit"
              type="number"
              min={1}
              max={100}
              className="w-24"
              value={draft.daily_limit ?? ''}
              onChange={(e) => set('daily_limit', e.target.value ? Number(e.target.value) : null)}
            />
          </Field>
        </div>
      </Section>

      <Section
        title="Booking form"
        description="Name and email are always asked. Add anything else you need to know."
        aside={
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={draft.questions.length >= 15}
            onClick={() =>
              set('questions', [
                ...draft.questions,
                { id: crypto.randomUUID().slice(0, 8), label: '', type: 'text', required: false, options: [] },
              ])
            }
          >
            <Plus className="size-4" aria-hidden />
            Add question
          </Button>
        }
      >
        <div className="space-y-3">
          {draft.questions.map((question, index) => (
            <div key={question.id} className="rounded-lg border border-zinc-200 p-3">
              <div className="flex flex-wrap items-start gap-2">
                <Input
                  aria-label="Question"
                  className="min-w-48 flex-1"
                  placeholder="What would you like to discuss?"
                  value={question.label}
                  maxLength={200}
                  onChange={(e) => setQuestion(index, { label: e.target.value })}
                />
                <Select
                  aria-label="Answer type"
                  className="w-40"
                  value={question.type}
                  onChange={(e) => setQuestion(index, { type: e.target.value as QuestionType })}
                >
                  <option value="text">Short answer</option>
                  <option value="textarea">Long answer</option>
                  <option value="select">Dropdown</option>
                </Select>
                <Button
                  type="button"
                  variant="ghost"
                  size="md"
                  aria-label="Remove question"
                  onClick={() =>
                    set(
                      'questions',
                      draft.questions.filter((_, i) => i !== index),
                    )
                  }
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </div>
              {question.type === 'select' && (
                <Input
                  aria-label="Options"
                  className="mt-2"
                  placeholder="Options, separated by commas"
                  defaultValue={question.options.join(', ')}
                  onChange={(e) =>
                    setQuestion(index, {
                      options: e.target.value
                        .split(',')
                        .map((o) => o.trim())
                        .filter(Boolean),
                    })
                  }
                />
              )}
              <label className="mt-2 flex items-center gap-2 text-sm text-zinc-700">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--brand)]"
                  checked={question.required}
                  onChange={(e) => setQuestion(index, { required: e.target.checked })}
                />
                Required
              </label>
            </div>
          ))}
          <label className="flex items-center gap-2 text-sm text-zinc-700">
            <input
              type="checkbox"
              className="size-4 accent-[var(--brand)]"
              checked={draft.allow_guests}
              onChange={(e) => set('allow_guests', e.target.checked)}
            />
            Let invitees add guests
          </label>
        </div>
      </Section>

      <Section title="Visibility">
        <div className="space-y-3">
          <label className="flex items-start gap-2 text-sm text-zinc-700">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-[var(--brand)]"
              checked={draft.is_active}
              onChange={(e) => set('is_active', e.target.checked)}
            />
            <span>
              <span className="font-medium text-zinc-900">Open for booking</span>
              <span className="block text-zinc-600">Turn off to pause this link without deleting it.</span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm text-zinc-700">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-[var(--brand)]"
              checked={draft.is_hidden}
              onChange={(e) => set('is_hidden', e.target.checked)}
            />
            <span>
              <span className="font-medium text-zinc-900">Secret link</span>
              <span className="block text-zinc-600">
                Leave it off your public page. Only people you send the link to can book.
              </span>
            </span>
          </label>
        </div>
      </Section>

      {eventType && (
        <Section title="Share" description="Send the link, or paste the code into a website to show the booking page there.">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg bg-zinc-100 px-3 py-2 text-sm">{url}</code>
              <CopyButton text={url} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg bg-zinc-100 px-3 py-2 text-sm">{embed}</code>
              <CopyButton text={embed} label="Copy embed code" />
            </div>
          </div>
        </Section>
      )}

      {error && <Notice tone="red">{error}</Notice>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <Button type="submit" disabled={pending}>
            {pending && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
            {eventType ? 'Save changes' : 'Create event type'}
          </Button>
          <LinkButton href="/admin/event-types" variant="ghost">
            Cancel
          </LinkButton>
        </div>
        {eventType && (
          <ActionButton
            variant="danger"
            confirm={`Delete "${eventType.name}"? Its link will stop working. Existing bookings are kept.`}
            action={() => deleteEventTypeAction(eventType.id)}
          >
            <Trash2 className="size-4" aria-hidden />
            Delete
          </ActionButton>
        )}
      </div>
    </form>
  );
}
