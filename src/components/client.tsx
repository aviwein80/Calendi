'use client';

import { Check, Copy, LoaderCircle } from 'lucide-react';
import {
  createContext,
  startTransition,
  use,
  useActionState,
  useEffect,
  useRef,
  useState,
  useTransition,
  type ComponentProps,
  type ReactNode,
} from 'react';
import { postJson } from '@/lib/postJson';
import { Button, cx } from './ui';

// Small interactive pieces used around the admin.

type ButtonProps = ComponentProps<typeof Button>;

type FormState = { error?: string; ok?: string } | undefined;
const FormContext = createContext<{ state: FormState; pending: boolean }>({ state: undefined, pending: false });

/**
 * A form that runs a server action and keeps what was typed. (A plain
 * `<form action>` clears every field when the action finishes, which is
 * miserable when the action only came back to say "wrong password".)
 * Put a <SubmitButton> and a <FormMessage> anywhere inside.
 */
export function ActionForm({
  action,
  className,
  clearOnSuccess = false,
  children,
}: {
  action: (state: FormState, data: FormData) => Promise<FormState>;
  className?: string;
  /** Empty the fields after a successful run (for example a password change). */
  clearOnSuccess?: boolean;
  children: ReactNode;
}) {
  const [state, dispatch, pending] = useActionState(action, undefined);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (clearOnSuccess && state?.ok) form.current?.reset();
  }, [clearOnSuccess, state]);
  return (
    <form
      ref={form}
      className={className}
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(() => dispatch(data));
      }}
    >
      <FormContext value={{ state, pending }}>{children}</FormContext>
    </form>
  );
}

/**
 * A form that posts its fields as JSON to one of this app's endpoints and
 * shows the reply. Like <ActionForm>, it keeps what was typed. The endpoint
 * answers { ok, message?, redirect? }; on `redirect` the browser goes there.
 */
export function ApiForm({
  endpoint,
  className,
  children,
}: {
  endpoint: string;
  className?: string;
  children: ReactNode;
}) {
  const [state, setState] = useState<FormState>(undefined);
  const [pending, startSubmit] = useTransition();
  return (
    <form
      className={className}
      onSubmit={(event) => {
        event.preventDefault();
        const fields = Object.fromEntries(new FormData(event.currentTarget));
        startSubmit(async () => {
          const reply = await postJson<{ ok: boolean; message?: string; redirect?: string }>(endpoint, fields);
          if (reply.ok && reply.redirect) {
            // A full page load, so the new session cookie is used from the start.
            window.location.assign(reply.redirect);
            return;
          }
          setState(reply.ok ? { ok: reply.message } : { error: reply.message ?? 'Something went wrong. Please try again.' });
        });
      }}
    >
      <FormContext value={{ state, pending }}>{children}</FormContext>
    </form>
  );
}

/** Submit button for an <ActionForm> or <ApiForm>: shows a spinner while it runs. */
export function SubmitButton({ children, disabled, ...props }: ButtonProps) {
  const { pending } = use(FormContext);
  return (
    <Button type="submit" {...props} disabled={pending || disabled}>
      {pending && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
      {children}
    </Button>
  );
}

export function CopyButton({
  text,
  label = 'Copy link',
  variant = 'secondary',
  size = 'sm',
}: {
  text: string;
  label?: string;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          // Clipboard access can be blocked (for example inside an iframe).
          window.prompt('Copy this:', text);
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }}
    >
      {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      {copied ? 'Copied' : label}
    </Button>
  );
}

/** A button that runs a server action, optionally after a confirmation, and shows the outcome. */
export function ActionButton({
  action,
  confirm,
  children,
  ...props
}: Omit<ButtonProps, 'onClick'> & {
  action: () => Promise<{ error?: string; ok?: string } | void>;
  confirm?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ error?: string; ok?: string }>({});
  return (
    <>
      <Button
        type="button"
        {...props}
        disabled={pending || props.disabled}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          setResult({});
          startTransition(async () => {
            setResult((await action()) ?? {});
          });
        }}
      >
        {pending && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
        {children}
      </Button>
      {(result.error || result.ok) && (
        <span
          role={result.error ? 'alert' : 'status'}
          className={cx('text-sm', result.error ? 'text-red-600' : 'text-emerald-700')}
        >
          {result.error ?? result.ok}
        </span>
      )}
    </>
  );
}

/** A switch that saves the moment it is flipped. */
export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => Promise<unknown> | void;
  label: string;
  disabled?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useState(checked);
  const [seen, setSeen] = useState(checked);
  if (seen !== checked) {
    // The server sent a new value: adopt it.
    setSeen(checked);
    setOptimistic(checked);
  }
  return (
    <button
      type="button"
      role="switch"
      aria-checked={optimistic}
      aria-label={label}
      disabled={disabled || pending}
      onClick={() => {
        const next = !optimistic;
        setOptimistic(next);
        startTransition(async () => {
          await onChange(next);
        });
      }}
      className={cx(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60',
        optimistic ? 'bg-brand' : 'bg-zinc-300',
      )}
    >
      <span
        className={cx(
          'inline-block size-5 rounded-full bg-white shadow transition-transform',
          optimistic ? 'translate-x-[22px]' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}

/** The result of the surrounding <ActionForm>'s last run: an error or a confirmation. */
export function FormMessage() {
  const { state } = use(FormContext);
  if (!state?.error && !state?.ok) return null;
  return (
    <p
      role={state.error ? 'alert' : 'status'}
      className={cx('text-sm', state.error ? 'text-red-600' : 'text-emerald-700')}
    >
      {state.error ?? state.ok}
    </p>
  );
}
