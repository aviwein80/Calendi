import type { Metadata } from 'next';
import { Suspense } from 'react';
import { logoutAction } from '@/app/actions/auth';
import { EmailForm, PasswordForm, ProfileForm, WebhookForm } from '@/components/SettingsForms';
import { Button, PageHeader, Section, Skeleton } from '@/components/ui';
import { MIN_PASSWORD_LENGTH } from '@/lib/constants';
import { requireOwner } from '@/lib/session';
import { readIntegrations } from '@/lib/store';
import { webhookSigningSecret } from '@/lib/webhook';

export const metadata: Metadata = { title: 'Settings' };

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" />
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <Content />
      </Suspense>
    </>
  );
}

async function Content() {
  const owner = await requireOwner();
  const email = readIntegrations(owner).email;
  const emailFromEnv = Boolean(
    process.env.EMAIL_FROM && (process.env.RESEND_API_KEY || process.env.SMTP_HOST),
  );

  return (
    <div className="space-y-5">
      <Section title="Profile" description="How you appear to people booking time with you.">
        <ProfileForm
          owner={{
            name: owner.name,
            email: owner.email,
            timezone: owner.timezone,
            welcome_message: owner.welcome_message,
            avatar_url: owner.avatar_url,
            brand_color: owner.brand_color,
          }}
        />
      </Section>

      <Section
        title="Email notifications"
        description="Optional. When bookings are saved to Google or Outlook, invitees already get a calendar invitation from there. Turn email on to be notified yourself about new, moved and cancelled bookings, and to send confirmations when you use iCloud or calendar links."
      >
        <EmailForm
          fromEnv={emailFromEnv}
          saved={{
            provider: email?.provider ?? 'none',
            from: email?.from ?? '',
            smtpHost: email?.smtpHost ?? '',
            smtpPort: email?.smtpPort ?? 587,
            smtpUser: email?.smtpUser ?? '',
            hasResendKey: Boolean(email?.resendApiKey),
            hasSmtpPass: Boolean(email?.smtpPass),
          }}
        />
      </Section>

      <Section
        title="Webhook"
        description="Optional. Calendi posts the booking details to this address whenever a meeting is booked, moved or cancelled, so tools like Zapier, Slack or Asana can react."
      >
        <WebhookForm url={owner.webhook_url} secret={webhookSigningSecret()} />
      </Section>

      <Section title="Password">
        <PasswordForm minPassword={MIN_PASSWORD_LENGTH} />
      </Section>

      <form action={logoutAction} className="md:hidden">
        <Button type="submit" variant="secondary">
          Sign out
        </Button>
      </form>
    </div>
  );
}
