// Before the owner has registered a Google or Microsoft app: the Connect
// buttons open a one-time setup card instead (exact redirect URL, five steps
// with direct links, the scopes, the environment variables). Only the signed-in
// owner can see it. Runs a copy of the app with no GOOGLE_* / MICROSOFT_* settings.
const { chromium, check, finish, reset, admin, visitor, shot, startApp, sql, DATABASE_URL, APP_SECRET } = require('./lib');

const PORT = Number(process.env.E2E_PORT || 3210) + 40;
const BASE = `http://localhost:${PORT}`;
const GOOGLE_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.freebusy',
  'https://www.googleapis.com/auth/calendar.events',
];

(async () => {
  await reset();
  const app = await startApp(PORT, { DATABASE_URL, APP_SECRET, CALENDAR_CACHE_SECONDS: '0' });
  const browser = await chromium.launch();
  try {
    // Session cookies are per host, not per port, so the owner's session works here too.
    const { page } = await admin(browser);
    console.log('Google not set up yet');
    await page.goto(`${BASE}/admin/calendars`);
    await page.click('#connect >> text=Connect Google');
    await page.waitForSelector('[data-testid="setup-google"]');
    check('Connect Google opens the setup card instead of a dead end', page.url().includes('setup=google'));
    const card = page.locator('[data-testid="setup-google"]');
    check('it shows the exact redirect URL to copy', (await card.locator('[data-testid="redirect-uri"]').textContent()).trim() === `${BASE}/api/oauth/google/callback` && (await card.locator('button:has-text("Copy")').count()) === 1);
    check('a numbered guide of five steps', (await card.locator('ol > li').count()) === 5);
    const links = await card.locator('ol a').evaluateAll((anchors) => anchors.map((a) => a.href));
    check('with direct links to the Google Cloud pages', ['projectcreate', 'calendar-json.googleapis.com', '/auth/overview', '/auth/clients/create'].every((part) => links.some((href) => href.startsWith('https://console.cloud.google.com/') && href.includes(part))), JSON.stringify(links));
    const scopes = await card.locator('[data-testid="scopes"] li').allTextContents();
    check('the exact scopes', JSON.stringify(scopes.map((s) => s.trim())) === JSON.stringify(GOOGLE_SCOPES), JSON.stringify(scopes));
    check('the environment variables to add', (await card.locator('code:text-is("GOOGLE_CLIENT_ID")').count()) === 1 && (await card.locator('code:text-is("GOOGLE_CLIENT_SECRET")').count()) === 1);
    check('and that the app must be “In production”', (await card.locator('text=every 7 days').count()) === 1);
    check('nothing to type credentials into', (await page.locator('input[name=clientId], input[name=clientSecret]').count()) === 0);
    await shot(page, 'calendars-setup-card', true);

    const start = await page.context().request.get(`${BASE}/api/oauth/google/start`, { maxRedirects: 0 });
    check('the sign-in route also points to the setup card', start.status() === 307 && start.headers().location.endsWith('/admin/calendars?setup=google#connect'), start.headers().location);

    console.log('Microsoft not set up yet');
    await page.click('#connect >> text=Connect Outlook / Microsoft 365');
    await page.waitForSelector('[data-testid="setup-microsoft"]');
    const ms = page.locator('[data-testid="setup-microsoft"]');
    check('Microsoft gets its own card and redirect URL', (await ms.locator('[data-testid="redirect-uri"]').textContent()).trim() === `${BASE}/api/oauth/microsoft/callback`);
    check('five steps, linking to Microsoft Entra', (await ms.locator('ol > li').count()) === 5 && (await ms.locator('ol a[href^="https://entra.microsoft.com/"]').count()) >= 1);
    check('with the Graph scopes', (await ms.locator('[data-testid="scopes"] >> text=Calendars.ReadWrite').count()) === 1 && (await ms.locator('[data-testid="scopes"] >> text=offline_access').count()) === 1);

    console.log('Visitors never see it');
    const anon = await visitor(browser);
    await anon.page.goto(`${BASE}/admin/calendars?setup=google`);
    await anon.page.waitForURL('**/admin/login');
    check('a visitor is sent to sign in, and sees no setup details', (await anon.page.locator('text=Redirect URL').count()) === 0);
    const anonStart = await fetch(`${BASE}/api/oauth/google/start`, { redirect: 'manual' });
    check('the sign-in route sends visitors to sign in too', anonStart.status === 307 && anonStart.headers.get('location').endsWith('/admin/login'));
    const html = await (await fetch(`${BASE}/`)).text();
    check('the public page mentions none of it', !html.includes('GOOGLE_CLIENT_ID') && !html.includes('/api/oauth/'));

    console.log('Other ways to connect');
    await page.goto(`${BASE}/admin/calendars`);
    await page.click('text=another CalDAV server');
    await page.waitForSelector('#caldav-preset');
    check('Fastmail, Nextcloud and other CalDAV servers can still be added', (await page.locator('#caldav-preset option').count()) === 2);
    check('nothing was connected along the way', sql('select count(*) from calendar_accounts') === '0');
  } finally {
    app.kill();
    await browser.close();
  }
  finish();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
