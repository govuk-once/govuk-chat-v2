import {
  CognitoIdentityProviderClient,
  DescribeUserPoolClientCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import * as client from 'openid-client';
import { requireEnv } from '../lib/env.ts';

const cognitoClient = new CognitoIdentityProviderClient({});

// What the callback needs to finish a sign-in the proxy started.
export interface SignInFlow {
  codeVerifier: string;
  state: string;
  returnPath: string;
}

// The app reads the sign-in client's secret from Cognito, rather than holding
// a copy of it.
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

// Cognito publishes its endpoints at the user pool's issuer URL, so they're
// discovered rather than built by hand.
async function discover(): Promise<client.Configuration> {
  const userPoolId = requireEnv('COGNITO_USER_POOL_ID');
  const clientId = requireEnv('COGNITO_SIGN_IN_CLIENT_ID');
  const clientSecret = await fetchSignInClientSecret(userPoolId, clientId);
  // Cognito user pool IDs are prefixed with their region.
  const region = userPoolId.split('_', 1)[0];

  const config = await client.discovery(
    new URL(`https://cognito-idp.${region}.amazonaws.com/${userPoolId}`),
    clientId,
    undefined,
    client.ClientSecretBasic(clientSecret),
  );
  // The ID token comes straight from Cognito over TLS, so OIDC doesn't
  // require its signature to be checked, but it's cheap to do anyway.
  client.enableNonRepudiationChecks(config);
  return config;
}

const configCache: { value?: Promise<client.Configuration> } = {};

// A failed discovery (e.g. Cognito unreachable) isn't cached, so the next
// request tries again.
async function discoverOrForget(): Promise<client.Configuration> {
  try {
    return await discover();
  } catch (error) {
    configCache.value = undefined;
    throw error;
  }
}

function cognitoConfig(): Promise<client.Configuration> {
  configCache.value ??= discoverOrForget();
  return configCache.value;
}

export async function startSignIn(
  redirectUri: string,
  returnPath: string,
): Promise<{ url: URL; flow: SignInFlow }> {
  const config = await cognitoConfig();
  const codeVerifier = client.randomPKCECodeVerifier();
  const state = client.randomState();

  const url = client.buildAuthorizationUrl(config, {
    redirect_uri: redirectUri,
    scope: 'openid',
    code_challenge: await client.calculatePKCECodeChallenge(codeVerifier),
    code_challenge_method: 'S256',
    state,
  });
  return { url, flow: { codeVerifier, state, returnPath } };
}

// Returns the signed-in user's Cognito sub.
export async function finishSignIn(
  callbackUrl: URL,
  flow: SignInFlow,
): Promise<string> {
  const config = await cognitoConfig();
  const tokens = await client.authorizationCodeGrant(config, callbackUrl, {
    pkceCodeVerifier: flow.codeVerifier,
    expectedState: flow.state,
  });
  const claims = tokens.claims();
  if (!claims) {
    throw new Error('Cognito returned no ID token');
  }
  return claims.sub;
}
