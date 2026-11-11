'use client';

import { useEffect } from 'react';
import { buttonClass } from '@/components/ui';

// Shown in place of any page that fails while loading (most often because the
// database could not be reached). The details stay in the server logs.

export default function PageError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-12">
      <div className="mx-auto w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-xl font-semibold text-zinc-900">This page could not be loaded</h1>
        <p className="mt-2 text-sm leading-6 text-zinc-600">
          Something went wrong on our side. Please try again in a moment.
        </p>
        <button type="button" onClick={() => retry()} className={buttonClass('primary', 'md', 'mt-5')}>
          Try again
        </button>
        <p className="mt-6 text-xs leading-5 text-zinc-500">
          Run this site? The{' '}
          {/* A full page load on purpose: the setup page re-checks the deployment on the server. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/admin/setup" className="underline">
            setup page
          </a>{' '}
          shows whether a setting is missing.
        </p>
      </div>
    </main>
  );
}
