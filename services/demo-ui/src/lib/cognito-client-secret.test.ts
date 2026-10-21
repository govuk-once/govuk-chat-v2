import { beforeAll, describe, expect, it, vi } from 'vitest';

const USER_POOL_ID = 'eu-west-1_example';
const CLIENT_ID = 'example-client-id';
const CLIENT_SECRET = 'example-client-secret';

const send = vi.fn();

const testEnv = {} as {
  fetchClientSecret: (userPoolId: string, clientId: string) => Promise<string>;
};

beforeAll(async () => {
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
  const secretModule = await import('./cognito-client-secret.ts');
  testEnv.fetchClientSecret = secretModule.fetchClientSecret;
});

describe('fetchClientSecret', () => {
  it("returns the app client's secret", async () => {
    send.mockResolvedValueOnce({
      UserPoolClient: { ClientSecret: CLIENT_SECRET },
    });

    expect(await testEnv.fetchClientSecret(USER_POOL_ID, CLIENT_ID)).toBe(
      CLIENT_SECRET,
    );
    expect(send).toHaveBeenCalledWith({
      input: { UserPoolId: USER_POOL_ID, ClientId: CLIENT_ID },
    });
  });

  it('throws when the app client has no client secret', async () => {
    send.mockResolvedValueOnce({ UserPoolClient: {} });

    await expect(
      testEnv.fetchClientSecret(USER_POOL_ID, CLIENT_ID),
    ).rejects.toThrow(`App client ${CLIENT_ID} has no client secret`);
  });
});
