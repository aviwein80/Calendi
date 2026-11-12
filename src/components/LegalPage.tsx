import type { ReactNode } from 'react';
import { LEGAL_UPDATED } from '@/lib/legal';
import { PublicFrame } from './PublicFrame';

// Shared layout for the privacy policy and terms of use. All stateless, so
// the pages stay static.

export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <PublicFrame>
      <article className="mx-auto w-full max-w-2xl rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-9">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">{title}</h1>
        <p className="mt-1 text-sm text-zinc-500">Last updated {LEGAL_UPDATED}</p>
        {children}
      </article>
    </PublicFrame>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-base font-semibold text-zinc-900">{title}</h2>
      {children}
    </section>
  );
}

export function LegalP({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-sm leading-6 text-zinc-700">{children}</p>;
}

export function LegalList({ children }: { children: ReactNode }) {
  return <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-6 text-zinc-700">{children}</ul>;
}

export function LegalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className="font-medium text-zinc-900 underline underline-offset-2">
      {children}
    </a>
  );
}
