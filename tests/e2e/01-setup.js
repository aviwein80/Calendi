// First-run setup: an empty database leads to the setup page, which creates
// the owner, but only for someone who knows the site's SETUP_TOKEN. Saves the
// signed-in session for the other specs.
const { chromium, BASE, STATE, OWNER, SETUP_TOKEN, APP_SECRET, DATABASE_URL, check, finish, sql, shot, api, startApp } = require('./lib');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'America/New_York' });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  page.on('pageerror', (error) => errors.push(error.message));
  console.log('Setup is locked until SETUP_TOKEN is set');
  const port = Number(process.env.E2E_PORT || 3210) + 20;
  const locked = await startApp(port, { DATABASE_URL, APP_SECRET });
  try {
    await page.goto(`http://localhost:${port}/`);
    await page.waitForURL('**/admin/setup');
    await page.waitForSelector('text=SETUP_TOKEN is not set');
    check('the checklist says to add SETUP_TOKEN', (await page.locator('ol > li').count()) === 1);
    check('and the account form is not offered', (await page.locator('#password').count()) === 0);
    const attempt = await api(`http://localhost:${port}/api/auth/setup`, {
      json: { setupToken: '', name: 'Mallory', email: 'mallory@example.com', password: 'a-long-enough-password', timezone: 'UTC' },
    });
    const reply = await attempt.json();
    check('posting the form directly is refused', attempt.status === 403 && /Setup is locked/.test(reply.message), JSON.stringify(reply));
  } finally {
    locked.kill();
  }
  const short = await startApp(port + 1, { DATABASE_URL, APP_SECRET, SETUP_TOKEN: 'too-short-to-be-safe' });
  try {
    await page.goto(`http://localhost:${port + 1}/admin/setup`);
    await page.waitForSelector('text=SETUP_TOKEN is too short');
    const attempt = await api(`http://localhost:${port + 1}/api/auth/setup`, {
      json: { setupToken: 'too-short-to-be-safe', name: 'Mallory', email: 'mallory@example.com', password: 'a-long-enough-password', timezone: 'UTC' },
    });
    check('a SETUP_TOKEN under 24 characters is treated as not set', attempt.status === 403);
  } finally {
    short.kill();
  }
  check('nobody became the owner', sql('select count(*) from owner') === '0');

  console.log('First-run setup');

  await page.goto(`${BASE}/`);
  await page.waitForURL('**/admin/setup');
  await page.waitForSelector('#name');
  check('an empty install sends visitors to setup', true);
  check('time zone is pre-selected from the browser', (await page.inputValue('#timezone')) === 'America/New_York');

  await page.fill('#name', OWNER.name);
  await page.fill('#email', OWNER.email);
  await page.fill('#password', OWNER.password);
  await page.fill('#setupToken', 'not-the-right-token-at-all-0000');
  await page.click('button[type=submit]');
  await page.waitForSelector('text=That setup token does not match');
  check('a wrong setup token is refused, and no account is created', sql('select count(*) from owner') === '0');
  const guess = await api('/api/auth/setup', {
    json: { setupToken: SETUP_TOKEN.slice(0, -1), name: 'Mallory', email: 'mallory@example.com', password: 'a-long-enough-password', timezone: 'UTC' },
  });
  check('so is a near miss sent straight to the endpoint', guess.status === 403 && sql('select count(*) from owner') === '0');

  await page.fill('#setupToken', SETUP_TOKEN);
  await page.fill('#password', 'short');
  await page.evaluate(() => document.querySelector('#password').removeAttribute('minlength'));
  await page.click('button[type=submit]');
  await page.waitForSelector('text=at least 10 characters');
  check('short passwords are refused, and the form keeps what was typed', (await page.inputValue('#name')) === OWNER.name);

  await page.fill('#password', OWNER.password);
  await page.click('button[type=submit]');
  await page.waitForURL('**/admin/event-types**');
  await page.waitForSelector('text=30 Minute Meeting');
  errors.length = 0; // the refusals above were expected, and the browser logs each one
  check('the token is accepted although the setting has whitespace after it', sql('select count(*) from owner') === '1');
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
