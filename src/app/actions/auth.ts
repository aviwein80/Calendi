'use server';

import { redirect } from 'next/navigation';
import { endSession } from '@/lib/session';

// Signing in and first-run setup are JSON endpoints (/api/auth/login and
// /api/auth/setup) so they can be rate limited with a proper 429 response.

export async function logoutAction(): Promise<void> {
  await endSession();
  redirect('/admin/login');
}
