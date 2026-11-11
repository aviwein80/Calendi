// Browser-side helper for calling this app's own JSON endpoints.

type Failure = { ok: false; code: string; message: string };

/**
 * POSTs JSON and returns the JSON reply. Never throws: a dropped connection
 * or an unreadable reply comes back as a failure with a message to show.
 */
export async function postJson<T extends { ok: boolean }>(url: string, body: unknown): Promise<T | Failure> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const reply = (await response.json().catch(() => null)) as T | Failure | null;
    if (reply && typeof reply === 'object' && 'ok' in reply) return reply;
    return {
      ok: false,
      code: 'error',
      message:
        response.status === 429
          ? 'Too many requests. Please wait a little and try again.'
          : 'Something went wrong on our side. Please try again.',
    };
  } catch {
    return { ok: false, code: 'network', message: 'Could not reach the server. Check your connection and try again.' };
  }
}

/** What the booking endpoints answer. */
export type BookingReply = { ok: true; token: string } | Failure;
