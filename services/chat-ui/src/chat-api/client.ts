import {
  CognitoIdentityProviderClient,
  DescribeUserPoolClientCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const TOKEN_SCOPE = 'chat-api/invoke';
const TOKEN_EXPIRY_MARGIN_MS = 60_000;

interface ChatApiConfig {
  chatApiUrl: string;
  tokenEndpoint: string;
  userPoolId: string;
  appClientId: string;
}

interface AccessToken {
  value: string;
  expiresAt: number;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
}

export interface InvokeThreadInput {
  threadId: string;
  runId: string;
  endUserId: string;
  content: string;
  signal: AbortSignal;
}

const cognitoClient = new CognitoIdentityProviderClient({});

// A property rather than a top-level `let`, which unicorn's lint rules reject.
const tokenCache: { token?: AccessToken } = {};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

// Read on use rather than at import, unlike chat-api-ts, because `next build`
// imports route modules inside the Docker build, where none of this is set.
function readConfig(): ChatApiConfig {
  return {
    chatApiUrl: requireEnv('CHAT_API_URL'),
    tokenEndpoint: requireEnv('COGNITO_TOKEN_ENDPOINT'),
    userPoolId: requireEnv('COGNITO_USER_POOL_ID'),
    appClientId: requireEnv('COGNITO_APP_CLIENT_ID'),
  };
}

async function fetchClientSecret(config: ChatApiConfig): Promise<string> {
  const { UserPoolClient } = await cognitoClient.send(
    new DescribeUserPoolClientCommand({
      UserPoolId: config.userPoolId,
      ClientId: config.appClientId,
    }),
  );
  if (!UserPoolClient?.ClientSecret) {
    throw new Error(`App client ${config.appClientId} has no client secret`);
  }
  return UserPoolClient.ClientSecret;
}

async function fetchAccessToken(config: ChatApiConfig): Promise<AccessToken> {
  const clientSecret = await fetchClientSecret(config);
  const credentials = Buffer.from(
    `${config.appClientId}:${clientSecret}`,
  ).toString('base64');

  const response = await fetch(config.tokenEndpoint, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: TOKEN_SCOPE,
    }),
  });
  if (!response.ok) {
    throw new Error(`Token request failed with status ${response.status}`);
  }

  const token = (await response.json()) as TokenResponse;
  return {
    value: token.access_token,
    expiresAt: Date.now() + token.expires_in * 1000,
  };
}

async function getAccessToken(config: ChatApiConfig): Promise<string> {
  if (
    !tokenCache.token ||
    Date.now() >= tokenCache.token.expiresAt - TOKEN_EXPIRY_MARGIN_MS
  ) {
    tokenCache.token = await fetchAccessToken(config);
  }
  return tokenCache.token.value;
}

export async function invokeThread(
  input: InvokeThreadInput,
): Promise<Response> {
  const config = readConfig();
  const accessToken = await getAccessToken(config);

  return fetch(`${config.chatApiUrl.replace(/\/$/, '')}/v1/threads/invoke`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'end-user-id': input.endUserId,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({
      threadId: input.threadId,
      runId: input.runId,
      messages: [
        { id: crypto.randomUUID(), role: 'user', content: input.content },
      ],
    }),
    signal: input.signal,
  });
}
