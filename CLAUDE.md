# Calendi

A single-owner scheduling app (book-a-time links backed by the owner's real
calendars). Next.js App Router + TypeScript + Tailwind, Postgres, no ORM.
`README.md` covers what it does and how to deploy it.

@AGENTS.md

## Commands

```bash
npm run dev          # local server (needs .env.local: DATABASE_URL, APP_SECRET)
npm run migrate      # apply db/migrations/*.sql (also runs before every build)
npm run typecheck    # next typegen + tsc
npm run lint
npm test             # unit tests: slot engine, ICS parsing, DB URL handling
npm run test:e2e     # browser tests against mock services (tests/e2e/README.md)
npm run build        # migrate, then next build
```

Before pushing: typecheck, lint, `npm test`, and `npm run test:e2e` for anything
touching booking, availability, calendars, auth or forms.

## Layout

```
db/migrations/         SQL, applied in name order, once each (scripts/migrate.mjs)
src/lib/               Everything that is not a screen
  types.ts             Row types mirror DB columns one-to-one (snake_case)
  store.ts             Every SQL query. No authorisation in here.
  db.ts                Postgres client (postgres.js), connection-string handling
  crypto.ts            AES-GCM encryption, HMAC signing, scrypt password hashing
  session.ts           Owner session cookie; requireOwner / assertOwner
  account.ts           Creating the owner (needs SETUP_TOKEN, once only) and sign-in
  ownerEmails.ts       The owner's extra email addresses: add, confirm by code, notifications address
  rateLimit.ts         Per-address limits counted in Postgres; clientAddress()
  manage.ts            findBookingByLink(): manage-link lookup that counts wrong guesses
  http.ts bookingApi.ts  Helpers for the JSON endpoints (429s, origin check, replies)
  postJson.ts          Browser-side caller for those endpoints
  install.ts           "Is this deployment ready?": missing settings / database problems,
                       each with a plain-language fix (drives /admin/setup)
  availability/
    slots.ts           PURE slot engine (no I/O, no clock): unit-tested
    index.ts           getSlots(): schedule + calendars + bookings -> start times
  calendars/
    types.ts           CalendarProvider interface, ProviderError, fetch helpers
    setup.ts           Google / Microsoft app settings from env vars, the owner's setup guide
    google.ts microsoft.ts caldav.ts ics.ts   One provider each
    icsParse.ts        iCalendar -> busy intervals (recurrence, zones, all-day)
    icsBuild.ts        Booking -> iCalendar text
    index.ts           The only entry point the rest of the app uses: token
                       refresh, busy cache, failure tracking, event writes
  bookings.ts          createBooking / cancelBooking / rescheduleBooking (the last two
                       take a booking the caller has already looked up)
  email.ts webhook.ts  Notifications (both optional, neither can fail a booking)
  format.ts public.ts constants.ts env.ts
src/app/
  page.tsx             Public landing page
  [slug]/page.tsx      Booking page for one event type
  booking/[token]/     Confirmation, cancel, reschedule (invitee, by secret token)
  admin/login, admin/setup
  admin/(panel)/       Signed-in admin: event-types, bookings, availability, calendars, settings
  actions/admin.ts     Server actions for the owner
  actions/auth.ts      Sign-out
  api/bookings         POST book; api/bookings/cancel and /reschedule (by manage token)
  api/auth             POST login, POST setup
  api/availability     GET slots for a date range
  api/oauth/[provider] Google / Microsoft sign-in round trip
  api/ics/[token]      .ics download
src/components/        UI. ui.tsx = stateless pieces; client.tsx = interactive pieces
src/proxy.ts           Redirects signed-out visitors away from /admin (cookie presence only)
tests/                 *.test.ts unit tests; e2e/ browser specs + mock services
```

## Rules that matter

### Next.js (this version is not the one you remember)
- Cache Components is on. A page is a **synchronous** default export that
  renders `<Suspense>` around an **async** content component; the content
  component does the data access. Reading cookies, params, the database or the
  clock outside a Suspense boundary breaks the build.
- Anything time- or session-dependent calls `await connection()` first
  (`requireOwner()` already does).
- Do not add `export const dynamic` / `runtime`; they are not supported here.
  `maxDuration` is fine.
- `page.tsx` files may only export the page, `metadata` / `generateMetadata`
  and segment config. Helpers go in `src/lib`.
- `'use server'` files may only export async functions (types are fine).
- Read `node_modules/next/dist/docs/` before using a Next API you have not used
  in this repo yet.
- **Install-state pages** (`/`, `/admin/login`, `/admin/setup`: anything that
  calls `installStatus()`) are the exception to the Suspense pattern. They set
  `export const instant = false` and `await connection()` at the top of the
  page itself, with no Suspense, so the build stores no shell for them and
  every response reflects the deployment as it is right now. (Next still
  answers with `x-nextjs-prerender: 1`; with Cache Components every page has
  a build-time entry, but theirs is empty. `08-unconfigured` checks both.)

### First run and failures
- A deployment with no database or `APP_SECRET` must show the checklist at
  `/admin/setup`, never a bare server error. `/`, `/admin/login` and
  `/admin/setup` go through `installStatus()`; add new required settings to
  `settingProblems()` with a fix someone can follow in their host's dashboard.
- `installStatus()` never echoes raw error text (it can contain the connection
  string); it maps error codes to fixed wording.
- `src/app/error.tsx` is the catch-all for everything else. Route handlers
  answer with JSON even when the database is down.

### Auth
- Every admin page's content component starts with `await requireOwner()`.
- Every action in `actions/admin.ts` starts with `await assertOwner()`. Server
  actions are reachable by direct request; the proxy is not a security boundary.
- Setup needs the `SETUP_TOKEN` setting (24+ characters, compared with
  `secretsMatch`) and refuses for ever once an owner exists. Do not add another
  way to create or replace the owner.

### Public endpoints (anything a visitor can call)
- They are JSON route handlers under `src/app/api`, not server actions, so
  they can answer with a real status code (429 when rate limited). Each one:
  wraps its handler in `guarded()`, rejects `fromAnotherSite()`, then calls
  `consume(LIMITS.x)` **before** doing any work, then validates with zod. The
  rules are enforced again in `lib/bookings.ts` and by the database.
- A new public endpoint gets its own entry in `LIMITS` and a check in
  `tests/e2e/09-security.js`.
- Manage-link tokens: 24 random bytes. Only `token_hash` (SHA-256) and
  `token_sealed` (encrypted with APP_SECRET) are stored; `booking.token` is
  filled in by `store.ts`, never read from a column. Every place that accepts
  a token from a visitor looks it up with `findBookingByLink()`, which is what
  counts and cuts off guessing. Never query by token any other way, and never
  log a token.
- The owner acts on bookings by id (after `assertOwner()`), not by token.

### Sign-in addresses
- The owner can have several email addresses (`owner_emails`). Sign-in accepts
  any **verified** one with the one password; never an unverified one.
- An address is verified by a six-digit code emailed to it, stored only as an
  HMAC (`codeHash`), five wrong tries per code. No email provider configured
  means it stays unverified; do not add another way to verify.
- `owner.email` is the notifications address (alerts, organiser, reply-to) and
  must be a verified address. A meeting type's `notify_email` overrides where
  its alerts go ('' = default). Connected calendar accounts are not sign-in
  addresses; keep them separate.

### Scheduling correctness (do not weaken these)
- The `bookings_no_overlap` exclusion constraint is the last line of defence
  against double-booking, and the `bookings_buffers` trigger is the same for
  buffers (it queues writers on an advisory lock, so two simultaneous bookings
  cannot both slip through). Never remove either or add a code path around
  them. The trigger's rule must stay identical to the one in `slots.ts`: if
  you change how buffers work, change both and the tests for both.
- `createBooking` / `rescheduleBooking` re-check the slot with `fresh: true`
  (bypassing caches) immediately before writing.
- Calendars **fail closed**: if any calendar marked "check for conflicts"
  cannot be read, `getCalendarBusy` throws `CalendarUnavailableError`, the
  public page says times could not be loaded, and the account is flagged in the
  admin. Do not turn this into "skip the broken calendar".
- Calendar, email and webhook failures after a booking is written are recorded
  (`sync_error`, logs) and never undo the booking.
- Time is epoch milliseconds / `timestamptz` everywhere. Working hours are
  wall-clock strings in the schedule's zone and are converted with Luxon
  (`slots.ts`), which is what keeps 9:00 at 9:00 across daylight saving.
  All-day and zone-less calendar events are placed in the schedule's zone.

### Calendar providers
- Add or change a provider by implementing `CalendarProvider` and registering
  it in `calendars/index.ts`. Screens never import a provider directly.
- Google / Microsoft app credentials come only from env vars
  (`oauthClientFromEnv`); the admin never asks for them. Without them the
  Connect button opens the owner-only setup card (`calendars/setup.ts`). The
  only exception: tokens of accounts connected by older versions are refreshed
  with the credentials those versions saved in `owner.integrations`.
- Google scopes stay minimal: `calendar.calendarlist.readonly`,
  `calendar.freebusy`, `calendar.events` (plus `openid email`). Sign-in always
  shows the account picker (`prompt=select_account`), so one button adds any
  number of accounts; an account is matched by its email (a reconnect).
- New calendars start with "check for conflicts" on; any (non-main) calendar
  the provider cannot read busy times for is switched off at connect time
  instead (`switchOffUnreadable`), so it cannot pause booking. Bookings go to
  the meeting type's own calendar if it can still take them, else the default
  (`pickBookingCalendar`).
- Provider endpoints can be redirected with env vars (`GOOGLE_API_BASE`,
  `ICLOUD_CALDAV_URL`, …) purely so the e2e mocks can stand in. Keep that
  working when touching them.
- Credentials are stored encrypted (`encryptJson`) and never sent to the browser.
  Forms treat an empty secret field as "keep what is saved".

### Data and UI conventions
- All SQL lives in `store.ts`; schema changes are new files in `db/migrations`
  (never edit an applied migration). Migrations run in production builds only:
  Vercel preview builds skip them, because previews usually share the live
  database. So a migration must not be needed by the code that is live *before*
  the merge, and the PR description should say that the branch has one. Every table has RLS enabled with no
  policies so a Supabase project does not expose it through its Data API.
- Forms that run a server action use `<ActionForm>` (keeps typed values on
  error), with `<SubmitButton>` and `<FormMessage>` inside. Do not use a bare
  `<form action={…}>`: React clears the fields when the action returns.
- Width / height overrides on `Input`, `Select`, `Textarea` work by passing a
  `w-…` / `min-h-…` class; other conflicting Tailwind classes will not override.
- Public pages take the owner's accent colour through `brandStyle()`; use
  `bg-brand`, `text-brand`, `text-brand-fg` rather than fixed colours.
- User-facing wording is plain language: say what happened and what to do next.

### Tests
- New scheduling rules get a unit test in `tests/slots.test.ts`; new calendar
  edge cases in `tests/ics.test.ts`; connect / sign-in address rules in
  `tests/connect.test.ts`.
- E2E specs use dates computed from "the first Monday at least six days out"
  (`D.mon`, `D.tue2`, … in `tests/e2e/lib.js`). Never hard-code a date.
