// A deployment that is not finished yet. This is what someone sees right
// after importing the project into a host and deploying before adding a
// database or APP_SECRET: it must be a to-do list, never a bare server error.
// Each case starts its own short-lived copy of the app with different settings.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { chromium, check, finish, visitor, shot, startApp, sql, DATABASE_URL, APP_SECRET: SECRET, SETUP_TOKEN } = require('./lib');

const ROOT = path.join(__dirname, '..', '..');
const FRESH = new URL(DATABASE_URL);
FRESH.pathname = '/calendi_fresh_test';

const FIRST_PORT = Number(process.env.E2E_PORT || 3210) + 10;

(async () => {
  const browser = await chromium.launch();
  const running = [];
  const open = async (settings) => {
    const port = FIRST_PORT + running.length;
    running.push(await startApp(port, settings));
    const { page } = await visitor(browser);
    // These cases fail on purpose; a failed page load is not a test failure here.
    page.removeAllListeners('pageerror');
    return { page, base: `http://localhost:${port}` };
  };

  try {
    console.log('Nothing set (deployed straight after importing)');
    let { page, base } = await open({});
    await page.goto(`${base}/`);
    await page.waitForURL('**/admin/setup');
    await page.waitForSelector('text=Almost there');
    check('the landing page leads to a setup checklist', true);
    check('it names the missing database', (await page.locator('text=No database is connected').count()) === 1);
    check('it names the missing secret', (await page.locator('text=APP_SECRET is not set').count()) === 1);
    check('and the missing setup token, so all three can be added in one go', (await page.locator('text=SETUP_TOKEN is not set').count()) === 1);
    check('it says to redeploy afterwards', (await page.locator('text=Then redeploy.').count()) === 1);
    check('the account form is not offered yet', (await page.locator('#password').count()) === 0);
    await page.waitForTimeout(300); // let the fade-in finish so the screenshot is legible
    await shot(page, 'setup-checklist');
    await page.goto(`${base}/admin`);
    await page.waitForURL('**/admin/setup');
    await page.waitForSelector('h1:text-is("Almost there")');
    // (Not a text= count: after a client-side redirect Next's route announcer repeats the heading.)
    check('/admin leads there too', (await page.locator('h1:text-is("Almost there")').count()) === 1);
    const api = await fetch(`${base}/api/availability?slug=30min&from=2030-01-07T00:00:00Z&to=2030-01-08T00:00:00Z`);
    const body = await api.json().catch(() => null);
    check('the availability API still answers with a readable message', api.status === 500 && Boolean(body && body.message), JSON.stringify(body));
    await page.goto(`${base}/30min`);
    await page.waitForSelector('text=This page could not be loaded');
    check('other pages show a plain error with a pointer to the setup page', (await page.locator('a[href="/admin/setup"]').count()) === 1);
    await shot(page, 'error-page');

    console.log('Database connected, but APP_SECRET too short');
    ({ page, base } = await open({ DATABASE_URL, APP_SECRET: 'too-short' }));
    await page.goto(`${base}/`);
    await page.waitForURL('**/admin/setup');
    await page.waitForSelector('text=APP_SECRET is too short');
    check('only the secret is listed', (await page.locator('ol > li').count()) === 1);

    console.log('Database connected, but its tables were never created');
    const empty = new URL(DATABASE_URL);
    empty.pathname = '/postgres';
    ({ page, base } = await open({ DATABASE_URL: empty.href, APP_SECRET: SECRET, SETUP_TOKEN }));
    await page.goto(`${base}/`);
    await page.waitForURL('**/admin/setup');
    await page.waitForSelector('text=its tables have not been created');
    check('the fix offered is to redeploy', (await page.locator('ol > li').count()) === 1 && (await page.locator('text=Redeploy the project').count()) === 1);

    console.log('Database address points nowhere');
    ({ page, base } = await open({ DATABASE_URL: 'postgres://calendi:calendi@localhost:1/calendi_test', APP_SECRET: SECRET }));
    await page.goto(`${base}/admin/setup`);
    await page.waitForSelector('text=The database could not be reached');
    check('the setup page says the database could not be reached', true);
    await page.goto(`${base}/`);
    await page.waitForSelector('text=This page could not be loaded');
    check('visitors get the plain error page, not the setup page', !page.url().includes('/admin/setup'));

    console.log('Checked on every request; nothing prerendered');
    for (const page of ['admin/setup', 'admin/login', 'index']) {
      const shell = path.join(ROOT, '.next', 'server', 'app', `${page}.html`);
      check(`the build stores no content for /${page === 'index' ? '' : page} (rendered per request)`, !fs.existsSync(shell) || fs.statSync(shell).size === 0);
    }
    sql('drop database if exists calendi_fresh_test with (force)');
    sql('create database calendi_fresh_test');
    ({ page, base } = await open({ DATABASE_URL: FRESH.href, APP_SECRET: SECRET, SETUP_TOKEN }));
    const first = await fetch(`${base}/admin/setup`);
    const firstHtml = await first.text();
    check('a brand-new database: the checklist says the tables are missing', firstHtml.includes('its tables have not been created'));
    check('and the reply may not be cached', /no-store/.test(first.headers.get('cache-control') || ''), first.headers.get('cache-control'));
    // Create the tables while that copy of the app keeps running, as a redeploy's build would.
    execFileSync('node', ['scripts/migrate.mjs'], { cwd: ROOT, env: { ...process.env, DATABASE_URL: FRESH.href }, stdio: 'ignore' });
    await page.goto(`${base}/admin/setup`);
    await page.waitForSelector('#setupToken');
    check('the very next request sees the change: the account form, no restart needed', (await page.locator('text=Almost there').count()) === 0);
    await page.goto(`${base}/`);
    await page.waitForURL('**/admin/setup');
    check('the landing page reads the same live state', true);

    console.log('Everything set');
    ({ page, base } = await open({ DATABASE_URL, APP_SECRET: SECRET }));
    await page.goto(`${base}/admin/setup`);
    await page.waitForURL('**/admin/login');
    check('with nothing missing (and an owner already created) setup hands over to sign-in', true);
  } finally {
    for (const child of running) child.kill();
    await browser.close();
    try {
      sql('drop database if exists calendi_fresh_test with (force)');
    } catch {
      // Best effort; the next run drops it first anyway.
    }
  }
  finish();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
