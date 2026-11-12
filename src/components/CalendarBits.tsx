'use client';

import { RefreshCw, Trash2 } from 'lucide-react';
import { useState, useTransition } from 'react';
import {
  connectCalDavAction,
  connectICloudAction,
  connectIcsAction,
  disconnectAccountAction,
  refreshAccountAction,
  setBookingTargetAction,
  setCalendarConflictsAction,
  setEventTypeCalendarAction,
} from '@/app/actions/admin';
import { ActionButton, ActionForm, FormMessage, SubmitButton, Toggle } from './client';
import { Field, Input, Select } from './ui';

// Interactive pieces of the Calendars page.

export function ConflictToggle({ calendarId, checked, name }: { calendarId: string; checked: boolean; name: string }) {
  return (
    <Toggle
      checked={checked}
      label={`Check ${name} for conflicts`}
      onChange={(next) => setCalendarConflictsAction(calendarId, next)}
    />
  );
}

/** "Add new bookings here": the default calendar. Only one can be on at a time. */
export function TargetToggle({ calendarId, checked, name }: { calendarId: string; checked: boolean; name: string }) {
  return (
    <Toggle
      checked={checked}
      label={`Add new bookings to ${name}`}
      onChange={(next) => setBookingTargetAction(next ? calendarId : null)}
    />
  );
}

export function AccountActions({ accountId, label }: { accountId: string; label: string }) {
  return (
    <>
      <ActionButton variant="ghost" size="sm" action={() => refreshAccountAction(accountId)}>
        <RefreshCw className="size-4" aria-hidden />
        Refresh
      </ActionButton>
      <ActionButton
        variant="ghost"
        size="sm"
        confirm={`Remove ${label}? Its events will no longer block your booking times.`}
        action={() => disconnectAccountAction(accountId)}
      >
        <Trash2 className="size-4" aria-hidden />
        Remove
      </ActionButton>
    </>
  );
}

/** Which calendar one meeting type's new bookings go to. */
export function EventTypeCalendarSelect({
  eventTypeId,
  name,
  value,
  defaultLabel,
  options,
}: {
  eventTypeId: string;
  name: string;
  value: string | null;
  defaultLabel: string;
  options: { id: string; label: string }[];
}) {
  const [selected, setSelected] = useState(value ?? '');
  const [pending, startTransition] = useTransition();
  return (
    <Select
      aria-label={`Calendar for ${name}`}
      className="w-full sm:w-96"
      value={selected}
      disabled={pending}
      onChange={(event) => {
        const next = event.target.value;
        setSelected(next);
        startTransition(async () => {
          await setEventTypeCalendarAction(eventTypeId, next || null);
        });
      }}
    >
      <option value="">{defaultLabel}</option>
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ))}
    </Select>
  );
}

export function ICloudForm({ email = '' }: { email?: string }) {
  return (
    <ActionForm action={connectICloudAction} className="space-y-3">
      <Field label="Apple ID email" htmlFor="icloud-email">
        <Input
          id="icloud-email"
          name="email"
          type="email"
          required
          autoComplete="off"
          defaultValue={email}
          placeholder="you@icloud.com"
        />
      </Field>
      <Field
        label="App-specific password"
        htmlFor="icloud-password"
        hint={
          <>
            Not your Apple ID password. Sign in at{' '}
            <a href="https://appleid.apple.com/account/manage" target="_blank" rel="noreferrer" className="font-medium text-brand underline">
              appleid.apple.com
            </a>{' '}
            → Sign-In and Security → App-Specific Passwords → +, name it “Calendi”, and paste it here.
          </>
        }
      >
        <Input id="icloud-password" name="password" type="password" required autoComplete="off" placeholder="xxxx-xxxx-xxxx-xxxx" />
      </Field>
      <FormMessage />
      <SubmitButton>Connect iCloud</SubmitButton>
    </ActionForm>
  );
}

/** Fastmail, Nextcloud and other CalDAV servers, where the server address is needed. */
export function CalDavForm() {
  const [preset, setPreset] = useState('fastmail');
  return (
    <ActionForm action={connectCalDavAction} className="space-y-3">
      <Field label="Service" htmlFor="caldav-preset">
        <Select id="caldav-preset" name="preset" value={preset} onChange={(e) => setPreset(e.target.value)}>
          <option value="fastmail">Fastmail</option>
          <option value="other">Other CalDAV server (Nextcloud, …)</option>
        </Select>
      </Field>
      {preset === 'other' && (
        <Field label="Server address" htmlFor="caldav-url">
          <Input id="caldav-url" name="serverUrl" type="url" required placeholder="https://cloud.example.com/remote.php/dav" />
        </Field>
      )}
      <Field label="Username" htmlFor="caldav-user">
        <Input id="caldav-user" name="username" required autoComplete="off" />
      </Field>
      <Field
        label={preset === 'other' ? 'Password' : 'App password'}
        htmlFor="caldav-pass"
        hint={preset === 'fastmail' ? 'Create one in Fastmail under Settings → Privacy & Security → App passwords (CalDAV access).' : undefined}
      >
        <Input id="caldav-pass" name="password" type="password" required autoComplete="off" />
      </Field>
      <FormMessage />
      <SubmitButton variant="secondary">Connect</SubmitButton>
    </ActionForm>
  );
}

export function IcsForm() {
  return (
    <ActionForm action={connectIcsAction} className="space-y-3">
      <Field label="Calendar link" htmlFor="ics-url" hint="A private .ics or webcal:// subscription address.">
        <Input id="ics-url" name="url" required placeholder="https://… or webcal://…" autoComplete="off" />
      </Field>
      <Field label="Name" htmlFor="ics-label" hint="Optional. How it appears in your list.">
        <Input id="ics-label" name="label" maxLength={80} placeholder="Family calendar" />
      </Field>
      <FormMessage />
      <SubmitButton variant="secondary">Add calendar</SubmitButton>
    </ActionForm>
  );
}
