// Stand-ins for the outside services the app talks to, so the end-to-end specs
// can run with no real accounts: an ICS feed, a webhook receiver, Google
// Calendar, Microsoft Graph, Resend and an SMTP server. Everything is kept in
// memory and can be inspected (GET :4001/state) or cleared (POST :4001/reset).
const http = require('http');
const net = require('net');

const EMPTY_FEED = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nX-WR-CALNAME:Test Feed\r\nEND:VCALENDAR\r\n';
const fresh = () => ({
  feed: { status: 200, body: EMPTY_FEED },
  webhooks: [],
  emails: [],
  smtp: [],
  google: { events: [], tokenCalls: [], apiCalls: [], seq: 0, access: 0, failFreeBusy: false },
  microsoft: { events: [], tokenCalls: [], apiCalls: [], seq: 0, access: 0 },
});
const state = fresh();

function body(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
  });
}
const send = (res, status, payload, headers = {}) => {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': typeof payload === 'string' ? 'text/plain' : 'application/json', ...headers });
  res.end(text);
};

// ── :4001 control, feed, webhook ──────────────────────────────────────────
http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const raw = await body(req);
    if (url.pathname === '/feed.ics') {
      if (state.feed.status !== 200) return send(res, state.feed.status, 'nope');
      return send(res, 200, state.feed.body, { 'Content-Type': 'text/calendar' });
    }
    if (url.pathname === '/feed' && req.method === 'POST') {
      Object.assign(state.feed, JSON.parse(raw));
      return send(res, 200, { ok: true });
    }
    if (url.pathname === '/hook') {
      state.webhooks.push({ headers: req.headers, body: JSON.parse(raw || '{}'), raw });
      return send(res, 200, { ok: true });
    }
    if (url.pathname === '/state') return send(res, 200, state);
    if (url.pathname === '/reset' && req.method === 'POST') {
      Object.assign(state, fresh());
      return send(res, 200, { ok: true });
    }
    if (url.pathname === '/google/event' && req.method === 'POST') {
      state.google.events.push({ id: `ext-${++state.google.seq}`, external: true, ...JSON.parse(raw) });
      return send(res, 200, { ok: true });
    }
    if (url.pathname === '/google/set' && req.method === 'POST') {
      Object.assign(state.google, JSON.parse(raw));
      return send(res, 200, { ok: true });
    }
    if (url.pathname === '/microsoft/event' && req.method === 'POST') {
      state.microsoft.events.push({ id: `ext-${++state.microsoft.seq}`, external: true, ...JSON.parse(raw) });
      return send(res, 200, { ok: true });
    }
    send(res, 404, 'not found');
  })
  .listen(4001);

// ── :4002 Google ──────────────────────────────────────────────────────────
http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const raw = await body(req);
    const g = state.google;
    if (url.pathname === '/auth') {
      const back = new URL(url.searchParams.get('redirect_uri'));
      g.authQuery = Object.fromEntries(url.searchParams);
      back.searchParams.set('code', 'g-code');
      back.searchParams.set('state', url.searchParams.get('state'));
      res.writeHead(302, { Location: back.href });
      return res.end();
    }
    if (url.pathname === '/token') {
      const form = Object.fromEntries(new URLSearchParams(raw));
      g.tokenCalls.push(form);
      if (form.grant_type === 'authorization_code') {
        const idToken = ['x', Buffer.from(JSON.stringify({ email: 'avi@gmail.test' })).toString('base64url'), 'y'].join('.');
        // Expires almost at once, so the very next call has to refresh.
        return send(res, 200, { access_token: `g-access-${++g.access}`, expires_in: 1, refresh_token: 'g-refresh', id_token: idToken });
      }
      if (form.refresh_token !== 'g-refresh') return send(res, 400, { error: 'invalid_grant' });
      return send(res, 200, { access_token: `g-access-${++g.access}`, expires_in: 3600 });
    }
    const auth = req.headers.authorization || '';
    g.apiCalls.push({ method: req.method, path: url.pathname + url.search, auth });
    if (auth !== `Bearer g-access-${g.access}`) return send(res, 401, { error: 'stale token ' + auth });
    if (url.pathname === '/calendar/v3/users/me/calendarList') {
      return send(res, 200, {
        items: [
          { id: 'avi@gmail.test', summary: 'avi@gmail.test', accessRole: 'owner', primary: true, backgroundColor: '#4285f4' },
          { id: 'family@group.calendar.google.com', summary: 'Family', accessRole: 'writer', backgroundColor: '#0b8043' },
          { id: 'holidays@group.v.calendar.google.com', summary: 'Holidays in United States', accessRole: 'reader' },
        ],
      });
    }
    if (url.pathname === '/calendar/v3/freeBusy') {
      const q = JSON.parse(raw);
      g.lastFreeBusy = q;
      if (g.failFreeBusy) return send(res, 500, { error: 'backend error' });
      const calendars = {};
      for (const { id } of q.items) {
        calendars[id] = {
          busy: g.events
            .filter((e) => e.calendarId === id && e.transparency !== 'transparent')
            .filter((e) => Date.parse(e.end) > Date.parse(q.timeMin) && Date.parse(e.start) < Date.parse(q.timeMax))
            .map((e) => ({ start: e.start, end: e.end })),
        };
      }
      return send(res, 200, { calendars });
    }
    let m = /^\/calendar\/v3\/calendars\/([^/]+)\/events$/.exec(url.pathname);
    if (m && req.method === 'POST') {
      const input = JSON.parse(raw);
      const event = {
        id: `gev-${++g.seq}`,
        calendarId: decodeURIComponent(m[1]),
        start: input.start.dateTime,
        end: input.end.dateTime,
        input,
        query: Object.fromEntries(url.searchParams),
      };
      g.events.push(event);
      return send(res, 200, {
        id: event.id,
        ...(input.conferenceData ? { hangoutLink: `https://meet.google.test/${event.id}` } : {}),
      });
    }
    m = /^\/calendar\/v3\/calendars\/([^/]+)\/events\/([^/]+)$/.exec(url.pathname);
    if (m) {
      const event = g.events.find((e) => e.id === decodeURIComponent(m[2]));
      if (!event) return send(res, 404, { error: 'gone' });
      if (req.method === 'PATCH') {
        const input = JSON.parse(raw);
        event.start = input.start.dateTime;
        event.end = input.end.dateTime;
        event.patched = (event.patched || 0) + 1;
        event.patchQuery = Object.fromEntries(url.searchParams);
        return send(res, 200, { id: event.id });
      }
      if (req.method === 'DELETE') {
        g.events = g.events.filter((e) => e !== event);
        g.deleted = [...(g.deleted || []), { id: event.id, query: Object.fromEntries(url.searchParams) }];
        res.writeHead(204);
        return res.end();
      }
    }
    send(res, 404, { error: 'unknown ' + url.pathname });
  })
  .listen(4002);

// ── :4003 Microsoft ───────────────────────────────────────────────────────
const graphTime = (iso) => new Date(iso).toISOString().replace('Z', '0000');
http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost:4003');
    const raw = await body(req);
    const ms = state.microsoft;
    if (url.pathname === '/common/oauth2/v2.0/authorize') {
      const back = new URL(url.searchParams.get('redirect_uri'));
      ms.authQuery = Object.fromEntries(url.searchParams);
      back.searchParams.set('code', 'ms-code');
      back.searchParams.set('state', url.searchParams.get('state'));
      res.writeHead(302, { Location: back.href });
      return res.end();
    }
    if (url.pathname === '/common/oauth2/v2.0/token') {
      const form = Object.fromEntries(new URLSearchParams(raw));
      ms.tokenCalls.push(form);
      if (form.grant_type === 'refresh_token' && form.refresh_token !== `ms-refresh-${ms.access}`) {
        return send(res, 400, { error: 'invalid_grant', error_description: 'stale refresh token' });
      }
      ms.access++;
      // Refresh tokens rotate, as Microsoft's do.
      return send(res, 200, { access_token: `ms-access-${ms.access}`, expires_in: 1, refresh_token: `ms-refresh-${ms.access}` });
    }
    const auth = req.headers.authorization || '';
    ms.apiCalls.push({ method: req.method, path: url.pathname + url.search, auth, prefer: req.headers.prefer });
    if (auth !== `Bearer ms-access-${ms.access}`) return send(res, 401, { error: { message: 'stale token' } });
    if (url.pathname === '/v1.0/me') return send(res, 200, { mail: 'avi@outlook.test', userPrincipalName: 'avi@outlook.test' });
    if (url.pathname === '/v1.0/me/calendars') {
      return send(res, 200, {
        value: [
          { id: 'cal-default', name: 'Calendar', canEdit: true, isDefaultCalendar: true, hexColor: '#0078d4' },
          { id: 'cal-bday', name: 'Birthdays', canEdit: false, isDefaultCalendar: false },
        ],
      });
    }
    let m = /^\/v1\.0\/me\/calendars\/([^/]+)\/calendarView$/.exec(url.pathname);
    if (m) {
      const from = Date.parse(url.searchParams.get('startDateTime'));
      const to = Date.parse(url.searchParams.get('endDateTime'));
      const all = ms.events
        .filter((e) => e.calendarId === decodeURIComponent(m[1]))
        .filter((e) => Date.parse(e.end) > from && Date.parse(e.start) < to)
        .map((e) => ({
          start: { dateTime: graphTime(e.start), timeZone: 'UTC' },
          end: { dateTime: graphTime(e.end), timeZone: 'UTC' },
          showAs: e.showAs || 'busy',
          isCancelled: false,
          isAllDay: Boolean(e.isAllDay),
        }));
      // Two pages, to exercise paging.
      const skip = Number(url.searchParams.get('$skip') || 0);
      const page = all.slice(skip, skip + 1);
      const next = skip + 1 < all.length ? new URL(url.href) : null;
      if (next) next.searchParams.set('$skip', String(skip + 1));
      return send(res, 200, { value: page, ...(next ? { '@odata.nextLink': next.href } : {}) });
    }
    m = /^\/v1\.0\/me\/calendars\/([^/]+)\/events$/.exec(url.pathname);
    if (m && req.method === 'POST') {
      const input = JSON.parse(raw);
      const event = {
        id: `msev-${++ms.seq}`,
        calendarId: decodeURIComponent(m[1]),
        start: input.start.dateTime + 'Z',
        end: input.end.dateTime + 'Z',
        input,
      };
      ms.events.push(event);
      return send(res, 201, { id: event.id, onlineMeeting: input.isOnlineMeeting ? { joinUrl: `https://teams.test/${event.id}` } : null });
    }
    m = /^\/v1\.0\/me\/events\/([^/]+)(\/cancel)?$/.exec(url.pathname);
    if (m) {
      const event = ms.events.find((e) => e.id === decodeURIComponent(m[1]));
      if (!event) return send(res, 404, { error: { message: 'gone' } });
      if (req.method === 'PATCH') {
        const input = JSON.parse(raw);
        event.start = input.start.dateTime + 'Z';
        event.end = input.end.dateTime + 'Z';
        event.patched = (event.patched || 0) + 1;
        return send(res, 200, { id: event.id });
      }
      if ((m[2] && req.method === 'POST') || req.method === 'DELETE') {
        ms.events = ms.events.filter((e) => e !== event);
        ms.cancelled = [...(ms.cancelled || []), { id: event.id, via: m[2] ? 'cancel' : 'delete', body: raw }];
        res.writeHead(m[2] ? 202 : 204);
        return res.end();
      }
    }
    send(res, 404, { error: { message: 'unknown ' + url.pathname } });
  })
  .listen(4003);

// ── :4004 Resend ──────────────────────────────────────────────────────────
http
  .createServer(async (req, res) => {
    const raw = await body(req);
    state.emails.push({ auth: req.headers.authorization, ...JSON.parse(raw || '{}') });
    send(res, 200, { id: 'email-' + state.emails.length });
  })
  .listen(4004);


// ── :4025 SMTP ────────────────────────────────────────────────────────────
// Just enough of the protocol for a mail client to sign in and hand over a message.
net
  .createServer((socket) => {
    let buffer = '';
    let receiving = false;
    let raw = '';
    let user = null;
    let envelope = { from: '', to: [] };
    const reply = (line) => socket.write(line + '\r\n');
    reply('220 localhost ESMTP test');
    socket.on('error', () => {});
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let end;
      while ((end = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (receiving) {
          if (line === '.') {
            receiving = false;
            state.smtp.push({ user, ...envelope, raw });
            raw = '';
            reply('250 queued');
          } else {
            raw += (line.startsWith('..') ? line.slice(1) : line) + '\r\n';
          }
          continue;
        }
        const command = line.toUpperCase();
        if (command.startsWith('EHLO')) socket.write('250-localhost\r\n250-AUTH PLAIN\r\n250 8BITMIME\r\n');
        else if (command.startsWith('HELO')) reply('250 localhost');
        else if (command.startsWith('AUTH PLAIN')) {
          const [, name, password] = Buffer.from(line.split(' ')[2] || '', 'base64').toString().split('\0');
          if (name === 'mailer' && password === 'smtp-pass') {
            user = name;
            reply('235 signed in');
          } else reply('535 wrong username or password');
        } else if (command.startsWith('MAIL FROM')) {
          envelope = { from: line.slice(10), to: [] };
          reply('250 ok');
        } else if (command.startsWith('RCPT TO')) {
          envelope.to.push(line.slice(8));
          reply('250 ok');
        } else if (command === 'DATA') {
          receiving = true;
          reply('354 go ahead');
        } else if (command === 'QUIT') {
          reply('221 bye');
          socket.end();
        } else reply('250 ok');
      }
    });
  })
  .listen(4025);

console.log('mocks listening on 4001-4004 and 4025');
