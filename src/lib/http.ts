import 'server-only';
import { unstable_rethrow } from 'next/navigation';
import type { Limit, LimitResult } from './rateLimit';

// Small helpers shared by the JSON endpoints under /api.

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

/** 429 Too Many Requests, with the limit's own wording and when to come back. */
export function tooMany(limit: Limit, result: LimitResult): Response {
  return json(
    { ok: false, code: 'rate_limited', error: 'rate_limited', message: limit.message },
    429,
    { 'Retry-After': String(result.retryAfterSeconds) },
  );
}

/**
 * True when a browser says the request was started by a different website.
 * These endpoints are only meant to be called by this app's own pages.
 */
export function fromAnotherSite(request: Request): boolean {
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return true;
  const origin = request.headers.get('origin');
  if (!origin) return false;
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

export const NOT_ALLOWED = () =>
  json({ ok: false, code: 'forbidden', message: 'This request was not sent from this site.' }, 403);

const MAX_BODY_BYTES = 64 * 1024;

/** Parses a small JSON body. Returns undefined for anything oversized or malformed. */
export async function readJson(request: Request): Promise<unknown> {
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return undefined;
  if (!(request.headers.get('content-type') ?? '').toLowerCase().includes('application/json')) return undefined;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return undefined;
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Wraps an endpoint so that an unexpected failure (most often the database or
 * a required setting being unavailable) is still answered with readable JSON.
 */
export function guarded<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (err) {
      // Next.js signals "decide this at request time" (and redirects) by
      // throwing; those are not failures and must pass through untouched.
      unstable_rethrow(err);
      console.error('[api] unexpected error:', err);
      return json({ ok: false, code: 'error', error: 'error', message: 'Something went wrong on our side. Please try again.' }, 500);
    }
  };
}
