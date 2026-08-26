import type {
  APIGatewayProxyEvent,
  APIGatewayProxyEventHeaders,
} from 'aws-lambda';

/*
All values in this fixture are pulled from the AWS docs for API Gateway
proxy integration, and are used to create a realistic APIGatewayProxyEvent
fixture for testing. See:
https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html
*/

const DEFAULT_HEADERS: APIGatewayProxyEventHeaders = {
  accept: '*/*',
  'content-type': 'application/json',
  host: 'abc123def4.execute-api.eu-west-1.amazonaws.com',
  'user-agent': 'aws-cli/2.31.11',
  'x-amzn-trace-id': 'Root=1-68ad4c2f-1f6f4a3b7c2d5e8a9b0c1d2e',
  'x-forwarded-for': '203.0.113.42',
  'x-forwarded-port': '443',
  'x-forwarded-proto': 'https',
};

/* eslint-disable unicorn/no-null -- API Gateway sends null for the event
fields a request doesn't populate, and @types/aws-lambda types them that
way, so the fixture has to use null too. */
const BASE_EVENT: Omit<APIGatewayProxyEvent, 'body' | 'headers'> = {
  resource: '/{proxy+}',
  multiValueHeaders: {},
  path: '/path/to/resource',
  httpMethod: 'POST',
  queryStringParameters: null,
  multiValueQueryStringParameters: null,
  pathParameters: null,
  stageVariables: null,
  isBase64Encoded: false,
  requestContext: {
    accountId: '123456789012',
    apiId: 'abc123def4',
    authorizer: null,
    domainName: 'abc123def4.execute-api.eu-west-1.amazonaws.com',
    domainPrefix: 'abc123def4',
    extendedRequestId: 'Qk1TxGHVjoEEJfw=',
    httpMethod: 'POST',
    identity: {
      accessKey: 'ASIAIOSFODNN7EXAMPLE',
      accountId: '123456789012',
      apiKey: null,
      apiKeyId: null,
      caller: 'AROAEXAMPLEID:test-session',
      clientCert: null,
      cognitoAuthenticationProvider: null,
      cognitoAuthenticationType: null,
      cognitoIdentityId: null,
      cognitoIdentityPoolId: null,
      principalOrgId: null,
      sourceIp: '203.0.113.42',
      user: 'AROAEXAMPLEID:test-session',
      userAgent: 'aws-cli/2.31.11',
      userArn: 'arn:aws:sts::123456789012:assumed-role/test-role/test-session',
    },
    path: '/dev/path/to/resource',
    protocol: 'HTTP/1.1',
    requestId: '9b0c1d2e-3f4a-5b6c-7d8e-9f0a1b2c3d4e',
    requestTime: '26/Aug/2026:09:00:00 +0000',
    requestTimeEpoch: 1_787_130_000_000,
    resourceId: 'a1b2c3',
    resourcePath: '/{proxy+}',
    stage: 'dev',
  },
};

export function apiGatewayProxyEventFixture(
  body: string | null = null,
  headerOverrides: APIGatewayProxyEventHeaders = {},
): APIGatewayProxyEvent {
  return {
    ...BASE_EVENT,
    body,
    headers: { ...DEFAULT_HEADERS, ...headerOverrides },
  };
}
