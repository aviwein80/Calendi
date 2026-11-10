'use client';

import {
  ArrowLeft,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  Globe,
  LoaderCircle,
  MapPin,
  Phone,
  Video,
} from 'lucide-react';
import { DateTime } from 'luxon';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from 'react';
import { bookAction, rescheduleAction, type PublicResult } from '@/app/actions/public';
import { formatDate, formatDuration, formatTime, locationSummary } from '@/lib/format';
import type { LocationType, PublicEventType, PublicOwner } from '@/lib/types';
import { Avatar, Button, cx, Field, Input, Notice, Select, Textarea } from './ui';

// The booking screen: pick a day, pick a time, fill in the form.
// Times come from /api/availability one month at a time and are shown in the
// visitor's own time zone (which they can change).

type Props = {
  owner: PublicOwner;
  eventType: PublicEventType;
  hostTimezone: string;
  /** Present when moving an existing booking instead of making a new one. */
  reschedule?: { token: string; start: string };
  prefill?: { name?: string; email?: string };
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const noopSubscribe = () => () => {};

function browserZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

function browserPrefers12h(): boolean {
  try {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hour12 !== false;
  } catch {
    return true;
  }
}

function LocationIcon({ type }: { type: LocationType }) {
  if (type === 'phone') return <Phone className="size-4 shrink-0" aria-hidden />;
  if (type === 'in_person') return <MapPin className="size-4 shrink-0" aria-hidden />;
  return <Video className="size-4 shrink-0" aria-hidden />;
}

type Loaded = { key: string; byDate: Map<string, string[]>; error: string };

export function Booker({ owner, eventType, hostTimezone, reschedule, prefill }: Props) {
  const router = useRouter();

  // The visitor's zone is only known in the browser. Until then we render the
  // frame without times rather than guess (and then visibly change).
  const detectedZone = useSyncExternalStore(noopSubscribe, browserZone, () => null);
  const ready = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const prefers12h = useSyncExternalStore(noopSubscribe, browserPrefers12h, () => true);
  const [chosenZone, setChosenZone] = useState<string | null>(null);
  const [chosen12h, setChosen12h] = useState<boolean | null>(null);
  const zone = chosenZone ?? detectedZone ?? hostTimezone;
  const hour12 = chosen12h ?? prefers12h;

  const [now] = useState(() => Date.now());
  const thisMonth = DateTime.fromMillis(now, { zone }).toFormat('yyyy-MM');
  const lastMonth = DateTime.fromMillis(now, { zone })
    .plus({ days: eventType.max_days_ahead })
    .toFormat('yyyy-MM');

  const [chosenMonth, setChosenMonth] = useState<string | null>(null);
  const month = chosenMonth && chosenMonth >= thisMonth ? chosenMonth : thisMonth;
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [step, setStep] = useState<'pick' | 'form'>('pick');
  const [reloads, setReloads] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [notice, setNotice] = useState('');
  const navigated = useRef(false);

  const rescheduleToken = reschedule?.token;
  const rescheduleStart = reschedule?.start;
  const requestKey = `${month}|${zone}|${reloads}`;
  const loading = !ready || loaded?.key !== requestKey;

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    const start = DateTime.fromISO(`${month}-01`, { zone });
    const query = new URLSearchParams({
      slug: eventType.slug,
      from: start.toUTC().toISO()!,
      to: start.plus({ months: 1 }).toUTC().toISO()!,
    });
    if (rescheduleToken) query.set('reschedule', rescheduleToken);

    fetch(`/api/availability?${query}`, { signal: controller.signal })
      .then(async (response) => {
        const data = (await response.json()) as { slots?: string[]; message?: string };
        if (!response.ok) throw new Error(data.message || 'Available times could not be loaded.');
        return data.slots ?? [];
      })
      .then((slots) => {
        const byDate = new Map<string, string[]>();
        for (const slot of slots) {
          if (slot === rescheduleStart) continue;
          const date = DateTime.fromISO(slot, { zone }).toISODate()!;
          byDate.set(date, [...(byDate.get(date) ?? []), slot]);
        }
        // Nothing this month and the visitor has not started browsing: move on
        // to the next month rather than show an empty calendar.
        if (byDate.size === 0 && !navigated.current && month < lastMonth) {
          setChosenMonth(start.plus({ months: 1 }).toFormat('yyyy-MM'));
          return;
        }
        setLoaded({ key: requestKey, byDate, error: '' });
      })
      .catch((err: Error) => {
        if (err.name === 'AbortError') return;
        setLoaded({ key: requestKey, byDate: new Map(), error: err.message });
      });
    return () => controller.abort();
  }, [ready, requestKey, month, zone, lastMonth, eventType.slug, rescheduleToken, rescheduleStart]);

  const byDate = loading ? new Map<string, string[]>() : loaded!.byDate;
  const firstAvailable = [...byDate.keys()].sort()[0] ?? null;
  const activeDate = selectedDate && byDate.has(selectedDate) ? selectedDate : firstAvailable;
  const times = activeDate ? (byDate.get(activeDate) ?? []) : [];

  const monthStart = DateTime.fromISO(`${month}-01`, { zone });
  const leadingBlanks = monthStart.weekday % 7;
  const today = DateTime.fromMillis(now, { zone }).toISODate();

  const zones = useMemo(() => {
    if (!ready) return [zone];
    let all: string[] = [];
    try {
      all = Intl.supportedValuesOf('timeZone');
    } catch {
      // Older browsers: offer just the zones we already know about.
    }
    return [...new Set([zone, hostTimezone, 'UTC', ...all])].sort();
  }, [ready, zone, hostTimezone]);

  function changeMonth(delta: number) {
    navigated.current = true;
    setChosenMonth(monthStart.plus({ months: delta }).toFormat('yyyy-MM'));
    setSelectedDate(null);
    setSelectedSlot(null);
  }

  function backToTimes(message: string) {
    setStep('pick');
    setSelectedSlot(null);
    setNotice(message);
    setReloads((n) => n + 1);
  }

  const endOf = (slot: string) =>
    DateTime.fromISO(slot).plus({ minutes: eventType.duration_minutes }).toISO()!;
  const location = locationSummary(eventType.location_type, eventType.location_value);

  return (
    <div className="fade-in mx-auto w-full max-w-[1040px] overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm lg:flex">
      {/* What is being booked */}
      <aside className="border-b border-zinc-200 p-6 lg:w-[300px] lg:shrink-0 lg:border-b-0 lg:border-r">
        {step === 'form' && (
          <button
            type="button"
            onClick={() => setStep('pick')}
            className="mb-5 inline-flex size-9 items-center justify-center rounded-full border border-zinc-200 text-brand hover:bg-zinc-50"
            aria-label="Back to times"
          >
            <ArrowLeft className="size-4" aria-hidden />
          </button>
        )}
        <div className="flex items-center gap-3">
          <Avatar name={owner.name} url={owner.avatar_url} size={40} />
          <p className="text-sm font-medium text-zinc-600">{owner.name}</p>
        </div>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-zinc-900">{eventType.name}</h1>
        {reschedule && (
          <p className="mt-2 text-sm text-zinc-500">
            Currently{' '}
            <span className="line-through">
              {formatTime(reschedule.start, zone, hour12)}, {formatDate(reschedule.start, zone)}
            </span>
          </p>
        )}
        <ul className="mt-4 space-y-2.5 text-sm font-medium text-zinc-600">
          <li className="flex items-center gap-2.5">
            <Clock className="size-4 shrink-0" aria-hidden />
            {formatDuration(eventType.duration_minutes)}
          </li>
          {location && (
            <li className="flex items-start gap-2.5">
              <span className="mt-0.5">
                <LocationIcon type={eventType.location_type} />
              </span>
              <span className="min-w-0 break-words">{location}</span>
            </li>
          )}
          {step === 'form' && selectedSlot && (
            <>
              <li className="flex items-start gap-2.5 text-zinc-900">
                <CalendarDays className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  {formatTime(selectedSlot, zone, hour12)} – {formatTime(endOf(selectedSlot), zone, hour12)},{' '}
                  {formatDate(selectedSlot, zone)}
                </span>
              </li>
              <li className="flex items-center gap-2.5">
                <Globe className="size-4 shrink-0" aria-hidden />
                {zone.replace(/_/g, ' ')}
              </li>
            </>
          )}
        </ul>
        {eventType.description && (
          <p className="mt-5 whitespace-pre-line text-sm leading-6 text-zinc-600">{eventType.description}</p>
        )}
      </aside>

      {step === 'pick' ? (
        <div className="min-w-0 flex-1 p-6">
          <h2 className="text-lg font-semibold text-zinc-900">
            {reschedule ? 'Pick a new date and time' : 'Select a date and time'}
          </h2>
          {notice && (
            <Notice tone="amber" className="mt-4">
              {notice}
            </Notice>
          )}
          <div className="mt-5 gap-8 md:flex">
            {/* Month */}
            <div className="md:w-[340px] md:shrink-0">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-base font-medium text-zinc-900" aria-live="polite">
                  {monthStart.setLocale('en-US').toFormat('LLLL yyyy')}
                </p>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => changeMonth(-1)}
                    disabled={month <= thisMonth}
                    aria-label="Previous month"
                    className="inline-flex size-9 items-center justify-center rounded-full text-brand hover:bg-brand/10 disabled:text-zinc-300 disabled:hover:bg-transparent"
                  >
                    <ChevronLeft className="size-5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => changeMonth(1)}
                    disabled={month >= lastMonth}
                    aria-label="Next month"
                    className="inline-flex size-9 items-center justify-center rounded-full text-brand hover:bg-brand/10 disabled:text-zinc-300 disabled:hover:bg-transparent"
                  >
                    <ChevronRight className="size-5" aria-hidden />
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-7 text-center text-xs font-medium uppercase tracking-wide text-zinc-500">
                {WEEKDAYS.map((day) => (
                  <div key={day} className="py-2">
                    {day}
                  </div>
                ))}
              </div>
              <div className={cx('grid grid-cols-7 gap-y-1', loading && 'opacity-50')}>
                {Array.from({ length: leadingBlanks }, (_, i) => (
                  <div key={`blank-${i}`} />
                ))}
                {Array.from({ length: monthStart.daysInMonth ?? 30 }, (_, i) => {
                  const date = monthStart.plus({ days: i });
                  const key = date.toISODate()!;
                  const open = byDate.has(key);
                  const selected = key === activeDate;
                  return (
                    <div key={key} className="flex justify-center">
                      <button
                        type="button"
                        disabled={!open}
                        aria-pressed={selected}
                        aria-label={`${date.setLocale('en-US').toFormat('cccc, LLLL d')}${open ? '' : ', no times available'}`}
                        onClick={() => {
                          navigated.current = true;
                          setSelectedDate(key);
                          setSelectedSlot(null);
                          setNotice('');
                        }}
                        className={cx(
                          'relative inline-flex size-11 items-center justify-center rounded-full text-sm',
                          selected
                            ? 'bg-brand font-semibold text-brand-fg'
                            : open
                              ? 'bg-brand/10 font-semibold text-brand hover:bg-brand/20'
                              : 'text-zinc-400',
                        )}
                      >
                        {i + 1}
                        {key === today && (
                          <span
                            className={cx(
                              'absolute bottom-1.5 size-1 rounded-full',
                              selected ? 'bg-brand-fg' : 'bg-current',
                            )}
                          />
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>

              <div className="mt-5">
                <label htmlFor="timezone" className="mb-1.5 block text-sm font-medium text-zinc-800">
                  Time zone
                </label>
                <div className="flex items-center gap-2">
                  <Globe className="size-4 shrink-0 text-zinc-500" aria-hidden />
                  <Select
                    id="timezone"
                    value={zone}
                    onChange={(event) => {
                      setChosenZone(event.target.value);
                      setSelectedDate(null);
                      setSelectedSlot(null);
                    }}
                  >
                    {zones.map((name) => (
                      <option key={name} value={name}>
                        {name.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
            </div>

            {/* Times */}
            <div className="mt-6 min-w-0 flex-1 md:mt-0">
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="text-base font-medium text-zinc-900">
                  {activeDate
                    ? DateTime.fromISO(activeDate, { zone }).setLocale('en-US').toFormat('cccc, LLLL d')
                    : ' '}
                </p>
                <div className="inline-flex shrink-0 rounded-lg border border-zinc-200 p-0.5 text-xs font-medium">
                  {[true, false].map((value) => (
                    <button
                      key={String(value)}
                      type="button"
                      onClick={() => setChosen12h(value)}
                      aria-pressed={hour12 === value}
                      className={cx(
                        'rounded-md px-2 py-1',
                        hour12 === value ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:bg-zinc-100',
                      )}
                    >
                      {value ? '12h' : '24h'}
                    </button>
                  ))}
                </div>
              </div>

              {loading ? (
                <div className="flex h-40 items-center justify-center text-zinc-400" role="status">
                  <LoaderCircle className="size-6 animate-spin" aria-hidden />
                  <span className="sr-only">Loading times</span>
                </div>
              ) : loaded?.error ? (
                <div className="space-y-3">
                  <Notice tone="red">{loaded.error}</Notice>
                  <Button variant="secondary" size="sm" onClick={() => setReloads((n) => n + 1)}>
                    Try again
                  </Button>
                </div>
              ) : times.length === 0 ? (
                <div className="rounded-lg border border-dashed border-zinc-300 p-5 text-sm leading-6 text-zinc-600">
                  No times are open in {monthStart.setLocale('en-US').toFormat('LLLL')}.
                  {month < lastMonth && (
                    <button
                      type="button"
                      onClick={() => changeMonth(1)}
                      className="mt-1 block font-medium text-brand hover:underline"
                    >
                      See {monthStart.plus({ months: 1 }).setLocale('en-US').toFormat('LLLL')}
                    </button>
                  )}
                </div>
              ) : (
                <ul className="space-y-2 md:-mr-2 md:max-h-[420px] md:overflow-y-auto md:pr-2" aria-label="Available times">
                  {times.map((slot) =>
                    slot === selectedSlot ? (
                      <li key={slot} className="flex gap-2">
                        <span className="flex h-12 flex-1 items-center justify-center rounded-lg bg-zinc-700 text-sm font-semibold text-white">
                          {formatTime(slot, zone, hour12)}
                        </span>
                        {reschedule ? (
                          <RescheduleButton
                            token={reschedule.token}
                            slot={slot}
                            zone={zone}
                            onDone={(token) => router.push(`/booking/${token}?moved=1`)}
                            onFail={(result) =>
                              result.code === 'slot_taken' ? backToTimes(result.message) : setNotice(result.message)
                            }
                          />
                        ) : (
                          <Button size="lg" className="flex-1" onClick={() => setStep('form')}>
                            Next
                          </Button>
                        )}
                      </li>
                    ) : (
                      <li key={slot}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedSlot(slot);
                            setNotice('');
                          }}
                          className="h-12 w-full rounded-lg border border-brand/40 text-sm font-semibold text-brand hover:border-brand hover:bg-brand/5"
                        >
                          {formatTime(slot, zone, hour12)}
                        </button>
                      </li>
                    ),
                  )}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : (
        <DetailsForm
          eventType={eventType}
          slot={selectedSlot!}
          zone={zone}
          prefill={prefill}
          onBooked={(token) => router.push(`/booking/${token}`)}
          onSlotTaken={backToTimes}
        />
      )}
    </div>
  );
}

function RescheduleButton({
  token,
  slot,
  zone,
  onDone,
  onFail,
}: {
  token: string;
  slot: string;
  zone: string;
  onDone: (token: string) => void;
  onFail: (result: Extract<PublicResult, { ok: false }>) => void;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="lg"
      className="flex-1"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await rescheduleAction({ token, start: slot, timezone: zone });
          if (result.ok) onDone(result.token);
          else onFail(result);
        })
      }
    >
      {pending && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
      Confirm
    </Button>
  );
}

function DetailsForm({
  eventType,
  slot,
  zone,
  prefill,
  onBooked,
  onSlotTaken,
}: {
  eventType: PublicEventType;
  slot: string;
  zone: string;
  prefill?: { name?: string; email?: string };
  onBooked: (token: string) => void;
  onSlotTaken: (message: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState('');
  const [showGuests, setShowGuests] = useState(false);

  function submit(form: HTMLFormElement) {
    const data = new FormData(form);
    const text = (name: string) => String(data.get(name) ?? '');
    const answers: Record<string, string> = {};
    for (const question of eventType.questions) answers[question.id] = text(`q_${question.id}`);
    setError('');
    startTransition(async () => {
      const result = await bookAction({
        slug: eventType.slug,
        start: slot,
        timezone: zone,
        name: text('name'),
        email: text('email'),
        phone: text('phone'),
        notes: text('notes'),
        company: text('company'),
        guests: text('guests')
          .split(/[\s,;]+/)
          .filter(Boolean),
        answers,
      });
      if (result.ok) onBooked(result.token);
      else if (result.code === 'slot_taken') onSlotTaken(result.message);
      else setError(result.message);
    });
  }

  return (
    <form
      className="min-w-0 flex-1 p-6"
      onSubmit={(event) => {
        event.preventDefault();
        submit(event.currentTarget);
      }}
    >
      <h2 className="text-lg font-semibold text-zinc-900">Enter your details</h2>
      <div className="mt-5 max-w-md space-y-4">
        <Field label="Name" htmlFor="name" required>
          <Input id="name" name="name" required maxLength={120} autoComplete="name" defaultValue={prefill?.name} />
        </Field>
        <Field label="Email" htmlFor="email" required>
          <Input
            id="email"
            name="email"
            type="email"
            required
            maxLength={200}
            autoComplete="email"
            defaultValue={prefill?.email}
          />
        </Field>
        {eventType.location_type === 'phone' && (
          <Field label="Phone number" htmlFor="phone" required hint="The number to call for this meeting.">
            <Input id="phone" name="phone" type="tel" required maxLength={40} autoComplete="tel" />
          </Field>
        )}
        {eventType.allow_guests &&
          (showGuests ? (
            <Field label="Guest emails" htmlFor="guests" hint="Separate addresses with commas. Guests get the invitation too.">
              <Input id="guests" name="guests" placeholder="name@example.com, another@example.com" />
            </Field>
          ) : (
            <Button type="button" variant="secondary" size="sm" onClick={() => setShowGuests(true)}>
              Add guests
            </Button>
          ))}
        {eventType.questions.map((question) => (
          <Field key={question.id} label={question.label} htmlFor={`q_${question.id}`} required={question.required}>
            {question.type === 'textarea' ? (
              <Textarea id={`q_${question.id}`} name={`q_${question.id}`} required={question.required} maxLength={2000} />
            ) : question.type === 'select' ? (
              <Select id={`q_${question.id}`} name={`q_${question.id}`} required={question.required} defaultValue="">
                <option value="" disabled={question.required}>
                  Choose…
                </option>
                {question.options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
            ) : (
              <Input id={`q_${question.id}`} name={`q_${question.id}`} required={question.required} maxLength={500} />
            )}
          </Field>
        ))}
        <Field label="Anything that would help us prepare?" htmlFor="notes">
          <Textarea id="notes" name="notes" maxLength={4000} />
        </Field>
        {/* Honeypot: hidden from people, tempting to bots. */}
        <div className="hidden" aria-hidden>
          <label>
            Company
            <input name="company" tabIndex={-1} autoComplete="off" />
          </label>
        </div>
        {error && <Notice tone="red">{error}</Notice>}
        <Button type="submit" size="lg" disabled={pending}>
          {pending && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
          Schedule meeting
        </Button>
      </div>
    </form>
  );
}
