import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { accountSummary, oauthClient } from '@/lib/calendars';
import { googleAuthorizeUrl } from '@/lib/calendars/google';
import { microsoftAuthorizeUrl } from '@/lib/calendars/microsoft';
import { oauthRedirectUri } from '@/lib/calendars/setup';
import { randomToken, sign } from '@/lib/crypto';
import { getBaseUrl } from '@/lib/env';
import { currentOwner } from '@/lib/session';
import { getCalendarAccount } from '@/lib/store';

// GET /api/oauth/google/start (or /microsoft/start): sends the signed-in owner
// straight to the provider's sign-in, which always starts with its account
// picker, so the same button adds a second or third account.
// ?account=<id> reconnects that account: the picker is pre-filled with it.

export async function GET(request: NextRequest, context: RouteContext<'/api/oauth/[provider]/start'>) {
  const { provider } = await context.params;
  const baseUrl = await getBaseUrl();
  if (!(await currentOwner())) return NextResponse.redirect(`${baseUrl}/admin/login`);
  if (provider !== 'google' && provider !== 'microsoft') {
    return NextResponse.redirect(`${baseUrl}/admin/calendars`);
  }

  const client = oauthClient(provider);
  // Not set up yet: the Calendars page explains the one-time setup.
  if (!client) return NextResponse.redirect(`${baseUrl}/admin/calendars?setup=${provider}#connect`);

  let loginHint: string | undefined;
  const accountId = request.nextUrl.searchParams.get('account') ?? '';
  if (/^[0-9a-f-]{36}$/i.test(accountId)) {
    const account = await getCalendarAccount(accountId);
    if (account?.provider === provider) loginHint = accountSummary(account).email || undefined;
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

  const redirectUri = oauthRedirectUri(provider, baseUrl);
  const url =
    provider === 'google'
      ? googleAuthorizeUrl(client, redirectUri, state, loginHint)
      : microsoftAuthorizeUrl(client, redirectUri, state, loginHint);
  return NextResponse.redirect(url);
}
