'use client';

import { RefreshCw, Unplug } from 'lucide-react';
import { useState } from 'react';
import {
  connectCalDavAction,
  connectIcsAction,
  disconnectAccountAction,
  refreshAccountAction,
  saveOAuthAppAction,
  setBookingTargetAction,
  setCalendarConflictsAction,
} from '@/app/actions/admin';
import { ActionButton, ActionForm, CopyButton, FormMessage, SubmitButton, Toggle } from './client';
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

export function TargetButton({ calendarId, label }: { calendarId: string | null; label: string }) {
  return (
    <ActionButton variant="secondary" size="sm" action={() => setBookingTargetAction(calendarId)}>
      {label}
    </ActionButton>
  );
}

export function AccountActions({ accountId, label }: { accountId: string; label: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ActionButton variant="ghost" size="sm" action={() => refreshAccountAction(accountId)}>
        <RefreshCw className="size-4" aria-hidden />
        Refresh
      </ActionButton>
      <ActionButton
        variant="ghost"
        size="sm"
        confirm={`Disconnect ${label}? Its events will no longer block your booking times.`}
        action={() => disconnectAccountAction(accountId)}
      >
        <Unplug className="size-4" aria-hidden />
        Disconnect
      </ActionButton>
    </div>
  );
}

export function CalDavForm() {
  const [preset, setPreset] = useState('icloud');
  return (
    <ActionForm action={connectCalDavAction} className="space-y-3">
      <Field label="Service" htmlFor="caldav-preset">
        <Select id="caldav-preset" name="preset" value={preset} onChange={(e) => setPreset(e.target.value)}>
          <option value="icloud">Apple iCloud</option>
          <option value="fastmail">Fastmail</option>
          <option value="other">Other CalDAV server</option>
        </Select>
      </Field>
      {preset === 'other' && (
        <Field label="Server address" htmlFor="caldav-url">
          <Input id="caldav-url" name="serverUrl" type="url" required placeholder="https://cloud.example.com/remote.php/dav" />
        </Field>
      )}
      <Field label={preset === 'icloud' ? 'Apple ID email' : 'Username'} htmlFor="caldav-user">
        <Input id="caldav-user" name="username" required autoComplete="off" />
      </Field>
      <Field
        label={preset === 'other' ? 'Password' : 'App-specific password'}
        htmlFor="caldav-pass"
        hint={
          preset === 'icloud'
            ? 'Not your Apple ID password. Create one at account.apple.com → Sign-In and Security → App-Specific Passwords.'
            : preset === 'fastmail'
              ? 'Create one in Fastmail under Settings → Privacy & Security → App passwords (CalDAV access).'
              : undefined
        }
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

export function OAuthAppForm({
  provider,
  redirectUri,
  hasSaved,
}: {
  provider: 'google' | 'microsoft';
  redirectUri: string;
  hasSaved: boolean;
}) {
  return (
    <ActionForm action={saveOAuthAppAction} className="space-y-3">
      <input type="hidden" name="provider" value={provider} />
      <div>
        <p className="mb-1.5 text-sm font-medium text-zinc-800">Redirect address to paste into {provider === 'google' ? 'Google' : 'Microsoft'}</p>
        <div className="flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 break-all rounded-lg bg-zinc-100 px-3 py-2 text-xs">{redirectUri}</code>
          <CopyButton text={redirectUri} label="Copy" />
        </div>
      </div>
      <Field label={provider === 'google' ? 'Client ID' : 'Application (client) ID'} htmlFor={`${provider}-id`}>
        <Input id={`${provider}-id`} name="clientId" required autoComplete="off" placeholder={hasSaved ? 'Saved. Enter again to replace.' : ''} />
      </Field>
      <Field label={provider === 'google' ? 'Client secret' : 'Client secret value'} htmlFor={`${provider}-secret`}>
        <Input id={`${provider}-secret`} name="clientSecret" type="password" required autoComplete="off" />
      </Field>
      {provider === 'microsoft' && (
        <Field
          label="Tenant ID"
          htmlFor="microsoft-tenant"
          hint="Leave empty unless the app registration is limited to a single organisation."
        >
          <Input id="microsoft-tenant" name="tenant" autoComplete="off" />
        </Field>
      )}
      <FormMessage />
      <SubmitButton variant="secondary">Save</SubmitButton>
    </ActionForm>
  );
}
