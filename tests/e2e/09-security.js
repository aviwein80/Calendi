// The security pass: per-address rate limits (429 with a readable message),
// manage-link tokens stored hashed, buffers enforced by the database even
// when two bookings race, and setup staying closed once there is an owner.
const { execFile } = require('child_process');
const { chromium, BASE, D, OWNER, SETUP_TOKEN, DATABASE_URL, utc, check, finish, sql, reset, visitor, book, daySlots, api, tokenHash } = require('./lib');

const post = (route, json, address) => api(route, { json, address });
const friendly = (body) => Boolean(body && body.message && body.message.length > 20 && !/error|exception/i.test(body.message));

/** Sends `count` requests one after another and returns the HTTP statuses. */
async function burst(count, send) {
  const statuses = [];
  for (let i = 0; i < count; i++) statuses.push((await send(i)).status);
  return statuses;
}

/** Runs one SQL statement without waiting, resolving to true if it succeeded. */
const sqlAsync = (query) =>
  new Promise((resolve) => execFile('psql', [DATABASE_URL, '-At', '-v', 'ON_ERROR_STOP=1', '-c', query], (error) => resolve(!error)));

(async () => {
  await reset();
  const browser = await chromium.launch();

  console.log('Setup stays closed once there is an owner');
  const before = sql("select email || '|' || password_hash from owner");
  const again = await post('/api/auth/setup', { setupToken: SETUP_TOKEN, name: 'Mallory', email: 'mallory@example.com', password: 'a-long-enough-password', timezone: 'UTC' }, '10.8.0.1');
  const againBody = await again.json();
  check('the right setup token no longer creates an account', again.status === 409 && /already has an owner/.test(againBody.message), JSON.stringify(againBody));
  check('the owner is unchanged, and there is still exactly one', sql("select email || '|' || password_hash from owner") === before && sql('select count(*) from owner') === '1');
  let second = true;
  try {
    sql("insert into owner (id, name, email, password_hash, timezone) values (2, 'x', 'x@x.co', 'x', 'UTC')");
  } catch {
    second = false;
  }
  check('the database itself refuses a second owner', !second);

  console.log('Rate limits');
  const range = `from=${encodeURIComponent(utc(D.mon.at('00:00')))}&to=${encodeURIComponent(utc(D.tue.at('00:00')))}`;
  let statuses = await burst(61, () => api(`/api/availability?slug=30min&${range}`, { address: '10.8.1.1' }));
  check('availability: 60 a minute pass, the 61st gets 429', statuses.slice(0, 60).every((s) => s === 200) && statuses[60] === 429, JSON.stringify(statuses.slice(55)));
  const limited = await api(`/api/availability?slug=30min&${range}`, { address: '10.8.1.1' });
  const limitedBody = await limited.json();
  check('the 429 carries a readable message and says when to retry', friendly(limitedBody) && Number(limited.headers.get('retry-after')) > 0, JSON.stringify(limitedBody));
  check('another address is not affected', (await api(`/api/availability?slug=30min&${range}`, { address: '10.8.1.2' })).status === 200);

  const junk = { slug: '30min', start: 'not-a-time-at-all', name: 'x', email: 'x@example.com', timezone: 'UTC' };
  statuses = await burst(9, () => post('/api/bookings', junk, '10.8.2.1'));
  check('booking: 8 an hour per address, the 9th gets 429', statuses.slice(0, 8).every((s) => s === 400) && statuses[8] === 429, JSON.stringify(statuses));
  check('booking 429 has a readable message', friendly(await (await post('/api/bookings', junk, '10.8.2.1')).json()));

  statuses = await burst(6, (i) => post('/api/auth/login', { email: OWNER.email, password: `guess-number-${i}` }, '10.8.3.1'));
  check('sign-in: 5 tries per address, the 6th gets 429', statuses.slice(0, 5).every((s) => s === 401) && statuses[5] === 429, JSON.stringify(statuses));
  const blockedLogin = await post('/api/auth/login', { email: OWNER.email, password: OWNER.password }, '10.8.3.1');
  check('even the right password is refused from that address meanwhile', blockedLogin.status === 429 && friendly(await blockedLogin.json()));
  check('one address cannot lock the account by itself', sql('select (locked_until is null)::text from owner') === 'true');
  const elsewhere = await post('/api/auth/login', { email: OWNER.email, password: OWNER.password }, '10.8.3.2');
  check('the owner can still sign in from elsewhere', elsewhere.status === 200 && /calendi_session=/.test(elsewhere.headers.get('set-cookie') || ''));
  sql('update owner set failed_logins = 0, locked_until = null');

  const visitorPage = await visitor(browser);
  const page = visitorPage.page;
  await page.goto(`${BASE}/admin/login`);
  await page.setExtraHTTPHeaders({ 'x-real-ip': '10.8.3.1' });
  await page.fill('#email', OWNER.email);
  await page.fill('#password', OWNER.password);
  await page.click('button[type=submit]');
  await page.waitForSelector('text=Too many sign-in attempts from your network');
  check('the sign-in form shows the rate-limit message', true);

  const sameSite = await fetch(`${BASE}/api/bookings`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example', 'x-real-ip': '10.8.4.1' }, body: JSON.stringify(junk) });
  check('requests started by another website are refused', sameSite.status === 403);

  console.log('Manage links');
  const guest = await visitor(browser);
  const token = await book(guest.page, { day: D.mon, time: '10:00 AM' });
  await guest.page.waitForSelector('text=You are scheduled');
  check('the token is at least 128 bits of randomness', /^[A-Za-z0-9_-]{22,}$/.test(token) && Buffer.from(token, 'base64url').length >= 16, token.length);
  const columns = sql("select string_agg(column_name, ',') from information_schema.columns where table_name = 'bookings' and column_name like 'token%'");
  check('the database has no plain token column', columns.split(',').sort().join() === 'token_hash,token_sealed', columns);
  const row = sql(`select token_hash || '|' || token_sealed from bookings where token_hash='${tokenHash(token)}'`);
  check('the stored hash is the SHA-256 of the token', row.startsWith(tokenHash(token)));
  check('nothing stored contains the token itself', !sql('select row_to_json(b)::text from bookings b').includes(token));
  check('the copy kept for the admin is encrypted', row.split('|')[1].startsWith('v1.'));

  const guesser = '10.8.5.1';
  statuses = await burst(11, (i) => api(`/api/ics/${'A'.repeat(31)}${i % 10}`, { address: guesser }));
  check('ten wrong links are answered 404, then the address is cut off', statuses.slice(0, 10).every((s) => s === 404) && statuses[10] === 429, JSON.stringify(statuses));
  check('while cut off, even a real link is refused from that address', (await api(`/api/ics/${token}`, { address: guesser })).status === 429);
  check('the real link still works from elsewhere', (await api(`/api/ics/${token}`, { address: '10.8.5.2' })).status === 200);
  const cancelGuess = await post('/api/bookings/cancel', { token: 'B'.repeat(32), reason: '' }, guesser);
  check('guessing through the cancel endpoint is cut off too', cancelGuess.status === 429 && friendly(await cancelGuess.json()));
  const pageGuess = await visitor(browser);
  await pageGuess.page.setExtraHTTPHeaders({ 'x-real-ip': guesser });
  await pageGuess.page.goto(`${BASE}/booking/${token}`);
  await pageGuess.page.waitForSelector('text=Too many attempts');
  check('and so are the booking pages', true);
  check('the booking was not touched', sql(`select status from bookings where token_hash='${tokenHash(token)}'`) === 'confirmed');

  statuses = await burst(11, (i) => post('/api/bookings/cancel', { token: `${'C'.repeat(31)}${i % 10}`, reason: '' }, '10.8.6.1'));
  check('cancel: limited per address', statuses[10] === 429, JSON.stringify(statuses));
  statuses = await burst(11, (i) => post('/api/bookings/reschedule', { token: `${'D'.repeat(31)}${i % 10}`, start: utc(D.tue.at('10:00')) }, '10.8.7.1'));
  check('reschedule: limited per address', statuses[10] === 429, JSON.stringify(statuses));

  const moved = await post('/api/bookings/reschedule', { token, start: utc(D.mon.at('11:00')) }, '10.8.8.1');
  check('a real link still reschedules', moved.status === 200 && sql(`select to_char(start_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS".000Z"') from bookings where token_hash='${tokenHash(token)}'`) === utc(D.mon.at('11:00')));
  const cancelled = await post('/api/bookings/cancel', { token, reason: 'done testing' }, '10.8.8.1');
  check('and cancels', cancelled.status === 200 && sql(`select status from bookings where token_hash='${tokenHash(token)}'`) === 'cancelled');

  console.log('Buffers are enforced by the database');
  sql('delete from bookings; delete from rate_limits');
  const insert = (name, start, end, before = 0, after = 0) =>
    `insert into bookings (token_hash, event_name, start_at, end_at, buffer_before_minutes, buffer_after_minutes, invitee_name, invitee_email, invitee_timezone) values ('${name}', '${name}', '${utc(start)}', '${utc(end)}', ${before}, ${after}, '${name}', 'x@example.com', 'UTC')`;
  const tryInsert = (...args) => {
    try {
      sql(insert(...args));
      return true;
    } catch {
      return false;
    }
  };
  check('a meeting with 15 minutes kept free after it is stored', tryInsert('a', D.wed.at('10:00'), D.wed.at('10:30'), 0, 15));
  check('one starting the moment it ends is refused', !tryInsert('b', D.wed.at('10:30'), D.wed.at('11:00')));
  check('one starting inside the gap is refused', !tryInsert('c', D.wed.at('10:40'), D.wed.at('11:10')));
  check('one starting when the gap ends is accepted', tryInsert('d', D.wed.at('10:45'), D.wed.at('11:15')));
  check("the newcomer's own buffer counts too", !tryInsert('e', D.wed.at('09:00'), D.wed.at('09:30'), 0, 45) && tryInsert('f', D.wed.at('09:00'), D.wed.at('09:30'), 0, 30));
  check('a buffer before is enforced the same way', !tryInsert('g', D.wed.at('11:15'), D.wed.at('11:45'), 10, 0) && tryInsert('h', D.wed.at('11:25'), D.wed.at('11:55'), 10, 0));
  let movedIntoGap = true;
  try {
    sql(`update bookings set start_at = '${utc(D.wed.at('11:20'))}', end_at = '${utc(D.wed.at('11:50'))}' where token_hash = 'h'`);
  } catch {
    movedIntoGap = false;
  }
  check('moving a meeting into a gap is refused as well', !movedIntoGap);
  sql("update bookings set status = 'cancelled' where token_hash = 'a'");
  check("a cancelled meeting's buffer no longer blocks", tryInsert('i', D.wed.at('10:00'), D.wed.at('10:45')));

  // The race itself, straight at the database. Two back-to-back meetings are
  // written in transactions that are open at the same time, so neither can
  // see the other. Each alone is fine; together they break the 15-minute gap.
  // Without the trigger's lock both are stored every time; with it, exactly
  // one must win, every time.
  sql('delete from bookings');
  const held = (statement) => sqlAsync(`begin; ${statement}; select pg_sleep(0.2); commit;`);
  let bothWon = 0;
  let neitherWon = 0;
  for (let round = 0; round < 10; round++) {
    const day = D.thu.at('09:00').plus({ minutes: round * 60 });
    const results = await Promise.all([
      held(insert(`r${round}a`, day, day.plus({ minutes: 30 }), 0, 15)),
      held(insert(`r${round}b`, day.plus({ minutes: 30 }), day.plus({ minutes: 55 }), 0, 0)),
    ]);
    if (results[0] && results[1]) bothWon++;
    if (!results[0] && !results[1]) neitherWon++;
  }
  check('10 pairs of overlapping transactions: never both stored, always one', bothWon === 0 && neitherWon === 0, `both=${bothWon} neither=${neitherWon}`);
  check('exactly ten of the twenty were stored', sql("select count(*) from bookings where status = 'confirmed'") === '10');

  // And through the app: an event type with a 30-minute gap after each
  // meeting, and two visitors booking adjacent slots at the same moment.
  sql('delete from bookings');
  sql("update event_types set buffer_after_minutes = 30 where slug = '30min'");
  const adjacent = await Promise.all([
    post('/api/bookings', { slug: '30min', start: utc(D.fri.at('10:00')), name: 'Racer One', email: 'one@example.com', timezone: 'UTC' }, '10.8.9.1'),
    post('/api/bookings', { slug: '30min', start: utc(D.fri.at('10:30')), name: 'Racer Two', email: 'two@example.com', timezone: 'UTC' }, '10.8.9.2'),
  ]);
  const outcome = adjacent.map((r) => r.status).sort().join();
  check('two visitors racing for adjacent slots: one is booked, one is told the time is gone', outcome === '200,409', outcome);
  const loser = adjacent.find((r) => r.status === 409);
  check('the loser gets the usual "no longer available" message', /no longer available/.test((await loser.json()).message));
  check('only one booking exists', sql("select count(*) from bookings where status = 'confirmed'") === '1');
  const after = await daySlots(D.fri);
  check('and the page then offers neither slot', !after.times.includes('10:00') && !after.times.includes('10:30'));

  await browser.close();
  finish();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
