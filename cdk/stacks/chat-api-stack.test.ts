import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import baseContext from '../cdk.json' with { type: 'json' };
import { Tags, Template, Match } from 'aws-cdk-lib/assertions';
import { vi, describe, it } from 'vitest';
import { ChatApiStack } from './chat-api-stack.ts';

const context = {
  ...baseContext,
  // prevent stacks from being bundled
  'aws:cdk:bundling-stacks': [],
};

describe('ChatApiStack', () => {
  const baseProps = {
    serviceName: 'chat-api',
    teamName: 'chat',
    repositoryUrl: 'https://example.com/repo',
    environment: 'testing',
  };

  function stackTemplate() {
    const app = new cdk.App({ context });
    const stack = new ChatApiStack(app, 'TestStack', baseProps);
    return Template.fromStack(stack);
  }

  describe('Stack tags', () => {
    function stackTags() {
      const app = new cdk.App({ context });
      const stack = new ChatApiStack(app, 'TestStack', baseProps);
      return Tags.fromStack(stack);
    }

    it('sets common tags ', () => {
      stackTags().hasValues({
        ServiceName: baseProps.serviceName,
        TeamName: baseProps.teamName,
        RepositoryUrl: baseProps.repositoryUrl,
        Environment: baseProps.environment,
      });
    });
  });

  describe('API lambda function', () => {
    it('creates the lambda', () => {
      const template = stackTemplate();

      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: Match.stringLikeRegexp('api-function'),
        Runtime: Match.stringLikeRegexp('python'),
      });
    });

    it('turns on snapstart for non-ephemeral environments', () => {
      vi.stubEnv('ENVIRONMENT', 'prod');

      const prodTemplate = stackTemplate();

      prodTemplate.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: Match.stringLikeRegexp('api-function'),
        SnapStart: {
          ApplyOn: 'PublishedVersions',
        },
      });

      vi.unstubAllEnvs();

      const template = stackTemplate();

      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: Match.stringLikeRegexp('api-function'),
        SnapStart: Match.absent(),
      });
    });

    it('aliases the function as published', () => {
      const template = stackTemplate();

      template.hasResourceProperties('AWS::Lambda::Alias', {
        Name: 'published',
      });
    });

    it('applies a policy to allow invoking Bedrock', () => {
      const template = stackTemplate();

      const resources = template.findResources('AWS::Lambda::Function', {
        Properties: {
          FunctionName: Match.stringLikeRegexp('api-function'),
        },
      });

      const roleId =
        Object.values(resources)[0].Properties.Role['Fn::GetAtt'][0];

      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: [
                'bedrock:InvokeModel',
                'bedrock:InvokeModelWithResponseStream',
              ],
            }),
          ]),
        },
        Roles: Match.arrayWith([Match.objectLike({ Ref: roleId })]),
      });
    });
  });

  describe('API gateway', () => {
    it('creates an API gateway', () => {
      const template = stackTemplate();

      template.resourceCountIs('AWS::ApiGateway::RestApi', 1);
    });

    it('requires IAM auth', () => {
      const template = stackTemplate();

      template.hasResourceProperties('AWS::ApiGateway::Method', {
        AuthorizationType: apigateway.AuthorizationType.IAM,
      });
    });

    it('uses the environment name for the stage', () => {
      const template = stackTemplate();

      template.hasResourceProperties('AWS::ApiGateway::Stage', {
        StageName: baseProps.environment,
      });
    });

    it('outputs the URL', () => {
      const template = stackTemplate();

      template.hasOutput('GatewayUrl', {});
    });
  });
});
