import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const COGNITO_DOMAIN = 'example.auth.eu-west-1.amazoncognito.com';
const APP_HOST = 'chat-ui-abc123.ecs.eu-west-1.on.aws';

const testEnv = {} as {
  getAuth: typeof import('./auth.ts').getAuth;
  signedInSub: typeof import('./auth.ts').signedInSub;
};

function base64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

// Cognito's ID token isn't signature-checked in the code flow, as it comes
// straight from the token endpoint, so an unsigned one is enough here.
function idTokenFor(sub: string): string {
  return `${base64url({ alg: 'none' })}.${base64url({ sub })}.`;
}

function cookieHeader(setCookies: string[]): string {
  return setCookies.map((cookie) => cookie.split(';', 1)[0]).join('; ');
}

function appHeaders(cookies = ''): Headers {
  return new Headers({
    host: 'localhost:3000',
    'x-forwarded-host': APP_HOST,
    'x-forwarded-proto': 'https',
    cookie: cookies,
  });
}

// Runs the whole Hosted UI round trip against the real Better Auth config,
// with only Cognito's HTTP responses faked.
async function signIn(sub: string): Promise<Headers> {
  const auth = await testEnv.getAuth();
  const { headers: startHeaders, response } = await auth.api.signInSocial({
    body: { provider: 'cognito', callbackURL: '/', disableRedirect: true },
    headers: appHeaders(),
    returnHeaders: true,
  });
  const state = new URL(response.url!).searchParams.get('state')!;

  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
    Response.json({
      access_token: 'access-token',
      id_token: idTokenFor(sub),
      token_type: 'Bearer',
      expires_in: 3600,
    }),
  );

  const callback = await auth.handler(
    new Request(
      `https://${APP_HOST}/api/auth/callback/cognito?code=code&state=${state}`,
      { headers: appHeaders(cookieHeader(startHeaders.getSetCookie())) },
    ),
  );
  return appHeaders(cookieHeader(callback.headers.getSetCookie()));
}

beforeAll(async () => {
  vi.stubEnv('COGNITO_USER_POOL_ID', 'eu-west-1_example');
  vi.stubEnv('COGNITO_SIGN_IN_CLIENT_ID', 'sign-in-client-id');
  vi.stubEnv('COGNITO_DOMAIN', COGNITO_DOMAIN);
  vi.stubEnv('SESSION_SECRET', 'a'.repeat(64));

  vi.doMock('@aws-sdk/client-cognito-identity-provider', () => ({
    CognitoIdentityProviderClient: class {
      send = () =>
        Promise.resolve({ UserPoolClient: { ClientSecret: 'client-secret' } });
    },
    DescribeUserPoolClientCommand: class {},
  }));

  const authModule = await import('./auth.ts');
  testEnv.getAuth = authModule.getAuth;
  testEnv.signedInSub = authModule.signedInSub;
});

beforeEach(() => {
  vi.stubEnv('COGNITO_USER_POOL_ID', 'eu-west-1_example');
  vi.stubEnv('COGNITO_SIGN_IN_CLIENT_ID', 'sign-in-client-id');
  vi.stubEnv('COGNITO_DOMAIN', COGNITO_DOMAIN);
  vi.stubEnv('SESSION_SECRET', 'a'.repeat(64));
});

describe('signedInSub', () => {
  it('returns the Cognito sub of a signed-in user', async () => {
    const sub = crypto.randomUUID();

    const session = await signIn(sub);

    expect(await testEnv.signedInSub(session)).toBe(sub);
  });

  it('returns the same sub each time a user signs in', async () => {
    const sub = crypto.randomUUID();

    const first = await signIn(sub);
    const second = await signIn(sub);

    expect(await testEnv.signedInSub(first)).toBe(sub);
    expect(await testEnv.signedInSub(second)).toBe(sub);
  });

  it('returns undefined without a session', async () => {
    expect(await testEnv.signedInSub(appHeaders())).toBeUndefined();
  });
});

describe('getAuth', () => {
  it('sends users to the Cognito Hosted UI with the callback on our host', async () => {
    const auth = await testEnv.getAuth();
    const { response } = await auth.api.signInSocial({
      body: { provider: 'cognito', callbackURL: '/', disableRedirect: true },
      headers: appHeaders(),
      returnHeaders: true,
    });

    const url = new URL(response.url!);
    expect(url.host).toBe(COGNITO_DOMAIN);
    expect(url.searchParams.get('scope')).toBe('openid');
    expect(url.searchParams.get('redirect_uri')).toBe(
      `https://${APP_HOST}/api/auth/callback/cognito`,
    );
  });

  // Regression guard: cognitoSub has to accept user input to be filled from
  // the Cognito profile, so this path would let a user impersonate another.
  it('does not let a user change their own details', async () => {
    const auth = await testEnv.getAuth();
    const session = await signIn(crypto.randomUUID());

    const response = await auth.handler(
      new Request(`https://${APP_HOST}/api/auth/update-user`, {
        method: 'POST',
        headers: {
          ...Object.fromEntries(session),
          'content-type': 'application/json',
        },
        body: JSON.stringify({ cognitoSub: crypto.randomUUID() }),
      }),
    );

    expect(response.status).toBe(404);
  });
});
