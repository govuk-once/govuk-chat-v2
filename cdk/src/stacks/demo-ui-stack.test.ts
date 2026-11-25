import * as cdk from 'aws-cdk-lib';
import baseContext from '../../cdk.json' with { type: 'json' };
import { Tags, Template, Match } from 'aws-cdk-lib/assertions';
import { vi, describe, expect, it } from 'vitest';
import { DemoUiStack } from './demo-ui-stack.ts';

const context = {
  ...baseContext,
  // prevent stacks from being bundled
  'aws:cdk:bundling-stacks': [],
};

describe('DemoUiStack', () => {
  const baseProps = {
    serviceName: 'demo-ui',
    teamName: 'chat',
    repositoryUrl: 'https://example.com/repo',
    environment: 'testing',
    chatApiUrl: 'https://api.example.com/testing/',
    cognitoTokenEndpoint: 'https://auth.example.com/oauth2/token',
    cognitoUserPoolId: 'eu-west-1_example',
    cognitoUserPoolArn:
      'arn:aws:cognito-idp:eu-west-1:123456789012:userpool/eu-west-1_example',
    cognitoAppClientId: 'example-client-id',
  };

  function createStack() {
    const app = new cdk.App({ context });
    return new DemoUiStack(app, 'TestStack', baseProps);
  }

  type CloudFormationReference =
    { Ref: string } | { 'Fn::GetAtt': [string, string] };

  function referencePlaceholder(reference: CloudFormationReference): string {
    return 'Ref' in reference
      ? `<${reference.Ref}>`
      : `<${reference['Fn::GetAtt'].join('.')}>`;
  }

  // The custom resource's SDK call, as JSON text with each CloudFormation
  // reference replaced by a placeholder naming it.
  function signInClientSettings(
    template = Template.fromStack(createStack()),
  ): string {
    const [customResource] = Object.values(
      template.findResources('Custom::AWS'),
    );
    const [, parts] = customResource.Properties.Update['Fn::Join'] as [
      string,
      (string | CloudFormationReference)[],
    ];
    return parts
      .map((part) =>
        typeof part === 'string' ? part : referencePlaceholder(part),
      )
      .join('');
  }

  describe('Stack tags', () => {
    it('sets common tags', () => {
      Tags.fromStack(createStack()).hasValues({
        ServiceName: baseProps.serviceName,
        TeamName: baseProps.teamName,
        RepositoryUrl: baseProps.repositoryUrl,
        Environment: baseProps.environment,
      });
    });
  });

  describe('Web function', () => {
    it('creates a web function with a public endpoint', () => {
      const template = Template.fromStack(createStack());

      template.resourceCountIs('AWS::Lambda::WebFunction', 1);
      template.hasResourceProperties('AWS::Lambda::WebFunctionEndpoint', {
        AuthType: 'ApplicationManaged',
      });
    });

    it('passes the environment name, Chat API values and session secret ARN', () => {
      const template = Template.fromStack(createStack());

      template.hasResourceProperties('AWS::Lambda::WebFunctionRevision', {
        ServiceConfig: Match.objectLike({
          EnvironmentVariables: {
            ENVIRONMENT: baseProps.environment,
            CHAT_API_URL: baseProps.chatApiUrl,
            COGNITO_TOKEN_ENDPOINT: baseProps.cognitoTokenEndpoint,
            COGNITO_USER_POOL_ID: baseProps.cognitoUserPoolId,
            COGNITO_APP_CLIENT_ID: baseProps.cognitoAppClientId,
            COGNITO_SIGN_IN_CLIENT_ID: Match.anyValue(),
            SESSION_SECRET_ARN: Match.anyValue(),
          },
        }),
      });
    });

    it('lets the execution role describe the Chat API user pool client', () => {
      const template = Template.fromStack(createStack());

      const [revision] = Object.values(
        template.findResources('AWS::Lambda::WebFunctionRevision'),
      );
      const roleId =
        revision.Properties.ServiceConfig.ExecutionRoleArn['Fn::GetAtt'][0];

      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            {
              Action: 'cognito-idp:DescribeUserPoolClient',
              Effect: 'Allow',
              Resource: baseProps.cognitoUserPoolArn,
            },
          ]),
        },
        Roles: [{ Ref: roleId }],
      });
    });

    it('outputs the endpoint URL', () => {
      const template = Template.fromStack(createStack());

      template.hasOutput('EndpointUrl', {});
    });

    it('outputs the sign-in client ID', () => {
      const template = Template.fromStack(createStack());

      template.hasOutput('SignInClientId', {});
    });
  });

  describe('Sign-in client', () => {
    it('creates a client with a secret on the user pool', () => {
      const template = Template.fromStack(createStack());

      template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
        GenerateSecret: true,
        UserPoolId: baseProps.cognitoUserPoolId,
      });
    });

    it('applies the authorization code grant once the endpoint exists', () => {
      expect(signInClientSettings()).toContain('"AllowedOAuthFlows":["code"]');
    });

    it('allows localhost and the endpoint as origins in ephemeral environments', () => {
      const template = Template.fromStack(createStack());
      const [endpointId] = Object.keys(
        template.findResources('AWS::Lambda::WebFunctionEndpoint'),
      );
      const endpointOrigin = `https://<${endpointId}.DomainName>`;

      const { parameters } = JSON.parse(signInClientSettings(template));

      expect(parameters.CallbackURLs).toEqual([
        'http://localhost:3000/api/auth/callback',
        `${endpointOrigin}/api/auth/callback`,
      ]);
      expect(parameters.LogoutURLs).toEqual([
        'http://localhost:3000/',
        `${endpointOrigin}/`,
      ]);
    });

    it('allows no localhost callback in non-ephemeral environments', () => {
      vi.stubEnv('ENVIRONMENT', 'prod');

      expect(signInClientSettings()).not.toContain('localhost');
    });

    it('keeps the client secret out of the custom resource logs', () => {
      expect(signInClientSettings()).toContain('"logApiResponseData":false');
    });
  });

  describe('Log group', () => {
    it('retains the log group for non-ephemeral environments', () => {
      vi.stubEnv('ENVIRONMENT', 'prod');

      const productionTemplate = Template.fromStack(createStack());

      productionTemplate.hasResource('AWS::Logs::LogGroup', {
        DeletionPolicy: 'Retain',
      });
    });

    it('deletes the log group for ephemeral environments', () => {
      const template = Template.fromStack(createStack());

      template.hasResource('AWS::Logs::LogGroup', {
        DeletionPolicy: 'Delete',
      });
    });
  });
});
