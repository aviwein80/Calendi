import 'server-only';
import { headers } from 'next/headers';

/**
 * The public address of this app, with no trailing slash. Used for links in
 * emails and calendar events, and for the OAuth redirect addresses.
 * Set APP_URL to pin it; otherwise it is worked out from the request.
 */
export async function getBaseUrl(): Promise<string> {
  const configured = process.env.APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  try {
    const list = await headers();
    const host = list.get('x-forwarded-host') ?? list.get('host');
    if (host) {
      const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
      const proto = list.get('x-forwarded-proto')?.split(',')[0] ?? (local ? 'http' : 'https');
      return `${proto}://${host}`;
    }
  } catch {
    // Not inside a request (for example a script); fall through.
  }
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  return 'http://localhost:3000';
}
