import { CircleAlert } from 'lucide-react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { SetupForm } from '@/components/AuthForms';
import { PublicFrame, PublicSkeleton } from '@/components/PublicFrame';
import { buttonClass } from '@/components/ui';
import { MIN_PASSWORD_LENGTH } from '@/lib/constants';
import { installStatus, type InstallProblem } from '@/lib/install';

export const metadata: Metadata = { title: 'Set up', robots: { index: false } };

// First-run setup. Shows what is still missing from the deployment, if
// anything, and otherwise the form that creates the owner account. Only
// reachable while no owner account exists.

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
  const status = await installStatus();
  if (!status.ready) return <Checklist problems={status.problems} />;
  if (status.owner) redirect('/admin/login');
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

/** What the deployment still needs before it can run. */
function Checklist({ problems }: { problems: InstallProblem[] }) {
  return (
    <div className="fade-in mx-auto w-full max-w-xl rounded-2xl border border-zinc-200 bg-white p-7 shadow-sm">
      <h1 className="text-xl font-semibold tracking-tight text-zinc-900">Almost there</h1>
      <p className="mt-1 text-sm leading-6 text-zinc-600">
        Calendi is deployed, but it cannot start until {problems.length === 1 ? 'this is' : 'these are'} sorted
        out:
      </p>
      <ol className="mt-5 space-y-3">
        {problems.map((problem) => (
          <li key={problem.id} className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <CircleAlert className="mt-0.5 size-5 shrink-0 text-amber-600" aria-hidden />
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-zinc-900">{problem.title}</h2>
              <p className="mt-1 text-sm leading-6 text-zinc-700">{problem.fix}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-5 text-sm leading-6 text-zinc-600">
        <span className="font-medium text-zinc-900">Then redeploy.</span> Changed settings only take effect on a
        new deployment (on Vercel: Deployments, the ⋯ menu on the latest one, Redeploy). When it finishes,
        come back to this page to create your account.
      </p>
      {/* A full page load on purpose: this re-runs the checks on the server. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/admin/setup" className={buttonClass('secondary', 'md', 'mt-5')}>
        Check again
      </a>
    </div>
  );
}
