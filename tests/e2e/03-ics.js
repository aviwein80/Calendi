// A calendar added by subscription link (.ics): busy events, repeating
// events and all-day events block times, and a broken feed pauses booking
// instead of offering times that might be taken.
const { chromium, BASE, D, compact, icsDate, icsLocal, check, finish, daySlots, mock, sql, reset, admin, visitor, shot } = require('./lib');

(async () => {
  await reset();
  const browser = await chromium.launch();
  const { page } = await admin(browser);
  console.log('Calendar feed (ICS)');

  await mock('/feed', {
    status: 200,
    body: [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-CALNAME:Family Feed',
      // Thursday, 9:00-10:00 New York.
      'BEGIN:VEVENT', 'UID:one', `DTSTART:${compact(D.thu.at('09:00'))}`, `DTEND:${compact(D.thu.at('10:00'))}`, 'SUMMARY:Dentist', 'END:VEVENT',
      // Every Tuesday 10:00-10:30 New York, started six weeks earlier.
      'BEGIN:VEVENT', 'UID:two', `DTSTART;TZID=America/New_York:${icsLocal(D.tue.plus(-42).at('10:00'))}`, `DTEND;TZID=America/New_York:${icsLocal(D.tue.plus(-42).at('10:30'))}`, 'RRULE:FREQ=WEEKLY;BYDAY=TU', 'SUMMARY:Standup', 'END:VEVENT',
      // All day Friday but marked free: must not block.
      'BEGIN:VEVENT', 'UID:three', `DTSTART;VALUE=DATE:${icsDate(D.fri)}`, `DTEND;VALUE=DATE:${icsDate(D.fri.plus(1))}`, 'TRANSP:TRANSPARENT', 'SUMMARY:Birthday', 'END:VEVENT',
      // All day the following Thursday and busy: blocks that day.
      'BEGIN:VEVENT', 'UID:four', `DTSTART;VALUE=DATE:${icsDate(D.thu2)}`, `DTEND;VALUE=DATE:${icsDate(D.thu2.plus(1))}`, 'SUMMARY:Out of office', 'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n'),
  });

  await page.goto(`${BASE}/admin/calendars`);
  await page.click('text=Add by .ics link');
  await page.waitForSelector('#ics-url');
  await page.fill('#ics-url', 'not a url');
  await page.click('button:has-text("Add calendar")');
  await page.waitForSelector('text=does not look like a web address');
  check('a bad link is rejected with a clear message', true);
  await page.fill('#ics-url', 'http://localhost:4001/feed.ics');
  await page.click('button:has-text("Add calendar")');
  await page.waitForSelector('text=Family Feed');
  check('feed added and named from the file', true);
  await shot(page, 'calendars-feed', true);
  check('a feed is read-only, so it is not chosen for new bookings', sql('select count(*) from calendars where is_booking_target') === '0');

  const thu = await daySlots(D.thu);
  check('one-off event blocks 9:00 and 9:30', !thu.times.includes('09:00') && !thu.times.includes('09:30') && thu.times.includes('10:00'), JSON.stringify(thu.times));
  const tue = await daySlots(D.tue);
  check('weekly event blocks 10:00 only', !tue.times.includes('10:00') && tue.times.includes('10:30') && tue.times.includes('09:30'), JSON.stringify(tue.times));
  check('an all-day event marked free does not block', (await daySlots(D.fri)).times.length === 16);
  check('an all-day busy event blocks the whole day', (await daySlots(D.thu2)).times.length === 0);

  // The feed breaks: availability must refuse, and the admin must say why.
  await mock('/feed', { status: 500 });
  const down = await daySlots(D.thu);
  check('broken feed: times are withheld (503) instead of guessed', down.status === 503 && down.error === 'calendar_unavailable', JSON.stringify(down));
  await page.goto(`${BASE}/admin/calendars`);
  await page.waitForSelector('text=Not syncing');
  check('the Calendars page reports it', (await page.locator('text=your booking pages are paused').count()) === 1);
  await page.goto(`${BASE}/admin/event-types`);
  check('the event types page warns too', (await page.locator('text=stopped syncing').count()) > 0);
  const pub = await visitor(browser);
  await pub.page.goto(`${BASE}/30min`);
  await pub.page.waitForSelector('text=could not be loaded right now');
  check('the public page says times could not be loaded (not "no times")', true);

  await mock('/feed', { status: 200 });
  const back = await daySlots(D.thu);
  check('feed restored: times return', back.status === 200 && back.times.includes('10:00'));
  check('and the warning clears by itself', sql("select status from calendar_accounts where provider='ics'") === 'ok');

  await browser.close();
  finish();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
