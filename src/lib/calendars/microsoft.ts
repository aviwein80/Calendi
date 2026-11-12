import { DateTime } from 'luxon';
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

// Outlook / Microsoft 365 calendars over Microsoft Graph. The endpoint
// constants can be pointed at a stand-in server for tests.
const login = (tenant: string) =>
  `${process.env.MICROSOFT_LOGIN_BASE ?? 'https://login.microsoftonline.com'}/${tenant}/oauth2/v2.0`;
const graph = () => process.env.MICROSOFT_GRAPH_BASE ?? 'https://graph.microsoft.com/v1.0';

export const MICROSOFT_SCOPES = [
  'offline_access',
  'openid',
  'email',
  'profile',
  'User.Read',
  'Calendars.ReadWrite',
];

const tenantOf = (client: OAuthClient) => client.tenant?.trim() || 'common';

export function microsoftAuthorizeUrl(
  client: OAuthClient,
  redirectUri: string,
  state: string,
  loginHint?: string,
): string {
  const params = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    response_mode: 'query',
    scope: MICROSOFT_SCOPES.join(' '),
    // Always show the account picker, so the same button can add another account.
    prompt: 'select_account',
    state,
  });
  if (loginHint) params.set('login_hint', loginHint);
  return `${login(tenantOf(client))}/authorize?${params}`;
}

type TokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  error?: string;
  error_description?: string;
};

async function tokenRequest(client: OAuthClient, body: Record<string, string>): Promise<TokenResponse> {
  const response = await request(`${login(tenantOf(client))}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      ...body,
    }).toString(),
  });
  const json = (await response.json().catch(() => ({}))) as TokenResponse;
  if (!response.ok || json.error) {
    throw new ProviderError(
      `Microsoft sign-in failed: ${(json.error_description || json.error || String(response.status)).split('\r\n')[0]}`,
      response.status,
      json.error === 'invalid_grant' || json.error === 'interaction_required',
    );
  }
  return json;
}

export async function microsoftExchangeCode(
  client: OAuthClient,
  redirectUri: string,
  code: string,
): Promise<OAuthCredentials> {
  const json = await tokenRequest(client, {
    code,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });
  if (!json.refresh_token) {
    throw new ProviderError('Microsoft did not return a refresh token (is offline_access allowed?).');
  }
  const me = await requestJson<{ mail?: string; userPrincipalName?: string }>(
    `${graph()}/me?$select=mail,userPrincipalName`,
    json.access_token,
  );
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + json.expires_in * 1000,
    email: me.mail || me.userPrincipalName || '',
  };
}

export async function microsoftRefresh(client: OAuthClient, refreshToken: string): Promise<OAuthTokens> {
  const json = await tokenRequest(client, {
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
    scope: MICROSOFT_SCOPES.join(' '),
  });
  return {
    accessToken: json.access_token,
    // Microsoft rotates refresh tokens: always keep the newest one.
    refreshToken: json.refresh_token ?? refreshToken,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
}

/** Graph wants local-style timestamps plus a zone name. We always send UTC. */
function graphTime(date: Date) {
  return { dateTime: date.toISOString().replace(/\.\d{3}Z$/, ''), timeZone: 'UTC' };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
}

function eventBody(event: EventInput, isCreate: boolean) {
  return {
    subject: event.title,
    body: { contentType: 'HTML', content: escapeHtml(event.description) },
    start: graphTime(event.start),
    end: graphTime(event.end),
    location: { displayName: event.location },
    attendees: event.attendees.map((a) => ({
      emailAddress: { address: a.email, name: a.name },
      type: 'required',
    })),
    ...(isCreate
      ? {
          allowNewTimeProposals: false,
          ...(event.conference === 'teams'
            ? { isOnlineMeeting: true, onlineMeetingProvider: 'teamsForBusiness' }
            : {}),
        }
      : {}),
  };
}

type GraphEvent = {
  start: { dateTime: string };
  end: { dateTime: string };
  showAs?: string;
  isCancelled?: boolean;
  isAllDay?: boolean;
};

export const microsoftProvider: CalendarProvider<OAuthCredentials> = {
  async listCalendars(credentials): Promise<ExternalCalendar[]> {
    const calendars: ExternalCalendar[] = [];
    let url: string | undefined =
      `${graph()}/me/calendars?$top=100&$select=id,name,hexColor,canEdit,isDefaultCalendar`;
    while (url) {
      const page: {
        value?: {
          id: string;
          name: string;
          hexColor?: string;
          canEdit?: boolean;
          isDefaultCalendar?: boolean;
        }[];
        '@odata.nextLink'?: string;
      } = await requestJson(url, credentials.accessToken);
      for (const item of page.value ?? []) {
        calendars.push({
          externalId: item.id,
          name: item.name,
          color: item.hexColor ?? '',
          canWrite: Boolean(item.canEdit),
          primary: Boolean(item.isDefaultCalendar),
        });
      }
      url = page['@odata.nextLink'];
    }
    return calendars;
  },

  async getBusy(credentials, externalIds, from, to, defaultZone): Promise<Interval[]> {
    const busy: Interval[] = [];
    for (const id of externalIds) {
      const params = new URLSearchParams({
        startDateTime: from.toISOString(),
        endDateTime: to.toISOString(),
        $select: 'start,end,showAs,isCancelled,isAllDay',
        $top: '250',
      });
      let url: string | undefined =
        `${graph()}/me/calendars/${encodeURIComponent(id)}/calendarView?${params}`;
      while (url) {
        const page: { value?: GraphEvent[]; '@odata.nextLink'?: string } = await requestJson(
          url,
          credentials.accessToken,
          { headers: { Prefer: 'outlook.timezone="UTC"' } },
        );
        for (const event of page.value ?? []) {
          if (event.isCancelled) continue;
          if (event.showAs === 'free' || event.showAs === 'workingElsewhere') continue;
          if (event.isAllDay) {
            // All-day events are dates, not instants: place them in the owner's zone.
            const startDay = event.start.dateTime.slice(0, 10);
            const endDay = event.end.dateTime.slice(0, 10);
            busy.push({
              start: DateTime.fromISO(startDay, { zone: defaultZone }).toMillis(),
              end: DateTime.fromISO(endDay, { zone: defaultZone }).toMillis(),
            });
          } else {
            busy.push({
              start: Date.parse(event.start.dateTime.slice(0, 19) + 'Z'),
              end: Date.parse(event.end.dateTime.slice(0, 19) + 'Z'),
            });
          }
        }
        url = page['@odata.nextLink'];
      }
    }
    return busy;
  },

  async createEvent(credentials, externalId, event): Promise<CreatedEvent> {
    const created = await requestJson<{ id: string; onlineMeeting?: { joinUrl?: string } | null }>(
      `${graph()}/me/calendars/${encodeURIComponent(externalId)}/events`,
      credentials.accessToken,
      { method: 'POST', body: JSON.stringify(eventBody(event, true)) },
    );
    return {
      externalEventId: created.id,
      meetingUrl: created.onlineMeeting?.joinUrl ?? '',
      invited: event.attendees.length > 0,
    };
  },

  async updateEvent(credentials, _externalId, externalEventId, event): Promise<void> {
    await requestJson(
      `${graph()}/me/events/${encodeURIComponent(externalEventId)}`,
      credentials.accessToken,
      { method: 'PATCH', body: JSON.stringify(eventBody(event, false)) },
    );
  },

  async deleteEvent(credentials, _externalId, externalEventId): Promise<void> {
    const base = `${graph()}/me/events/${encodeURIComponent(externalEventId)}`;
    try {
      // "cancel" tells the attendees; plain delete is the fallback when there are none.
      await requestJson(`${base}/cancel`, credentials.accessToken, {
        method: 'POST',
        body: JSON.stringify({ comment: 'This meeting was cancelled.' }),
      });
    } catch (err) {
      if (err instanceof ProviderError && err.status === 404) return;
      if (err instanceof ProviderError && err.status === 401) throw err;
      try {
        await requestJson(base, credentials.accessToken, { method: 'DELETE' });
      } catch (inner) {
        if (inner instanceof ProviderError && inner.status === 404) return;
        throw inner;
      }
    }
  },
};
