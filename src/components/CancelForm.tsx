'use client';

import { LoaderCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { postJson, type BookingReply } from '@/lib/postJson';
import { Button, Field, LinkButton, Notice, Textarea } from './ui';

export function CancelForm({ token }: { token: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState('');

  return (
    <form
      className="mt-6 space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        const reason = String(new FormData(event.currentTarget).get('reason') ?? '');
        setError('');
        startTransition(async () => {
          const result = await postJson<BookingReply>('/api/bookings/cancel', { token, reason });
          if (result.ok) router.push(`/booking/${token}`);
          else setError(result.message);
        });
      }}
    >
      <Field label="Reason (optional)" htmlFor="reason">
        <Textarea id="reason" name="reason" maxLength={1000} placeholder="Let them know why, if you like." />
      </Field>
      {error && <Notice tone="red">{error}</Notice>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="danger" disabled={pending}>
          {pending && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
          Cancel meeting
        </Button>
        <LinkButton href={`/booking/${token}`} variant="ghost">
          Keep it
        </LinkButton>
      </div>
    </form>
  );
}
