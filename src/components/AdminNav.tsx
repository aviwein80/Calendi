'use client';

import { CalendarClock, CalendarRange, ExternalLink, Inbox, LayoutGrid, LogOut, Settings } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { logoutAction } from '@/app/actions/auth';
import { cx } from './ui';

const items = [
  { href: '/admin/event-types', label: 'Event types', icon: LayoutGrid },
  { href: '/admin/bookings', label: 'Bookings', icon: Inbox },
  { href: '/admin/availability', label: 'Availability', icon: CalendarClock },
  { href: '/admin/calendars', label: 'Calendars', icon: CalendarRange },
  { href: '/admin/settings', label: 'Settings', icon: Settings },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <header className="border-b border-zinc-200 bg-white md:fixed md:inset-y-0 md:left-0 md:w-60 md:border-b-0 md:border-r">
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between px-4 py-3 md:px-5 md:py-5">
          <Link href="/admin/event-types" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <span className="inline-flex size-7 items-center justify-center rounded-lg bg-brand text-brand-fg">
              <CalendarClock className="size-4" aria-hidden />
            </span>
            Calendi
          </Link>
        </div>
        <nav aria-label="Admin" className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-1 md:flex-col md:px-3 md:pb-0">
          {items.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  'flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium',
                  active ? 'bg-brand/10 text-brand' : 'text-zinc-700 hover:bg-zinc-100',
                )}
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="hidden space-y-1 border-t border-zinc-200 p-3 md:block">
          <Link
            href="/"
            target="_blank"
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
          >
            <ExternalLink className="size-4" aria-hidden />
            View booking page
          </Link>
          <form action={logoutAction}>
            <button
              type="submit"
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
            >
              <LogOut className="size-4" aria-hidden />
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
