# End-to-end tests

These drive a real browser through the whole app: first-run setup, booking,
rescheduling, cancelling, every calendar connection, email, webhooks, time
zones, a phone-sized screen, and sign-in security.

No real accounts are involved. `mocks.js` stands in for Google Calendar,
Microsoft Graph, Resend, an SMTP server, an ICS feed and a webhook receiver.
CalDAV (how iCloud connects) is tested against a real local CalDAV server,
Radicale.

```bash
npm run test:e2e
```

```bash
npm run test:e2e -- --no-build
```

```bash
npm run test:e2e -- google
```

The second form reuses the last build; the third runs only specs whose file
name contains the word given (setup always runs first).

## What it needs

- **Postgres** running locally, with a database whose name ends in `_test`.
  The runner wipes it on every run and refuses any other name. Default:
  `postgres://calendi:calendi@localhost:5432/calendi_test`; override with
  `E2E_DATABASE_URL`.
- **`psql`** on the path.
- **Playwright with Chromium**, resolvable by `require('playwright')`.
- **Radicale**, for the CalDAV spec only (`pip install radicale`). Without it
  that spec is skipped and the rest still run. If Radicale lives in a virtual
  environment, point `RADICALE_PYTHON` at that environment's `python`.
- Free ports: 3210 (the app; change with `E2E_PORT`), 4001–4004, 4025, 5232.

## How it fits together

`run.js` empties and migrates the database, builds the app, starts the mocks,
Radicale and the app (with the provider endpoints pointed at the mocks and the
calendar cache switched off), then runs each numbered spec in order. `01-setup`
creates the owner and saves the signed-in session that later specs reuse;
every other spec starts by calling `reset()` so it can run on its own.

Screenshots and the logs of each service land in `tests/e2e/.out/`.

Dates are computed from "the first Monday at least six days from now"
(`D.mon`, `D.tue`, … `D.mon3` in `lib.js`), so the specs do not go stale. The
owner in these tests works 9:00–17:00 on weekdays, New York time.

## What the mocks do not prove

They check that the app sends Google and Microsoft the requests their
documentation describes and handles the documented replies. They cannot prove
the real services behave as documented for a particular account (consent
screens, admin approval, tenant policies). The first real connection of each
kind is worth watching once by hand.
