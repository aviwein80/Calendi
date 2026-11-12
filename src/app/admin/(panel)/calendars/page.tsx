import { ExternalLink } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense, type ReactNode } from 'react';
import {
  AccountActions,
  CalDavForm,
  ConflictToggle,
  EventTypeCalendarSelect,
  ICloudForm,
  IcsForm,
  TargetToggle,
} from '@/components/CalendarBits';
import { CopyButton } from '@/components/client';
import { Badge, buttonClass, cx, Notice, PageHeader, Section, Skeleton } from '@/components/ui';
import { accountSummary, oauthClient, pickBookingCalendar, usesSavedAppCredentials } from '@/lib/calendars';
import { OAUTH_SETUP, oauthRedirectUri, type OAuthProviderId } from '@/lib/calendars/setup';
import { getBaseUrl } from '@/lib/env';
import { requireOwner } from '@/lib/session';
import { listCalendarAccounts, listCalendars, listEventTypes } from '@/lib/store';
import type { CalendarAccount, CalendarRow } from '@/lib/types';

export const metadata: Metadata = { title: 'Calendars' };

// Actions on this page talk to calendar and email services; allow them time.
export const maxDuration = 60;

export default function CalendarsPage(props: PageProps<'/admin/calendars'>) {
  return (
    <>
      <PageHeader
        title="Calendars"
        description="Connect the calendars you live by. Events on them block your booking times, and new bookings are added to the calendar you choose."
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

type PanelId = 'google' | 'microsoft' | 'icloud' | 'ics' | 'caldav' | '';

async function Content({ searchParams }: PageProps<'/admin/calendars'>) {
  await requireOwner();
  const [query, accounts, calendars, eventTypes, baseUrl, legacyGoogle, legacyMicrosoft] = await Promise.all([
    searchParams,
    listCalendarAccounts(),
    listCalendars(),
    listEventTypes(),
    getBaseUrl(),
    usesSavedAppCredentials('google'),
    usesSavedAppCredentials('microsoft'),
  ]);
  const ready = { google: Boolean(oauthClient('google')), microsoft: Boolean(oauthClient('microsoft')) };
  const setup = first(query.setup);
  const add = first(query.add);
  const panel: PanelId =
    setup === 'google' || setup === 'microsoft'
      ? setup
      : add === 'icloud' || add === 'ics' || add === 'caldav'
        ? add
        : '';
  const connected = first(query.connected);
  const summaries = new Map(accounts.map((account) => [account.id, accountSummary(account)]));
  const writable = calendars.filter((c) => c.can_write);
  const defaultTarget = calendars.find((c) => c.is_booking_target);
  const calendarLabel = (calendar: CalendarRow) => {
    const summary = summaries.get(calendar.account_id);
    const extra = summary?.email && summary.email !== calendar.name ? summary.email : summary?.service;
    return extra ? `${calendar.name} · ${extra}` : calendar.name;
  };

  return (
    <div className="space-y-5">
      {connected && (
        <Notice tone="green">
          Connected{connected === '1' ? '' : ` ${connected}`}. Its calendars are listed below.
        </Notice>
      )}
      {first(query.error) && <Notice tone="red">{first(query.error)}</Notice>}
      {(legacyGoogle || legacyMicrosoft) && (
        <Notice tone="amber">
          Your connected {legacyGoogle && legacyMicrosoft ? 'Google and Microsoft' : legacyGoogle ? 'Google' : 'Microsoft'}{' '}
          accounts still use app settings saved by an earlier version of Calendi. They keep working, but to connect
          another account, add the app settings as environment variables (press the Connect button for the steps).
        </Notice>
      )}

      <section id="connect" className="scroll-mt-6">
        <h2 className="sr-only">Connect a calendar</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <ConnectButton
            href={ready.google ? '/api/oauth/google/start' : '/admin/calendars?setup=google#connect'}
            external={ready.google}
            tile="G"
            tileClass="bg-[#4285f4]"
            title="Connect Google"
            subtitle="Gmail and Google Workspace"
            active={panel === 'google'}
          />
          <ConnectButton
            href={ready.microsoft ? '/api/oauth/microsoft/start' : '/admin/calendars?setup=microsoft#connect'}
            external={ready.microsoft}
            tile="O"
            tileClass="bg-[#0078d4]"
            title="Connect Outlook / Microsoft 365"
            subtitle="Outlook.com, Hotmail, work accounts"
            active={panel === 'microsoft'}
          />
          <ConnectButton
            href="/admin/calendars?add=icloud#connect"
            tile="i"
            tileClass="bg-zinc-900"
            title="Connect iCloud"
            subtitle="Apple Calendar"
            active={panel === 'icloud'}
          />
        </div>
        <p className="mt-3 text-sm text-zinc-600">
          Something else?{' '}
          <Link href="/admin/calendars?add=ics#connect" className="font-medium text-brand underline-offset-2 hover:underline">
            Add by .ics link
          </Link>{' '}
          (any calendar, read-only) or{' '}
          <Link href="/admin/calendars?add=caldav#connect" className="font-medium text-brand underline-offset-2 hover:underline">
            another CalDAV server
          </Link>{' '}
          (Fastmail, Nextcloud).
        </p>

        {(panel === 'google' || panel === 'microsoft') &&
          (ready[panel] ? (
            <Notice className="mt-4" tone="green">
              {OAUTH_SETUP[panel].name} is set up. Press the button above to sign in.
            </Notice>
          ) : (
            <SetupCard provider={panel} baseUrl={baseUrl} />
          ))}
        {panel === 'icloud' && (
          <Panel title="Connect iCloud" description="Your Apple ID email and an app-specific password. Calendi finds your calendars from there.">
            <ICloudForm email={first(query.email)} />
          </Panel>
        )}
        {panel === 'ics' && (
          <Panel
            title="Add a calendar by link"
            description="Works with any calendar product. Read-only: it blocks busy times, but bookings cannot be added to it. Look for “Secret address in iCal format” (Google), “Publish calendar → ICS” (Outlook) or “Public calendar” (Apple). Changes can take a few minutes to arrive."
          >
            <IcsForm />
          </Panel>
        )}
        {panel === 'caldav' && (
          <Panel title="Another CalDAV server" description="For Fastmail, Nextcloud and similar services. For iCloud, use Connect iCloud above.">
            <CalDavForm />
          </Panel>
        )}
      </section>

      <Section
        title="Connected calendars"
        description={
          accounts.length > 0
            ? '“Check for conflicts”: events on that calendar make you unavailable. “Add new bookings here”: where new bookings are saved, unless a meeting type below says otherwise.'
            : undefined
        }
      >
        {accounts.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-300 p-5 text-sm leading-6 text-zinc-600">
            Nothing connected yet. Until you connect a calendar, people can book any time inside your working hours.
          </p>
        ) : (
          <div className="space-y-4">
            {accounts.map((account) => (
              <AccountCard
                key={account.id}
                account={account}
                summary={summaries.get(account.id)!}
                calendars={calendars.filter((c) => c.account_id === account.id)}
                usedBy={(calendarId) =>
                  eventTypes
                    .filter((t) => t.calendar_id === calendarId && pickBookingCalendar(t, calendars) === calendarId)
                    .map((t) => t.name)
                }
              />
            ))}
            {!defaultTarget && (
              <Notice tone="amber">
                New bookings are not being added to any calendar. Turn on “Add new bookings here” for one of the
                calendars above, or rely on email notifications (set up under{' '}
                <Link href="/admin/settings" className="font-medium underline">
                  Settings
                </Link>
                ). Calendars added by link are read-only.
              </Notice>
            )}
          </div>
        )}
      </Section>

      {writable.length > 0 && eventTypes.length > 0 && (
        <Section
          title="Where new bookings go"
          description="Each meeting type can save its bookings to a different calendar."
        >
          <ul className="divide-y divide-zinc-100">
            {eventTypes.map((eventType) => (
              <li key={eventType.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className="h-6 w-1 shrink-0 rounded-full" style={{ background: eventType.color }} aria-hidden />
                  <span className="truncate text-sm font-medium text-zinc-900">{eventType.name}</span>
                </span>
                <EventTypeCalendarSelect
                  eventTypeId={eventType.id}
                  name={eventType.name}
                  value={writable.some((c) => c.id === eventType.calendar_id) ? eventType.calendar_id : null}
                  defaultLabel={defaultTarget ? `Default: ${calendarLabel(defaultTarget)}` : 'Default: no calendar'}
                  options={writable.map((c) => ({ id: c.id, label: calendarLabel(c) }))}
                />
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function ConnectButton({
  href,
  external = false,
  tile,
  tileClass,
  title,
  subtitle,
  active,
}: {
  href: string;
  external?: boolean;
  tile: string;
  tileClass: string;
  title: string;
  subtitle: string;
  active: boolean;
}) {
  const className = cx(
    'flex items-center gap-3 rounded-xl border bg-white p-4 text-left shadow-sm transition hover:border-brand hover:shadow-md',
    active ? 'border-brand ring-2 ring-brand/20' : 'border-zinc-200',
  );
  const body = (
    <>
      <span className={cx('inline-flex size-10 shrink-0 items-center justify-center rounded-lg text-lg font-semibold text-white', tileClass)} aria-hidden>
        {tile}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-zinc-900">{title}</span>
        <span className="block text-xs leading-5 text-zinc-500">{subtitle}</span>
      </span>
    </>
  );
  return external ? (
    // Leaves the app for the provider's sign-in, so a plain link is right.
     
    <a href={href} className={className}>
      {body}
    </a>
  ) : (
    <Link href={href} className={className} scroll={false}>
      {body}
    </Link>
  );
}

function Panel({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <div className="mt-4 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
      <h3 className="text-base font-semibold text-zinc-900">{title}</h3>
      <p className="mb-4 mt-1 text-sm leading-6 text-zinc-600">{description}</p>
      <div className="max-w-md">{children}</div>
    </div>
  );
}

/** Shown to the signed-in owner only: the one-time Google / Microsoft app registration. */
function SetupCard({ provider, baseUrl }: { provider: OAuthProviderId; baseUrl: string }) {
  const guide = OAUTH_SETUP[provider];
  const redirectUri = oauthRedirectUri(provider, baseUrl);
  return (
    <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/60 p-5" data-testid={`setup-${provider}`}>
      <h3 className="text-base font-semibold text-zinc-900">One-time setup for {guide.name} (about 5 minutes)</h3>
      <p className="mt-1 text-sm leading-6 text-zinc-700">
        Before Calendi can offer “Sign in with {guide.name}”, {guide.name} needs to know about this site. You do this
        once; after that the Connect button signs in directly, for as many accounts as you like. Only you see this.
      </p>

      <div className="mt-4">
        <p className="mb-1.5 text-sm font-medium text-zinc-900">Redirect URL</p>
        <div className="flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 break-all rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs" data-testid="redirect-uri">
            {redirectUri}
          </code>
          <CopyButton text={redirectUri} label="Copy" />
        </div>
      </div>

      <ol className="mt-4 list-decimal space-y-2.5 pl-5 text-sm leading-6 text-zinc-800">
        {guide.steps.map((step) => (
          <li key={step.text}>
            {step.text}
            {step.link && (
              <>
                {' '}
                <a href={step.link.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-brand underline">
                  {step.link.label}
                  <ExternalLink className="size-3.5" aria-hidden />
                </a>
              </>
            )}
            {step.detail && <span className="block text-zinc-600">{step.detail}</span>}
          </li>
        ))}
      </ol>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-1.5 text-sm font-medium text-zinc-900">Scopes to add</p>
          <ul className="space-y-1" data-testid="scopes">
            {guide.scopes.map((scope) => (
              <li key={scope}>
                <code className="break-all rounded bg-white px-1.5 py-0.5 text-xs">{scope}</code>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="mb-1.5 text-sm font-medium text-zinc-900">Environment variables</p>
          <ul className="space-y-1">
            {guide.variables.map((name) => (
              <li key={name}>
                <code className="rounded bg-white px-1.5 py-0.5 text-xs">{name}</code>
              </li>
            ))}
          </ul>
          {guide.optional && (
            <p className="mt-1.5 text-xs leading-5 text-zinc-600">
              <code className="rounded bg-white px-1 py-0.5">{guide.optional.name}</code>: {guide.optional.when}.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function AccountCard({
  account,
  summary,
  calendars,
  usedBy,
}: {
  account: CalendarAccount;
  summary: { service: string; email: string };
  calendars: CalendarRow[];
  usedBy: (calendarId: string) => string[];
}) {
  const oauth = account.provider === 'google' || account.provider === 'microsoft';
  const icloud = account.provider === 'caldav' && summary.service === 'Apple iCloud';
  const reconnect = oauth
    ? `/api/oauth/${account.provider}/start?account=${account.id}`
    : icloud
      ? `/admin/calendars?add=icloud&email=${encodeURIComponent(summary.email)}#connect`
      : null;
  const broken = account.status === 'error';
  return (
    <div className={cx('rounded-lg border', broken ? 'border-red-300' : 'border-zinc-200')} data-account={summary.email || account.label}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 bg-zinc-50 px-4 py-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{summary.service}</p>
          <p className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold text-zinc-900">{summary.email || account.label}</span>
            {broken ? <Badge tone="red">Not syncing</Badge> : <Badge tone="green">Connected</Badge>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {reconnect && <ReconnectLink href={reconnect} external={oauth} primary={broken} />}
          <AccountActions accountId={account.id} label={summary.email || account.label} />
        </div>
      </div>
      {broken && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-800" role="alert">
          <p className="font-medium">
            {oauth
              ? 'Calendi can no longer read this account (the sign-in may have expired or been removed), so your booking pages are paused.'
              : 'Calendi cannot read this account right now, so your booking pages are paused.'}
          </p>
          <p className="break-words">{account.last_error?.replace(/\s*Reconnect this account\.$/, '')}</p>
          <p className="mt-1">
            {reconnect
              ? 'Press Reconnect and sign in again to fix it.'
              : 'Press Refresh to try again, or remove it and add it back.'}
          </p>
        </div>
      )}
      <ul className="divide-y divide-zinc-100">
        {calendars.map((calendar) => {
          const types = usedBy(calendar.id);
          return (
            <li key={calendar.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3" data-calendar={calendar.name}>
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span
                    className="size-2.5 shrink-0 rounded-full bg-zinc-300"
                    style={calendar.color ? { background: calendar.color } : undefined}
                    aria-hidden
                  />
                  <span className="truncate text-sm text-zinc-900">{calendar.name}</span>
                  {!calendar.can_write && <Badge>Read-only</Badge>}
                </div>
                {types.length > 0 && (
                  <p className="mt-0.5 pl-5 text-xs text-zinc-500">New bookings for: {types.join(', ')}</p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                <label className="flex items-center gap-2 text-sm text-zinc-600">
                  Check for conflicts
                  <ConflictToggle calendarId={calendar.id} checked={calendar.check_conflicts} name={calendar.name} />
                </label>
                {calendar.can_write && (
                  <label className="flex items-center gap-2 text-sm text-zinc-600 sm:w-52 sm:justify-end">
                    Add new bookings here
                    <TargetToggle calendarId={calendar.id} checked={calendar.is_booking_target} name={calendar.name} />
                  </label>
                )}
                {/* Keeps the toggles in two tidy columns. */}
                {!calendar.can_write && <span className="hidden sm:block sm:w-52" aria-hidden />}
              </div>
            </li>
          );
        })}
        {calendars.length === 0 && <li className="px-4 py-3 text-sm text-zinc-500">No calendars found in this account.</li>}
      </ul>
    </div>
  );
}

function ReconnectLink({ href, external, primary }: { href: string; external: boolean; primary: boolean }) {
  const className = buttonClass(primary ? 'primary' : 'ghost', 'sm');
  return external ? (
    // Leaves the app for the provider's sign-in.
     
    <a href={href} className={className}>
      Reconnect
    </a>
  ) : (
    <Link href={href} className={className}>
      Reconnect
    </Link>
  );
}
