import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { oauthClient } from '@/lib/calendars';
import { googleAuthorizeUrl } from '@/lib/calendars/google';
import { microsoftAuthorizeUrl } from '@/lib/calendars/microsoft';
import { randomToken, sign } from '@/lib/crypto';
import { getBaseUrl } from '@/lib/env';
import { currentOwner } from '@/lib/session';

// GET /api/oauth/google/start (or /microsoft/start): sends the signed-in owner
// to the provider's consent screen.

export async function GET(_request: NextRequest, context: RouteContext<'/api/oauth/[provider]/start'>) {
  const { provider } = await context.params;
  const baseUrl = await getBaseUrl();
  if (!(await currentOwner())) return NextResponse.redirect(`${baseUrl}/admin/login`);
  if (provider !== 'google' && provider !== 'microsoft') {
    return NextResponse.redirect(`${baseUrl}/admin/calendars`);
  }

  const client = await oauthClient(provider);
  if (!client) {
    const message = encodeURIComponent('Add the app credentials first (see the setup steps below).');
    return NextResponse.redirect(`${baseUrl}/admin/calendars?error=${message}`);
  }

  // The state value ties the provider's reply to this browser.
  const state = randomToken(16);
  const payload = `${provider}.${state}`;
  (await cookies()).set('calendi_oauth', `${payload}.${sign(payload)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/oauth',
    maxAge: 600,
  });

  const redirectUri = `${baseUrl}/api/oauth/${provider}/callback`;
  const url =
    provider === 'google'
      ? googleAuthorizeUrl(client, redirectUri, state)
      : microsoftAuthorizeUrl(client, redirectUri, state);
  return NextResponse.redirect(url);
}
