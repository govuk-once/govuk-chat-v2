import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import { requireEnv } from './env.ts';

const secretsManagerClient = new SecretsManagerClient({});

// A property rather than a top-level `let`, which unicorn's lint rules reject.
const secretCache: { secret?: Promise<string> } = {};

async function fetchSecret(secretArn: string): Promise<string> {
  const { SecretString } = await secretsManagerClient.send(
    new GetSecretValueCommand({ SecretId: secretArn }),
  );
  if (!SecretString) {
    throw new Error(`Secret ${secretArn} has no value`);
  }
  return SecretString;
}

async function fetchSecretUncachedOnFailure(
  secretArn: string,
): Promise<string> {
  try {
    return await fetchSecret(secretArn);
  } catch (error) {
    // Let the next request try again, rather than failing every request
    // until the web function's environment is recycled.
    secretCache.secret = undefined;
    throw error;
  }
}

// Locally, SESSION_SECRET is set directly. Deployed, it is read from Secrets
// Manager rather than set in the environment, where anyone who can read the
// web function's configuration could read it back.
export function sessionSecret(): Promise<string> {
  const localSecret = process.env.SESSION_SECRET;
  if (localSecret) return Promise.resolve(localSecret);

  secretCache.secret ??= fetchSecretUncachedOnFailure(
    requireEnv('SESSION_SECRET_ARN'),
  );
  return secretCache.secret;
}
