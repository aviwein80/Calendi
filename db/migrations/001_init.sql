-- Calendi schema. Single-owner scheduling app.
-- Row level security is switched on for every table with no policies, so that
-- if this database is a Supabase project the tables are not readable through
-- Supabase's public Data API. The app connects as the table owner, which
-- bypasses RLS, so nothing else changes.

create table owner (
  id               smallint primary key default 1 check (id = 1),
  name             text not null,
  email            text not null,
  password_hash    text not null,
  session_version  integer not null default 1,
  timezone         text not null,
  welcome_message  text not null default '',
  avatar_url       text not null default '',
  brand_color      text not null default '#4f46e5',
  webhook_url      text not null default '',
  integrations     text not null default '',
  failed_logins    integer not null default 0,
  locked_until     timestamptz,
  created_at       timestamptz not null default now()
);

create table schedules (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  timezone    text not null,
  is_default  boolean not null default false,
  weekly      jsonb not null,
  overrides   jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create unique index schedules_one_default on schedules (is_default) where is_default;

create table event_types (
  id                     uuid primary key default gen_random_uuid(),
  slug                   text not null unique,
  name                   text not null,
  description            text not null default '',
  duration_minutes       integer not null check (duration_minutes between 5 and 720),
  color                  text not null default '#4f46e5',
  location_type          text not null default 'none',
  location_value         text not null default '',
  schedule_id            uuid references schedules (id) on delete set null,
  slot_interval_minutes  integer not null default 30 check (slot_interval_minutes between 5 and 720),
  buffer_before_minutes  integer not null default 0 check (buffer_before_minutes between 0 and 720),
  buffer_after_minutes   integer not null default 0 check (buffer_after_minutes between 0 and 720),
  min_notice_minutes     integer not null default 240 check (min_notice_minutes >= 0),
  max_days_ahead         integer not null default 60 check (max_days_ahead between 1 and 730),
  daily_limit            integer check (daily_limit is null or daily_limit > 0),
  questions              jsonb not null default '[]'::jsonb,
  allow_guests           boolean not null default false,
  is_active              boolean not null default true,
  is_hidden              boolean not null default false,
  position               integer not null default 0,
  created_at             timestamptz not null default now()
);

create table calendar_accounts (
  id             uuid primary key default gen_random_uuid(),
  provider       text not null check (provider in ('google', 'microsoft', 'caldav', 'ics')),
  label          text not null,
  credentials    text not null,
  status         text not null default 'ok' check (status in ('ok', 'error')),
  last_error     text,
  last_error_at  timestamptz,
  alerted_at     timestamptz,
  created_at     timestamptz not null default now()
);

create table calendars (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references calendar_accounts (id) on delete cascade,
  external_id        text not null,
  name               text not null,
  color              text not null default '',
  check_conflicts    boolean not null default true,
  can_write          boolean not null default false,
  is_booking_target  boolean not null default false,
  created_at         timestamptz not null default now(),
  unique (account_id, external_id)
);
create unique index calendars_one_target on calendars (is_booking_target) where is_booking_target;

create table bookings (
  id                     uuid primary key default gen_random_uuid(),
  token                  text not null unique,
  event_type_id          uuid references event_types (id) on delete set null,
  event_name             text not null,
  start_at               timestamptz not null,
  end_at                 timestamptz not null,
  buffer_before_minutes  integer not null default 0,
  buffer_after_minutes   integer not null default 0,
  invitee_name           text not null,
  invitee_email          text not null,
  invitee_timezone       text not null,
  invitee_phone          text not null default '',
  guests                 jsonb not null default '[]'::jsonb,
  answers                jsonb not null default '[]'::jsonb,
  notes                  text not null default '',
  location_type          text not null default 'none',
  location               text not null default '',
  meeting_url            text not null default '',
  status                 text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  cancel_reason          text not null default '',
  cancelled_by           text not null default '',
  cancelled_at           timestamptz,
  previous_start_at      timestamptz,
  rescheduled_at         timestamptz,
  sequence               integer not null default 0,
  calendar_id            uuid references calendars (id) on delete set null,
  external_event_id      text not null default '',
  invited_by_calendar    boolean not null default false,
  sync_error             text not null default '',
  created_at             timestamptz not null default now(),
  check (end_at > start_at),
  -- The database itself refuses two confirmed bookings that overlap, so a
  -- race between two people picking the same slot can never double-book.
  constraint bookings_no_overlap
    exclude using gist (tstzrange(start_at, end_at) with &&) where (status = 'confirmed')
);
create index bookings_start_idx on bookings (start_at);

alter table owner             enable row level security;
alter table schedules         enable row level security;
alter table event_types       enable row level security;
alter table calendar_accounts enable row level security;
alter table calendars         enable row level security;
alter table bookings          enable row level security;
