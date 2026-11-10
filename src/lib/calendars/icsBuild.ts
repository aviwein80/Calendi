// Writes iCalendar text for a booking: the .ics download on the confirmation
// page, the attachment on confirmation emails, and events saved over CalDAV.

export type IcsEvent = {
  uid: string;
  start: Date;
  end: Date;
  title: string;
  description: string;
  location: string;
  organizer?: { name: string; email: string };
  attendees?: { name: string; email: string }[];
  sequence?: number;
  cancelled?: boolean;
  /** PUBLISH for a plain "add to calendar" file, CANCEL when withdrawing it. */
  method?: 'PUBLISH' | 'CANCEL';
};

function stamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function escapeParam(value: string): string {
  return value.replace(/["\r\n]/g, ' ').replace(/[;:,]/g, ' ').trim();
}

/** Lines may be at most 75 octets; longer ones continue on the next line after a space. */
function fold(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  let size = 0;
  for (const char of line) {
    const charSize = Buffer.byteLength(char, 'utf8');
    const limit = parts.length === 0 ? 75 : 74;
    if (size + charSize > limit) {
      parts.push(current);
      current = '';
      size = 0;
    }
    current += char;
    size += charSize;
  }
  if (current) parts.push(current);
  return parts.join('\r\n ');
}

export function buildIcs(event: IcsEvent, now: Date = new Date()): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Calendi//Scheduling//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${event.method ?? 'PUBLISH'}`,
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART:${stamp(event.start)}`,
    `DTEND:${stamp(event.end)}`,
    `SUMMARY:${escapeText(event.title)}`,
  ];
  if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
  if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
  if (event.organizer) {
    lines.push(`ORGANIZER;CN=${escapeParam(event.organizer.name)}:mailto:${event.organizer.email}`);
  }
  for (const attendee of event.attendees ?? []) {
    lines.push(
      `ATTENDEE;CN=${escapeParam(attendee.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED:mailto:${attendee.email}`,
    );
  }
  lines.push(`SEQUENCE:${event.sequence ?? 0}`);
  lines.push(`STATUS:${event.cancelled ? 'CANCELLED' : 'CONFIRMED'}`);
  lines.push('TRANSP:OPAQUE', 'END:VEVENT', 'END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
