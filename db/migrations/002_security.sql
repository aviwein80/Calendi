-- Security pass before first go-live.

-- 1. Manage-link tokens are no longer stored as written.
--    token_hash   SHA-256 of the token: what a link is looked up by.
--    token_sealed The token encrypted with APP_SECRET, so the owner's admin
--                 can still show the invitee's link. Useless without the
--                 secret, which is not in the database.
--    Bookings made before this change keep working links (the hash is
--    computed here), but have no sealed copy, so the admin cannot re-show them.
alter table bookings
  add column token_hash text,
  add column token_sealed text not null default '';
update bookings set token_hash = encode(sha256(convert_to(token, 'UTF8')), 'hex');
alter table bookings alter column token_hash set not null;
alter table bookings add constraint bookings_token_hash_key unique (token_hash);
alter table bookings drop column token;

-- 2. Request counters for rate limiting. `key` is "<what>:<hashed address>";
--    no raw IP address is stored.
create table rate_limits (
  key           text not null,
  window_start  timestamptz not null,
  count         integer not null,
  primary key (key, window_start)
);
create index rate_limits_window_idx on rate_limits (window_start);
alter table rate_limits enable row level security;

-- 3. Buffers are enforced by the database, not only by the page that offers
--    the times. Two people booking back-to-back slots at the same instant each
--    look free to the other; this trigger makes the second one fail.
--
--    The rule is the slot engine's (src/lib/availability/slots.ts): a meeting,
--    padded with its own buffers, may not touch another meeting; and it may
--    not sit inside another meeting's buffers. Writers are queued on an
--    advisory lock so each one sees the bookings committed before it.
create function bookings_enforce_buffers() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status <> 'confirmed' then
    return new;
  end if;

  perform pg_advisory_xact_lock(7243915);

  if exists (
    select 1
    from bookings b
    where b.status = 'confirmed'
      and b.id <> new.id
      -- Buffers are at most 12 hours, so only nearby bookings can matter.
      and b.end_at > new.start_at - interval '1 day'
      and b.start_at < new.end_at + interval '1 day'
      and (
        tstzrange(b.start_at, b.end_at) && tstzrange(
          new.start_at - new.buffer_before_minutes * interval '1 minute',
          new.end_at + new.buffer_after_minutes * interval '1 minute')
        or
        tstzrange(
          b.start_at - b.buffer_before_minutes * interval '1 minute',
          b.end_at + b.buffer_after_minutes * interval '1 minute') && tstzrange(new.start_at, new.end_at)
      )
  ) then
    -- Same error class as the overlap constraint, so callers treat both alike.
    raise exception 'This time is too close to another booking'
      using errcode = '23P01', constraint = 'bookings_buffers';
  end if;

  return new;
end;
$$;

create trigger bookings_buffers
  before insert or update of start_at, end_at, status, buffer_before_minutes, buffer_after_minutes
  on bookings
  for each row execute function bookings_enforce_buffers();
