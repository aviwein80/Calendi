import { DateTime } from 'luxon';
import { currentOwner } from '@/lib/session';
import { listAllBookings } from '@/lib/store';

// GET /admin/bookings/export: every booking as a CSV file (owner only).

function cell(value: string): string {
  // Leading =, +, - or @ would be run as a formula by spreadsheet apps.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export async function GET(): Promise<Response> {
  const owner = await currentOwner();
  if (!owner) return new Response('Not signed in', { status: 401 });

  const local = (date: Date | null) =>
    date ? DateTime.fromJSDate(date, { zone: owner.timezone }).toFormat('yyyy-MM-dd HH:mm') : '';
  const header = [
    'Status',
    'Event',
    `Start (${owner.timezone})`,
    `End (${owner.timezone})`,
    'Invitee',
    'Email',
    'Phone',
    'Invitee time zone',
    'Guests',
    'Location',
    'Answers',
    'Notes',
    'Cancelled by',
    'Cancel reason',
    'Booked at',
  ];
  const rows = (await listAllBookings()).map((b) =>
    [
      b.status,
      b.event_name,
      local(b.start_at),
      local(b.end_at),
      b.invitee_name,
      b.invitee_email,
      b.invitee_phone,
      b.invitee_timezone,
      b.guests.join('; '),
      b.meeting_url || b.location,
      b.answers.map((a) => `${a.label}: ${a.value}`).join(' | '),
      b.notes,
      b.cancelled_by,
      b.cancel_reason,
      local(b.created_at),
    ]
      .map(cell)
      .join(','),
  );
  // The byte-order mark makes Excel read the file as UTF-8.
  const csv = '﻿' + [header.map(cell).join(','), ...rows].join('\r\n') + '\r\n';
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="bookings.csv"',
      'Cache-Control': 'no-store',
    },
  });
}
