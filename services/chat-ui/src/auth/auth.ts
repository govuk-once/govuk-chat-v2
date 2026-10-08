import {
  CognitoIdentityProviderClient,
  DescribeUserPoolClientCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { betterAuth } from 'better-auth';
import { requireEnv } from '../lib/env.ts';

const SESSION_MAX_AGE_SECONDS = 24 * 60 * 60;

const cognitoClient = new CognitoIdentityProviderClient({});

// The app reads the sign-in client's secret from Cognito, rather than holding
// a copy of it, so the auth instance can only be built once that's fetched.
async function fetchSignInClientSecret(
  userPoolId: string,
  clientId: string,
): Promise<string> {
  const { UserPoolClient } = await cognitoClient.send(
    new DescribeUserPoolClientCommand({
      UserPoolId: userPoolId,
      ClientId: clientId,
    }),
  );
  if (!UserPoolClient?.ClientSecret) {
    throw new Error(`Sign-in client ${clientId} has no client secret`);
  }
  return UserPoolClient.ClientSecret;
}

async function createAuth() {
  const userPoolId = requireEnv('COGNITO_USER_POOL_ID');
  const clientId = requireEnv('COGNITO_SIGN_IN_CLIENT_ID');
  const clientSecret = await fetchSignInClientSecret(userPoolId, clientId);

  return betterAuth({
    secret: requireEnv('SESSION_SECRET'),
    // Behind the load balancer the request's own URL is the container's, so
    // the public origin comes from the forwarded headers, limited to hosts we
    // serve from.
    baseURL: { allowedHosts: ['localhost:3000', '*.on.aws'] },
    advanced: { trustedProxyHeaders: true },
    session: { expiresIn: SESSION_MAX_AGE_SECONDS },
    // With no database, Better Auth keeps the session in an encrypted cookie.
    // Cognito's tokens aren't needed after sign-in, and are large enough to
    // risk header limits, so they aren't kept in a cookie alongside it.
    account: { storeAccountCookie: false },
    user: {
      // Without a database, Better Auth's own user ID is generated in memory
      // and changes whenever the task restarts, so the Cognito sub is carried
      // on the session to identify the user to the Chat API.
      additionalFields: { cognitoSub: { type: 'string', required: true } },
    },
    // Fields that are filled from the provider profile must also accept user
    // input, which /update-user would let a signed-in user change. Changing
    // cognitoSub would let them act as another user, so that path is off.
    disabledPaths: ['/update-user'],
    socialProviders: {
      cognito: {
        clientId,
        clientSecret,
        domain: requireEnv('COGNITO_DOMAIN'),
        // Cognito user pool IDs are prefixed with their region.
        region: userPoolId.split('_', 1)[0],
        userPoolId,
        disableDefaultScope: true,
        scope: ['openid'],
        mapProfileToUser: (profile) => ({
          cognitoSub: profile.sub,
          // Better Auth refuses a sign-in without an email, and only the
          // openid scope is requested, so a placeholder stands in.
          email: `${profile.sub}@users.invalid`,
        }),
      },
    },
  });
}

const authCache: { value?: ReturnType<typeof createAuth> } = {};

// A failed build (e.g. Cognito unreachable) isn't cached, so the next request
// tries again.
async function createAuthOrForget(): ReturnType<typeof createAuth> {
  try {
    return await createAuth();
  } catch (error) {
    authCache.value = undefined;
    throw error;
  }
}

export function getAuth(): ReturnType<typeof createAuth> {
  authCache.value ??= createAuthOrForget();
  return authCache.value;
}

export async function signedInSub(
  headers: Headers,
): Promise<string | undefined> {
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers });
  return session?.user.cognitoSub;
}
