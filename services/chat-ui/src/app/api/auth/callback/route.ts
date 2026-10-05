import {
  CognitoIdentityProviderClient,
  DescribeUserPoolClientCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import {
  createSessionCookie,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
} from '../../../../auth/session.ts';
import { appOrigin, callbackUrl } from '../../../../auth/urls.ts';
import { requireEnv } from '../../../../lib/env.ts';

const cognitoClient = new CognitoIdentityProviderClient({});

const uuidSchema = z.uuid();

const signInSecretCache: { value?: string } = {};

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

// The state comes back from the browser, so only a same-origin path is
// trusted; anything else (e.g. //evil.example) would be an open redirect.
function safeReturnPath(state: string | null): string {
  if (
    !state?.startsWith('/') ||
    state.startsWith('//') ||
    state.includes('\\')
  ) {
    return '/';
  }
  return state;
}

interface TokenResponse {
  id_token: string;
}

function createIdTokenVerifier() {
  return CognitoJwtVerifier.create({
    userPoolId: requireEnv('COGNITO_USER_POOL_ID'),
    tokenUse: 'id',
    clientId: requireEnv('COGNITO_SIGN_IN_CLIENT_ID'),
  });
}

// Kept between requests so the user pool's signing keys are fetched once.
const verifierCache: {
  value?: ReturnType<typeof createIdTokenVerifier>;
} = {};

async function verifiedSub(idToken: string): Promise<string | undefined> {
  verifierCache.value ??= createIdTokenVerifier();
  try {
    const { sub } = await verifierCache.value.verify(idToken);
    return sub;
  } catch {
    return undefined;
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const code = request.nextUrl.searchParams.get('code');
  if (!code) {
    return NextResponse.json(
      { error: 'Missing code parameter' },
      { status: 400 },
    );
  }

  const tokenEndpoint = requireEnv('COGNITO_TOKEN_ENDPOINT');
  const clientId = requireEnv('COGNITO_SIGN_IN_CLIENT_ID');
  const clientSecret = await fetchSignInClientSecret();
  const redirectUri = callbackUrl(request);

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
  const sub = await verifiedSub(id_token);
  if (!sub) {
    return NextResponse.json({ error: 'Invalid ID token' }, { status: 401 });
  }
  // The sub becomes the Chat API's end-user-id, which must be a UUID. Cognito
  // documents it as one, so a mismatch is a server fault worth failing on
  // here rather than on the user's first message.
  if (!uuidSchema.safeParse(sub).success) {
    throw new Error('Cognito sub is not a UUID');
  }
  const sessionCookie = createSessionCookie(sub);

  const returnPath = safeReturnPath(request.nextUrl.searchParams.get('state'));
  const response = NextResponse.redirect(
    new URL(returnPath, appOrigin(request)),
  );
  response.cookies.set(SESSION_COOKIE, sessionCookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return response;
}
