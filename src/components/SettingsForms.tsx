'use client';

import { useState } from 'react';
import {
  addEmailAction,
  changePasswordAction,
  confirmEmailAction,
  removeEmailAction,
  saveEmailAction,
  saveProfileAction,
  saveWebhookAction,
  sendEmailCodeAction,
  setNotificationEmailAction,
  testEmailAction,
  testWebhookAction,
} from '@/app/actions/admin';
import { EVENT_COLORS } from '@/lib/constants';
import { ActionButton, ActionForm, CopyButton, FormMessage, SubmitButton } from './client';
import { TimezoneSelect } from './TimezoneSelect';
import { Badge, cx, Field, Input, Notice, Select, Textarea } from './ui';

export function ProfileForm({
  owner,
}: {
  owner: {
    name: string;
    timezone: string;
    welcome_message: string;
    avatar_url: string;
    brand_color: string;
  };
}) {
  const [color, setColor] = useState(owner.brand_color);
  return (
    <ActionForm action={saveProfileAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="name" hint="Shown on your booking pages.">
          <Input id="name" name="name" required maxLength={120} defaultValue={owner.name} />
        </Field>
        <Field label="Time zone" htmlFor="timezone" hint="Used for your bookings list and notifications.">
          <TimezoneSelect id="timezone" name="timezone" defaultValue={owner.timezone} />
        </Field>
        <Field label="Photo link" htmlFor="avatar_url" hint="Optional. A web address of a square photo.">
          <Input id="avatar_url" name="avatar_url" type="url" maxLength={500} placeholder="https://…" defaultValue={owner.avatar_url} />
        </Field>
        <Field label="Welcome message" htmlFor="welcome_message" className="sm:col-span-2" hint="Shown under your name on your main page.">
          <Textarea id="welcome_message" name="welcome_message" maxLength={1000} defaultValue={owner.welcome_message} />
        </Field>
        <Field label="Accent colour" className="sm:col-span-2">
          <input type="hidden" name="brand_color" value={color} />
          <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Accent colour">
            {EVENT_COLORS.map((swatch) => (
              <button
                key={swatch}
                type="button"
                role="radio"
                aria-checked={color === swatch}
                aria-label={swatch}
                onClick={() => setColor(swatch)}
                className={cx('size-7 rounded-full ring-offset-2', color === swatch && 'ring-2 ring-zinc-900')}
                style={{ background: swatch }}
              />
            ))}
            <input
              type="color"
              aria-label="Custom colour"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-8 w-10 cursor-pointer rounded border border-zinc-300 bg-white p-0.5"
            />
          </div>
        </Field>
      </div>
      <div className="flex items-center gap-3">
        <SubmitButton>Save</SubmitButton>
        <FormMessage />
      </div>
    </ActionForm>
  );
}

export function EmailForm({
  saved,
  fromEnv,
}: {
  saved: {
    provider: 'none' | 'resend' | 'smtp';
    from: string;
    smtpHost: string;
    smtpPort: number;
    smtpUser: string;
    hasResendKey: boolean;
    hasSmtpPass: boolean;
  };
  fromEnv: boolean;
}) {
  const [provider, setProvider] = useState(saved.provider);

  if (fromEnv) {
    return (
      <div className="space-y-3">
        <Notice>Email is set up through environment variables (RESEND_API_KEY or SMTP_HOST, plus EMAIL_FROM).</Notice>
        <ActionButton variant="secondary" action={testEmailAction}>
          Send me a test
        </ActionButton>
      </div>
    );
  }

  return (
    <ActionForm action={saveEmailAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Send with" htmlFor="provider">
          <Select
            id="provider"
            name="provider"
            value={provider}
            onChange={(e) => setProvider(e.target.value as typeof provider)}
          >
            <option value="none">Off</option>
            <option value="resend">Resend (resend.com)</option>
            <option value="smtp">SMTP (any mail server)</option>
          </Select>
        </Field>
        {provider !== 'none' && (
          <Field label="From address" htmlFor="from" hint={provider === 'resend' ? 'Must be on a domain you verified in Resend.' : undefined}>
            <Input id="from" name="from" type="email" required placeholder="meetings@yourdomain.com" defaultValue={saved.from} />
          </Field>
        )}
        {provider === 'resend' && (
          <Field label="Resend API key" htmlFor="resendApiKey" className="sm:col-span-2">
            <Input
              id="resendApiKey"
              name="resendApiKey"
              type="password"
              autoComplete="off"
              placeholder={saved.hasResendKey ? 'Saved. Leave empty to keep it.' : 're_…'}
            />
          </Field>
        )}
        {provider === 'smtp' && (
          <>
            <Field label="Server" htmlFor="smtpHost">
              <Input id="smtpHost" name="smtpHost" required placeholder="smtp.gmail.com" defaultValue={saved.smtpHost} />
            </Field>
            <Field label="Port" htmlFor="smtpPort" hint="587 for most servers, 465 for SSL.">
              <Input id="smtpPort" name="smtpPort" type="number" min={1} max={65535} defaultValue={saved.smtpPort || 587} />
            </Field>
            <Field label="Username" htmlFor="smtpUser">
              <Input id="smtpUser" name="smtpUser" autoComplete="off" defaultValue={saved.smtpUser} />
            </Field>
            <Field label="Password" htmlFor="smtpPass">
              <Input
                id="smtpPass"
                name="smtpPass"
                type="password"
                autoComplete="off"
                placeholder={saved.hasSmtpPass ? 'Saved. Leave empty to keep it.' : ''}
              />
            </Field>
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton>Save</SubmitButton>
        {saved.provider !== 'none' && (
          <ActionButton variant="secondary" action={testEmailAction}>
            Send me a test
          </ActionButton>
        )}
        <FormMessage />
      </div>
    </ActionForm>
  );
}

export function WebhookForm({ url, secret }: { url: string; secret: string }) {
  return (
    <ActionForm action={saveWebhookAction} className="space-y-4">
      <Field
        label="Webhook address"
        htmlFor="webhook_url"
        hint="For Zapier, use a “Webhooks by Zapier → Catch Hook” trigger and paste its address here."
      >
        <Input id="webhook_url" name="webhook_url" type="url" placeholder="https://hooks.zapier.com/hooks/catch/…" defaultValue={url} />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton>Save</SubmitButton>
        {url && (
          <ActionButton variant="secondary" action={testWebhookAction}>
            Send a test
          </ActionButton>
        )}
        <FormMessage />
      </div>
      <details>
        <summary className="text-sm font-medium text-brand">Verifying requests (optional)</summary>
        <div className="mt-3 space-y-2 text-sm leading-6 text-zinc-600">
          <p>
            Each request carries an <code className="rounded bg-zinc-100 px-1">X-Calendi-Signature</code> header:
            “sha256=” followed by the HMAC-SHA256 of the request body, using this secret.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-lg bg-zinc-100 px-3 py-2 text-xs">{secret}</code>
            <CopyButton text={secret} label="Copy" />
          </div>
        </div>
      </details>
    </ActionForm>
  );
}

export function PasswordForm({ minPassword }: { minPassword: number }) {
  return (
    <ActionForm action={changePasswordAction} className="space-y-4" clearOnSuccess>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Current password" htmlFor="current">
          <Input id="current" name="current" type="password" required autoComplete="current-password" />
        </Field>
        <Field label="New password" htmlFor="next" hint={`At least ${minPassword} characters.`}>
          <Input id="next" name="next" type="password" required minLength={minPassword} autoComplete="new-password" />
        </Field>
      </div>
      <div className="flex items-center gap-3">
        <SubmitButton variant="secondary">Change password</SubmitButton>
        <FormMessage />
      </div>
    </ActionForm>
  );
}

export type AddressRow = { id: string; email: string; verified: boolean; codeSent: boolean; notifications: boolean };

/** The owner's email addresses: sign-in, confirmation and the notifications address. */
export function EmailAddresses({ addresses, canSend }: { addresses: AddressRow[]; canSend: boolean }) {
  return (
    <div className="space-y-4">
      {!canSend && (
        <Notice tone="amber">
          Email sending is not set up, so a new address cannot be confirmed yet and cannot be used to sign in. Set
          it up under Email notifications below, then press “Send code”.
        </Notice>
      )}
      <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200">
        {addresses.map((address) => (
          <li key={address.id} className="space-y-2 px-4 py-3" data-address={address.email}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="truncate text-sm font-medium text-zinc-900">{address.email}</span>
                {address.verified ? <Badge tone="green">Confirmed</Badge> : <Badge tone="amber">Unverified</Badge>}
                {address.notifications && <Badge tone="brand">Notifications</Badge>}
              </div>
              <div className="flex flex-wrap items-center gap-1">
                {address.verified && !address.notifications && (
                  <ActionButton variant="ghost" size="sm" action={() => setNotificationEmailAction(address.id)}>
                    Use for notifications
                  </ActionButton>
                )}
                {!address.verified && (
                  <ActionButton variant="ghost" size="sm" disabled={!canSend} action={() => sendEmailCodeAction(address.id)}>
                    {address.codeSent ? 'Send a new code' : 'Send code'}
                  </ActionButton>
                )}
                {!address.notifications && (
                  <ActionButton
                    variant="ghost"
                    size="sm"
                    confirm={`Remove ${address.email}? It will no longer work for signing in.`}
                    action={() => removeEmailAction(address.id)}
                  >
                    Remove
                  </ActionButton>
                )}
              </div>
            </div>
            {!address.verified && address.codeSent && (
              <ActionForm action={confirmEmailAction} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="id" value={address.id} />
                <Input
                  name="code"
                  aria-label={`Code sent to ${address.email}`}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={9}
                  required
                  placeholder="6-digit code"
                  className="w-36"
                />
                <SubmitButton size="sm" variant="secondary">
                  Confirm
                </SubmitButton>
                <FormMessage />
              </ActionForm>
            )}
          </li>
        ))}
      </ul>
      <ActionForm action={addEmailAction} className="flex flex-wrap items-start gap-2" clearOnSuccess>
        <Input
          name="email"
          type="email"
          aria-label="Add an email address"
          required
          maxLength={200}
          placeholder="another@address.com"
          className="w-full sm:w-72"
        />
        <SubmitButton variant="secondary">Add address</SubmitButton>
        <div className="basis-full">
          <FormMessage />
        </div>
      </ActionForm>
    </div>
  );
}
