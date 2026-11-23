import {
  AdminDeleteUserCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import { RUN_CONTEXT } from './run-context.ts';

export default async function globalTeardown(): Promise<void> {
  const userPoolId = process.env[RUN_CONTEXT.userPoolId];
  const username = process.env[RUN_CONTEXT.username];
  // Playwright runs teardown even when global setup failed before creating
  // the user.
  if (!userPoolId || !username) {
    return;
  }

  const cognito = new CognitoIdentityProviderClient({});
  await cognito.send(
    new AdminDeleteUserCommand({ UserPoolId: userPoolId, Username: username }),
  );
}
