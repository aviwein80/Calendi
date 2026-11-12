-- One-click calendar connections and more than one sign-in email.
-- Additive only: new columns with defaults and a new table. Nothing existing
-- is changed or removed, so the code that is live before this lands keeps
-- working against it.

-- 1. Per meeting type: which calendar new bookings are added to (null = the
--    default calendar, calendars.is_booking_target), and which of the owner's
--    addresses gets the booking alerts ('' = the notifications address).
alter table event_types
  add column calendar_id uuid references calendars (id) on delete set null,
  add column notify_email text not null default '';

-- 2. The owner's email addresses. Any verified one can be used to sign in.
--    A verification code is stored only as an HMAC keyed with APP_SECRET.
create table owner_emails (
  id               uuid primary key default gen_random_uuid(),
  email            text not null,
  verified_at      timestamptz,
  code_hash        text not null default '',
  code_expires_at  timestamptz,
  code_attempts    integer not null default 0,
  code_sent_at     timestamptz,
  created_at       timestamptz not null default now()
);
create unique index owner_emails_email_key on owner_emails (lower(email));
alter table owner_emails enable row level security;

-- The address used to sign in so far becomes the first verified one.
insert into owner_emails (email, verified_at, created_at)
select lower(email), created_at, created_at from owner
on conflict do nothing;
