import * as cdk from 'aws-cdk-lib';
import baseContext from '../../cdk.json' with { type: 'json' };
import { Tags, Template, Match } from 'aws-cdk-lib/assertions';
import { vi, describe, it, afterEach } from 'vitest';
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

  afterEach(() => {
    vi.unstubAllEnvs();
  });

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
          Environment: [
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
          ],
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
  });

  describe('Log group', () => {
    it('retains the log group for non-ephemeral environments', () => {
      vi.stubEnv('ENVIRONMENT', 'prod');

      const productionTemplate = Template.fromStack(createStack());

      productionTemplate.hasResource('AWS::Logs::LogGroup', {
        DeletionPolicy: 'Retain',
      });

      vi.unstubAllEnvs();
      const template = Template.fromStack(createStack());

      template.hasResource('AWS::Logs::LogGroup', {
        DeletionPolicy: 'Delete',
      });
    });
  });
});
