import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { LoginForm } from '@/components/AuthForms';
import { PublicFrame, PublicSkeleton } from '@/components/PublicFrame';
import { installStatus } from '@/lib/install';
import { currentOwner } from '@/lib/session';

export const metadata: Metadata = { title: 'Sign in', robots: { index: false } };

export default function LoginPage() {
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
  const status = await installStatus();
  if (!status.ready || !status.owner) redirect('/admin/setup');
  if (await currentOwner()) redirect('/admin/event-types');
  return (
    <div className="fade-in mx-auto w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-7 shadow-sm">
      <h1 className="text-xl font-semibold tracking-tight text-zinc-900">Sign in</h1>
      <p className="mb-6 mt-1 text-sm text-zinc-600">Manage your scheduling page.</p>
      <LoginForm />
    </div>
  );
}
