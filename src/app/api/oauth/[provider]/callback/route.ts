import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { connectAccount, oauthClient } from '@/lib/calendars';
import { googleExchangeCode } from '@/lib/calendars/google';
import { microsoftExchangeCode } from '@/lib/calendars/microsoft';
import { verifySignature } from '@/lib/crypto';
import { getBaseUrl } from '@/lib/env';
import { currentOwner } from '@/lib/session';

// GET /api/oauth/<provider>/callback: where Google or Microsoft sends the owner
// back after they approve access. Swaps the one-time code for tokens and saves
// the account.

export async function GET(request: NextRequest, context: RouteContext<'/api/oauth/[provider]/callback'>) {
  const { provider } = await context.params;
  const baseUrl = await getBaseUrl();
  const back = (query: string) => NextResponse.redirect(`${baseUrl}/admin/calendars?${query}`);
  const fail = (message: string) => back(`error=${encodeURIComponent(message)}`);

  if (!(await currentOwner())) return NextResponse.redirect(`${baseUrl}/admin/login`);
  if (provider !== 'google' && provider !== 'microsoft') return back('');

  const params = request.nextUrl.searchParams;
  const jar = await cookies();
  const cookie = jar.get('calendi_oauth')?.value ?? '';
  jar.delete({ name: 'calendi_oauth', path: '/api/oauth' });

  const cut = cookie.lastIndexOf('.');
  const payload = cookie.slice(0, cut);
  const stateOk =
    cut > 0 &&
    verifySignature(payload, cookie.slice(cut + 1)) &&
    payload === `${provider}.${params.get('state') ?? ''}`;
  if (!stateOk) return fail('The sign-in could not be verified. Please try connecting again.');

  if (params.get('error')) {
    return fail(
      params.get('error') === 'access_denied'
        ? 'Access was not granted, so nothing was connected.'
        : params.get('error_description') || params.get('error')!,
    );
  }
  const code = params.get('code');
  const client = await oauthClient(provider);
  if (!code || !client) return fail('The sign-in did not complete. Please try again.');

  try {
    const redirectUri = `${baseUrl}/api/oauth/${provider}/callback`;
    const credentials =
      provider === 'google'
        ? await googleExchangeCode(client, redirectUri, code)
        : await microsoftExchangeCode(client, redirectUri, code);
    await connectAccount(provider, credentials.email || 'Account', credentials);
  } catch (err) {
    console.error('[oauth] connect failed:', err);
    return fail(err instanceof Error ? err.message : 'The account could not be connected.');
  }
  return back('connected=1');
}
