import 'server-only';
import { hmacHex, sign } from './crypto';
import type { Booking, Owner } from './types';

// Optional outgoing webhook: one JSON POST per booking change, which is what
// Zapier, Make, Slack workflows and similar tools expect.

export type WebhookEvent = 'booking.created' | 'booking.rescheduled' | 'booking.cancelled' | 'test';

/** Shown in Settings so a receiver can verify the X-Calendi-Signature header. */
export function webhookSigningSecret(): string {
  return sign('webhook-signing-secret');
}

export function bookingPayload(booking: Booking, baseUrl: string) {
  return {
    id: booking.id,
    status: booking.status,
    event_name: booking.event_name,
    start: booking.start_at.toISOString(),
    end: booking.end_at.toISOString(),
    previous_start: booking.previous_start_at?.toISOString() ?? null,
    invitee: {
      name: booking.invitee_name,
      email: booking.invitee_email,
      phone: booking.invitee_phone,
      timezone: booking.invitee_timezone,
    },
    guests: booking.guests,
    answers: booking.answers,
    notes: booking.notes,
    location: booking.location,
    meeting_url: booking.meeting_url,
    cancel_reason: booking.cancel_reason,
    cancelled_by: booking.cancelled_by,
    manage_url: `${baseUrl}/booking/${booking.token}`,
    created_at: booking.created_at.toISOString(),
  };
}

/** Posts to the owner's webhook. Throws on failure so the test button can report it. */
export async function postWebhook(url: string, event: WebhookEvent, data: unknown): Promise<void> {
  const body = JSON.stringify({ event, sent_at: new Date().toISOString(), data });
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Calendi-Webhook',
      'X-Calendi-Event': event,
      'X-Calendi-Signature': `sha256=${hmacHex(webhookSigningSecret(), body)}`,
    },
    body,
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`The webhook address answered ${response.status}.`);
}

/** Fire-and-log: a webhook problem must never undo a booking. */
export async function sendBookingWebhook(
  event: Exclude<WebhookEvent, 'test'>,
  booking: Booking,
  owner: Owner,
  baseUrl: string,
): Promise<void> {
  if (!owner.webhook_url) return;
  try {
    await postWebhook(owner.webhook_url, event, bookingPayload(booking, baseUrl));
  } catch (err) {
    console.error('[webhook] delivery failed:', err instanceof Error ? err.message : err);
  }
}
