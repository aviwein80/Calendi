import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { SetupForm } from '@/components/AuthForms';
import { PublicFrame, PublicSkeleton } from '@/components/PublicFrame';
import { MIN_PASSWORD_LENGTH } from '@/lib/constants';
import { getOwner } from '@/lib/store';

export const metadata: Metadata = { title: 'Set up', robots: { index: false } };

// First-run setup. Only reachable while no owner account exists.

export default function SetupPage() {
  return (
    <PublicFrame>
      <Suspense fallback={<PublicSkeleton />}>
        <Content />
      </Suspense>
    </PublicFrame>
  );
}

async function Content() {
  await connection();
  if (await getOwner()) redirect('/admin/login');
  return (
    <div className="fade-in mx-auto w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-7 shadow-sm">
      <h1 className="text-xl font-semibold tracking-tight text-zinc-900">Welcome to Calendi</h1>
      <p className="mb-6 mt-1 text-sm leading-6 text-zinc-600">
        Create your account to get a booking page. You can connect calendars and adjust your hours next.
      </p>
      <SetupForm minPassword={MIN_PASSWORD_LENGTH} />
    </div>
  );
}
