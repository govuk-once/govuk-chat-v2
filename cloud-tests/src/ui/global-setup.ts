import { randomBytes } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import {
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import { chatApiOutputs, demoUiOutputs } from '../environment.ts';
import { RUN_CONTEXT } from './run-context.ts';

// ECS tasks can still be starting after CloudFormation reports the deploy
// complete.
const HEALTH_CHECK_TIMEOUT_MS = 5 * 60_000;
const HEALTH_CHECK_INTERVAL_MS = 5000;
const HEALTH_CHECK_REQUEST_TIMEOUT_MS = 10_000;

// Returns the response status, or why the request failed, to report if the
// Demo UI never becomes healthy.
async function healthCheckResult(healthUrl: URL): Promise<string> {
  try {
    const response = await fetch(healthUrl, {
      signal: AbortSignal.timeout(HEALTH_CHECK_REQUEST_TIMEOUT_MS),
    });
    return String(response.status);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function waitForHealthyDemoUi(endpointUrl: string): Promise<void> {
  const healthUrl = new URL('/api/health', endpointUrl);
  const deadline = Date.now() + HEALTH_CHECK_TIMEOUT_MS;

  let result = await healthCheckResult(healthUrl);
  while (result !== '200') {
    if (Date.now() >= deadline) {
      throw new Error(
        `${healthUrl} wasn't healthy after ${HEALTH_CHECK_TIMEOUT_MS / 1000}s; last result: ${result}`,
      );
    }
    await setTimeout(HEALTH_CHECK_INTERVAL_MS);
    result = await healthCheckResult(healthUrl);
  }
}

// The random part may lack a character class that Cognito's default password
// policy requires, so the suffix guarantees one of each.
const randomPassword = (): string =>
  `${randomBytes(24).toString('base64url')}Aa1!`;

async function createTestUser(userPoolId: string): Promise<void> {
  const cognito = new CognitoIdentityProviderClient({});
  const username = `cloud-test-${randomBytes(8).toString('hex')}`;
  const password = randomPassword();

  await cognito.send(
    new AdminCreateUserCommand({
      UserPoolId: userPoolId,
      Username: username,
      MessageAction: 'SUPPRESS',
    }),
  );
  // Set as soon as the user exists, so teardown deletes it even if setting
  // the password fails.
  process.env[RUN_CONTEXT.userPoolId] = userPoolId;
  process.env[RUN_CONTEXT.username] = username;

  // Permanent skips the forced password change on first sign-in.
  await cognito.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: userPoolId,
      Username: username,
      Password: password,
      Permanent: true,
    }),
  );
  process.env[RUN_CONTEXT.password] = password;
}

export default async function globalSetup(): Promise<void> {
  const [{ endpointUrl }, { userPoolId }] = await Promise.all([
    demoUiOutputs(),
    chatApiOutputs(),
  ]);

  await waitForHealthyDemoUi(endpointUrl);
  process.env[RUN_CONTEXT.demoUiUrl] = endpointUrl;

  await createTestUser(userPoolId);
}
