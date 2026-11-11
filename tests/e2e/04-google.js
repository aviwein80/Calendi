// Google Calendar, against a stand-in for Google's servers (mocks.js): the
// sign-in round trip, token refresh, busy times, creating the event with a
// Meet link, moving it, deleting it, and an outage.
const { chromium, BASE, D, utc, check, finish, daySlots, mock, sql, reset, admin, visitor, book, pickDay, offered, shot, tokenHash } = require('./lib');

(async () => {
  await reset();
  const browser = await chromium.launch();
  const { page } = await admin(browser);
  console.log('Google Calendar');

  await page.goto(`${BASE}/admin/calendars`);
  check('no Connect button until app credentials are saved', (await page.locator('a:has-text("Connect Google")').count()) === 0);
  await page.fill('#google-id', 'test-client-id.apps.googleusercontent.com');
  await page.fill('#google-secret', 'test-secret');
  await page.locator('form:has(#google-id) button[type=submit]').click();
  await page.waitForSelector('a:has-text("Connect Google")');
  const integrations = sql('select integrations from owner');
  check('client secret is encrypted in the database', integrations.startsWith('v1.') && !integrations.includes('test-secret'));

  await page.click('a:has-text("Connect Google")');
  await page.waitForURL('**/admin/calendars?connected=1');
  await page.waitForSelector('text=avi@gmail.test');
  await shot(page, 'calendars-google', true);
  let state = await mock('/state');
  const consent = state.google.authQuery;
  check('consent request asks for offline access and calendar scopes', consent.access_type === 'offline' && consent.prompt === 'consent' && consent.scope.includes('calendar.events') && consent.scope.includes('calendar.readonly'));
  check('redirect address is this app', consent.redirect_uri === `${BASE}/api/oauth/google/callback` && state.google.tokenCalls[0].redirect_uri === consent.redirect_uri);
  check('code exchanged using the client secret', state.google.tokenCalls[0].code === 'g-code' && state.google.tokenCalls[0].client_secret === 'test-secret');
  const credentials = sql("select credentials from calendar_accounts where provider='google'");
  check('tokens are encrypted in the database', credentials.startsWith('v1.') && !credentials.includes('g-refresh'));
  check('three calendars listed', sql('select count(*) from calendars') === '3');
  check('the primary calendar is chosen for new bookings', sql('select name from calendars where is_booking_target') === 'avi@gmail.test');
  check('a read-only holiday calendar starts unchecked and cannot receive bookings', sql("select check_conflicts::text || can_write::text from calendars where name like 'Holidays%'") === 'falsefalse');

  // Monday: busy on the primary 10:00-11:00; something on the unchecked
  // holiday calendar at noon; something on the second calendar at 2:00.
  await mock('/google/event', { calendarId: 'avi@gmail.test', start: utc(D.mon.at('10:00')), end: utc(D.mon.at('11:00')) });
  await mock('/google/event', { calendarId: 'holidays@group.v.calendar.google.com', start: utc(D.mon.at('12:00')), end: utc(D.mon.at('13:00')) });
  await mock('/google/event', { calendarId: 'family@group.calendar.google.com', start: utc(D.mon.at('14:00')), end: utc(D.mon.at('14:30')) });
  const monday = await daySlots(D.mon);
  check('primary calendar event blocks 10:00 and 10:30', !monday.times.includes('10:00') && !monday.times.includes('10:30') && monday.times.includes('11:00'), JSON.stringify(monday.times));
  check('an unchecked calendar does not block', monday.times.includes('12:00') && monday.times.includes('12:30'));
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

  await browser.close();
  finish();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
