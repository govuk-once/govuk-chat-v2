import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const USER_POOL_ID = 'eu-west-1_example';
const ISSUER = `https://cognito-idp.eu-west-1.amazonaws.com/${USER_POOL_ID}`;
const DOMAIN = 'https://example.auth.eu-west-1.amazoncognito.com';
const CLIENT_ID = 'sign-in-client-id';
const CALLBACK = 'https://chat.example.com/api/auth/callback';

const testEnv = {} as {
  startSignIn: typeof import('./oidc.ts').startSignIn;
  finishSignIn: typeof import('./oidc.ts').finishSignIn;
};

const cognitoKey = generateKeyPairSync('rsa', { modulusLength: 2048 });
const otherKey = generateKeyPairSync('rsa', { modulusLength: 2048 });

function base64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function idToken(sub: string, privateKey: KeyObject): string {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${base64url({ alg: 'RS256', kid: 'cognito-key' })}.${base64url(
    { iss: ISSUER, aud: CLIENT_ID, sub, iat: now, exp: now + 3600 },
  )}`;
  const signature = sign('sha256', Buffer.from(unsigned), privateKey);
  return `${unsigned}.${signature.toString('base64url')}`;
}

// Fakes the parts of Cognito the sign-in talks to: its discovery document,
// its signing keys and its token endpoint.
function fakeCognito(tokenFor: () => string): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === `${ISSUER}/.well-known/openid-configuration`) {
      return Promise.resolve(
        Response.json({
          issuer: ISSUER,
          authorization_endpoint: `${DOMAIN}/oauth2/authorize`,
          token_endpoint: `${DOMAIN}/oauth2/token`,
          jwks_uri: `${ISSUER}/.well-known/jwks.json`,
          response_types_supported: ['code'],
          id_token_signing_alg_values_supported: ['RS256'],
        }),
      );
    }
    if (url === `${ISSUER}/.well-known/jwks.json`) {
      const jwk = cognitoKey.publicKey.export({ format: 'jwk' });
      return Promise.resolve(
        Response.json({
          keys: [{ ...jwk, kid: 'cognito-key', alg: 'RS256', use: 'sig' }],
        }),
      );
    }
    if (url === `${DOMAIN}/oauth2/token`) {
      return Promise.resolve(
        Response.json({
          access_token: 'access-token',
          id_token: tokenFor(),
          token_type: 'Bearer',
          expires_in: 3600,
        }),
      );
    }
    return Promise.reject(new Error(`Unexpected fetch to ${url}`));
  });
}

beforeAll(async () => {
  vi.doMock('@aws-sdk/client-cognito-identity-provider', () => ({
    CognitoIdentityProviderClient: class {
      send = () =>
        Promise.resolve({ UserPoolClient: { ClientSecret: 'client-secret' } });
    },
    DescribeUserPoolClientCommand: class {},
  }));

  const oidcModule = await import('./oidc.ts');
  testEnv.startSignIn = oidcModule.startSignIn;
  testEnv.finishSignIn = oidcModule.finishSignIn;
});

beforeEach(() => {
  vi.stubEnv('COGNITO_USER_POOL_ID', USER_POOL_ID);
  vi.stubEnv('COGNITO_SIGN_IN_CLIENT_ID', CLIENT_ID);
});

describe('startSignIn', () => {
  it('sends users to the Hosted UI with PKCE and a state', async () => {
    fakeCognito(() => '');

    const { url, flow } = await testEnv.startSignIn(CALLBACK, '/chat');

    expect(url.origin + url.pathname).toBe(`${DOMAIN}/oauth2/authorize`);
    expect(url.searchParams.get('redirect_uri')).toBe(CALLBACK);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBe(flow.state);
    expect(flow.returnPath).toBe('/chat');
  });
});

describe('finishSignIn', () => {
  it("returns the user's Cognito sub", async () => {
    const sub = crypto.randomUUID();
    fakeCognito(() => idToken(sub, cognitoKey.privateKey));
    const { flow } = await testEnv.startSignIn(CALLBACK, '/');

    const result = await testEnv.finishSignIn(
      new URL(`${CALLBACK}?code=code&state=${flow.state}`),
      flow,
    );

    expect(result).toBe(sub);
  });

  it('rejects a callback whose state does not match', async () => {
    fakeCognito(() => idToken(crypto.randomUUID(), cognitoKey.privateKey));
    const { flow } = await testEnv.startSignIn(CALLBACK, '/');

    await expect(
      testEnv.finishSignIn(new URL(`${CALLBACK}?code=code&state=forged`), flow),
    ).rejects.toThrow();
  });

  it('rejects an ID token not signed by Cognito', async () => {
    fakeCognito(() => idToken(crypto.randomUUID(), otherKey.privateKey));
    const { flow } = await testEnv.startSignIn(CALLBACK, '/');

    await expect(
      testEnv.finishSignIn(
        new URL(`${CALLBACK}?code=code&state=${flow.state}`),
        flow,
      ),
    ).rejects.toThrow();
  });
});
