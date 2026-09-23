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

    it('passes the environment name to the container', () => {
      const template = Template.fromStack(createStack());

      template.hasResourceProperties('AWS::ECS::ExpressGatewayService', {
        PrimaryContainer: Match.objectLike({
          Environment: [{ Name: 'ENVIRONMENT', Value: baseProps.environment }],
        }),
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
