import { GOOGLE_SCOPES } from './google';
import { MICROSOFT_SCOPES } from './microsoft';
import type { OAuthClient } from './types';

// Google and Microsoft sign-in needs a one-time "app registration" on their
// side, done once by the owner, whose client ID and secret are then set as
// environment variables. Nothing here touches the network or the database, so
// it is shared by the Calendars page, the sign-in routes and the unit tests.

export type OAuthProviderId = 'google' | 'microsoft';

type Env = Record<string, string | undefined>;

/** The app credentials from the environment, or null until both are set. */
export function oauthClientFromEnv(provider: OAuthProviderId, env: Env = process.env): OAuthClient | null {
  const prefix = provider === 'google' ? 'GOOGLE' : 'MICROSOFT';
  const clientId = env[`${prefix}_CLIENT_ID`]?.trim();
  const clientSecret = env[`${prefix}_CLIENT_SECRET`]?.trim();
  if (!clientId || !clientSecret) return null;
  const tenant = provider === 'microsoft' ? env.MICROSOFT_TENANT_ID?.trim() || undefined : undefined;
  return tenant ? { clientId, clientSecret, tenant } : { clientId, clientSecret };
}

/** Where the provider sends the owner back after they sign in. */
export function oauthRedirectUri(provider: OAuthProviderId, baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/api/oauth/${provider}/callback`;
}

export type SetupStep = { text: string; link?: { label: string; href: string }; detail?: string };

export type OAuthSetupGuide = {
  provider: OAuthProviderId;
  /** "Google" or "Microsoft". */
  name: string;
  /** Environment variables to add, in order. */
  variables: string[];
  /** Optional extra variable and when it is needed. */
  optional?: { name: string; when: string };
  scopes: string[];
  steps: SetupStep[];
};

const VERCEL_STEP: SetupStep = {
  text: 'In Vercel, open this project → Settings → Environment Variables, add the two values below, then redeploy (Deployments → ⋯ → Redeploy).',
  link: { label: 'vercel.com/dashboard', href: 'https://vercel.com/dashboard' },
};

export const OAUTH_SETUP: Record<OAuthProviderId, OAuthSetupGuide> = {
  google: {
    provider: 'google',
    name: 'Google',
    variables: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    scopes: GOOGLE_SCOPES,
    steps: [
      {
        text: 'Create a Google Cloud project (any name, for example “Calendi”).',
        link: { label: 'Create project', href: 'https://console.cloud.google.com/projectcreate' },
      },
      {
        text: 'Turn on the Google Calendar API for that project.',
        link: {
          label: 'Calendar API → Enable',
          href: 'https://console.cloud.google.com/apis/library/calendar-json.googleapis.com',
        },
      },
      {
        text: 'Set up the sign-in screen: pick “External” (or “Internal” on Google Workspace), add the scopes listed below under Data access, then under Audience press “Publish app” so it is “In production”.',
        link: { label: 'Google Auth Platform', href: 'https://console.cloud.google.com/auth/overview' },
        detail: 'Left “In testing”, Google signs Calendi out of your calendar every 7 days.',
      },
      {
        text: 'Create an OAuth client of type “Web application” and paste the redirect URL above under “Authorized redirect URIs”. Copy the client ID and client secret it shows.',
        link: { label: 'Create OAuth client', href: 'https://console.cloud.google.com/auth/clients/create' },
      },
      VERCEL_STEP,
    ],
  },
  microsoft: {
    provider: 'microsoft',
    name: 'Microsoft',
    variables: ['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET'],
    optional: {
      name: 'MICROSOFT_TENANT_ID',
      when: 'only if you chose “this organizational directory only” in step 1',
    },
    scopes: MICROSOFT_SCOPES,
    steps: [
      {
        text: 'Register a new app. Supported account types: “Accounts in any organizational directory and personal Microsoft accounts”. Redirect URI: platform “Web”, and the URL above.',
        link: {
          label: 'New registration',
          href: 'https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/CreateApplicationBlade/quickStartType~/null/isMSAApp~/false',
        },
      },
      {
        text: 'Under API permissions → Add a permission → Microsoft Graph → Delegated, add the scopes listed below. A work account may need an administrator to grant consent.',
        link: {
          label: 'App registrations',
          href: 'https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade/quickStartType~/null/sourceType/Microsoft_AAD_IAM',
        },
      },
      {
        text: 'Under Certificates & secrets → New client secret, create one and copy its “Value” (not the Secret ID).',
      },
      {
        text: 'On the app’s Overview page, copy the “Application (client) ID”.',
      },
      VERCEL_STEP,
    ],
  },
};
