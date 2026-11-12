// The privacy policy and terms of use: public (no session, no sign-in), plain
// pages that answer 200, say what they must, and are linked from the footer of
// the public pages. (The setup page's footer is checked in 01-setup and 08.)
const { chromium, BASE, D, check, finish, reset, admin, visitor, book, api, nextAddress } = require('./lib');

(async () => {
  await reset();
  const browser = await chromium.launch();

  console.log('Both pages answer without a session');
  for (const [route, heading] of [['/privacy', 'Privacy policy'], ['/terms', 'Terms of use']]) {
    // A bare request: no cookies, no sign-in, no browser.
    const response = await api(route, { address: nextAddress(), redirect: 'manual' });
    // React puts <!-- --> between adjacent text pieces; strip them to read the page as text.
    const html = (await response.text()).replace(/<!-- -->/g, '');
    check(`${route} returns 200`, response.status === 200, String(response.status));
    check(`${route} shows its heading and a last-updated date`, html.includes(heading) && /Last updated \d{1,2} \w+ \d{4}/.test(html));
    check(`${route} names the contact address`, html.includes('avibruin@gmail.com'));
  }

  console.log('What the privacy policy has to say');
  const { page } = await visitor(browser);
  await page.goto(`${BASE}/privacy`);
  const text = await page.innerText('article');
  for (const [what, pattern] of [
    ['what is collected from people who book', /name.*email.*phone.*time zone/is],
    ['that connected calendars are read for busy times', /busy/i],
    ['that bookings are written to a chosen calendar', /adds the meeting\s+to the calendar/i],
    ['the Google API Services User Data Policy and Limited Use', /Google API Services User Data Policy.*Limited Use/is],
    ['that Google data is not sold', /not sold/i],
    ['that Google data is not used for advertising', /not used or transferred for advertising/i],
    ['that Google data is not used to train AI', /train AI or machine-learning/i],
    ['that tokens are stored encrypted', /stored encrypted/i],
    ['how to ask for deletion', /delete.*avibruin@gmail\.com|avibruin@gmail\.com.*delete/is],
  ]) {
    check(`it covers ${what}`, pattern.test(text));
  }
  check('the Google policy link points at Google', (await page.locator('a[href^="https://developers.google.com/terms/api-services-user-data-policy"]').count()) === 1);
  check('the contact link is a mailto link', (await page.locator('a[href="mailto:avibruin@gmail.com"]').count()) >= 1);

  console.log('Linked from the footer of the public pages');
  const token = await book(page, { day: D.mon, time: '10:00 AM' });
  for (const [label, route] of [
    ['the landing page', '/'],
    ['a booking page', '/30min'],
    ['the confirmation page', `/booking/${token}`],
    ['the sign-in page', '/admin/login'],
    ['the privacy policy', '/privacy'],
    ['the terms of use', '/terms'],
  ]) {
    await page.goto(`${BASE}${route}`);
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('[aria-busy]', { state: 'detached' }); // the loading skeleton has its own footer
    const links = [await page.locator('footer a[href="/privacy"]').count(), await page.locator('footer a[href="/terms"]').count()];
    check(`${label} links to both`, links.join() === '1,1', links.join());
  }
  await page.goto(`${BASE}/30min`);
  await page.click('footer a[href="/terms"]');
  await page.waitForURL('**/terms');
  check('the footer link opens the terms', (await page.locator('h1:text-is("Terms of use")').count()) === 1);

  console.log('The two paths cannot be taken as booking links');
  const { page: owner } = await admin(browser);
  for (const slug of ['privacy', 'terms']) {
    await owner.goto(`${BASE}/admin/event-types/new`);
    await owner.fill('#name', 'Legal clash');
    await owner.fill('#slug', slug);
    await owner.click('button:has-text("Create event type")');
    await owner.waitForSelector('text=is used by the app itself');
    check(`the admin refuses "${slug}" as an event link`, true);
  }

  await browser.close();
  finish();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
