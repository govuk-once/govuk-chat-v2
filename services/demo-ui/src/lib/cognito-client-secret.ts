import {
  CognitoIdentityProviderClient,
  DescribeUserPoolClientCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const cognitoClient = new CognitoIdentityProviderClient({});

export async function fetchClientSecret(
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
    throw new Error(`App client ${clientId} has no client secret`);
  }
  return UserPoolClient.ClientSecret;
}
