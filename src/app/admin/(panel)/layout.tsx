import type { Metadata } from 'next';
import { Suspense, type ReactNode } from 'react';
import { AdminNav } from '@/components/AdminNav';

export const metadata: Metadata = { title: { default: 'Admin', template: '%s · Calendi' }, robots: { index: false } };

// The frame around every admin page. It contains no private data, so it can be
// drawn instantly; each page checks the session before showing anything real.

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-1 flex-col md:pl-60">
      {/* The nav highlights the current page, which is only known per request. */}
      <Suspense
        fallback={<div className="h-24 border-b border-zinc-200 bg-white md:fixed md:inset-y-0 md:left-0 md:h-auto md:w-60 md:border-b-0 md:border-r" />}
      >
        <AdminNav />
      </Suspense>
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}
