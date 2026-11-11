// The core loop with no calendars connected: book, download the calendar
// file, reschedule, cancel.
const { chromium, BASE, D, utc, check, finish, sql, reset, visitor, book, pickDay, offered, shot, tokenHash } = require('./lib');

(async () => {
  await reset();
  const browser = await chromium.launch();
  const { ctx, page } = await visitor(browser);
  const errors = [];
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  console.log('Book, reschedule, cancel');

  await page.goto(`${BASE}/`);
  await page.waitForSelector('text=30 Minute Meeting');
  await shot(page, 'public-profile');
  await page.click('text=30 Minute Meeting');
  await page.waitForURL('**/30min');
  await page.waitForSelector('ul[aria-label="Available times"] button');
  check('visitor zone detected', (await page.inputValue('#timezone')) === 'America/New_York');
  await pickDay(page, D.wed.at('12:00'));
  const times = await offered(page);
  check('a clear working day offers 16 half-hour slots, 9:00 to 4:30', times.length === 16 && times[0] === '9:00 AM' && times[15] === '4:30 PM', JSON.stringify(times));
  await shot(page, 'public-picker');

  const token = await book(page, { day: D.wed, time: '10:00 AM', fill: (p) => p.fill('#notes', 'Looking forward to it.') });
  await page.waitForSelector('text=You are scheduled');
  await shot(page, 'public-confirmed');
  check('stored at the right instant', sql(`select to_char(start_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS".000Z"') from bookings where token_hash='${tokenHash(token)}'`) === utc(D.wed.at('10:00')));

  const ics = await (await ctx.request.get(`${BASE}/api/ics/${token}`)).text();
  check('calendar file downloads', ics.includes('BEGIN:VEVENT') && ics.includes('SUMMARY:30 Minute Meeting with Avi Tester'));

  await page.click('text=Reschedule');
  await page.waitForURL('**/reschedule');
  await page.waitForSelector('ul[aria-label="Available times"] button');
  await pickDay(page, D.thu.at('12:00'));
  await page.click('ul[aria-label="Available times"] button:text-is("2:30 PM")');
  await page.click('button:text-is("Confirm")');
  await page.waitForSelector('text=Your meeting was moved');
  check('moved, remembering the old time', sql(`select to_char(start_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS".000Z"') || '|' || (previous_start_at is not null)::text || '|' || sequence from bookings where token_hash='${tokenHash(token)}'`) === `${utc(D.thu.at('14:30'))}|true|1`);

  await page.click('a:has-text("Cancel")');
  await page.waitForURL('**/cancel');
  await page.fill('#reason', 'Something came up');
  await page.click('button:has-text("Cancel meeting")');
  await page.waitForSelector('text=This meeting was cancelled');
  check('cancelled by the invitee with a reason', sql(`select status || '|' || cancelled_by || '|' || cancel_reason from bookings where token_hash='${tokenHash(token)}'`) === 'cancelled|invitee|Something came up');
  check('a cancelled booking can no longer be changed', (await page.locator('text=Reschedule').count()) === 0);
  check('no browser errors along the way', errors.length === 0, JSON.stringify(errors));

  await browser.close();
  finish();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
