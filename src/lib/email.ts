import 'server-only';
import nodemailer from 'nodemailer';
import { buildIcs } from './calendars/icsBuild';
import { onCalendarFailure, PROVIDER_NAMES } from './calendars';
import { formatRange, zoneLabel } from './format';
import { getOwner, readIntegrations } from './store';
import type { Booking, Integrations, Owner } from './types';

// Outgoing email. Optional: with nothing configured every function here is a
// quiet no-op, and invitations still go out through Google or Outlook when
// bookings are saved to one of those calendars.

type EmailConfig = NonNullable<Integrations['email']>;

type Message = {
  to: string[];
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
  attachments?: { filename: string; content: string; contentType: string }[];
};

/** Environment variables win over what was saved in the admin. */
export function emailConfig(owner: Owner | null): EmailConfig | null {
  if (process.env.RESEND_API_KEY && process.env.EMAIL_FROM) {
    return { provider: 'resend', from: process.env.EMAIL_FROM, resendApiKey: process.env.RESEND_API_KEY };
  }
  if (process.env.SMTP_HOST && process.env.EMAIL_FROM) {
    return {
      provider: 'smtp',
      from: process.env.EMAIL_FROM,
      smtpHost: process.env.SMTP_HOST,
      smtpPort: Number(process.env.SMTP_PORT ?? 587),
      smtpUser: process.env.SMTP_USER,
      smtpPass: process.env.SMTP_PASS,
    };
  }
  const saved = readIntegrations(owner).email;
  if (!saved || saved.provider === 'none' || !saved.from) return null;
  if (saved.provider === 'resend' && !saved.resendApiKey) return null;
  if (saved.provider === 'smtp' && !saved.smtpHost) return null;
  return saved;
}

function fromHeader(config: EmailConfig, owner: Owner | null): string {
  if (config.from.includes('<')) return config.from;
  const name = (owner?.name ?? 'Calendi').replace(/["<>\r\n]/g, '');
  return `"${name}" <${config.from}>`;
}

/** Sends one message. Throws on failure; callers decide whether that matters. */
export async function sendEmail(message: Message, owner: Owner | null, config: EmailConfig): Promise<void> {
  const from = fromHeader(config, owner);
  if (config.provider === 'resend') {
    const response = await fetch(process.env.RESEND_API_URL ?? 'https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        reply_to: message.replyTo,
        attachments: message.attachments?.map((a) => ({
          filename: a.filename,
          content: Buffer.from(a.content, 'utf8').toString('base64'),
          content_type: a.contentType,
        })),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(`Resend answered ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }
    return;
  }

  const port = config.smtpPort || 587;
  const transport = nodemailer.createTransport({
    host: config.smtpHost,
    port,
    secure: port === 465,
    auth: config.smtpUser ? { user: config.smtpUser, pass: config.smtpPass ?? '' } : undefined,
    connectionTimeout: 15_000,
    socketTimeout: 20_000,
  });
  await transport.sendMail({
    from,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
    replyTo: message.replyTo,
    attachments: message.attachments,
  });
}

// ── Templates ────────────────────────────────────────────────────────────

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

type Row = [label: string, value: string];
type Action = { label: string; url: string };

function layout(input: {
  heading: string;
  intro: string;
  rows: Row[];
  actions?: Action[];
  footer?: string;
  color: string;
}): { text: string; html: string } {
  const rows = input.rows.filter(([, value]) => value);
  const text = [
    input.heading,
    '',
    input.intro,
    '',
    ...rows.map(([label, value]) => `${label}: ${value}`),
    '',
    ...(input.actions ?? []).map((a) => `${a.label}: ${a.url}`),
    ...(input.footer ? ['', input.footer] : []),
  ].join('\n');

  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f4f5;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#18181b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid #e4e4e7">
<tr><td style="height:6px;background:${esc(input.color)};border-radius:12px 12px 0 0;font-size:0">&nbsp;</td></tr>
<tr><td style="padding:28px 32px">
<h1 style="margin:0 0 8px;font-size:20px;line-height:28px">${esc(input.heading)}</h1>
<p style="margin:0 0 20px;font-size:15px;line-height:22px;color:#52525b">${esc(input.intro)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;line-height:21px">
${rows
  .map(
    ([label, value]) =>
      `<tr><td style="padding:6px 16px 6px 0;color:#71717a;vertical-align:top;white-space:nowrap">${esc(label)}</td><td style="padding:6px 0;vertical-align:top">${esc(value).replace(/\n/g, '<br>')}</td></tr>`,
  )
  .join('\n')}
</table>
${
  input.actions?.length
    ? `<p style="margin:24px 0 0">${input.actions
        .map(
          (a, i) =>
            `<a href="${esc(a.url)}" style="display:inline-block;margin:0 8px 8px 0;padding:9px 16px;border-radius:8px;font-size:14px;text-decoration:none;${
              i === 0
                ? `background:${esc(input.color)};color:#ffffff`
                : 'border:1px solid #d4d4d8;color:#18181b'
            }">${esc(a.label)}</a>`,
        )
        .join('')}</p>`
    : ''
}
${input.footer ? `<p style="margin:20px 0 0;font-size:13px;line-height:19px;color:#71717a">${esc(input.footer)}</p>` : ''}
</td></tr></table>
</td></tr></table></body></html>`;
  return { text, html };
}

function whereRow(booking: Booking): Row {
  return ['Where', booking.meeting_url || booking.location];
}

function answerRows(booking: Booking): Row[] {
  return [
    ...booking.answers.map((a): Row => [a.label, a.value]),
    ['Notes', booking.notes],
    ['Guests', booking.guests.join(', ')],
  ];
}

function icsAttachment(booking: Booking, owner: Owner, cancelled = false) {
  return {
    filename: 'invite.ics',
    contentType: 'text/calendar; charset=utf-8',
    content: buildIcs({
      uid: `${booking.id}@calendi`,
      start: booking.start_at,
      end: booking.end_at,
      title: `${booking.event_name} with ${owner.name}`,
      description: booking.meeting_url ? `Join: ${booking.meeting_url}` : '',
      location: booking.meeting_url || booking.location,
      sequence: booking.sequence,
      cancelled,
      method: cancelled ? 'CANCEL' : 'PUBLISH',
    }),
  };
}

export type BookingEvent = 'created' | 'rescheduled' | 'cancelled';

/**
 * Sends the emails for a booking change. The invitee is emailed only when
 * their calendar provider has not already sent them an invitation.
 * Never throws: email problems must not undo a booking.
 */
export async function sendBookingEmails(
  event: BookingEvent,
  booking: Booking,
  owner: Owner,
  baseUrl: string,
): Promise<void> {
  const config = emailConfig(owner);
  if (!config) return;
  const manageUrl = `${baseUrl}/booking/${booking.token}`;
  const jobs: Promise<void>[] = [];

  if (!booking.invited_by_calendar) {
    const when = `${formatRange(booking.start_at, booking.end_at, booking.invitee_timezone)} (${zoneLabel(booking.invitee_timezone, booking.start_at)})`;
    const copy = {
      created: {
        subject: `Confirmed: ${booking.event_name} with ${owner.name}`,
        heading: 'You are scheduled',
        intro: `Your meeting with ${owner.name} is confirmed.`,
      },
      rescheduled: {
        subject: `Rescheduled: ${booking.event_name} with ${owner.name}`,
        heading: 'Your meeting was rescheduled',
        intro: `Your meeting with ${owner.name} has a new time.`,
      },
      cancelled: {
        subject: `Cancelled: ${booking.event_name} with ${owner.name}`,
        heading: 'Your meeting was cancelled',
        intro: `Your meeting with ${owner.name} will not take place.`,
      },
    }[event];
    const body = layout({
      heading: copy.heading,
      intro: copy.intro,
      color: owner.brand_color,
      rows: [
        ['What', booking.event_name],
        ['When', when],
        ...(event === 'cancelled' ? [] : [whereRow(booking)]),
        ...(event === 'cancelled' ? ([['Reason', booking.cancel_reason]] as Row[]) : []),
      ],
      actions:
        event === 'cancelled'
          ? []
          : [
              { label: 'View booking', url: manageUrl },
              { label: 'Reschedule', url: `${manageUrl}/reschedule` },
              { label: 'Cancel', url: `${manageUrl}/cancel` },
            ],
    });
    jobs.push(
      sendEmail(
        {
          to: [booking.invitee_email, ...booking.guests],
          subject: copy.subject,
          ...body,
          replyTo: owner.email,
          attachments: [icsAttachment(booking, owner, event === 'cancelled')],
        },
        owner,
        config,
      ),
    );
  }

  const ownerWhen = `${formatRange(booking.start_at, booking.end_at, owner.timezone)} (${zoneLabel(owner.timezone, booking.start_at)})`;
  const ownerCopy = {
    created: { subject: `New booking: ${booking.invitee_name}`, heading: 'New booking' },
    rescheduled: { subject: `Rescheduled: ${booking.invitee_name}`, heading: 'Booking rescheduled' },
    cancelled: { subject: `Cancelled: ${booking.invitee_name}`, heading: 'Booking cancelled' },
  }[event];
  const ownerBody = layout({
    heading: ownerCopy.heading,
    intro: `${booking.event_name} with ${booking.invitee_name}.`,
    color: owner.brand_color,
    rows: [
      ['Invitee', `${booking.invitee_name} <${booking.invitee_email}>`],
      ['When', ownerWhen],
      ...(event === 'cancelled'
        ? ([
            ['Cancelled by', booking.cancelled_by === 'host' ? 'You' : 'The invitee'],
            ['Reason', booking.cancel_reason],
          ] as Row[])
        : [whereRow(booking)]),
      ['Phone', booking.invitee_phone],
      ...answerRows(booking),
      ['Calendar', booking.sync_error ? `Not saved to your calendar: ${booking.sync_error}` : ''],
    ],
    actions: [{ label: 'Open bookings', url: `${baseUrl}/admin/bookings` }],
  });
  jobs.push(
    sendEmail(
      { to: [owner.email], subject: ownerCopy.subject, ...ownerBody, replyTo: booking.invitee_email },
      owner,
      config,
    ),
  );

  const results = await Promise.allSettled(jobs);
  for (const result of results) {
    if (result.status === 'rejected') console.error('[email] send failed:', result.reason);
  }
}

export async function sendTestEmail(owner: Owner, config: EmailConfig): Promise<void> {
  const body = layout({
    heading: 'Email is working',
    intro: 'This is a test message from your Calendi scheduling page.',
    color: owner.brand_color,
    rows: [['Sent to', owner.email]],
  });
  await sendEmail({ to: [owner.email], subject: 'Calendi test email', ...body }, owner, config);
}

// Tell the owner (at most once a day per account) when a calendar stops syncing.
onCalendarFailure(async (account, detail) => {
  const owner = await getOwner();
  const config = emailConfig(owner);
  if (!owner || !config) return;
  const body = layout({
    heading: 'A calendar stopped syncing',
    intro:
      'Calendi could not read one of your calendars, so your booking pages are paused until it is fixed.',
    color: '#dc2626',
    rows: [
      ['Calendar', `${PROVIDER_NAMES[account.provider]} (${account.label})`],
      ['Problem', detail],
    ],
    footer: 'Open Calendars in your Calendi admin to reconnect it.',
  });
  await sendEmail({ to: [owner.email], subject: 'Action needed: a calendar stopped syncing', ...body }, owner, config);
});
