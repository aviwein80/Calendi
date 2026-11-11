import { signIn } from '@/lib/account';
import { fromAnotherSite, guarded, json, NOT_ALLOWED, readJson, tooMany } from '@/lib/http';
import { consume, LIMITS } from '@/lib/rateLimit';
import { startSession } from '@/lib/session';

// POST /api/auth/login  { email, password }
// Signs the owner in. Limited per network address, on top of the account-wide
// lockout after repeated wrong passwords.

export const POST = guarded(async (request: Request): Promise<Response> => {
  if (fromAnotherSite(request)) return NOT_ALLOWED();
  const limit = await consume(LIMITS.login);
  if (!limit.allowed) return tooMany(LIMITS.login, limit);

  const body = await readJson(request);
  if (typeof body !== 'object' || body === null) {
    return json({ ok: false, message: 'Enter your email and password.' }, 400);
  }
  const result = await signIn(body as Record<string, unknown>);
  if (!result.ok) return json({ ok: false, message: result.message }, result.status);

  await startSession(result.owner);
  return json({ ok: true, redirect: '/admin/event-types' });
});
