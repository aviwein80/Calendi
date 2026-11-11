// Shared helpers for the end-to-end specs. Each spec is a plain Node script
// that drives a real browser against the running app (see run.js).
const { chromium } = require('playwright');
const { execFileSync, spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const BASE = `http://localhost:${process.env.E2E_PORT || 3210}`;
const DATABASE_URL = process.env.E2E_DATABASE_URL || 'postgres://calendi:calendi@localhost:5432/calendi_test';
const OUT = path.join(__dirname, '.out');
const STATE = path.join(OUT, 'admin-session.json');
fs.mkdirSync(OUT, { recursive: true });

const OWNER = { name: 'Avi Tester', email: 'owner@example.com', password: 'correct-horse-battery' };
/** The SETUP_TOKEN the runner starts the app with. */
const SETUP_TOKEN = 'e2e-setup-token-0123456789abcdef';
const APP_SECRET = 'end-to-end-test-secret-0123456789abcdef';
const ROOT = path.join(__dirname, '..', '..');

/** How a manage-link token is stored: its SHA-256. */
const tokenHash = (token) => crypto.createHash('sha256').update(token, 'utf8').digest('hex');

// Rate limits are per network address. Run locally there is no proxy, so the
// app takes the address from X-Real-IP: every simulated visitor gets its own,
// as real visitors would, and a spec can pick one to exhaust on purpose.
let addresses = 0;
const nextAddress = () => `10.0.${Math.floor(addresses / 250)}.${(addresses++ % 250) + 1}`;
/** The address this spec's own (non-browser) requests come from. */
const SPEC_ADDRESS = '10.9.0.1';

/** fetch against the app, from a chosen address (default: this spec's own). */
function api(route, { address = SPEC_ADDRESS, json, ...init } = {}) {
  return fetch(route.startsWith('http') ? route : BASE + route, {
    ...init,
    ...(json !== undefined ? { method: 'POST', body: JSON.stringify(json) } : {}),
    headers: {
      'x-real-ip': address,
      ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
}

let passed = 0;
let failed = 0;
function check(name, condition, detail = '') {
  if (condition) {
    passed++;
    console.log('  ok   ', name);
  } else {
    failed++;
    console.log('  FAIL ', name, detail);
  }
}
/** Prints the tally and exits non-zero if anything failed. */
function finish() {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

/** Runs one SQL statement with psql and returns its output as text. Throws on SQL errors. */
function sql(query) {
  return execFileSync('psql', [DATABASE_URL, '-At', '-v', 'ON_ERROR_STOP=1', '-c', query], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
    .toString()
    .trim();
}

const mock = async (route, data) =>
  (await fetch('http://localhost:4001' + route, data ? { method: 'POST', body: JSON.stringify(data) } : undefined)).json();

const WORKDAY = JSON.stringify([{ start: '09:00', end: '17:00' }]);
const WEEK = `{"1":${WORKDAY},"2":${WORKDAY},"3":${WORKDAY},"4":${WORKDAY},"5":${WORKDAY}}`;

/** Puts the app back to "owner exists, one default event type, nothing connected". */
async function reset() {
  sql(`
    delete from bookings;
    delete from calendar_accounts;
    delete from event_types where slug <> '30min';
    update event_types set location_type = 'none', location_value = '', questions = '[]', allow_guests = false,
      buffer_before_minutes = 0, buffer_after_minutes = 0, daily_limit = null, is_active = true, is_hidden = false;
    delete from schedules where not is_default;
    update schedules set overrides = '{}', weekly = '${WEEK}';
    update owner set integrations = '', webhook_url = '', welcome_message = '', brand_color = '#4f46e5',
      failed_logins = 0, locked_until = null;
    delete from rate_limits;
  `);
  await mock('/reset', {});
}

/** Open slots on one of the D.* days, as "HH:mm" labels in New York time. */
async function daySlots(d, slug = '30min') {
  const from = encodeURIComponent(d.at('00:00').toUTC().toISO());
  const to = encodeURIComponent(d.plus(1).at('00:00').toUTC().toISO());
  const response = await api(`/api/availability?slug=${slug}&from=${from}&to=${to}`);
  const body = await response.json();
  if (!response.ok) return { status: response.status, error: body.error, times: [] };
  const format = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' });
  return { status: 200, times: body.slots.map((slot) => format.format(new Date(slot))) };
}

async function newPage(browser, options) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    timezoneId: 'America/New_York',
    extraHTTPHeaders: { 'x-real-ip': nextAddress() },
    ...options,
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => {
    failed++;
    console.log('  FAIL  page error:', error.message);
  });
  return { ctx: context, page };
}

/** A browser tab signed in as the owner (01-setup.js saves the session). */
const admin = (browser) => newPage(browser, { storageState: STATE });
/** A signed-out visitor, optionally in another time zone or on a phone-sized screen. */
const visitor = (browser, timezoneId = 'America/New_York', viewport = { width: 1280, height: 900 }) =>
  newPage(browser, { timezoneId, viewport });

/**
 * Books through the public page. `day` is one of the D.* days and `time` the
 * slot's label ("11:00 AM"). Returns the booking token.
 */
async function book(page, { slug = '30min', day, time, name = 'Jane Invitee', email = 'jane@example.com', fill }) {
  await page.goto(`${BASE}/${slug}`);
  await page.waitForSelector('ul[aria-label="Available times"] button');
  await pickDay(page, day.at('12:00'));
  await page.click(`ul[aria-label="Available times"] button:text-is("${time}")`);
  await page.click('button:text-is("Next")');
  await page.fill('#name', name);
  await page.fill('#email', email);
  if (fill) await fill(page);
  await page.click('text=Schedule meeting');
  await page.waitForURL('**/booking/**', { timeout: 20000 });
  return page.url().split('/booking/')[1].split(/[/?]/)[0];
}

/**
 * Starts a separate, short-lived copy of the app with exactly these settings
 * and waits until it answers. The caller kills the returned process.
 */
async function startApp(port, settings) {
  const env = { ...process.env, ...settings };
  for (const name of ['DATABASE_URL', 'POSTGRES_URL', 'POSTGRES_URL_NON_POOLING', 'APP_SECRET', 'APP_URL', 'SETUP_TOKEN']) {
    // Blank rather than removed: a removed variable would be filled back in
    // from a developer's .env.local, a blank one is left alone.
    if (!(name in settings)) env[name] = '';
  }
  const child = spawn('node', ['node_modules/next/dist/bin/next', 'start', '-p', String(port)], { cwd: ROOT, env, stdio: 'ignore' });
  for (let i = 0; i < 80; i++) {
    try {
      await fetch(`http://localhost:${port}/icon.svg`);
      return child;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  child.kill();
  throw new Error(`The app did not start on port ${port}`);
}

const shot = (page, name, fullPage = false) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage });

// ── Dates ────────────────────────────────────────────────────────────────
// The owner's schedule is 9:00-17:00 on weekdays, New York time. The specs
// need real weekdays in the bookable future, so every date is worked out from
// "the first Monday at least six days from now" rather than written down.
const { DateTime } = require('luxon');
const NY = 'America/New_York';
const today = DateTime.now().setZone(NY).startOf('day');
const firstMonday = today.plus({ days: 6 + ((8 - today.plus({ days: 6 }).weekday) % 7) });

function day(offset) {
  const date = firstMonday.plus({ days: offset }).setLocale('en-US');
  return {
    iso: date.toISODate(),
    /** The calendar button's label, e.g. "Monday, November 16". */
    label: date.toFormat('cccc, LLLL d'),
    /** That day at a New York wall-clock time, e.g. at('09:30'). */
    at: (hhmm) => DateTime.fromISO(`${date.toISODate()}T${hhmm}`, { zone: NY }).setLocale('en-US'),
    plus: (days) => day(offset + days),
  };
}
/** Week one, week two, and one day in week three. */
const D = {
  mon: day(0), tue: day(1), wed: day(2), thu: day(3), fri: day(4),
  mon2: day(7), tue2: day(8), wed2: day(9), thu2: day(10), fri2: day(11),
  mon3: day(14),
};
/** "2026-11-16T16:00:00.000Z" */
const utc = (dt) => dt.toUTC().toISO();
/** "20261116T160000Z", as written in iCalendar files. */
const compact = (dt) => dt.toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");
/** "20261116", an iCalendar date. */
const icsDate = (d) => d.iso.replace(/-/g, '');
/** "20261116T100000", an iCalendar local time. */
const icsLocal = (dt) => dt.toFormat("yyyyMMdd'T'HHmmss");

/** Shows the month containing `when` (a DateTime in the visitor's zone) and clicks that day. */
async function pickDay(page, when) {
  const local = when.setLocale('en-US');
  const month = local.toFormat('LLLL yyyy');
  for (let i = 0; i < 4; i++) {
    const shown = (await page.locator('p[aria-live="polite"]').first().textContent()).trim();
    if (shown === month) break;
    await page.click('button[aria-label="Next month"]');
  }
  await page.click(`button[aria-label="${local.toFormat('cccc, LLLL d')}"]`);
}

/** The time labels currently offered, e.g. ["9:00 AM", "9:30 AM"]. */
const offered = (page) =>
  page.$$eval('ul[aria-label="Available times"] button', (buttons) => buttons.map((b) => b.textContent.trim()));

module.exports = {
  chromium, BASE, OUT, STATE, OWNER, SETUP_TOKEN, APP_SECRET, DATABASE_URL, D, NY, utc, compact, icsDate, icsLocal,
  check, finish, sql, mock, reset, daySlots, admin, visitor, book, pickDay, offered, shot,
  api, tokenHash, nextAddress, startApp,
};
