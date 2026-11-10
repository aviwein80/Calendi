'use client';

import { loginAction, setupAction } from '@/app/actions/auth';
import { ActionForm, FormMessage, SubmitButton } from './client';
import { TimezoneSelect } from './TimezoneSelect';
import { Field, Input } from './ui';

export function LoginForm() {
  return (
    <ActionForm action={loginAction} className="space-y-4">
      <Field label="Email" htmlFor="email">
        <Input id="email" name="email" type="email" required autoComplete="username" autoFocus />
      </Field>
      <Field label="Password" htmlFor="password">
        <Input id="password" name="password" type="password" required autoComplete="current-password" />
      </Field>
      <FormMessage />
      <SubmitButton className="w-full">Sign in</SubmitButton>
    </ActionForm>
  );
}

export function SetupForm({ minPassword }: { minPassword: number }) {
  return (
    <ActionForm action={setupAction} className="space-y-4">
      <Field label="Your name" htmlFor="name" hint="Shown to people booking time with you.">
        <Input id="name" name="name" required maxLength={120} autoComplete="name" autoFocus />
      </Field>
      <Field label="Email" htmlFor="email" hint="Used to sign in, and for booking notifications.">
        <Input id="email" name="email" type="email" required maxLength={200} autoComplete="username" />
      </Field>
      <Field label="Password" htmlFor="password" hint={`At least ${minPassword} characters.`}>
        <Input
          id="password"
          name="password"
          type="password"
          required
          minLength={minPassword}
          autoComplete="new-password"
        />
      </Field>
      <Field label="Your time zone" htmlFor="timezone" hint="Your working hours are set in this zone.">
        <TimezoneSelect id="timezone" name="timezone" />
      </Field>
      <FormMessage />
      <SubmitButton className="w-full">Create my scheduling page</SubmitButton>
    </ActionForm>
  );
}
