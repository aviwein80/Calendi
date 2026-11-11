// CalDAV (how Apple iCloud, Fastmail and Nextcloud are connected), against a
// real local CalDAV server (Radicale). Because CalDAV calendars do not send
// invitations themselves, this is also where Calendi's own emails and the
// webhook are checked, along with custom questions, guests and buffers.
const crypto = require('crypto');
const { chromium, BASE, D, compact, icsLocal, check, finish, daySlots, mock, sql, reset, admin, visitor, book, pickDay, offered, shot, tokenHash } = require('./lib');

const CALDAV = process.env.E2E_CALDAV_URL || 'http://127.0.0.1:5232';
const dav = (method, path, body) =>
  fetch(`${CALDAV}${path}`, {
    method,
    headers: {
      Authorization: 'Basic ' + Buffer.from('avi:secret').toString('base64'),
      'Content-Type': 'text/calendar',
      Depth: '1',
    },
    body,
  });
const vevent = (lines) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN', 'BEGIN:VEVENT', 'DTSTAMP:20260101T000000Z', ...lines, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');

(async () => {
  await reset();
  const listing = await (await dav('PROPFIND', '/avi/work/')).text();
  for (const match of listing.matchAll(/<href>(\/avi\/work\/[^<]+\.ics)<\/href>/g)) await dav('DELETE', match[1]);

  const browser = await chromium.launch();
  const { page } = await admin(browser);
  console.log('CalDAV, email and webhook');

  await page.goto(`${BASE}/admin/calendars`);
  await page.click('summary:text-is("Connect")');
  await page.selectOption('#caldav-preset', 'other');
  await page.fill('#caldav-url', `${CALDAV}/`);
  await page.fill('#caldav-user', 'avi');
  await page.fill('#caldav-pass', 'wrong-password');
  await page.click('form:has(#caldav-user) button[type=submit]');
  await page.waitForSelector('text=rejected the username or password');
  check('a wrong password is rejected with a clear message', true);
  check('nothing is saved for the failed attempt, and the form keeps its values', sql('select count(*) from calendar_accounts') === '0' && (await page.inputValue('#caldav-user')) === 'avi');
  await page.fill('#caldav-pass', 'secret');
  await page.click('form:has(#caldav-user) button[type=submit]');
  await page.waitForSelector('text=Bookings saved here');
  await shot(page, 'calendars-caldav', true);
  check('the "Work" calendar is found and chosen for bookings', sql("select name || '|' || is_booking_target::text from calendars") === 'Work|true');
  const stored = sql('select credentials from calendar_accounts');
  check('the password is encrypted in the database', stored.startsWith('v1.') && !stored.includes('secret'));

  // Events made in the calendar app: lunch on Friday, and a weekly Friday gym slot.
  await dav('PUT', '/avi/work/lunch.ics', vevent(['UID:lunch', `DTSTART;TZID=America/New_York:${icsLocal(D.fri.at('13:00'))}`, `DTEND;TZID=America/New_York:${icsLocal(D.fri.at('14:00'))}`, 'SUMMARY:Lunch']));
  await dav('PUT', '/avi/work/gym.ics', vevent(['UID:gym', `DTSTART;TZID=America/New_York:${icsLocal(D.fri.plus(-49).at('16:00'))}`, `DTEND;TZID=America/New_York:${icsLocal(D.fri.plus(-49).at('17:00'))}`, 'RRULE:FREQ=WEEKLY;BYDAY=FR', 'SUMMARY:Gym']));
  const friday = await daySlots(D.fri);
  check('a CalDAV event blocks 13:00-14:00', !friday.times.includes('13:00') && !friday.times.includes('13:30') && friday.times.includes('14:00'), JSON.stringify(friday.times));
  check('a weekly CalDAV event blocks 16:00 and 16:30', !friday.times.includes('16:00') && !friday.times.includes('16:30') && friday.times.includes('15:30'));

  // Email (through a stand-in for Resend) and the webhook.
  await page.goto(`${BASE}/admin/settings`);
  await page.selectOption('#provider', 'resend');
  await page.fill('#from', 'meetings@example.com');
  await page.fill('#resendApiKey', 're_test_key');
  await page.locator('form:has(#provider) button[type=submit]').click();
  await page.waitForSelector('form:has(#provider) >> text=Saved.');
  await page.click('button:has-text("Send me a test")');
  await page.waitForSelector('text=Sent to owner@example.com');
  let state = await mock('/state');
  check('the test email went out through Resend', state.emails.length === 1 && state.emails[0].auth === 'Bearer re_test_key' && state.emails[0].to[0] === 'owner@example.com' && state.emails[0].from === '"Avi Tester" <meetings@example.com>');
  check('the API key is encrypted in the database', !sql('select integrations from owner').includes('re_test_key'));

  await page.fill('#webhook_url', 'http://localhost:4001/hook');
  await page.locator('form:has(#webhook_url) button[type=submit]').click();
  await page.waitForSelector('form:has(#webhook_url) >> text=Saved.');
  await page.click('button:has-text("Send a test")');
  await page.waitForSelector('text=Test sent.');
  await page.click('summary:has-text("Verifying requests")');
  const secret = (await page.locator('details:has-text("Verifying requests") code').last().textContent()).trim();
  state = await mock('/state');
  const hook = state.webhooks[0];
  check('the test webhook arrived with a valid signature', hook.body.event === 'test' && hook.headers['x-calendi-signature'] === 'sha256=' + crypto.createHmac('sha256', secret).update(hook.raw).digest('hex'));
  await shot(page, 'admin-settings', true);

  // An event type with questions, guests, a phone call and a buffer.
  await page.goto(`${BASE}/admin/event-types/new`);
  await page.fill('#name', 'Discovery Call');
  check('the link is suggested from the name', (await page.inputValue('#slug')) === 'discovery-call');
  await page.selectOption('#duration', '45');
  await page.selectOption('#location_type', 'phone');
  await page.selectOption('#buffer_after', '15');
  await page.click('button:has-text("Add question")');
  await page.fill('input[aria-label="Question"]', 'What is this about?');
  await page.check('text=Required');
  await page.click('button:has-text("Add question")');
  await page.locator('input[aria-label="Question"]').nth(1).fill('Team size');
  await page.locator('select[aria-label="Answer type"]').nth(1).selectOption('select');
  await page.fill('input[aria-label="Options"]', '1-10, 11-50, 51+');
  await page.check('text=Let invitees add guests');
  await page.click('button:has-text("Create event type")');
  await page.waitForURL('**/admin/event-types');
  await page.waitForSelector('text=Discovery Call');
  check('the event type is saved', sql("select duration_minutes || '|' || location_type || '|' || buffer_after_minutes || '|' || jsonb_array_length(questions) from event_types where slug='discovery-call'") === '45|phone|15|2');

  const guest = await visitor(browser);
  await guest.page.goto(`${BASE}/discovery-call`);
  await guest.page.waitForSelector('ul[aria-label="Available times"] button');
  await pickDay(guest.page, D.fri.at('12:00'));
  const labels = await offered(guest.page);
  // 45 minutes plus 15 clear afterwards must fit before lunch at 1:00.
  check('45-minute slots respect the buffer before the 1:00 event', labels.includes('12:00 PM') && !labels.includes('12:30 PM'), JSON.stringify(labels));
  const token = await book(guest.page, {
    slug: 'discovery-call',
    day: D.fri,
    time: '10:00 AM',
    fill: async (p) => {
      await p.fill('#phone', '+1 (410) 555-0100');
      await p.click('button:has-text("Add guests")');
      await p.fill('#guests', 'bob@example.com, jane@example.com');
      await p.locator('input[id^="q_"]').first().fill('Marketing automation');
      await p.locator('select[id^="q_"]').selectOption('11-50');
      await p.fill('#notes', 'See you then; bring "the deck", ok?');
    },
  });
  await guest.page.waitForSelector('text=A confirmation has been sent to jane@example.com');
  const id = sql(`select id from bookings where token_hash='${tokenHash(token)}'`);
  const saved = await dav('GET', `/avi/work/${id}.ics`);
  const ics = await saved.text();
  check('the booking is saved into the CalDAV calendar', saved.status === 200 && ics.includes(`DTSTART:${compact(D.fri.at('10:00'))}`) && ics.includes(`DTEND:${compact(D.fri.at('10:45'))}`), ics.slice(0, 300));
  check('the calendar entry has the details but no attendee lines', ics.includes('SUMMARY:Discovery Call: Jane Invitee and Avi Tester') && ics.replace(/\r\n /g, '').includes('Marketing automation') && !ics.includes('ATTENDEE'));
  check('guest list excludes the invitee themself; phone is kept', sql(`select invited_by_calendar::text || '|' || guests::text || '|' || invitee_phone || '|' || sync_error from bookings where token_hash='${tokenHash(token)}'`) === 'false|["bob@example.com"]|+1 (410) 555-0100|');
  state = await mock('/state');
  const toInvitee = state.emails.find((m) => m.to.includes('jane@example.com'));
  const toOwner = state.emails.find((m) => m.subject === 'New booking: Jane Invitee');
  const when = `10:00 AM – 10:45 AM, ${D.fri.at('10:00').toFormat('cccc, LLLL d, yyyy')}`;
  check('invitee and guest get a confirmation with a calendar file', toInvitee.to.includes('bob@example.com') && toInvitee.subject === 'Confirmed: Discovery Call with Avi Tester' && toInvitee.attachments[0].filename === 'invite.ics' && Buffer.from(toInvitee.attachments[0].content, 'base64').toString().includes(`DTSTART:${compact(D.fri.at('10:00'))}`));
  check("the invitee's email shows their local time and the manage links", toInvitee.text.includes(when) && toInvitee.text.includes(`/booking/${token}/reschedule`) && toInvitee.reply_to === 'owner@example.com', toInvitee.text);
  check('the owner is notified, with the answers', toOwner.text.includes('What is this about?: Marketing automation') && toOwner.text.includes('Team size: 11-50') && toOwner.text.includes('+1 (410) 555-0100') && toOwner.reply_to === 'jane@example.com', toOwner.text);
  const created = state.webhooks.find((w) => w.body.event === 'booking.created');
  check('the booking.created webhook carries the details', created.body.data.invitee.email === 'jane@example.com' && created.body.data.start === D.fri.at('10:00').toUTC().toISO() && created.body.data.answers.length === 2 && created.body.data.manage_url.endsWith(token));

  // The next visitor: the booked time and its buffer are gone, and required
  // questions are enforced on the server even if the browser check is removed.
  const second = await visitor(browser);
  await second.page.goto(`${BASE}/discovery-call`);
  await second.page.waitForSelector('ul[aria-label="Available times"] button');
  await pickDay(second.page, D.fri.at('12:00'));
  const after = await offered(second.page);
  check('the booked time and its 15-minute buffer are gone', !after.includes('10:00 AM') && !after.includes('10:30 AM') && after.includes('11:00 AM') && after.includes('9:00 AM'), JSON.stringify(after));
  await second.page.click('ul[aria-label="Available times"] button:text-is("11:00 AM")');
  await second.page.click('button:text-is("Next")');
  await second.page.fill('#name', 'No Answers');
  await second.page.fill('#email', 'x@example.com');
  await second.page.fill('#phone', '4105550100');
  await second.page.evaluate(() => document.querySelectorAll('[required]').forEach((el) => el.removeAttribute('required')));
  await second.page.click('text=Schedule meeting');
  await second.page.waitForSelector('text=Please answer "What is this about?"');
  check('a required question is enforced on the server', sql("select count(*) from bookings where invitee_name='No Answers'") === '0');

  // Reschedule and cancel reach CalDAV, email and the webhook too.
  await guest.page.goto(`${BASE}/booking/${token}/reschedule`);
  await guest.page.waitForSelector('ul[aria-label="Available times"] button');
  await pickDay(guest.page, D.fri.at('12:00'));
  await guest.page.click('ul[aria-label="Available times"] button:text-is("2:00 PM")');
  await guest.page.click('button:text-is("Confirm")');
  await guest.page.waitForSelector('text=Your meeting was moved');
  const movedIcs = await (await dav('GET', `/avi/work/${id}.ics`)).text();
  check('the CalDAV entry is moved', movedIcs.includes(`DTSTART:${compact(D.fri.at('14:00'))}`) && movedIcs.includes('SEQUENCE:1'), movedIcs.slice(0, 200));
  await guest.page.goto(`${BASE}/booking/${token}/cancel`);
  await guest.page.fill('#reason', 'Conflict');
  await guest.page.click('button:has-text("Cancel meeting")');
  await guest.page.waitForSelector('text=This meeting was cancelled');
  check('the CalDAV entry is removed', (await dav('GET', `/avi/work/${id}.ics`)).status === 404);
  state = await mock('/state');
  const events = state.webhooks.map((w) => w.body.event);
  check('webhooks were sent for created, rescheduled and cancelled', ['booking.created', 'booking.rescheduled', 'booking.cancelled'].every((e) => events.includes(e)), JSON.stringify(events));
  const rescheduled = state.webhooks.find((w) => w.body.event === 'booking.rescheduled');
  check('the reschedule webhook has the old and new times', rescheduled.body.data.previous_start === D.fri.at('10:00').toUTC().toISO() && rescheduled.body.data.start === D.fri.at('14:00').toUTC().toISO());
  const subjects = state.emails.map((m) => m.subject);
  check('emails were sent for the reschedule and the cancellation', subjects.includes('Rescheduled: Discovery Call with Avi Tester') && subjects.includes('Cancelled: Discovery Call with Avi Tester') && subjects.includes('Cancelled: Jane Invitee'), JSON.stringify(subjects));
  const cancelMail = state.emails.find((m) => m.subject === 'Cancelled: Discovery Call with Avi Tester');
  check('the cancellation email carries a CANCEL calendar file', Buffer.from(cancelMail.attachments[0].content, 'base64').toString().includes('METHOD:CANCEL'));

  const csv = await (await page.context().request.get(`${BASE}/admin/bookings/export`)).text();
  check('the CSV export includes the booking', csv.includes('"Discovery Call"') && csv.includes('"jane@example.com"') && csv.includes('"cancelled"'));
  check('the CSV export needs a session', (await fetch(`${BASE}/admin/bookings/export`, { redirect: 'manual' })).status === 307);

  await browser.close();
  finish();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
