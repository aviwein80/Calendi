import { createAccount } from '@/lib/account';
import { fromAnotherSite, guarded, json, NOT_ALLOWED, readJson, tooMany } from '@/lib/http';
import { consume, LIMITS } from '@/lib/rateLimit';
import { startSession } from '@/lib/session';

// POST /api/auth/setup  { setupToken, name, email, password, timezone }
// Creates the owner account. Needs the SETUP_TOKEN setting, and only ever
// succeeds once.

export const POST = guarded(async (request: Request): Promise<Response> => {
  if (fromAnotherSite(request)) return NOT_ALLOWED();
  const limit = await consume(LIMITS.setup);
  if (!limit.allowed) return tooMany(LIMITS.setup, limit);

  const body = await readJson(request);
  if (typeof body !== 'object' || body === null) {
    return json({ ok: false, message: 'Fill in the form and try again.' }, 400);
  }
  const result = await createAccount(body as Record<string, unknown>);
  if (!result.ok) return json({ ok: false, message: result.message }, result.status);

  await startSession(result.owner);
  return json({ ok: true, redirect: '/admin/event-types?welcome=1' });
});
