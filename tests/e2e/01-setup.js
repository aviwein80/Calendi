// First-run setup: an empty database leads to the setup page, which creates
// the owner. Saves the signed-in session for the other specs.
const { chromium, BASE, STATE, OWNER, check, finish, sql, shot } = require('./lib');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'America/New_York' });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  page.on('pageerror', (error) => errors.push(error.message));
  console.log('First-run setup');

  await page.goto(`${BASE}/`);
  await page.waitForURL('**/admin/setup');
  await page.waitForSelector('#name');
  check('an empty install sends visitors to setup', true);
  check('time zone is pre-selected from the browser', (await page.inputValue('#timezone')) === 'America/New_York');

  await page.fill('#name', OWNER.name);
  await page.fill('#email', OWNER.email);
  await page.fill('#password', 'short');
  await page.evaluate(() => document.querySelector('#password').removeAttribute('minlength'));
  await page.click('button[type=submit]');
  await page.waitForSelector('text=at least 10 characters');
  check('short passwords are refused, and the form keeps what was typed', (await page.inputValue('#name')) === OWNER.name);

  await page.fill('#password', OWNER.password);
  await page.click('button[type=submit]');
  await page.waitForURL('**/admin/event-types**');
  await page.waitForSelector('text=30 Minute Meeting');
  check('owner created with a starter event type and schedule', sql('select count(*) from event_types') === '1' && sql('select count(*) from schedules where is_default') === '1');
  check('password is stored hashed', sql('select password_hash from owner').startsWith('scrypt$'));
  await shot(page, 'admin-event-types', true);
  await context.storageState({ path: STATE });

  for (const path of ['/admin/availability', '/admin/calendars', '/admin/bookings', '/admin/settings', '/admin/event-types/new']) {
    await page.goto(BASE + path);
    await page.waitForLoadState('networkidle');
    await shot(page, `admin${path.replace(/\//g, '-').replace('-admin', '')}`, true);
  }
  check('every admin page loads without browser errors', errors.length === 0, JSON.stringify(errors));

  await browser.close();
  finish();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
