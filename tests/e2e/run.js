#!/usr/bin/env node
// Runs the end-to-end specs: builds the app, starts it against a scratch
// database plus stand-ins for Google, Microsoft, email and friends, and then
// drives a real browser through every flow.
//
//   npm run test:e2e                 everything
//   npm run test:e2e -- --no-build   reuse the last build
//   npm run test:e2e -- google       only specs whose file name contains "google"
//
// Needs: a local Postgres with a database whose name ends in "_test"
// (E2E_DATABASE_URL), `psql`, and Playwright with Chromium. The CalDAV spec
// also needs Radicale (`pip install radicale`); it is skipped without it.
// See tests/e2e/README.md.
const { spawn, spawnSync, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(__dirname, '.out');
const PORT = process.env.E2E_PORT || '3210';
const DATABASE_URL = process.env.E2E_DATABASE_URL || 'postgres://calendi:calendi@localhost:5432/calendi_test';
const BASE = `http://localhost:${PORT}`;
const args = process.argv.slice(2);
const filter = args.find((a) => !a.startsWith('--'));
const children = [];

function fail(message) {
  console.error(`\n${message}`);
  stopAll();
  process.exit(1);
}

function stopAll() {
  for (const child of children) {
    try {
      child.kill('SIGTERM');
    } catch {
      // already gone
    }
  }
}
process.on('SIGINT', () => {
  stopAll();
  process.exit(130);
});

function start(name, command, commandArgs, env = {}) {
  const log = fs.openSync(path.join(OUT, `${name}.log`), 'w');
  const child = spawn(command, commandArgs, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', log, log] });
  child.on('error', () => {});
  children.push(child);
  return child;
}

async function waitFor(url, label, init) {
  for (let i = 0; i < 80; i++) {
    try {
      await fetch(url, init);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  fail(`${label} did not start. See ${path.join(OUT, '*.log')}`);
}

async function portFree(port) {
  try {
    await fetch(`http://localhost:${port}`);
    return false;
  } catch {
    return true;
  }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  // 1. A scratch database, emptied and migrated. Refuse anything that does not look like one.
  const database = new URL(DATABASE_URL).pathname.slice(1);
  if (!database.endsWith('_test')) {
    fail(`Refusing to wipe "${database}": E2E_DATABASE_URL must point at a database whose name ends in "_test".`);
  }
  try {
    execFileSync('psql', [DATABASE_URL, '-q', '-v', 'ON_ERROR_STOP=1', '-c', 'drop schema public cascade; create schema public;'], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (error) {
    fail(`Could not reach the test database at ${DATABASE_URL}\n${error.stderr || error.message}`);
  }
  const migrate = spawnSync('node', ['scripts/migrate.mjs'], { cwd: ROOT, env: { ...process.env, DATABASE_URL }, stdio: 'inherit' });
  if (migrate.status !== 0) fail('Migrations failed.');

  // 2. Build.
  if (!args.includes('--no-build')) {
    console.log('Building the app…');
    const build = spawnSync('node', ['node_modules/next/dist/bin/next', 'build'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
    if (build.status !== 0) fail(`The build failed.\n${build.stdout}`);
  }

  // 3. Stand-in services.
  for (const port of [PORT, 4001]) {
    if (!(await portFree(port))) fail(`Port ${port} is already in use. Stop whatever is running there and try again.`);
  }
  start('mocks', 'node', [path.join(__dirname, 'mocks.js')]);
  await waitFor('http://localhost:4001/state', 'The mock services');

  // 4. A real CalDAV server, if Radicale is installed.
  const python = process.env.RADICALE_PYTHON || 'python3';
  let caldav = spawnSync(python, ['-m', 'radicale', '--version'], { stdio: 'ignore' }).status === 0;
  if (caldav) {
    const dir = path.join(OUT, 'radicale');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'users'), 'avi:secret\n');
    fs.writeFileSync(
      path.join(dir, 'config'),
      `[server]\nhosts = 127.0.0.1:5232\n[auth]\ntype = htpasswd\nhtpasswd_filename = ${dir}/users\nhtpasswd_encryption = plain\n[storage]\nfilesystem_folder = ${dir}/collections\n`,
    );
    start('radicale', python, ['-m', 'radicale', '--config', path.join(dir, 'config')]);
    const auth = { Authorization: 'Basic ' + Buffer.from('avi:secret').toString('base64') };
    await waitFor('http://127.0.0.1:5232/', 'Radicale', { headers: auth });
    const made = await fetch('http://127.0.0.1:5232/avi/work/', {
      method: 'MKCALENDAR',
      headers: { ...auth, 'Content-Type': 'application/xml' },
      body: '<?xml version="1.0"?><C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:set><D:prop><D:displayname>Work</D:displayname><C:supported-calendar-component-set><C:comp name="VEVENT"/></C:supported-calendar-component-set></D:prop></D:set></C:mkcalendar>',
    });
    if (made.status !== 201) caldav = false;
  }

  // 5. The app itself, pointed at the stand-ins. The calendar cache is off so
  // each check sees the change it just made.
  start('app', 'node', ['node_modules/next/dist/bin/next', 'start', '-p', PORT], {
    DATABASE_URL,
    APP_SECRET: 'end-to-end-test-secret-0123456789abcdef',
    // With a trailing space and line break, as a value pasted into a host's
    // settings page often has. The setup form is given the clean value.
    SETUP_TOKEN: 'e2e-setup-token-0123456789abcdef \n',
    APP_URL: '',
    CALENDAR_CACHE_SECONDS: '0',
    GOOGLE_AUTH_URL: 'http://localhost:4002/auth',
    GOOGLE_TOKEN_URL: 'http://localhost:4002/token',
    GOOGLE_API_BASE: 'http://localhost:4002',
    MICROSOFT_LOGIN_BASE: 'http://localhost:4003',
    MICROSOFT_GRAPH_BASE: 'http://localhost:4003/v1.0',
    RESEND_API_URL: 'http://localhost:4004/emails',
    // Never let real credentials from the shell leak into a test run.
    GOOGLE_CLIENT_ID: '',
    GOOGLE_CLIENT_SECRET: '',
    MICROSOFT_CLIENT_ID: '',
    MICROSOFT_CLIENT_SECRET: '',
    RESEND_API_KEY: '',
    SMTP_HOST: '',
    EMAIL_FROM: '',
  });
  await waitFor(`${BASE}/admin/login`, 'The app');

  // 6. The specs, in order. 01 creates the owner the others sign in as.
  const specs = fs
    .readdirSync(__dirname)
    .filter((file) => /^\d\d-.*\.js$/.test(file))
    .sort()
    .filter((file) => file.startsWith('01-') || !filter || file.includes(filter));
  const results = [];
  for (const spec of specs) {
    if (spec.includes('caldav') && !caldav) {
      console.log(`\n── ${spec}: skipped (Radicale is not installed; pip install radicale)`);
      results.push([spec, 'skipped']);
      continue;
    }
    console.log(`\n── ${spec}`);
    const run = spawnSync('node', [path.join(__dirname, spec)], {
      cwd: ROOT,
      env: { ...process.env, E2E_PORT: PORT, E2E_DATABASE_URL: DATABASE_URL },
      stdio: 'inherit',
      timeout: 300_000,
    });
    results.push([spec, run.status === 0 ? 'passed' : 'FAILED']);
    if (spec.startsWith('01-') && run.status !== 0) break;
  }

  stopAll();
  console.log('\n── Summary');
  for (const [spec, result] of results) console.log(`  ${result.padEnd(8)} ${spec}`);
  console.log(`\nScreenshots and service logs: ${OUT}`);
  // On a developer's machine a missing optional tool only skips its spec. In
  // CI everything is installed, so a skip means the setup broke: fail loudly.
  const bad = results.some(([, result]) => result === 'FAILED' || (process.env.CI && result === 'skipped'));
  process.exit(bad ? 1 : 0);
})();
