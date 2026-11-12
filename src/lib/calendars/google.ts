import type { Interval } from '../types';
import {
  ProviderError,
  request,
  requestJson,
  type CalendarProvider,
  type CreatedEvent,
  type EventInput,
  type ExternalCalendar,
  type OAuthClient,
  type OAuthCredentials,
  type OAuthTokens,
} from './types';

// Google Calendar over its REST API. The endpoint constants can be pointed at
// a stand-in server for tests; in normal use they are never set.
const authUrl = () => process.env.GOOGLE_AUTH_URL ?? 'https://accounts.google.com/o/oauth2/v2/auth';
const tokenUrl = () => process.env.GOOGLE_TOKEN_URL ?? 'https://oauth2.googleapis.com/token';
const api = () =>
  (process.env.GOOGLE_API_BASE ?? 'https://www.googleapis.com') + '/calendar/v3';

/**
 * Only what Calendi uses: the account's address (to label the connection),
 * the list of calendars, busy times, and adding / moving / removing the
 * events it creates. It never asks to read the contents of other events.
 */
export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.freebusy',
  'https://www.googleapis.com/auth/calendar.events',
];

export function googleAuthorizeUrl(
  client: OAuthClient,
  redirectUri: string,
  state: string,
  loginHint?: string,
): string {
  const params = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    // "offline" is what makes Google hand back a refresh token, and it only
    // does so on the consent screen, so ask for that every time. The account
    // chooser comes first, which is what lets the same button add a second
    // or third Google account.
    access_type: 'offline',
    prompt: 'select_account consent',
    state,
  });
  if (loginHint) params.set('login_hint', loginHint);
  return `${authUrl()}?${params}`;
}

type TokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
};

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const response = await request(tokenUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  const json = (await response.json().catch(() => ({}))) as TokenResponse;
  if (!response.ok || json.error) {
    throw new ProviderError(
      `Google sign-in failed: ${json.error_description || json.error || response.status}`,
      response.status,
      json.error === 'invalid_grant',
    );
  }
  return json;
}

function emailFromIdToken(idToken: string | undefined): string {
  try {
    const payload = JSON.parse(Buffer.from(idToken!.split('.')[1], 'base64url').toString('utf8'));
    return typeof payload.email === 'string' ? payload.email : '';
  } catch {
    return '';
  }
}

export async function googleExchangeCode(
  client: OAuthClient,
  redirectUri: string,
  code: string,
): Promise<OAuthCredentials> {
  const json = await tokenRequest({
    code,
    client_id: client.clientId,
    client_secret: client.clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });
  if (!json.refresh_token) {
    throw new ProviderError(
      'Google did not return a refresh token. Remove this app at myaccount.google.com/permissions, then connect again.',
    );
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + json.expires_in * 1000,
    email: emailFromIdToken(json.id_token),
  };
}

export async function googleRefresh(client: OAuthClient, refreshToken: string): Promise<OAuthTokens> {
  const json = await tokenRequest({
    client_id: client.clientId,
    client_secret: client.clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? refreshToken,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
}

type GoogleEvent = {
  id: string;
  hangoutLink?: string;
  conferenceData?: { entryPoints?: { entryPointType: string; uri: string }[] };
};

function eventBody(event: EventInput, includeConference: boolean) {
  return {
    summary: event.title,
    description: event.description,
    location: event.location || undefined,
    start: { dateTime: event.start.toISOString() },
    end: { dateTime: event.end.toISOString() },
    attendees: event.attendees.map((a) => ({ email: a.email, displayName: a.name })),
    reminders: { useDefault: true },
    ...(includeConference && event.conference === 'google_meet'
      ? {
          conferenceData: {
            createRequest: {
              requestId: event.uid,
              conferenceSolutionKey: { type: 'hangoutsMeet' },
            },
          },
        }
      : {}),
  };
}

export const googleProvider: CalendarProvider<OAuthCredentials> = {
  async listCalendars(credentials): Promise<ExternalCalendar[]> {
    const calendars: ExternalCalendar[] = [];
    let pageToken = '';
    do {
      const params = new URLSearchParams({ minAccessRole: 'freeBusyReader', maxResults: '250' });
      if (pageToken) params.set('pageToken', pageToken);
      const page = await requestJson<{
        items?: {
          id: string;
          summary?: string;
          summaryOverride?: string;
          backgroundColor?: string;
          accessRole: string;
          primary?: boolean;
        }[];
        nextPageToken?: string;
      }>(`${api()}/users/me/calendarList?${params}`, credentials.accessToken);
      for (const item of page.items ?? []) {
        calendars.push({
          externalId: item.id,
          name: item.summaryOverride || item.summary || item.id,
          color: item.backgroundColor ?? '',
          canWrite: item.accessRole === 'owner' || item.accessRole === 'writer',
          primary: Boolean(item.primary),
        });
      }
      pageToken = page.nextPageToken ?? '';
    } while (pageToken);
    return calendars;
  },

  async getBusy(credentials, externalIds, from, to): Promise<Interval[]> {
    if (externalIds.length === 0) return [];
    const result = await requestJson<{
      calendars?: Record<
        string,
        { busy?: { start: string; end: string }[]; errors?: { reason: string }[] }
      >;
    }>(`${api()}/freeBusy`, credentials.accessToken, {
      method: 'POST',
      body: JSON.stringify({
        timeMin: from.toISOString(),
        timeMax: to.toISOString(),
        items: externalIds.map((id) => ({ id })),
      }),
    });
    const busy: Interval[] = [];
    for (const id of externalIds) {
      const entry = result.calendars?.[id];
      if (!entry || entry.errors?.length) {
        throw new ProviderError(
          `Google could not read calendar "${id}" (${entry?.errors?.[0]?.reason ?? 'no data'}).`,
        );
      }
      for (const block of entry.busy ?? []) {
        busy.push({ start: Date.parse(block.start), end: Date.parse(block.end) });
      }
    }
    return busy;
  },

  async createEvent(credentials, externalId, event): Promise<CreatedEvent> {
    const params = new URLSearchParams({ sendUpdates: 'all', conferenceDataVersion: '1' });
    const created = await requestJson<GoogleEvent>(
      `${api()}/calendars/${encodeURIComponent(externalId)}/events?${params}`,
      credentials.accessToken,
      { method: 'POST', body: JSON.stringify(eventBody(event, true)) },
    );
    const video = created.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video');
    return {
      externalEventId: created.id,
      meetingUrl: created.hangoutLink ?? video?.uri ?? '',
      invited: event.attendees.length > 0,
    };
  },

  async updateEvent(credentials, externalId, externalEventId, event): Promise<void> {
    await requestJson(
      `${api()}/calendars/${encodeURIComponent(externalId)}/events/${encodeURIComponent(externalEventId)}?sendUpdates=all`,
      credentials.accessToken,
      { method: 'PATCH', body: JSON.stringify(eventBody(event, false)) },
    );
  },

  async deleteEvent(credentials, externalId, externalEventId): Promise<void> {
    try {
      await requestJson(
        `${api()}/calendars/${encodeURIComponent(externalId)}/events/${encodeURIComponent(externalEventId)}?sendUpdates=all`,
        credentials.accessToken,
        { method: 'DELETE' },
      );
    } catch (err) {
      // Already gone is as good as deleted.
      if (err instanceof ProviderError && (err.status === 404 || err.status === 410)) return;
      throw err;
    }
  },
};
