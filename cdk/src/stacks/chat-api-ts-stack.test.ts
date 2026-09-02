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
    it('creates the agent-stream lambda with AGENT_RUNTIME_ARN configured', () => {
      const template = stackTemplate();

      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: Match.stringLikeRegexp('chat-api-ts-threads-invoke-ts'),
        Environment: {
          Variables: Match.objectLike({
            AGENT_RUNTIME_ARN: baseProps.agentRuntimeArn,
            POWERTOOLS_SERVICE_NAME: 'chat-api-ts',
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

    it('requires Cognito auth on POST requests', () => {
      const template = stackTemplate();

      template.hasResourceProperties('AWS::ApiGateway::Method', {
        HttpMethod: 'POST',
        AuthorizationType: 'COGNITO_USER_POOLS',
        AuthorizationScopes: ['chat-api/invoke'],
      });
    });

    it('outputs the gateway URL', () => {
      const template = stackTemplate();

      template.hasOutput('GatewayUrl', {});
    });
  });

  describe('Cognito', () => {
    it('creates a User Pool', () => {
      const template = stackTemplate();

      template.hasResourceProperties('AWS::Cognito::UserPool', {
        UserPoolName: Match.stringLikeRegexp('chat-api-ts-user-pool'),
      });
    });

    it('creates a Resource Server with an invoke scope', () => {
      const template = stackTemplate();

      template.hasResourceProperties('AWS::Cognito::UserPoolResourceServer', {
        Identifier: 'chat-api',
        Scopes: Match.arrayWith([Match.objectLike({ ScopeName: 'invoke' })]),
      });
    });

    it('creates an App Client with client credentials flow', () => {
      const template = stackTemplate();

      template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
        AllowedOAuthFlows: ['client_credentials'],
        GenerateSecret: true,
      });
    });

    it('outputs the User Pool ID and App Client ID', () => {
      const template = stackTemplate();

      template.hasOutput('UserPoolId', {});
      template.hasOutput('AppClientId', {});
      template.hasOutput('TokenEndpoint', {});
    });
  });
});
