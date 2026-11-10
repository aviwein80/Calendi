import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense, type ReactNode } from 'react';
import {
  AccountActions,
  CalDavForm,
  ConflictToggle,
  IcsForm,
  OAuthAppForm,
  TargetButton,
} from '@/components/CalendarBits';
import { Badge, buttonClass, Card, Notice, PageHeader, Section, Skeleton } from '@/components/ui';
import { oauthClient, PROVIDER_NAMES } from '@/lib/calendars';
import { getBaseUrl } from '@/lib/env';
import { requireOwner } from '@/lib/session';
import { getIntegrations, listCalendarAccounts, listCalendars } from '@/lib/store';

export const metadata: Metadata = { title: 'Calendars' };

// Actions on this page talk to calendar and email services; allow them time.
export const maxDuration = 60;

export default function CalendarsPage(props: PageProps<'/admin/calendars'>) {
  return (
    <>
      <PageHeader
        title="Calendars"
        description="Connect every calendar you live by. Events on them block your booking times, and new bookings are added to the one you choose."
      />
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <Content {...props} />
      </Suspense>
    </>
  );
}

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

function Steps({ children }: { children: ReactNode }) {
  return <ol className="list-decimal space-y-1.5 pl-5 text-sm leading-6 text-zinc-700">{children}</ol>;
}

async function Content({ searchParams }: PageProps<'/admin/calendars'>) {
  await requireOwner();
  const [query, accounts, calendars, baseUrl, googleClient, microsoftClient, integrations] = await Promise.all([
    searchParams,
    listCalendarAccounts(),
    listCalendars(),
    getBaseUrl(),
    oauthClient('google'),
    oauthClient('microsoft'),
    getIntegrations(),
  ]);
  const target = calendars.find((c) => c.is_booking_target);
  const googleFromEnv = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  const microsoftFromEnv = Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET);

  return (
    <div className="space-y-5">
      {first(query.connected) && <Notice tone="green">Calendar connected.</Notice>}
      {first(query.error) && <Notice tone="red">{first(query.error)}</Notice>}

      <Section
        title="Connected calendars"
        description="Switch on “Check for conflicts” for calendars whose events should make you unavailable."
      >
        {accounts.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-300 p-5 text-sm leading-6 text-zinc-600">
            Nothing connected yet. Until you add a calendar, people can book any time inside your working
            hours.
          </p>
        ) : (
          <div className="space-y-4">
            {accounts.map((account) => {
              const own = calendars.filter((c) => c.account_id === account.id);
              const reconnect =
                account.provider === 'google' || account.provider === 'microsoft'
                  ? `/api/oauth/${account.provider}/start`
                  : null;
              return (
                <div key={account.id} className="rounded-lg border border-zinc-200">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 bg-zinc-50 px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                        {PROVIDER_NAMES[account.provider]}
                      </p>
                      <p className="truncate text-sm font-semibold text-zinc-900">{account.label}</p>
                    </div>
                    <AccountActions accountId={account.id} label={account.label} />
                  </div>
                  {account.status === 'error' && (
                    <div className="border-b border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-800" role="alert">
                      <p className="font-medium">This calendar is not syncing, so your booking pages are paused.</p>
                      <p>{account.last_error}</p>
                      {reconnect ? (
                        <a href={reconnect} className="mt-1 inline-block font-medium underline">
                          Reconnect
                        </a>
                      ) : (
                        <p className="mt-1">Press Refresh to try again, or disconnect it and add it back.</p>
                      )}
                    </div>
                  )}
                  <ul className="divide-y divide-zinc-100">
                    {own.map((calendar) => (
                      <li key={calendar.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span
                            className="size-2.5 shrink-0 rounded-full bg-zinc-300"
                            style={calendar.color ? { background: calendar.color } : undefined}
                            aria-hidden
                          />
                          <span className="truncate text-sm text-zinc-900">{calendar.name}</span>
                          {calendar.is_booking_target && <Badge tone="brand">Bookings saved here</Badge>}
                        </div>
                        <div className="flex items-center gap-3">
                          {calendar.can_write && !calendar.is_booking_target && (
                            <TargetButton calendarId={calendar.id} label="Save bookings here" />
                          )}
                          <label className="flex items-center gap-2 text-sm text-zinc-600">
                            Check for conflicts
                            <ConflictToggle calendarId={calendar.id} checked={calendar.check_conflicts} name={calendar.name} />
                          </label>
                        </div>
                      </li>
                    ))}
                    {own.length === 0 && <li className="px-4 py-3 text-sm text-zinc-500">No calendars found in this account.</li>}
                  </ul>
                </div>
              );
            })}
            {target ? (
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-zinc-600">
                <span>
                  New bookings are added to <span className="font-medium text-zinc-900">{target.name}</span>.
                </span>
                <TargetButton calendarId={null} label="Stop adding bookings to a calendar" />
              </div>
            ) : (
              <Notice tone="amber">
                New bookings are not being added to any calendar. Press “Save bookings here” on a calendar
                above, or rely on email notifications (set up under{' '}
                <Link href="/admin/settings" className="font-medium underline">
                  Settings
                </Link>
                ). Calendar feeds added by link are read-only and cannot receive bookings.
              </Notice>
            )}
          </div>
        )}
      </Section>

      <Section title="Add a calendar" description="You can connect as many as you like, from any mix of services.">
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="p-4 shadow-none">
            <h3 className="text-sm font-semibold text-zinc-900">Google Calendar</h3>
            <p className="mt-1 text-sm leading-6 text-zinc-600">
              Reads busy times, adds bookings, sends the invitation and can create Google Meet links.
            </p>
            {googleClient ? (
              // Leaves the app for the provider's sign-in, so a plain link is right.
              // eslint-disable-next-line @next/next/no-html-link-for-pages
              <a href="/api/oauth/google/start" className={buttonClass('primary', 'md', 'mt-3')}>
                Connect Google
              </a>
            ) : (
              <p className="mt-3 text-sm font-medium text-amber-800">One-time setup needed first.</p>
            )}
            <details className="mt-3" open={!googleClient}>
              <summary className="text-sm font-medium text-brand">
                {googleClient ? 'Setup details' : 'How to set it up (about 5 minutes)'}
              </summary>
              <div className="mt-3 space-y-3">
                <Steps>
                  <li>
                    Open <span className="font-medium">console.cloud.google.com</span> and create a project.
                  </li>
                  <li>
                    Under APIs &amp; Services → Library, enable the <span className="font-medium">Google Calendar API</span>.
                  </li>
                  <li>
                    Under Google Auth Platform (OAuth consent screen), choose <span className="font-medium">Internal</span>{' '}
                    if you use Google Workspace. Otherwise choose External and then publish the app (“In
                    production”), or Google will sign you out every 7 days.
                  </li>
                  <li>
                    Under Clients, create an OAuth client of type <span className="font-medium">Web application</span>{' '}
                    and add the redirect address below.
                  </li>
                  <li>Paste the client ID and secret here.</li>
                </Steps>
                {googleFromEnv ? (
                  <Notice>Set through the GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.</Notice>
                ) : (
                  <OAuthAppForm
                    provider="google"
                    redirectUri={`${baseUrl}/api/oauth/google/callback`}
                    hasSaved={Boolean(integrations.google)}
                  />
                )}
              </div>
            </details>
          </Card>

          <Card className="p-4 shadow-none">
            <h3 className="text-sm font-semibold text-zinc-900">Outlook / Microsoft 365</h3>
            <p className="mt-1 text-sm leading-6 text-zinc-600">
              Reads busy times, adds bookings, sends the invitation and can create Teams links (work or school
              accounts).
            </p>
            {microsoftClient ? (
              // Leaves the app for the provider's sign-in, so a plain link is right.
              // eslint-disable-next-line @next/next/no-html-link-for-pages
              <a href="/api/oauth/microsoft/start" className={buttonClass('primary', 'md', 'mt-3')}>
                Connect Microsoft
              </a>
            ) : (
              <p className="mt-3 text-sm font-medium text-amber-800">One-time setup needed first.</p>
            )}
            <details className="mt-3" open={!microsoftClient}>
              <summary className="text-sm font-medium text-brand">
                {microsoftClient ? 'Setup details' : 'How to set it up (about 5 minutes)'}
              </summary>
              <div className="mt-3 space-y-3">
                <Steps>
                  <li>
                    Open <span className="font-medium">entra.microsoft.com</span> → App registrations → New
                    registration.
                  </li>
                  <li>
                    For supported account types pick “Accounts in any organizational directory and personal
                    Microsoft accounts”.
                  </li>
                  <li>
                    Add a redirect address of type <span className="font-medium">Web</span> using the value below.
                  </li>
                  <li>
                    Under API permissions add Microsoft Graph delegated permissions:{' '}
                    <span className="font-medium">Calendars.ReadWrite</span>, User.Read and offline_access. A work
                    account may need an administrator to approve them.
                  </li>
                  <li>Under Certificates &amp; secrets create a client secret and copy its Value.</li>
                  <li>Paste the application (client) ID and the secret value here.</li>
                </Steps>
                {microsoftFromEnv ? (
                  <Notice>Set through the MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET environment variables.</Notice>
                ) : (
                  <OAuthAppForm
                    provider="microsoft"
                    redirectUri={`${baseUrl}/api/oauth/microsoft/callback`}
                    hasSaved={Boolean(integrations.microsoft)}
                  />
                )}
              </div>
            </details>
          </Card>

          <Card className="p-4 shadow-none">
            <h3 className="text-sm font-semibold text-zinc-900">Apple iCloud and other CalDAV</h3>
            <p className="mt-1 text-sm leading-6 text-zinc-600">
              iCloud, Fastmail, Nextcloud and similar. Reads busy times and adds bookings. No setup beyond a
              password.
            </p>
            <details className="mt-3">
              <summary className="text-sm font-medium text-brand">Connect</summary>
              <div className="mt-3">
                <CalDavForm />
              </div>
            </details>
          </Card>

          <Card className="p-4 shadow-none">
            <h3 className="text-sm font-semibold text-zinc-900">Any calendar, by link</h3>
            <p className="mt-1 text-sm leading-6 text-zinc-600">
              Works with every calendar product, including Google and Outlook, with no setup. Read-only: it
              blocks busy times but bookings cannot be added to it.
            </p>
            <details className="mt-3">
              <summary className="text-sm font-medium text-brand">Add a link</summary>
              <div className="mt-3 space-y-3">
                <p className="text-sm leading-6 text-zinc-600">
                  Look for “Secret address in iCal format” (Google), “Publish calendar → ICS” (Outlook) or
                  “Public calendar” (Apple). Changes can take a few minutes to arrive, depending on the provider.
                </p>
                <IcsForm />
              </div>
            </details>
          </Card>
        </div>
      </Section>
    </div>
  );
}
