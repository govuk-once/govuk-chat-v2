import { beforeEach, describe, expect, it, vi } from 'vitest';

const SECRET_ARN =
  'arn:aws:secretsmanager:eu-west-1:123456789012:secret:session-secret';
const SECRET = 'x'.repeat(64);

const send = vi.fn();

const testEnv = {} as { sessionSecret: () => Promise<string> };

vi.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: vi.fn().mockImplementation(function () {
    return { send };
  }),
  GetSecretValueCommand: vi.fn().mockImplementation(function (input: unknown) {
    return { input };
  }),
}));

// The module caches the fetched secret, so each test needs a fresh copy.
beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('SESSION_SECRET', '');
  vi.stubEnv('SESSION_SECRET_ARN', SECRET_ARN);
  const secretModule = await import('./session-secret.ts');
  testEnv.sessionSecret = secretModule.sessionSecret;
});

describe('sessionSecret', () => {
  it('returns SESSION_SECRET without fetching when it is set', async () => {
    vi.stubEnv('SESSION_SECRET', SECRET);

    expect(await testEnv.sessionSecret()).toBe(SECRET);
    expect(send).not.toHaveBeenCalled();
  });

  it('fetches the secret once and caches it', async () => {
    send.mockResolvedValueOnce({ SecretString: SECRET });

    expect(await testEnv.sessionSecret()).toBe(SECRET);
    expect(await testEnv.sessionSecret()).toBe(SECRET);
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith({ input: { SecretId: SECRET_ARN } });
  });

  it('throws when the secret has no value', async () => {
    send.mockResolvedValueOnce({});

    await expect(testEnv.sessionSecret()).rejects.toThrow(
      `Secret ${SECRET_ARN} has no value`,
    );
  });

  it('fetches again after a failed fetch', async () => {
    send
      .mockRejectedValueOnce(new Error('throttled'))
      .mockResolvedValueOnce({ SecretString: SECRET });

    await expect(testEnv.sessionSecret()).rejects.toThrow('throttled');
    expect(await testEnv.sessionSecret()).toBe(SECRET);
  });
});
