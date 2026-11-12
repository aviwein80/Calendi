// Outlook / Microsoft 365, against a stand-in for Microsoft Graph (mocks.js):
// sign-in, rotating refresh tokens, busy / free / tentative / all-day events,
// paged results, Teams links, and the owner cancelling from the admin.
const { chromium, BASE, D, utc, check, finish, daySlots, mock, sql, reset, admin, visitor, book, pickDay, shot, tokenHash } = require('./lib');

(async () => {
  await reset();
  const browser = await chromium.launch();
  const { page } = await admin(browser);
  console.log('Outlook / Microsoft 365');

  await page.goto(`${BASE}/admin/calendars`);
  await page.click('#connect >> text=Connect Outlook / Microsoft 365');
  await page.waitForURL('**/admin/calendars?connected=*');
  await page.waitForSelector('[data-account="avi@outlook.test"]');
  await shot(page, 'calendars-microsoft', true);
  let state = await mock('/state');
  const consent = state.microsoft.authQuery;
  check('one click goes straight to Microsoft, with the app settings from the environment', consent.client_id === 'ms-client-id' && state.microsoft.tokenCalls[0].client_secret === 'ms-secret');
  check('Microsoft shows its account picker', consent.prompt === 'select_account');
  check('consent asks for offline_access and Calendars.ReadWrite', consent.scope.includes('offline_access') && consent.scope.includes('Calendars.ReadWrite'));
  check('redirect address is this app', consent.redirect_uri === `${BASE}/api/oauth/microsoft/callback`);
  check('the default calendar is chosen for new bookings', sql('select name from calendars where is_booking_target') === 'Calendar');
  check('the read-only Birthdays calendar is checked by default too, and cannot take bookings', sql("select check_conflicts::text || can_write::text from calendars where name='Birthdays'") === 'truefalse');

  const add = (data) => mock('/microsoft/event', { calendarId: 'cal-default', ...data });
  await add({ start: utc(D.tue.at('10:00')), end: utc(D.tue.at('11:00')) });
  await add({ start: utc(D.tue.at('12:00')), end: utc(D.tue.at('13:00')), showAs: 'free' });
  await add({ start: utc(D.tue.at('14:00')), end: utc(D.tue.at('14:30')), showAs: 'tentative' });
  // All-day events arrive from Graph as midnight-to-midnight UTC dates.
  await add({ start: `${D.wed.iso}T00:00:00Z`, end: `${D.wed.plus(1).iso}T00:00:00Z`, isAllDay: true, showAs: 'oof' });
  const tuesday = await daySlots(D.tue);
  check('a busy event blocks 10:00-11:00', !tuesday.times.includes('10:00') && !tuesday.times.includes('10:30') && tuesday.times.includes('11:00'), JSON.stringify(tuesday.times));
  check('an event marked free does not block', tuesday.times.includes('12:00') && tuesday.times.includes('12:30'));
  check('a tentative event blocks (and was on a later page of results)', !tuesday.times.includes('14:00') && tuesday.times.includes('14:30'));
  check('an all-day out-of-office blocks the whole local day', (await daySlots(D.wed)).times.length === 0);
  check('and only that day', (await daySlots(D.thu)).times.length === 16);
  state = await mock('/state');
  check('Graph was asked for UTC times', state.microsoft.apiCalls.some((call) => call.path.includes('calendarView') && call.prefer === 'outlook.timezone="UTC"'));
  const refreshes = state.microsoft.tokenCalls.filter((call) => call.grant_type === 'refresh_token');
  check('each rotated refresh token was saved and used exactly once', refreshes.length >= 1 && new Set(refreshes.map((call) => call.refresh_token)).size === refreshes.length, JSON.stringify(refreshes.map((call) => call.refresh_token)));

  await page.goto(`${BASE}/admin/event-types`);
  await page.click('a:has-text("Edit")');
  await page.waitForSelector('#location_type');
  await page.selectOption('#location_type', 'google_meet');
  await page.waitForSelector('text=Google Meet links are created when');
  check('choosing Google Meet without a Google calendar shows a warning', true);
  await page.selectOption('#location_type', 'teams');
  check('Teams shows no warning', (await page.locator('text=Teams links are created when').count()) === 0);
  await page.click('button:has-text("Save changes")');
  await page.waitForURL('**/admin/event-types');

  const guest = await visitor(browser);
  const token = await book(guest.page, { day: D.tue, time: '11:30 AM' });
  await guest.page.waitForSelector('a:has-text("https://teams.test/msev-")');
  await guest.page.waitForSelector('text=A calendar invitation has been sent to jane@example.com');
  state = await mock('/state');
  const event = state.microsoft.events.find((e) => e.id.startsWith('msev-'));
  const graphTime = (dt) => utc(dt).replace('.000Z', '');
  check('event created with the right UTC time', event.input.start.dateTime === graphTime(D.tue.at('11:30')) && event.input.start.timeZone === 'UTC' && event.input.end.dateTime === graphTime(D.tue.at('12:00')), JSON.stringify(event.input.start));
  check('the invitee is a required attendee', event.input.attendees[0].emailAddress.address === 'jane@example.com' && event.input.attendees[0].type === 'required');
  check('a Teams meeting was requested', event.input.isOnlineMeeting === true && event.input.onlineMeetingProvider === 'teamsForBusiness');
  check('the body is HTML and carries the manage links', event.input.body.contentType === 'HTML' && event.input.body.content.includes(`/booking/${token}/cancel`) && event.input.body.content.includes('<br>'));

  await guest.page.goto(`${BASE}/booking/${token}/reschedule`);
  await guest.page.waitForSelector('ul[aria-label="Available times"] button');
  await pickDay(guest.page, D.tue.at('12:00'));
  await guest.page.click('ul[aria-label="Available times"] button:text-is("12:00 PM")');
  await guest.page.click('button:text-is("Confirm")');
  await guest.page.waitForSelector('text=Your meeting was moved');
  state = await mock('/state');
  const moved = state.microsoft.events.find((e) => e.id === event.id);
  check('the event was moved in place', moved.start === utc(D.tue.at('12:00')).replace('.000Z', 'Z') && moved.patched === 1, JSON.stringify([moved.start, moved.patched]));

  // The owner cancels from the admin.
  await page.goto(`${BASE}/admin/bookings`);
  await page.click('summary:has-text("Jane Invitee")');
  await shot(page, 'admin-bookings', true);
  await page.click('button:has-text("Cancel booking")');
  await page.fill('textarea', 'Double booked, sorry');
  await page.click('button:has-text("Cancel this booking")');
  await page.waitForSelector('text=No upcoming bookings');
  state = await mock('/state');
  check('Graph "cancel" was used, so attendees are notified', state.microsoft.cancelled[0].id === event.id && state.microsoft.cancelled[0].via === 'cancel');
  check('the booking is marked cancelled by the host, with the reason', sql(`select status || '|' || cancelled_by || '|' || cancel_reason from bookings where token_hash='${tokenHash(token)}'`) === 'cancelled|host|Double booked, sorry');
  await guest.page.goto(`${BASE}/booking/${token}`);
  await guest.page.waitForSelector('text=Reason: Double booked, sorry');
  check("the invitee's page shows the cancellation and reason", true);

  await browser.close();
  finish();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
