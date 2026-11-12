// Google Calendar, against a stand-in for Google's servers (mocks.js): the
// one-click sign-in (app settings come from environment variables), token
// refresh, busy times, creating the event with a Meet link, moving it,
// deleting it, an outage; then a second Google account checked alongside the
// first, a meeting type that saves to it, an expired sign-in and a reconnect.
const { chromium, BASE, D, utc, check, finish, daySlots, mock, sql, reset, admin, visitor, book, pickDay, offered, shot, tokenHash } = require('./lib');

const MINIMAL_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.freebusy',
  'https://www.googleapis.com/auth/calendar.events',
];

(async () => {
  await reset();
  const browser = await chromium.launch();
  const { page } = await admin(browser);
  console.log('Google Calendar');

  await page.goto(`${BASE}/admin/calendars`);
  await page.waitForSelector('text=Nothing connected yet');
  check('the page offers Connect Google, Outlook / Microsoft 365 and iCloud, plus a link option', (await page.locator('#connect >> text=Connect Google').count()) === 1 && (await page.locator('#connect >> text=Connect Outlook / Microsoft 365').count()) === 1 && (await page.locator('#connect >> text=Connect iCloud').count()) === 1 && (await page.locator('text=Add by .ics link').count()) === 1);
  check('no app credentials can be typed into the page', (await page.locator('input[name=clientId], input[name=clientSecret], #google-id, #google-secret').count()) === 0);
  await shot(page, 'calendars-empty', true);

  // One click: straight to Google's sign-in and back.
  await page.click('#connect >> text=Connect Google');
  await page.waitForURL('**/admin/calendars?connected=*');
  await page.waitForSelector('[data-account="avi@gmail.test"]');
  let state = await mock('/state');
  const consent = state.google.authQuery;
  check('the button goes straight to Google with the app settings from the environment', consent.client_id === 'test-client-id.apps.googleusercontent.com');
  check('Google shows its account picker (and the consent that yields a refresh token)', consent.prompt.split(' ').includes('select_account') && consent.prompt.split(' ').includes('consent') && consent.access_type === 'offline');
  check('only the calendar scopes Calendi needs are requested', JSON.stringify(consent.scope.split(' ').sort()) === JSON.stringify([...MINIMAL_SCOPES].sort()), consent.scope);
  check('redirect address is this app', consent.redirect_uri === `${BASE}/api/oauth/google/callback` && state.google.tokenCalls[0].redirect_uri === consent.redirect_uri);
  check('code exchanged using the client secret from the environment', state.google.tokenCalls[0].code === 'g-code:avi@gmail.test' && state.google.tokenCalls[0].client_secret === 'test-secret');
  const credentials = sql("select credentials from calendar_accounts where provider='google'");
  check('tokens are encrypted in the database', credentials.startsWith('v1.') && !credentials.includes('g-refresh'));
  check('three calendars listed', sql('select count(*) from calendars') === '3');
  check('every calendar starts with "check for conflicts" on', sql('select count(*) from calendars where check_conflicts') === '3');
  check('the main calendar of the first account is where new bookings go', sql('select name from calendars where is_booking_target') === 'avi@gmail.test');
  check('a read-only holiday calendar cannot receive bookings', sql("select can_write::text from calendars where name like 'Holidays%'") === 'false' && (await page.locator('[data-calendar="Holidays in United States"] >> text=Read-only').count()) === 1);
  check('the account shows its email and a Connected state', (await page.locator('[data-account="avi@gmail.test"] >> text=Connected').count()) === 1);
  await shot(page, 'calendars-one-account', true);

  // The owner switches the holiday calendar off.
  await page.click('button[aria-label="Check Holidays in United States for conflicts"]');
  await page.waitForFunction(() => document.querySelector('button[aria-label="Check Holidays in United States for conflicts"]')?.getAttribute('aria-checked') === 'false');
  for (let i = 0; i < 20 && sql("select check_conflicts::text from calendars where name like 'Holidays%'") !== 'false'; i++) await page.waitForTimeout(100);
  check('a calendar can be switched off', sql("select check_conflicts::text from calendars where name like 'Holidays%'") === 'false');

  // Monday: busy on the primary 10:00-11:00; something on the unchecked
  // holiday calendar at noon; something on the second calendar at 2:00.
  await mock('/google/event', { calendarId: 'avi@gmail.test', start: utc(D.mon.at('10:00')), end: utc(D.mon.at('11:00')) });
  await mock('/google/event', { calendarId: 'holidays@group.v.calendar.google.com', start: utc(D.mon.at('12:00')), end: utc(D.mon.at('13:00')) });
  await mock('/google/event', { calendarId: 'family@group.calendar.google.com', start: utc(D.mon.at('14:00')), end: utc(D.mon.at('14:30')) });
  const monday = await daySlots(D.mon);
  check('primary calendar event blocks 10:00 and 10:30', !monday.times.includes('10:00') && !monday.times.includes('10:30') && monday.times.includes('11:00'), JSON.stringify(monday.times));
  check('a switched-off calendar does not block', monday.times.includes('12:00') && monday.times.includes('12:30'));
  check('a second checked calendar does block', !monday.times.includes('14:00') && monday.times.includes('14:30'));
  state = await mock('/state');
  check('the expired access token was refreshed', state.google.tokenCalls.some((call) => call.grant_type === 'refresh_token'));
  check('Google was asked only about checked calendars', state.google.lastFreeBusy.items.length === 2);

  await page.goto(`${BASE}/admin/event-types`);
  await page.click('a:has-text("Edit")');
  await page.waitForSelector('#location_type');
  await page.selectOption('#location_type', 'google_meet');
  check('no warning: bookings already go to a Google calendar', (await page.locator('text=Google Meet links are created when').count()) === 0);
  await page.click('button:has-text("Save changes")');
  await page.waitForURL('**/admin/event-types');

  const guest = await visitor(browser);
  const token = await book(guest.page, { day: D.mon, time: '11:00 AM' });
  await guest.page.waitForSelector('text=A calendar invitation has been sent to jane@example.com');
  await guest.page.waitForSelector('a:has-text("https://meet.google.test/gev-")');
  await shot(guest.page, 'public-confirmed-google');
  check('confirmation shows the Meet link and that Google sent the invitation', true);
  state = await mock('/state');
  const event = state.google.events.find((e) => e.id.startsWith('gev-'));
  check('event created on the primary calendar at the right time', event.calendarId === 'avi@gmail.test' && event.start === utc(D.mon.at('11:00')) && event.end === utc(D.mon.at('11:30')), JSON.stringify([event.calendarId, event.start, event.end]));
  check('invitee is an attendee and Google is told to email them', event.input.attendees[0].email === 'jane@example.com' && event.query.sendUpdates === 'all');
  check('a Meet link was requested', event.input.conferenceData.createRequest.conferenceSolutionKey.type === 'hangoutsMeet' && event.query.conferenceDataVersion === '1');
  check('the description carries reschedule and cancel links', event.input.description.includes(`/booking/${token}/reschedule`) && event.input.description.includes(`/booking/${token}/cancel`));
  check('the title names both people', event.input.summary === '30 Minute Meeting: Jane Invitee and Avi Tester', event.input.summary);
  check('the booking records where it was saved', sql(`select external_event_id || '|' || invited_by_calendar::text || '|' || meeting_url || '|' || sync_error from bookings where token_hash='${tokenHash(token)}'`) === `${event.id}|true|https://meet.google.test/${event.id}|`);
  const after = await daySlots(D.mon);
  check('the booked slot is gone for the next visitor', !after.times.includes('11:00') && after.times.includes('11:30'));

  // Rescheduling: the booking's own Google event must not block its neighbours.
  await guest.page.goto(`${BASE}/booking/${token}/reschedule`);
  await guest.page.waitForSelector('ul[aria-label="Available times"] button');
  await pickDay(guest.page, D.mon.at('12:00'));
  const labels = await offered(guest.page);
  check('its own time is not offered, but the adjacent 11:30 is', !labels.includes('11:00 AM') && labels.includes('11:30 AM'), JSON.stringify(labels));
  await guest.page.click('ul[aria-label="Available times"] button:text-is("3:00 PM")');
  await guest.page.click('button:text-is("Confirm")');
  await guest.page.waitForSelector('text=Your meeting was moved');
  state = await mock('/state');
  const moved = state.google.events.find((e) => e.id === event.id);
  check('the Google event was moved in place and attendees told', moved.start === utc(D.mon.at('15:00')) && moved.patched === 1 && moved.patchQuery.sendUpdates === 'all', JSON.stringify([moved.start, moved.patched]));
  const freed = await daySlots(D.mon);
  check('the old time is free again and the new one is taken', freed.times.includes('11:00') && !freed.times.includes('15:00'));

  await guest.page.goto(`${BASE}/booking/${token}/cancel`);
  await guest.page.click('button:has-text("Cancel meeting")');
  await guest.page.waitForSelector('text=This meeting was cancelled');
  state = await mock('/state');
  check('the Google event was deleted and attendees told', !state.google.events.some((e) => e.id === event.id) && state.google.deleted[0].query.sendUpdates === 'all');
  check('the cancelled time is bookable again', (await daySlots(D.mon)).times.includes('15:00'));

  await mock('/google/set', { failFreeBusy: true });
  check('during a Google outage, times are withheld rather than guessed', (await daySlots(D.mon)).status === 503);
  await mock('/google/set', { failFreeBusy: false });
  check('and return when Google does', (await daySlots(D.mon)).status === 200);

  console.log('A second Google account');
  await mock('/google/set', { nextAccount: 'work@company.test' });
  await page.goto(`${BASE}/admin/calendars`);
  await page.click('#connect >> text=Connect Google');
  await page.waitForURL('**/admin/calendars?connected=*');
  await page.waitForSelector('[data-account="work@company.test"]');
  check('the same button added a second Google account', sql("select count(*) from calendar_accounts where provider='google'") === '2' && (await page.locator('[data-account="avi@gmail.test"]').count()) === 1);
  check('the success message names the account', (await page.locator('text=Connected work@company.test').count()) === 1);
  check("the second account's main calendar is checked for conflicts", sql("select check_conflicts::text from calendars where external_id='work@company.test'") === 'true');
  check('a calendar Google cannot report busy times for was switched off instead of pausing bookings', sql("select check_conflicts::text from calendars where name='Birthdays'") === 'false');
  check('new bookings still go to the first account by default', sql('select name from calendars where is_booking_target') === 'avi@gmail.test');
  await shot(page, 'calendars-two-accounts', true);

  await mock('/google/event', { calendarId: 'work@company.test', start: utc(D.tue.at('09:00')), end: utc(D.tue.at('10:00')) });
  await mock('/google/event', { calendarId: 'avi@gmail.test', start: utc(D.tue.at('13:00')), end: utc(D.tue.at('14:00')) });
  const tuesday = await daySlots(D.tue);
  check('both accounts are checked for conflicts', !tuesday.times.includes('09:00') && !tuesday.times.includes('09:30') && !tuesday.times.includes('13:00') && !tuesday.times.includes('13:30') && tuesday.times.includes('10:00') && tuesday.times.includes('14:00'), JSON.stringify(tuesday.times));
  state = await mock('/state');
  const asked = new Set(state.google.freeBusyCalls.slice(-2).map((call) => call.account));
  check('each account was asked with its own sign-in', asked.has('avi@gmail.test') && asked.has('work@company.test'));

  // One meeting type saves its bookings to the second account.
  const typeId = sql("select id from event_types where slug='30min'");
  const workCalendar = sql("select id from calendars where external_id='work@company.test'");
  await page.selectOption('select[aria-label="Calendar for 30 Minute Meeting"]', workCalendar);
  for (let i = 0; i < 30 && sql(`select coalesce(calendar_id::text, '') from event_types where id='${typeId}'`) !== workCalendar; i++) await page.waitForTimeout(100);
  check('a meeting type can pick its own calendar', sql(`select coalesce(calendar_id::text, '') from event_types where id='${typeId}'`) === workCalendar);
  const second = await visitor(browser);
  await book(second.page, { day: D.tue, time: '11:00 AM', name: 'Sam Second', email: 'sam@example.com' });
  state = await mock('/state');
  const routed = state.google.events.find((e) => e.input?.attendees?.[0]?.email === 'sam@example.com');
  check("that type's booking lands on the second account's calendar", routed && routed.calendarId === 'work@company.test' && routed.account === 'work@company.test', JSON.stringify(routed && [routed.calendarId, routed.account]));

  console.log('An expired sign-in, and reconnecting');
  await mock('/google/set', { revoked: ['work@company.test'] });
  check('when one account stops working, times are withheld', (await daySlots(D.wed)).status === 503);
  await page.goto(`${BASE}/admin/calendars`);
  const broken = page.locator('[data-account="work@company.test"]');
  await broken.locator('text=Not syncing').waitFor();
  check('the account shows a clear "Not syncing" state with the reason', (await broken.locator('text=sign-in may have expired').count()) === 1 && (await broken.locator('text=expired or revoked').count()) === 1);
  check('the other account still shows as connected', (await page.locator('[data-account="avi@gmail.test"] >> text=Connected').count()) === 1);
  await shot(page, 'calendars-expired', true);
  await broken.locator('a:has-text("Reconnect")').click();
  await page.waitForURL('**/admin/calendars?connected=*');
  state = await mock('/state');
  check('Reconnect goes back to Google with that account pre-selected', state.google.authQuery.login_hint === 'work@company.test');
  check('reconnecting updates the account instead of adding another', sql("select count(*) from calendar_accounts where provider='google'") === '2' && sql("select status from calendar_accounts where label='work@company.test'") === 'ok');
  check('and times are offered again', (await daySlots(D.wed)).status === 200);

  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('[data-account="work@company.test"] button:has-text("Remove")').click();
  await page.waitForSelector('[data-account="work@company.test"]', { state: 'detached' });
  check('removing the account frees the meeting type to use the default calendar again', sql(`select coalesce(calendar_id::text, 'none') from event_types where id='${typeId}'`) === 'none');

  await browser.close();
  finish();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
