// Everything else: two people racing for one slot, another time zone on a
// phone, secret and switched-off links, prefill and embed, editing hours,
// branding, SMTP email, and sign-in security.
const { chromium, BASE, D, OWNER, utc, check, finish, daySlots, mock, sql, reset, admin, visitor, book, pickDay, offered, shot, api } = require('./lib');

(async () => {
  await reset();
  const browser = await chromium.launch();
  const { page } = await admin(browser);

  console.log('Two people, one slot');
  const first = await visitor(browser);
  const second = await visitor(browser);
  for (const [p, name] of [[first.page, 'Racer A'], [second.page, 'Racer B']]) {
    await p.goto(`${BASE}/30min`);
    await p.waitForSelector('ul[aria-label="Available times"] button');
    await pickDay(p, D.mon2.at('12:00'));
    await p.click('ul[aria-label="Available times"] button:text-is("9:00 AM")');
    await p.click('button:text-is("Next")');
    await p.fill('#name', name);
    await p.fill('#email', `${name.replace(' ', '').toLowerCase()}@example.com`);
  }
  await Promise.all([first.page.click('text=Schedule meeting'), second.page.click('text=Schedule meeting')]);
  const settled = (p) => p.waitForFunction(() => /You are scheduled|no longer available/.test(document.body.innerText));
  await Promise.all([settled(first.page), settled(second.page)]);
  const outcomes = await Promise.all(
    [first.page, second.page].map((p) => p.evaluate(() => (/You are scheduled/.test(document.body.innerText) ? 'booked' : 'refused'))),
  );
  check('exactly one of two simultaneous bookings wins', outcomes.sort().join() === 'booked,refused', outcomes.join());
  check('only one booking is stored for that time', sql("select count(*) from bookings where status='confirmed'") === '1');
  let refused = false;
  try {
    const start = D.mon2.at('09:15').toUTC().toISO();
    const end = D.mon2.at('09:45').toUTC().toISO();
    sql(`insert into bookings (token_hash, event_name, start_at, end_at, invitee_name, invitee_email, invitee_timezone) values ('x', 'x', '${start}', '${end}', 'x', 'x@x.co', 'UTC')`);
  } catch {
    refused = true;
  }
  check('the database itself refuses an overlapping confirmed booking', refused);

  console.log('Another time zone, on a phone');
  const nineNy = D.tue2.at('09:00');
  const nineTokyo = nineNy.setZone('Asia/Tokyo').setLocale('en-US');
  const tokyo = await visitor(browser, 'Asia/Tokyo', { width: 390, height: 844 });
  await tokyo.page.goto(`${BASE}/30min`);
  await tokyo.page.waitForSelector('ul[aria-label="Available times"] button');
  check("the zone picker starts on the visitor's zone", (await tokyo.page.inputValue('#timezone')) === 'Asia/Tokyo');
  await pickDay(tokyo.page, nineTokyo);
  const evening = await offered(tokyo.page);
  check('a New York morning shows as that evening in Tokyo', evening.includes(nineTokyo.toFormat('h:mm a')) && !evening.includes('9:00 AM'), JSON.stringify(evening));
  await shot(tokyo.page, 'phone-picker', true);
  await tokyo.page.click('button[aria-pressed="false"]:text-is("24h")');
  check('the 24-hour switch works', (await offered(tokyo.page)).includes(nineTokyo.toFormat('HH:mm')));
  await tokyo.page.click(`ul[aria-label="Available times"] button:text-is("${nineTokyo.toFormat('HH:mm')}")`);
  await tokyo.page.click('button:text-is("Next")');
  await tokyo.page.fill('#name', 'Kenji Tokyo');
  await tokyo.page.fill('#email', 'kenji@example.jp');
  await shot(tokyo.page, 'phone-form', true);
  await tokyo.page.click('text=Schedule meeting');
  await tokyo.page.waitForSelector('text=You are scheduled');
  check('it is stored as the right instant', sql("select to_char(start_at at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\".000Z\"') || '|' || invitee_timezone from bookings where invitee_name='Kenji Tokyo'") === `${utc(nineNy)}|Asia/Tokyo`);
  const tokyoWhen = `${nineTokyo.toFormat('h:mm a')} – ${nineTokyo.plus({ minutes: 30 }).toFormat('h:mm a')}, ${nineTokyo.toFormat('cccc, LLLL d, yyyy')}`;
  check('the confirmation shows Tokyo time', (await tokyo.page.locator(`text=${tokyoWhen}`).count()) === 1 && (await tokyo.page.locator('text=Japan Standard Time (Tokyo)').count()) === 1, tokyoWhen);
  await shot(tokyo.page, 'phone-confirmed', true);
  check('no sideways scrolling on a phone', !(await tokyo.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)));
  const switcher = await visitor(browser, 'Asia/Tokyo');
  await switcher.page.goto(`${BASE}/30min`);
  await switcher.page.waitForSelector('ul[aria-label="Available times"] button');
  await switcher.page.selectOption('#timezone', 'America/New_York');
  await pickDay(switcher.page, D.tue2.at('12:00'));
  check('switching zone relabels the same slots (9:00 is taken, so 9:30 is first)', (await offered(switcher.page))[0] === '9:30 AM');

  console.log('Links, visibility, prefill, embed');
  await page.goto(`${BASE}/admin/event-types/new`);
  await page.fill('#name', 'VIP Session');
  await page.fill('#slug', 'admin');
  await page.click('button:has-text("Create event type")');
  await page.waitForSelector('text=is used by the app itself');
  check('reserved link names are refused, and typed values survive', (await page.inputValue('#name')) === 'VIP Session');
  await page.fill('#slug', '30min');
  await page.click('button:has-text("Create event type")');
  await page.waitForSelector('text=already uses that link');
  check('duplicate links are refused', true);
  await page.fill('#slug', 'vip');
  await page.check('text=Secret link');
  await page.fill('#limit', '1');
  await page.click('button:has-text("Create event type")');
  await page.waitForURL('**/admin/event-types');
  await page.waitForSelector('text=Secret link');
  const anon = await visitor(browser);
  await anon.page.goto(`${BASE}/`);
  await anon.page.waitForSelector('text=30 Minute Meeting');
  check('a secret event type is not listed publicly', (await anon.page.locator('text=VIP Session').count()) === 0);
  await anon.page.goto(`${BASE}/vip?name=Pat%20Prefill&email=pat@example.com`);
  await anon.page.waitForSelector('ul[aria-label="Available times"] button');
  await pickDay(anon.page, D.wed2.at('12:00'));
  await anon.page.click('ul[aria-label="Available times"] button:text-is("10:00 AM")');
  await anon.page.click('button:text-is("Next")');
  check('but its link works, with name and email prefilled from the link', (await anon.page.inputValue('#name')) === 'Pat Prefill' && (await anon.page.inputValue('#email')) === 'pat@example.com');
  await anon.page.click('text=Schedule meeting');
  await anon.page.waitForSelector('text=You are scheduled');
  check('a daily limit of 1 closes the rest of that day only', (await daySlots(D.wed2, 'vip')).times.length === 0 && (await daySlots(D.thu2, 'vip')).times.length > 0);
  const other = await daySlots(D.wed2);
  check('other event types see that booking as busy', !other.times.includes('10:00') && other.times.includes('11:00'));
  await anon.page.goto(`${BASE}/30min?embed=1`);
  await anon.page.waitForSelector('ul[aria-label="Available times"] button');
  await shot(anon.page, 'public-embed');
  check('embed mode renders', true);

  await page.goto(`${BASE}/admin/event-types`);
  await page.click('button[aria-label="30 Minute Meeting is open for booking"]');
  await page.waitForSelector('text=Off');
  check('switching an event type off is saved', sql("select is_active::text from event_types where slug='30min'") === 'false');
  await anon.page.goto(`${BASE}/30min`);
  await anon.page.waitForSelector('text=This page is not available');
  check('a switched-off event shows a friendly dead end, and serves no times', (await daySlots(D.wed2)).status === 404);
  await anon.page.goto(`${BASE}/no-such-event`);
  await anon.page.waitForSelector('text=This page is not available');
  await anon.page.goto(`${BASE}/booking/not-a-real-token`);
  await anon.page.waitForSelector('text=Booking not found');
  check('unknown links are handled', true);
  await page.click('button[aria-label="30 Minute Meeting is open for booking"]');
  await page.waitForFunction(() => !/\bOff\b/.test(document.querySelector('main').innerText));

  console.log('Availability editing');
  await page.goto(`${BASE}/admin/availability`);
  await page.waitForSelector('text=Weekly hours');
  await page.locator('select[aria-label="Friday end"]').selectOption('12:00');
  await page.fill('input[aria-label="Date"]', D.thu2.iso);
  await page.click('button:has-text("Add date")');
  await page.waitForSelector('text=Unavailable all day');
  await page.click('button:text-is("Save")');
  await page.waitForSelector('text=Saved.');
  await shot(page, 'admin-availability-edited', true);
  const friday = await daySlots(D.fri2);
  check('Friday now ends at noon', friday.times[friday.times.length - 1] === '11:30', JSON.stringify(friday.times));
  check('the date marked unavailable has no times', (await daySlots(D.thu2)).times.length === 0);
  await page.reload();
  await page.waitForSelector(`text=${D.thu2.at('12:00').toFormat('ccc, LLL d, yyyy')}`);
  check('saved hours are shown after a reload', (await page.locator('select[aria-label="Friday end"]').inputValue()) === '12:00');

  console.log('Profile and branding');
  await page.goto(`${BASE}/admin/settings`);
  await page.fill('#welcome_message', 'Happy to connect. Pick a time below.');
  await page.click('button[aria-label="#059669"]');
  await page.locator('form:has(#welcome_message) button[type=submit]').click();
  await page.waitForSelector('form:has(#welcome_message) >> text=Saved.');
  await anon.page.goto(`${BASE}/`);
  await anon.page.waitForSelector('text=Happy to connect. Pick a time below.');
  const brand = await anon.page.evaluate(() => getComputedStyle(document.querySelector('[style*="--brand"]')).getPropertyValue('--brand'));
  check('the accent colour is applied to public pages', brand.trim() === '#059669', brand);

  console.log('SMTP email');
  await page.selectOption('#provider', 'smtp');
  await page.fill('#from', 'meetings@example.com');
  await page.fill('#smtpHost', 'localhost');
  await page.fill('#smtpPort', '4025');
  await page.fill('#smtpUser', 'mailer');
  await page.fill('#smtpPass', 'smtp-pass');
  await page.locator('form:has(#provider) button[type=submit]').click();
  await page.waitForSelector('form:has(#provider) >> text=Saved.');
  await page.click('button:has-text("Send me a test")');
  await page.waitForSelector('text=Sent to owner@example.com');
  await book(anon.page, { day: D.mon3, time: '2:00 PM', name: 'Sam Smtp', email: 'sam@example.com' });
  const state = await mock('/state');
  const mail = state.smtp.find((m) => m.to.some((to) => to.includes('sam@example.com')));
  check('the test email arrived over SMTP, signed in', state.smtp[0].user === 'mailer' && state.smtp[0].raw.includes('Subject: Calendi test email'));
  check('the confirmation went out over SMTP with the calendar file attached', mail && mail.raw.includes('Subject: Confirmed: 30 Minute Meeting with Avi Tester') && mail.raw.includes('invite.ics'));
  check('the owner got a copy over SMTP', state.smtp.some((m) => m.to.some((to) => to.includes(OWNER.email)) && m.raw.includes('Subject: New booking: Sam Smtp')));

  console.log('Sign-in');
  const out = await visitor(browser);
  await out.page.goto(`${BASE}/admin/settings`);
  check('signed-out visitors are sent to sign in', out.page.url().endsWith('/admin/login'));
  await out.page.fill('#email', OWNER.email);
  await out.page.fill('#password', 'wrong-password-1');
  await out.page.click('button[type=submit]');
  await out.page.waitForSelector('text=do not match');
  check('a wrong password is refused; the email stays in the form', (await out.page.inputValue('#email')) === OWNER.email);
  // The account locks after 8 wrong passwords in total. One network address
  // is cut off after 5 tries (see 09-security), so this takes several addresses.
  for (let i = 0; i < 7; i++) {
    const reply = await api('/api/auth/login', { address: `10.7.0.${i + 1}`, json: { email: OWNER.email, password: `wrong-password-${i + 2}` } });
    if (reply.status !== 401) check('wrong password answered with 401', false, String(reply.status));
  }
  await out.page.fill('#password', OWNER.password);
  await out.page.click('button[type=submit]');
  await out.page.waitForSelector('text=Too many attempts. Try again in');
  check('after 8 wrong tries sign-in is locked for a while, even with the right password', true);
  sql('update owner set locked_until = null, failed_logins = 0');
  await out.page.click('button[type=submit]');
  await out.page.waitForURL('**/admin/event-types');
  check('the correct password signs in', true);
  await out.page.click('button:has-text("Sign out")');
  await out.page.waitForURL('**/admin/login');
  await out.page.goto(`${BASE}/admin/bookings`);
  check('signing out really signs out', out.page.url().endsWith('/admin/login'));
  await out.ctx.addCookies([{ name: 'calendi_session', value: '1.99999999999999.forged', domain: 'localhost', path: '/' }]);
  await out.page.goto(`${BASE}/admin/bookings`);
  await out.page.waitForURL('**/admin/login');
  check('a forged session cookie is rejected', (await out.page.locator('text=Kenji Tokyo').count()) === 0);
  await out.page.goto(`${BASE}/admin/setup`);
  await out.page.waitForURL('**/admin/login');
  check('the setup page is closed once an owner exists', true);

  await browser.close();
  finish();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
