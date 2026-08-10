import * as cdk from 'aws-cdk-lib';
import baseContext from '../../cdk.json' with { type: 'json' };
import { Tags, Template, Match } from 'aws-cdk-lib/assertions';
import { describe, it } from 'vitest';
import { ChatApiTsStack } from './chat-api-ts-stack.ts';

const context = {
  ...baseContext,
  // prevent stacks from being bundled
  'aws:cdk:bundling-stacks': [],
};

describe('ChatApiTsStack', () => {
  const baseProps = {
    serviceName: 'chat-api',
    teamName: 'chat',
    repositoryUrl: 'https://example.com/repo',
    environment: 'testing',
    agentRuntimeArn:
      'arn:aws:bedrock-agentcore:eu-west-1:123456789012:runtime/test',
  };

  function stackTemplate() {
    const app = new cdk.App({ context });
    const stack = new ChatApiTsStack(app, 'TestStack', baseProps);
    return Template.fromStack(stack);
  }

  function stackTags() {
    const app = new cdk.App({ context });
    const stack = new ChatApiTsStack(app, 'TestStack', baseProps);
    return Tags.fromStack(stack);
  }

  describe('Stack tags', () => {
    it('sets common tags', () => {
      stackTags().hasValues({
        ServiceName: baseProps.serviceName,
        TeamName: baseProps.teamName,
        RepositoryUrl: baseProps.repositoryUrl,
        Environment: baseProps.environment,
      });
    });
  });

  describe('API lambda functions', () => {
    it('creates a hello-world lambda', () => {
      const template = stackTemplate();

      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: Match.stringLikeRegexp('chat-api-ts-hello-world-ts'),
      });
    });

    it('creates the agent-stream lambda with AGENT_RUNTIME_ARN configured', () => {
      const template = stackTemplate();

      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: Match.stringLikeRegexp('agent-stream'),
        Environment: {
          Variables: Match.objectLike({
            AGENT_RUNTIME_ARN: baseProps.agentRuntimeArn,
          }),
        },
      });
    });
  });

  describe('API Gateway', () => {
    it('creates a REST API', () => {
      const template = stackTemplate();

      template.resourceCountIs('AWS::ApiGateway::RestApi', 1);
    });

    it('exposes a /v1/hello-world resource', () => {
      const template = stackTemplate();

      template.hasResourceProperties('AWS::ApiGateway::Resource', {
        PathPart: 'v1',
      });
      template.hasResourceProperties('AWS::ApiGateway::Resource', {
        PathPart: 'hello-world',
      });
    });

    it('exposes a /v1/threads/invoke resource path', () => {
      const template = stackTemplate();

      template.hasResourceProperties('AWS::ApiGateway::Resource', {
        PathPart: 'v1',
      });
      template.hasResourceProperties('AWS::ApiGateway::Resource', {
        PathPart: 'threads',
      });
      template.hasResourceProperties('AWS::ApiGateway::Resource', {
        PathPart: 'invoke',
      });
    });

    it('requires IAM auth on GET requests', () => {
      const template = stackTemplate();

      template.hasResourceProperties('AWS::ApiGateway::Method', {
        HttpMethod: 'GET',
        AuthorizationType: 'AWS_IAM',
      });
    });

    it('requires IAM auth on POST requests', () => {
      const template = stackTemplate();

      template.hasResourceProperties('AWS::ApiGateway::Method', {
        HttpMethod: 'POST',
        AuthorizationType: 'AWS_IAM',
      });
    });

    it('outputs the gateway URL', () => {
      const template = stackTemplate();

      template.hasOutput('GatewayUrl', {});
    });
  });
});
