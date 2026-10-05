import * as cdk from 'aws-cdk-lib';
import baseContext from '../../cdk.json' with { type: 'json' };
import { Tags, Template, Match } from 'aws-cdk-lib/assertions';
import { vi, describe, expect, it } from 'vitest';
import { ChatUiStack } from './chat-ui-stack.ts';

const context = {
  ...baseContext,
  // prevent stacks from being bundled
  'aws:cdk:bundling-stacks': [],
};

describe('ChatUiStack', () => {
  const baseProps = {
    serviceName: 'chat-ui',
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
    return new ChatUiStack(app, 'TestStack', baseProps);
  }

  // The custom resource's SDK call, as JSON text without its CloudFormation
  // references.
  function signInClientSettings(): string {
    const template = Template.fromStack(createStack());
    const [customResource] = Object.values(
      template.findResources('Custom::AWS'),
    );
    const [, parts] = customResource.Properties.Update['Fn::Join'] as [
      string,
      unknown[],
    ];
    return parts.filter((part) => typeof part === 'string').join('');
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

  describe('VPC', () => {
    it('creates public subnets in two availability zones and no NAT gateways', () => {
      const template = Template.fromStack(createStack());

      template.resourceCountIs('AWS::EC2::VPC', 1);
      template.resourceCountIs('AWS::EC2::Subnet', 2);
      template.resourceCountIs('AWS::EC2::InternetGateway', 1);
      template.resourceCountIs('AWS::EC2::NatGateway', 0);
    });
  });

  describe('Express service', () => {
    it('runs in the stack subnets with the health check path', () => {
      const template = Template.fromStack(createStack());

      const subnetIds = Object.keys(template.findResources('AWS::EC2::Subnet'));

      template.hasResourceProperties('AWS::ECS::ExpressGatewayService', {
        HealthCheckPath: '/api/health',
        NetworkConfiguration: {
          Subnets: subnetIds.map((id) => ({ Ref: id })),
        },
      });
    });

    it('passes the environment name and Chat API values to the container', () => {
      const template = Template.fromStack(createStack());

      template.hasResourceProperties('AWS::ECS::ExpressGatewayService', {
        PrimaryContainer: Match.objectLike({
          Environment: Match.arrayWith([
            { Name: 'ENVIRONMENT', Value: baseProps.environment },
            { Name: 'CHAT_API_URL', Value: baseProps.chatApiUrl },
            {
              Name: 'COGNITO_TOKEN_ENDPOINT',
              Value: baseProps.cognitoTokenEndpoint,
            },
            {
              Name: 'COGNITO_USER_POOL_ID',
              Value: baseProps.cognitoUserPoolId,
            },
            {
              Name: 'COGNITO_APP_CLIENT_ID',
              Value: baseProps.cognitoAppClientId,
            },
            { Name: 'COGNITO_SIGN_IN_CLIENT_ID', Value: Match.anyValue() },
          ]),
        }),
      });
    });

    it('lets the task role describe the Chat API user pool client', () => {
      const template = Template.fromStack(createStack());

      const services = template.findResources(
        'AWS::ECS::ExpressGatewayService',
      );
      const taskRoleId =
        Object.values(services)[0].Properties.TaskRoleArn['Fn::GetAtt'][0];

      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: [
            {
              Action: 'cognito-idp:DescribeUserPoolClient',
              Effect: 'Allow',
              Resource: baseProps.cognitoUserPoolArn,
            },
          ],
        },
        Roles: [{ Ref: taskRoleId }],
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

  describe('Session secret', () => {
    it('passes a generated secret to the container', () => {
      const template = Template.fromStack(createStack());

      template.resourceCountIs('AWS::SecretsManager::Secret', 1);
      template.hasResourceProperties('AWS::ECS::ExpressGatewayService', {
        PrimaryContainer: Match.objectLike({
          Secrets: [{ Name: 'SESSION_SECRET', ValueFrom: Match.anyValue() }],
        }),
      });
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

    it('applies the authorization code grant once the service exists', () => {
      expect(signInClientSettings()).toContain('"AllowedOAuthFlows":["code"]');
    });

    it('allows a localhost callback in ephemeral environments', () => {
      expect(signInClientSettings()).toContain('http://localhost:3000');
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
