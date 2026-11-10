// Shared types. Row types mirror the database columns one-to-one
// (snake_case), so there is no mapping layer to get out of sync.

/** A span of time as epoch milliseconds, end exclusive. */
export type Interval = { start: number; end: number };

/** Wall-clock hours within one day, "HH:mm" (end may be "24:00"). */
export type TimeRange = { start: string; end: string };

/** Keyed by ISO weekday: "1" is Monday … "7" is Sunday. */
export type WeeklyHours = Record<string, TimeRange[]>;

/** Keyed by "YYYY-MM-DD". An empty list means unavailable that day. */
export type DateOverrides = Record<string, TimeRange[]>;

export type LocationType = 'none' | 'google_meet' | 'teams' | 'link' | 'phone' | 'in_person';

export type QuestionType = 'text' | 'textarea' | 'select';

export type Question = {
  id: string;
  label: string;
  type: QuestionType;
  required: boolean;
  options: string[];
};

export type Answer = { label: string; value: string };

export type Owner = {
  id: number;
  name: string;
  email: string;
  password_hash: string;
  session_version: number;
  timezone: string;
  welcome_message: string;
  avatar_url: string;
  brand_color: string;
  webhook_url: string;
  integrations: string;
  failed_logins: number;
  locked_until: Date | null;
  created_at: Date;
};

/** The parts of the owner that are safe to show on public pages. */
export type PublicOwner = Pick<Owner, 'name' | 'welcome_message' | 'avatar_url' | 'brand_color'>;

export type Schedule = {
  id: string;
  name: string;
  timezone: string;
  is_default: boolean;
  weekly: WeeklyHours;
  overrides: DateOverrides;
  created_at: Date;
};

export type EventType = {
  id: string;
  slug: string;
  name: string;
  description: string;
  duration_minutes: number;
  color: string;
  location_type: LocationType;
  location_value: string;
  schedule_id: string | null;
  slot_interval_minutes: number;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  min_notice_minutes: number;
  max_days_ahead: number;
  daily_limit: number | null;
  questions: Question[];
  allow_guests: boolean;
  is_active: boolean;
  is_hidden: boolean;
  position: number;
  created_at: Date;
};

/** What a booking page needs to know about an event type. */
export type PublicEventType = Pick<
  EventType,
  | 'slug'
  | 'name'
  | 'description'
  | 'duration_minutes'
  | 'color'
  | 'location_type'
  | 'location_value'
  | 'questions'
  | 'allow_guests'
  | 'max_days_ahead'
>;

export type CalendarProviderId = 'google' | 'microsoft' | 'caldav' | 'ics';

export type CalendarAccount = {
  id: string;
  provider: CalendarProviderId;
  label: string;
  credentials: string;
  status: 'ok' | 'error';
  last_error: string | null;
  last_error_at: Date | null;
  alerted_at: Date | null;
  created_at: Date;
};

export type CalendarRow = {
  id: string;
  account_id: string;
  external_id: string;
  name: string;
  color: string;
  check_conflicts: boolean;
  can_write: boolean;
  is_booking_target: boolean;
  created_at: Date;
};

export type Booking = {
  id: string;
  token: string;
  event_type_id: string | null;
  event_name: string;
  start_at: Date;
  end_at: Date;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  invitee_name: string;
  invitee_email: string;
  invitee_timezone: string;
  invitee_phone: string;
  guests: string[];
  answers: Answer[];
  notes: string;
  location_type: LocationType;
  location: string;
  meeting_url: string;
  status: 'confirmed' | 'cancelled';
  cancel_reason: string;
  cancelled_by: string;
  cancelled_at: Date | null;
  previous_start_at: Date | null;
  rescheduled_at: Date | null;
  sequence: number;
  calendar_id: string | null;
  external_event_id: string;
  invited_by_calendar: boolean;
  sync_error: string;
  created_at: Date;
};

/** Settings the owner enters in the admin, stored encrypted in owner.integrations. */
export type Integrations = {
  google?: { clientId: string; clientSecret: string };
  microsoft?: { clientId: string; clientSecret: string; tenant?: string };
  email?: {
    provider: 'none' | 'resend' | 'smtp';
    from: string;
    resendApiKey?: string;
    smtpHost?: string;
    smtpPort?: number;
    smtpUser?: string;
    smtpPass?: string;
  };
};
