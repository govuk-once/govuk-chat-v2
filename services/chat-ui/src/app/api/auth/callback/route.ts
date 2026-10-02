import {
  CognitoIdentityProviderClient,
  DescribeUserPoolClientCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { NextResponse, type NextRequest } from 'next/server';
import {
  createSessionCookie,
  SESSION_COOKIE,
} from '../../../../auth/session.ts';

export const runtime = 'nodejs';

const SESSION_MAX_AGE_SECONDS = 86_400;

const cognitoClient = new CognitoIdentityProviderClient({});

const signInSecretCache: { value?: string } = {};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

async function fetchSignInClientSecret(): Promise<string> {
  if (signInSecretCache.value) return signInSecretCache.value;

  const userPoolId = requireEnv('COGNITO_USER_POOL_ID');
  const clientId = requireEnv('COGNITO_SIGN_IN_CLIENT_ID');

  const { UserPoolClient } = await cognitoClient.send(
    new DescribeUserPoolClientCommand({
      UserPoolId: userPoolId,
      ClientId: clientId,
    }),
  );
  if (!UserPoolClient?.ClientSecret) {
    throw new Error(`Sign-in client ${clientId} has no client secret`);
  }
  signInSecretCache.value = UserPoolClient.ClientSecret;
  return UserPoolClient.ClientSecret;
}

function buildRedirectUri(request: NextRequest): string {
  const host =
    request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  const protocol = request.headers.get('x-forwarded-proto') ?? 'http';
  return `${protocol}://${host}/api/auth/callback`;
}

interface TokenResponse {
  id_token: string;
}

interface IdTokenPayload {
  sub: string;
}

function decodeIdTokenPayload(idToken: string): IdTokenPayload {
  const parts = idToken.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid ID token format');
  }
  return JSON.parse(
    Buffer.from(parts[1], 'base64url').toString(),
  ) as IdTokenPayload;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const code = request.nextUrl.searchParams.get('code');
  if (!code) {
    return NextResponse.json(
      { error: 'Missing code parameter' },
      { status: 400 },
    );
  }

  const state = request.nextUrl.searchParams.get('state') ?? '/';
  const tokenEndpoint = requireEnv('COGNITO_TOKEN_ENDPOINT');
  const clientId = requireEnv('COGNITO_SIGN_IN_CLIENT_ID');
  const clientSecret = await fetchSignInClientSecret();
  const redirectUri = buildRedirectUri(request);

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString(
    'base64',
  );
  const tokenResponse = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!tokenResponse.ok) {
    return NextResponse.json(
      { error: 'Token exchange failed' },
      { status: 500 },
    );
  }

  const { id_token } = (await tokenResponse.json()) as TokenResponse;
  const { sub } = decodeIdTokenPayload(id_token);
  const sessionCookie = createSessionCookie(sub);

  const response = NextResponse.redirect(new URL(state, request.url));
  response.cookies.set(SESSION_COOKIE, sessionCookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return response;
}
