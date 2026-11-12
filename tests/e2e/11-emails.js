// More than one email address on the owner's account: adding one, confirming
// it with an emailed code (or leaving it unverified when email is not set
// up), signing in with any confirmed address and the one password, choosing
// the notifications address, and a meeting type sending its alerts elsewhere.
const path = require('path');
const { chromium, BASE, D, OUT, OWNER, check, finish, mock, sql, reset, admin, visitor, book, api } = require('./lib');

const login = (email, address) => api('/api/auth/login', { address, json: { email, password: OWNER.password } });
const row = (page, email) => page.locator(`[data-address="${email}"]`);
const codeFor = async (email) => {
  const mail = (await mock('/state')).emails.filter((m) => m.to.includes(email)).pop();
  return mail ? /^(\d{6}) is your Calendi confirmation code$/.exec(mail.subject)?.[1] : undefined;
};

(async () => {
  await reset();
  const browser = await chromium.launch();
  const { page } = await admin(browser);
  console.log('Email addresses');

  await page.goto(`${BASE}/admin/settings`);
  await row(page, OWNER.email).waitFor();
  check('the first address is confirmed and gets the notifications', (await row(page, OWNER.email).locator('text=Confirmed').count()) === 1 && (await row(page, OWNER.email).locator('text=Notifications').count()) === 1);
  check('the profile form no longer edits the sign-in email', (await page.locator('form:has(#welcome_message) input[type=email]').count()) === 0);

  console.log('Without email set up');
  await page.fill('input[aria-label="Add an email address"]', 'Second@Example.com');
  await page.click('button:has-text("Add address")');
  await page.waitForSelector('text=it is unverified: email sending is not set up');
  check('a new address is added as unverified', (await row(page, 'second@example.com').locator('text=Unverified').count()) === 1);
  check('and no code can be sent yet', await row(page, 'second@example.com').locator('button:has-text("Send code")').isDisabled());
  check('an unverified address cannot sign in', (await login('second@example.com', '10.11.0.1')).status === 401);
  await page.fill('input[aria-label="Add an email address"]', 'second@example.com');
  await page.click('button:has-text("Add address")');
  await page.waitForSelector('text=already on your account');
  check('the same address cannot be added twice', sql("select count(*) from owner_emails where lower(email)='second@example.com'") === '1');

  console.log('Confirming with a code');
  await page.selectOption('#provider', 'resend');
  await page.fill('#from', 'meetings@example.com');
  await page.fill('#resendApiKey', 're_test_key');
  await page.locator('form:has(#provider) button[type=submit]').click();
  await page.waitForSelector('form:has(#provider) >> text=Saved.');
  await row(page, 'second@example.com').locator('button:has-text("Send code")').click();
  await page.waitForSelector('text=Code sent to second@example.com');
  const code = await codeFor('second@example.com');
  check('a six-digit code is emailed to the new address', /^\d{6}$/.test(code || ''), String(code));
  check('the code is not stored as written', !sql("select code_hash from owner_emails where email='second@example.com'").includes(code));
  const input = row(page, 'second@example.com').locator('input[name=code]');
  await input.fill(code === '000000' ? '111111' : '000000');
  await row(page, 'second@example.com').locator('button:has-text("Confirm")').click();
  await page.waitForSelector('text=That code is not right. 4 tries left.');
  check('a wrong code is refused', sql("select verified_at is null from owner_emails where email='second@example.com'") === 't');
  await input.fill(code);
  await row(page, 'second@example.com').locator('button:has-text("Confirm")').click();
  await row(page, 'second@example.com').locator('text=Confirmed').waitFor();
  check('the right code confirms the address', sql("select verified_at is not null from owner_emails where email='second@example.com'") === 't');
  check('a confirmed address signs in with the same password', (await login('second@example.com', '10.11.0.2')).status === 200);
  check('in any letter case', (await login('SECOND@example.COM', '10.11.0.3')).status === 200);
  check('the original address still signs in', (await login(OWNER.email, '10.11.0.4')).status === 200);

  // A code can only be guessed a few times.
  await page.fill('input[aria-label="Add an email address"]', 'third@example.com');
  await page.click('button:has-text("Add address")');
  await page.waitForSelector('text=Code sent to third@example.com');
  const third = await codeFor('third@example.com');
  await page.locator('#emails').screenshot({ path: path.join(OUT, 'settings-email-addresses.png') });
  const thirdInput = row(page, 'third@example.com').locator('input[name=code]');
  const wrong = third === '123456' ? '654321' : '123456';
  for (let i = 0; i < 5; i++) {
    await thirdInput.fill(wrong);
    await row(page, 'third@example.com').locator('button:has-text("Confirm")').click();
    await page.waitForTimeout(250);
  }
  await thirdInput.fill(third);
  await row(page, 'third@example.com').locator('button:has-text("Confirm")').click();
  await page.waitForSelector('text=Too many wrong codes');
  check('after five wrong codes even the right one is refused until a new code is sent', sql("select verified_at is null from owner_emails where email='third@example.com'") === 't');
  check('and the address still cannot sign in', (await login('third@example.com', '10.11.0.5')).status === 401);
  page.once('dialog', (dialog) => dialog.accept());
  await row(page, 'third@example.com').locator('button:has-text("Remove")').click();
  await row(page, 'third@example.com').waitFor({ state: 'detached' });
  check('an address can be removed', sql("select count(*) from owner_emails where email='third@example.com'") === '0');

  console.log('The notifications address');
  await row(page, 'second@example.com').locator('button:has-text("Use for notifications")').click();
  await row(page, 'second@example.com').locator('text=Notifications').waitFor();
  check('a confirmed address can receive the notifications', sql('select email from owner') === 'second@example.com');
  check('the notifications address cannot be removed', (await row(page, 'second@example.com').locator('button:has-text("Remove")').count()) === 0);
  await page.click('button:has-text("Send me a test")');
  await page.waitForSelector('text=Sent to second@example.com');

  await mock('/reset', {});
  const guest = await visitor(browser);
  await book(guest.page, { day: D.mon, time: '10:00 AM', name: 'Alert One', email: 'one@example.com' });
  let state = await mock('/state');
  check('booking alerts go to the notifications address', state.emails.some((m) => m.subject === 'New booking: Alert One' && m.to.includes('second@example.com') && !m.to.includes(OWNER.email)));

  console.log('A meeting type with its own alert address');
  await page.goto(`${BASE}/admin/event-types`);
  await page.click('a:has-text("Edit")');
  await page.waitForSelector('#notify_email');
  const options = await page.locator('#notify_email option').allTextContents();
  check('only confirmed addresses are offered', options.length === 2 && options.some((o) => o.includes(OWNER.email)) && !options.some((o) => o.includes('third@')), JSON.stringify(options));
  await page.selectOption('#notify_email', OWNER.email);
  await page.click('button:has-text("Save changes")');
  await page.waitForURL('**/admin/event-types');
  check('the choice is saved', sql("select notify_email from event_types where slug='30min'") === OWNER.email);
  await book(guest.page, { day: D.tue, time: '10:00 AM', name: 'Alert Two', email: 'two@example.com' });
  state = await mock('/state');
  check("that type's alerts go to its own address", state.emails.some((m) => m.subject === 'New booking: Alert Two' && m.to.includes(OWNER.email) && !m.to.includes('second@example.com')));

  await page.goto(`${BASE}/admin/settings`);
  page.once('dialog', (dialog) => dialog.accept());
  await row(page, OWNER.email).locator('button:has-text("Remove")').click();
  await row(page, OWNER.email).waitFor({ state: 'detached' });
  check('removing an address sends that type back to the notifications address', sql("select notify_email from event_types where slug='30min'") === '');
  check('and the removed address no longer signs in', (await login(OWNER.email, '10.11.0.6')).status === 401);

  await browser.close();
  await reset();
  finish();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
