// Values shared between server and browser code.

export const MIN_PASSWORD_LENGTH = 10;

/** Paths the app itself uses, so an event type can never be given one as its link. */
export const RESERVED_SLUGS = new Set([
  'admin',
  'api',
  'booking',
  'embed',
  'favicon.ico',
  'robots.txt',
  'sitemap.xml',
  '_next',
  'static',
  'public',
  'login',
  'setup',
]);

export const EVENT_COLORS = [
  '#4f46e5',
  '#2563eb',
  '#0891b2',
  '#059669',
  '#65a30d',
  '#d97706',
  '#ea580c',
  '#dc2626',
  '#db2777',
  '#9333ea',
  '#475569',
];
