'use client';

import { LoaderCircle } from 'lucide-react';
import { useState, useTransition } from 'react';
import { hostCancelAction } from '@/app/actions/admin';
import { Button, Notice, Textarea } from './ui';

/** "Cancel booking" for the owner: asks for an optional reason first. */
export function HostCancel({ token, invitee }: { token: string; invitee: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <Button type="button" variant="danger" size="sm" onClick={() => setOpen(true)}>
        Cancel booking
      </Button>
    );
  }
  return (
    <div className="w-full space-y-2 rounded-lg border border-zinc-200 p-3">
      <label htmlFor={`reason-${token}`} className="block text-sm font-medium text-zinc-800">
        Reason for {invitee} (optional)
      </label>
      <Textarea
        id={`reason-${token}`}
        value={reason}
        maxLength={1000}
        className="min-h-16"
        onChange={(e) => setReason(e.target.value)}
      />
      {error && <Notice tone="red">{error}</Notice>}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="danger"
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await hostCancelAction(token, reason);
              if (result.error) setError(result.error);
              else setOpen(false);
            })
          }
        >
          {pending && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
          Cancel this booking
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Keep it
        </Button>
      </div>
    </div>
  );
}
