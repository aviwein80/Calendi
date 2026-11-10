import type { ReactNode } from 'react';
import { Skeleton } from './ui';

/** Centres public content on the page. */
export function PublicFrame({ children }: { children: ReactNode }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-8 sm:py-12">{children}</main>
  );
}

/** Shown in place of a public page while its data loads. */
export function PublicSkeleton({ wide = false }: { wide?: boolean }) {
  return (
    <div
      className={`mx-auto w-full rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm ${wide ? 'max-w-[1040px]' : 'max-w-xl'}`}
      aria-busy
    >
      <Skeleton className="h-10 w-10 rounded-full" />
      <Skeleton className="mt-4 h-7 w-2/3" />
      <Skeleton className="mt-3 h-4 w-1/3" />
      <Skeleton className="mt-8 h-40 w-full" />
    </div>
  );
}

/** A centred message card for "not found" and similar dead ends. */
export function PublicMessage({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-sm">
      <h1 className="text-xl font-semibold text-zinc-900">{title}</h1>
      {children && <div className="mt-2 text-sm leading-6 text-zinc-600">{children}</div>}
    </div>
  );
}
