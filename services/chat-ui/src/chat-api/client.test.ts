import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InvokeThreadInput } from './client.ts';

const CHAT_API_URL = 'https://api.example.com/dev/';
const TOKEN_ENDPOINT = 'https://auth.example.com/oauth2/token';
const USER_POOL_ID = 'eu-west-1_example';
const APP_CLIENT_ID = 'example-client-id';
const CLIENT_SECRET = 'example-client-secret';
const ACCESS_TOKEN = 'example-access-token';
const TOKEN_LIFETIME_SECONDS = 3600;
const NOW = new Date('2026-09-24T12:00:00.000Z');

const send = vi.fn();
const fetchMock = vi.fn<typeof fetch>();

const testEnv = {} as {
  invokeThread: (input: InvokeThreadInput) => Promise<Response>;
};

function invokeInput(): InvokeThreadInput {
  return {
    threadId: crypto.randomUUID(),
    runId: crypto.randomUUID(),
    endUserId: crypto.randomUUID(),
    content: 'Tell me about SSP',
    signal: new AbortController().signal,
  };
}

function tokenResponse(): Response {
  return Response.json({
    access_token: ACCESS_TOKEN,
    expires_in: TOKEN_LIFETIME_SECONDS,
    token_type: 'Bearer',
  });
}

function tokenRequests(): Parameters<typeof fetch>[] {
  return fetchMock.mock.calls.filter(([url]) => url === TOKEN_ENDPOINT);
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.stubEnv('CHAT_API_URL', CHAT_API_URL);
  vi.stubEnv('COGNITO_TOKEN_ENDPOINT', TOKEN_ENDPOINT);
  vi.stubEnv('COGNITO_USER_POOL_ID', USER_POOL_ID);
  vi.stubEnv('COGNITO_APP_CLIENT_ID', APP_CLIENT_ID);
  vi.stubGlobal('fetch', fetchMock);

  send.mockResolvedValue({ UserPoolClient: { ClientSecret: CLIENT_SECRET } });
  fetchMock.mockImplementation(async (url) =>
    url === TOKEN_ENDPOINT ? tokenResponse() : new Response('upstream'),
  );

  // The token cache lives in module scope, so each test imports afresh.
  vi.resetModules();
  vi.doMock('@aws-sdk/client-cognito-identity-provider', () => ({
    CognitoIdentityProviderClient: vi.fn().mockImplementation(function () {
      return { send };
    }),
    DescribeUserPoolClientCommand: vi.fn().mockImplementation(function (
      input: unknown,
    ) {
      return { input };
    }),
  }));
  const clientModule = await import('./client.ts');
  testEnv.invokeThread = clientModule.invokeThread;
});

afterAll(() => {
  vi.useRealTimers();
});

describe('configuration', () => {
  it('throws when a variable is not configured', async () => {
    vi.stubEnv('CHAT_API_URL', undefined);

    await expect(testEnv.invokeThread(invokeInput())).rejects.toThrow(
      'CHAT_API_URL is not configured',
    );
  });
});

describe('invokeThread', () => {
  it('fetches a token with the client secret once and reuses it', async () => {
    await testEnv.invokeThread(invokeInput());
    await testEnv.invokeThread(invokeInput());

    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith({
      input: { UserPoolId: USER_POOL_ID, ClientId: APP_CLIENT_ID },
    });
    expect(tokenRequests()).toHaveLength(1);
    const [, tokenInit] = tokenRequests()[0]!;
    expect(new Headers(tokenInit?.headers).get('Authorization')).toBe(
      `Basic ${btoa(`${APP_CLIENT_ID}:${CLIENT_SECRET}`)}`,
    );
  });

  it('fetches a new token once the cached one is within a minute of expiring', async () => {
    await testEnv.invokeThread(invokeInput());
    vi.setSystemTime(NOW.getTime() + (TOKEN_LIFETIME_SECONDS - 60) * 1000);
    await testEnv.invokeThread(invokeInput());

    expect(tokenRequests()).toHaveLength(2);
  });

  it('throws when the app client has no client secret', async () => {
    send.mockResolvedValueOnce({ UserPoolClient: {} });

    await expect(testEnv.invokeThread(invokeInput())).rejects.toThrow(
      `App client ${APP_CLIENT_ID} has no client secret`,
    );
    expect(tokenRequests()).toHaveLength(0);
  });

  it('throws when the token request fails and does not cache the failure', async () => {
    fetchMock.mockResolvedValueOnce(new Response(undefined, { status: 400 }));

    await expect(testEnv.invokeThread(invokeInput())).rejects.toThrow(
      'Token request failed with status 400',
    );
    await testEnv.invokeThread(invokeInput());

    expect(tokenRequests()).toHaveLength(2);
  });

  it('posts one user message to the invoke endpoint and returns the response', async () => {
    const input = invokeInput();

    const response = await testEnv.invokeThread(input);

    const [url, init] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe(`${CHAT_API_URL}v1/threads/invoke`);
    expect(init?.signal).toBe(input.signal);
    expect(init?.headers).toEqual({
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      'end-user-id': input.endUserId,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    });
    expect(JSON.parse(init?.body as string)).toEqual({
      threadId: input.threadId,
      runId: input.runId,
      messages: [
        {
          id: expect.stringMatching(
            /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/,
          ),
          role: 'user',
          content: input.content,
        },
      ],
    });
    expect(await response.text()).toBe('upstream');
  });
});
