# Calendi

Your own scheduling page. People open a link, see the times you are actually
free, and book. The meeting lands on your calendar and theirs.

It is a single-owner app: one person (you) signs in to the admin, and everyone
else just books.

## What it does

**For the people booking**

- A landing page listing your meeting types, and a link per type (`/30min`, `/intro-call`, …)
- Month view, times shown in their own time zone (changeable), 12- or 24-hour clock
- A short form: name, email, plus any questions you add; optional guests
- A confirmation page with add-to-calendar buttons, and links to reschedule or cancel
- Works on phones, and can be embedded in another site

**For you**

- **Calendars from anywhere, as many as you like**, all checked together for conflicts:
  | Source | Blocks busy times | Receives bookings | Sends the invitation | Video link |
  |---|---|---|---|---|
  | Google Calendar | yes | yes | Google does | Google Meet |
  | Outlook / Microsoft 365 | yes | yes | Outlook does | Teams (work or school accounts) |
  | Apple iCloud, Fastmail, Nextcloud (CalDAV) | yes | yes | Calendi's email | your own link |
  | Any calendar by subscription link (.ics) | yes | no (read-only) | Calendi's email | your own link |
- Event types with their own duration, location, colour, questions and rules:
  start-time spacing, free time before and after, minimum notice, how far ahead
  people can book, and a daily limit
- Secret links (not listed publicly) and an on/off switch per event type
- Weekly working hours, split days, one-off dates off or with special hours,
  and more than one schedule if different meetings need different hours
- A bookings list (upcoming, past, cancelled) with cancel, reschedule and CSV export
- Optional email notifications (through Resend or any SMTP server)
- An optional webhook on every booking, reschedule and cancellation, for Zapier, Slack, Asana and the like
- Your name, photo, welcome message and accent colour on the public pages

**What keeps it honest**

- Two people can never get the same slot: the database itself refuses overlapping
  bookings, and bookings that would break the free time you keep around meetings,
  even when two people book at the same instant.
- A slot is re-checked against your live calendars at the moment of booking.
- If a connected calendar cannot be read, booking pauses with a clear message
  (and the admin tells you which calendar) rather than offering times that
  might be taken.
- Calendar passwords, tokens and API keys are encrypted before they are stored.
- Nobody can claim a freshly deployed site without the setup token you chose.
- The secret links invitees use to reschedule or cancel are stored only as a
  hash (plus an encrypted copy for your admin), so a copy of the database is not
  enough to act on anyone's booking.
- Booking, cancelling, rescheduling, loading times and signing in are each
  limited per network address, and guessing at booking links is cut off.

## Putting it online

You need two things: somewhere to run the app, and a Postgres database. The
steps below use Vercel and a database added through Vercel (Supabase or Neon);
any Node host and any Postgres work the same way.

1. **Import this repository into Vercel** (New Project → pick the repo). Leave the build settings alone. Vercel deploys straight away; at this point the site shows an "Almost there" page listing what it still needs, which is the next two steps.
2. **Add a database.** In the Vercel project: Storage → Create Database → Supabase or Neon → connect it to the project. That sets the database address for you. (Using a database you already have? Add its connection string as `DATABASE_URL` instead.)
3. **Add two settings.** Project → Settings → Environment Variables:
   - `APP_SECRET`: a long random value of at least 32 characters. Keep it. Everything encrypted in the database is locked with this value; if it changes, calendars have to be reconnected.
   - `SETUP_TOKEN`: another random value, at least 24 characters. This is what proves the site is yours when you create your account. Keep it somewhere you can copy it from in step 5.

   A password manager's generator works for both, or run this once for each:
   ```bash
   openssl rand -base64 32
   ```
4. **Redeploy** (Deployments → the ⋯ menu on the latest one → Redeploy). Settings only take effect on a new deployment, and the database tables are created during the build.
5. **Open the site and create your account**, pasting the `SETUP_TOKEN` value into the first field. The first person to submit that form with the right token becomes the owner, and after that setup is closed for good. Without the token nobody can claim the site, so there is no rush, but do not share it. Once your account exists you can delete the `SETUP_TOKEN` setting.
6. **Connect your calendars** under Calendars (each option shows its own steps), then check your hours under Availability.
7. Optional: turn on email and the webhook under Settings. If you add a custom domain, set `APP_URL` to it (for example `https://meet.example.com`) so links in emails and calendar entries use that address.

If something is still missing or the database cannot be reached, `/admin/setup` says which, and what to do about it.

### Connecting calendars

- **By link (.ics)** needs nothing but the link, so it is the quickest way to
  block busy times from any calendar. It cannot receive bookings.
- **iCloud / CalDAV** needs an app-specific password (the Calendars page says where to create one).
- **Google and Microsoft** need a one-time "app registration" on their side,
  about five minutes each. The Calendars page lists the exact steps and shows
  the redirect address to paste. Two things to know:
  - Google: if your account is not Google Workspace, publish the app
    ("In production") or Google will sign you out every seven days.
  - Microsoft: a work account may need an administrator to approve calendar access.

### Settings reference

The first two are always required, and `SETUP_TOKEN` until your account
exists. The rest can be entered in the admin instead (where they are stored
encrypted); a value set here wins.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string. `POSTGRES_URL` (set by Vercel's database integrations) is used if this is absent. |
| `APP_SECRET` | At least 32 characters. Signs sessions and encrypts stored credentials. |
| `SETUP_TOKEN` | At least 24 characters. Must be typed on the setup form to create the owner account. Not needed afterwards. |
| `APP_URL` | Public address, if it should not be taken from the request (custom domains). |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google app registration. |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID` | Microsoft app registration (tenant only for single-organisation apps). |
| `RESEND_API_KEY` or `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, plus `EMAIL_FROM` | Outgoing email. |
| `MIGRATE_ON_PREVIEW` | Set to `1` only if Vercel preview deployments have a database of their own. By default previews never change the database (see below). |
| `CALENDAR_CACHE_SECONDS` | How long calendar lookups are remembered while people browse (default 60, 0 to disable). Booking always re-checks. |

## Good to know

- **Limits per visitor.** From one network address: 8 bookings, 10
  cancellations and 10 reschedules an hour; 60 look-ups of available times a
  minute; 5 sign-in attempts per 15 minutes; and 10 booking links that do not
  exist per 15 minutes. Over the limit, the visitor is told to wait (HTTP 429).
  There is also an overall cap of 40 new bookings an hour. The numbers live in
  `src/lib/rateLimit.ts`. The visitor's address comes from the host: Vercel
  provides it reliably; behind your own proxy, make sure it sets `X-Real-IP`.
- **Preview deployments do not touch the database.** Vercel builds a preview
  for every branch, usually against the same database as the live site.
  Database changes are applied only by production builds, so an unmerged
  branch cannot change the tables under the live site. A preview of a branch
  that needs new tables may therefore not work until it is merged.

- **Cancel from Calendi, not from your calendar.** Deleting a booking's entry
  directly in Google or Outlook does not cancel the booking here, so the slot
  stays taken. Use the Bookings page or the links in the calendar entry.
- **Who emails the invitee?** When bookings are saved to Google or Outlook,
  that calendar sends the invitation and any updates. Otherwise Calendi's own
  email does, so turn email on under Settings if you use iCloud or links only.
- **Lost the password?** There is no reset email. Replace the password hash
  in the `owner` table, or ask a developer to. Sign-in also pauses for 15
  minutes after 8 wrong passwords in a row.
- **Not included:** teams and round-robin, group events, payments, SMS,
  reminder workflows, and Zoom's own integration (use a personal Zoom room link
  as the location instead).

## Working on it

```bash
npm install
```

Create `.env.local` (see `.env.example`), pointing `DATABASE_URL` at a local Postgres, then:

```bash
npm run migrate
```

```bash
npm run dev
```

Checks:

```bash
npm run typecheck
```

```bash
npm run lint
```

```bash
npm test
```

```bash
npm run test:e2e
```

`npm test` covers the scheduling engine and calendar parsing. `npm run test:e2e`
drives a real browser through every flow against stand-ins for Google,
Microsoft, CalDAV, email and webhooks; see `tests/e2e/README.md` for what it
needs. Both run on every push (`.github/workflows/ci.yml`).

How the code is organised, and the rules it follows, are in `CLAUDE.md`.
