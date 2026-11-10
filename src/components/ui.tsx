import Link from 'next/link';
import type { ComponentProps, CSSProperties, ReactNode } from 'react';

// Small building blocks shared by every screen. Plain components with no
// state, so they work in both server and client components.

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/** Picks black or white text for a background colour, whichever reads better. */
export function readableOn(hex: string): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return '#ffffff';
  const value = parseInt(match[1], 16);
  const channel = (shift: number) => {
    const c = ((value >> shift) & 255) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
  return luminance > 0.45 ? '#18181b' : '#ffffff';
}

/** Inline style that applies the owner's accent colour to everything inside. */
export function brandStyle(color: string): CSSProperties {
  const valid = /^#[0-9a-f]{6}$/i.test(color) ? color : '#4f46e5';
  return { '--brand': valid, '--brand-fg': readableOn(valid) } as CSSProperties;
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const base =
  'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap';
const variants: Record<Variant, string> = {
  primary: 'bg-brand text-brand-fg hover:opacity-90',
  secondary: 'border border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50',
  ghost: 'text-zinc-700 hover:bg-zinc-100',
  danger: 'border border-red-200 bg-white text-red-700 hover:bg-red-50',
};
const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-5 text-base',
};

export function buttonClass(variant: Variant = 'primary', size: Size = 'md', extra?: string): string {
  return cx(base, variants[variant], sizes[size], extra);
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: ComponentProps<'button'> & { variant?: Variant; size?: Size }) {
  return <button {...props} className={buttonClass(variant, size, className)} />;
}

export function LinkButton({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link {...props} className={buttonClass(variant, size, className)} />;
}

const inputBase =
  'block rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:bg-zinc-100 disabled:text-zinc-500';

/** Fields fill their container unless the caller passes a width class of its own. */
function fieldClass(className: string | undefined, extra?: string): string {
  const hasWidth = /(^|\s)w-/.test(className ?? '');
  return cx(inputBase, !hasWidth && 'w-full', extra, className);
}

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input {...props} className={fieldClass(className)} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  const hasHeight = /(^|\s)min-h-/.test(className ?? '');
  return <textarea {...props} className={fieldClass(className, hasHeight ? undefined : 'min-h-24')} />;
}

export function Select({ className, ...props }: ComponentProps<'select'>) {
  return <select {...props} className={fieldClass(className, 'pr-8')} />;
}

export function Field({
  label,
  hint,
  error,
  htmlFor,
  required,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  htmlFor?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-zinc-800">
        {label}
        {required && <span className="text-red-600"> *</span>}
      </label>
      {children}
      {hint && !error && <p className="mt-1.5 text-xs leading-5 text-zinc-500">{hint}</p>}
      {error && <p className="mt-1.5 text-xs leading-5 text-red-600">{error}</p>}
    </div>
  );
}

export function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      {...props}
      className={cx('rounded-xl border border-zinc-200 bg-white shadow-sm shadow-zinc-900/[0.03]', className)}
    />
  );
}

export function Section({
  title,
  description,
  children,
  aside,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <Card className="p-5 sm:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-zinc-900">{title}</h2>
          {description && <p className="mt-1 text-sm leading-6 text-zinc-600">{description}</p>}
        </div>
        {aside}
      </div>
      {children}
    </Card>
  );
}

type Tone = 'neutral' | 'green' | 'amber' | 'red' | 'brand';
const tones: Record<Tone, string> = {
  neutral: 'bg-zinc-100 text-zinc-700',
  green: 'bg-emerald-50 text-emerald-700',
  amber: 'bg-amber-50 text-amber-800',
  red: 'bg-red-50 text-red-700',
  brand: 'bg-brand/10 text-brand',
};

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', tones[tone])}>
      {children}
    </span>
  );
}

export function Notice({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: 'neutral' | 'green' | 'amber' | 'red';
  children: ReactNode;
  className?: string;
}) {
  const styles = {
    neutral: 'border-zinc-200 bg-zinc-50 text-zinc-700',
    green: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
    red: 'border-red-200 bg-red-50 text-red-800',
  }[tone];
  return (
    <div role={tone === 'red' ? 'alert' : 'status'} className={cx('rounded-lg border px-3.5 py-2.5 text-sm leading-6', styles, className)}>
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">{title}</h1>
        {description && <p className="mt-1 text-sm leading-6 text-zinc-600">{description}</p>}
      </div>
      {action}
    </div>
  );
}

/** Placeholder block shown while a page's data loads. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-lg bg-zinc-200/70', className)} />;
}

export function Avatar({ name, url, size = 56 }: { name: string; url?: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt=""
        width={size}
        height={size}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-brand/10 font-semibold text-brand"
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {initials || '?'}
    </span>
  );
}
