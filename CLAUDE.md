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
  install.ts           "Is this deployment ready?": missing settings / database problems,
                       each with a plain-language fix (drives /admin/setup)
  availability/
    slots.ts           PURE slot engine (no I/O, no clock): unit-tested
    index.ts           getSlots(): schedule + calendars + bookings -> start times
  calendars/
    types.ts           CalendarProvider interface, ProviderError, fetch helpers
    google.ts microsoft.ts caldav.ts ics.ts   One provider each
    icsParse.ts        iCalendar -> busy intervals (recurrence, zones, all-day)
    icsBuild.ts        Booking -> iCalendar text
    index.ts           The only entry point the rest of the app uses: token
                       refresh, busy cache, failure tracking, event writes
  bookings.ts          createBooking / cancelBooking / rescheduleBooking
  email.ts webhook.ts  Notifications (both optional, neither can fail a booking)
  format.ts public.ts constants.ts env.ts
src/app/
  page.tsx             Public landing page
  [slug]/page.tsx      Booking page for one event type
  booking/[token]/     Confirmation, cancel, reschedule (invitee, by secret token)
  admin/login, admin/setup
  admin/(panel)/       Signed-in admin: event-types, bookings, availability, calendars, settings
  actions/public.ts    Server actions anyone can call (book, cancel, reschedule)
  actions/admin.ts     Server actions for the owner
  actions/auth.ts      Setup, sign-in, sign-out
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
- `actions/public.ts` trusts nothing: validate shape with zod there, enforce
  the rules again in `lib/bookings.ts`.

### Scheduling correctness (do not weaken these)
- The `bookings_no_overlap` exclusion constraint is the last line of defence
  against double-booking. Never remove it or add a code path around it.
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
- Provider endpoints can be redirected with env vars (`GOOGLE_API_BASE`, …)
  purely so the e2e mocks can stand in. Keep that working when touching them.
- Credentials are stored encrypted (`encryptJson`) and never sent to the browser.
  Forms treat an empty secret field as "keep what is saved".

### Data and UI conventions
- All SQL lives in `store.ts`; schema changes are new files in `db/migrations`
  (never edit an applied migration). Every table has RLS enabled with no
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
  edge cases in `tests/ics.test.ts`.
- E2E specs use dates computed from "the first Monday at least six days out"
  (`D.mon`, `D.tue2`, … in `tests/e2e/lib.js`). Never hard-code a date.
