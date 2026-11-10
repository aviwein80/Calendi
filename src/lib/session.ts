import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { sign, verifySignature } from './crypto';
import { getOwner } from './store';
import type { Owner } from './types';

// Admin sign-in. There is exactly one owner, so the session cookie only has
// to prove "this browser signed in, and the password has not changed since".

const COOKIE = 'calendi_session';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export async function startSession(owner: Pick<Owner, 'session_version'>): Promise<void> {
  const payload = `${owner.session_version}.${Date.now() + MAX_AGE_SECONDS * 1000}`;
  (await cookies()).set(COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function endSession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

/** The signed-in owner, or null. */
export async function currentOwner(): Promise<Owner | null> {
  const value = (await cookies()).get(COOKIE)?.value;
  if (!value) return null;
  const cut = value.lastIndexOf('.');
  if (cut < 0) return null;
  const payload = value.slice(0, cut);
  if (!verifySignature(payload, value.slice(cut + 1))) return null;
  const [version, expires] = payload.split('.').map(Number);
  if (!Number.isFinite(expires) || expires < Date.now()) return null;
  const owner = await getOwner();
  return owner && owner.session_version === version ? owner : null;
}

/** For admin pages: returns the owner or sends the visitor to sign in (or first-run setup). */
export async function requireOwner(): Promise<Owner> {
  // Sessions expire, so this can only be decided while handling a real request.
  await connection();
  const owner = await currentOwner();
  if (owner) return owner;
  redirect((await getOwner()) ? '/admin/login' : '/admin/setup');
}

/** For server actions and route handlers: throws instead of redirecting. */
export async function assertOwner(): Promise<Owner> {
  const owner = await currentOwner();
  if (!owner) throw new Error('Not signed in.');
  return owner;
}
